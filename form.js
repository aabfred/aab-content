const
    { TextDecoder } = require("util"),
    keep = x => x,
    alter = ( decoder, x ) => decoder.decode( typeof x == "string"? Buffer.from(x) : x ),
    namemap = (x,i) => i? x.slice(0,-1) : x,
    namesplit = x => x.split("[").map( namemap ),
    LF = "\r\n",
    RE_DIGITS = /^\d*$/;


function formtree( form, key, keys, value ){
    if( !( key in form ) )
        form[key] = keys[0].match( RE_DIGITS )? [] : {};
    return formset( form[key], keys, value );
}

function formset( form, keys, value ){
    const name = keys.shift();
    if( keys.length )
        return formtree( form, name, keys, value );
    if( !name )
        return form.push( value );
    const old = form[ name ];
    if( old === undefined ) form[name] = value;
    else if( Array.isArray( old ) ) old.push( value );
    else form[name] = [ old, value ];
}

function formdecode( content, pairs ){
    content.datatype = "form";
    const index = pairs.findIndex( x => x[0] == "_charset_" );
    let charset = index == -1? null : pairs.splice( index, 1 )[0][1].toLowerCase();
    if( charset == "utf-8" ) charset = null;
    const
        decoder = charset && new TextDecoder( charset ),
        decode = decoder? alter.bind( null, decoder ) : keep,
        form = {};
    for( let [ name, value ] of pairs ){
        name = decode( name );
        if( typeof value == "string" )
            value = decode( value );
        else
            value.body = decode( value.body );
        formset( form, namesplit( name ), value );
    }
    return form;
}


// multipart/form-data
module.exports.data = function( content, headers, parts ){
    return formdecode( content, parts.map(
        x => [ x.content.name, "filename" in x.content? x : x.body ]
    ) );
};


// HTML5 text/plain
module.exports.plain = function( content, headers, text ){
    const pairs = [];
    let pair;
    for( const line of text.split( /\r\n/ ) ){
        const eq = line.indexOf("=");
        if( eq !== -1 )
            pairs.push( pair = [ line.substr( 0, eq ), line.substr( eq + 1 ) ] );
        else if( pair )
            pair[1] += LF + line;
    }
    return formdecode( content, pairs );
};
