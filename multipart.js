/*global HeadersParser: true*/
const
    mparser = new HeadersParser({
        "content-type": { parse: [ "keyattrs", ";", "mime" ], cas: "lower" },
        "content-disposition": { parse: [ "keyattrs", ";", "disposition" ], cas: "lower" }
    }),

    LF = "\r\n",
    RE_HEADER = /^([^:\s]+):\s*(.*)$/,
    RE_TOHEAD = /\s*\r\n\s*/g;


function toHeaders( pairs ){
    let old;
    return pairs.reduce( ( headers, [k,v] ) => {
        k = k.toLowerCase();
        const value = v.replace( RE_TOHEAD, " " );
        if( !( k in headers ) ) headers[k] = value;
        else if( Array.isArray( old = headers[k] ) ) old.push( value );
        else headers[k] = [ old, value ];
        return headers;
    }, {});
}


function split( boundary, lines ){
    if(typeof lines == "string") lines = lines.split( LF );

    const
        parts = [],
        start = "--" + boundary,
        end = start + "--";
    let m, header, headers, body;

    for( const line of lines ){
        if( [ start, end ].includes( line ) && body ){
            headers = toHeaders( headers );
            parts.push({
                content: mparser.parse( headers ),
                headers: headers,
                body: body.join( LF )
            });
        }
        if( line == end )
            return parts;
        else if( line == start )
            headers = [],
            body = null;
        else if( body )
            body.push( line );
        else if( headers ){
            if( line ){
                if( ( m = line.match( RE_HEADER ) ) )
                    headers.push( header = m.slice(1) );
                else
                    header[1] += "\r\n" + line;
            }else
                body = [];
        }
    }
}

module.exports = function multipart( parser, content, headers, text ){
    return Promise.all(
        split( content.boundary, text )
            .map( x => {
                const { content: c, headers: h, body: b } = x;
                return c.mime?
                    parser
                        .decode( c, h, b )
                        .then( r => ({ content: c, headers: h, body: r }) ) :
                    x;
            })
    );
};
