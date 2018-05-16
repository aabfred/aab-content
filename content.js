/*global HeadersParser TextDecoder: true*/
function contentType( txt ){
    const content = this.keyattrs( ";", "mime", txt );
    for( const [k,v] of Object.entries( content ) )
        if( [ "mime", "charset" ].includes( k ) ) content[k] = v.toLowerCase();
    return content;
}

const
    { parse: qs } = require("querystring"),
    { createInflate, createGunzip } = require("zlib"),
    BodyReader = require("./body"),
    forms = require("./form"),
    multipart = require("./multipart"),

    parser = new HeadersParser({
        "content-type": { parse: contentType },
        "content-length": { key: "length", parse: "number" },
        "content-encoding": { key: "encodings", parse: [ "list", "," ], cas: "lower" },
        "content-language": { key: "languages", parse: [ "list", "," ], cas: "lower" },
    }),
    statusError = ( status, msg, cls=Error ) => Object.assign( new cls( msg ), typeof status == "number"? { status } : status ),

    BIN = [ "audio", "font", "image", "video" ],
    TEXT = [ "message", "text" ];


class ContentParser {

    constructor( options={} ){
        const { decoders, methods, compress, limit } = options;
        this.decoders = Object.assign( Object.create( this.constructor.decoders ), decoders );
        this.methods = Object.assign( Object.create( this.constructor.methods ), methods );
        this.compress = Object.assign( Object.create( this.constructor.compress ), compress );
        if( limit ) this.limit = limit;
    }

    datatype( mime ){
        if( typeof mime !== "string" ) mime = mime.mime;    // mime is content
        const [ type, sub ] = mime.split("/");
        if( type == "multipart" ) return "multi";
        if( ( sub == "json" ) || sub.endsWith( "+json" ) ) return "json";
        if( TEXT.includes( type ) || sub.endsWith( "+xml" ) ) return "text";
        if( BIN.includes( type ) ) return "buffer";
    }

    decode( content, headers, body ){
        let mime = content.mime;
        const datatype = content.datatype = this.datatype( mime ) || "buffer";
        if( datatype == "buffer" ){
            if( typeof body == "string" ) body = Buffer.from( body );
        }else{
            if( typeof body !== "string" ) body = body.toString();
            if( datatype == "json" ) body = JSON.parse( body );
            else if( datatype == "multi" ) body = multipart( this, content, headers, body );
        }
        const [ type, sub ] = mime.split("/");
        let promise = Promise.resolve( body );
        for( const pattern of [ type + "/*", "*/" + sub, mime ] ){
            const decoder = this.decoders[ pattern ];
            if( decoder ) promise = promise.then( decoder.bind( this, content, headers ) );
        }
        return promise;
    }

    parse( stream, headers ){
        const
            { methods, limit } = this,
            method = headers[":method"],
            flags = methods[ method ];
        if( !flags )
            throw statusError( 405, method );

        const
            [ path, query ] = headers[ ":path" ].split("?"),
            result = { method, path, flags },
            formOK = flags.includes("form");
        if( query ) result.query = qs( query );

        if( !formOK && !flags.includes("request") )
            return result;

        let content = parser.parse( headers );
        if( !content.mime ) return result;

        if( method == "GET" ){
            if( !query || ( content.mime !== "application/x-www-form-urlencoded" ) )
                return result;
            content.datatype = "form",
            result.body = () => Promise.resolve( result.query || {} );
        }else if( content.length == undefined )
            throw statusError( 411, "Length Required" );
        else if( limit && ( content.length > limit ) )
            throw statusError( 413, "Payload Too Large" );
        else if( content.length ){
            if( content.charset && ( content.charset !== "utf-8" ) )
                try{ content.decoder = new TextDecoder( content.charset ); }
                catch(e){ throw statusError( 415, "Charset not supported" ); }

            const decompress = [];
            if( content.encodings )
                for( const encoding of content.encodings ){
                    if( encoding == "identity" ) continue;
                    const algo = this.compress[ encoding ];
                    if( !algo ) throw statusError( 415, "Compression not supported" );
                    decompress.push( algo() );
                }

            if( formOK && ( content.mime == "text/plain" ) )
                content.mime = "text/x-form-plain";
            const body = new BodyReader( this, stream, content, headers, decompress );
            result.body = body.read.bind( body );
            result.pipe = body.pipe.bind( body );
        }
        result.content = content;
        return result;
    }

}


ContentParser.methods = {
    DELETE:  [ "idempotent" ],
    GET:     [ "response", "form", "safe", "idempotent", "cacheable" ],
    HEAD:    [ "safe", "idempotent", "cacheable" ],
    OPTIONS: [ "response", "safe", "idempotent" ],
    PATCH:   [ "request" ],
    POST:    [ "request", "response", "form", "fresh" ],// cache only if freshness information is included
    PUT:     [ "request", "idempotent" ]
};
ContentParser.compress = {
    gzip: createGunzip,
    deflate: createInflate
};
ContentParser.decoders = {};


// POST forms
ContentParser.decoders[ "text/x-form-plain" ] = forms.plain;
ContentParser.decoders[ "multipart/form-data" ] = forms.data;


module.exports = ContentParser;
