require("aab-utils/headersparser");

const
    assert = require("assert"),
    { Duplex } = require("stream"),
    { createReadStream } = require("fs"),
    { join } = require("path"),
    ContentParser = require("../content"),
    cp = new ContentParser({
        decoders: { "text/*": ( content, headers, text ) => typeof text == "string"? text.replace( /\n$/, "" ) : text }
    }),
    inputs = [
        [ "input1", "Rếver" ],
        [ "input1", "Bob" ],
        [ "input2", "mélanger" ]
    ];

function eqR( r, key, value ){
    const val = ( typeof value == "string" ) && value.includes('"')? "'"+ value + "'" : JSON.stringify(value);
    return it( `${key} = ${ val }`, () => assert[ typeof value == "object"? "deepEqual" : "equal" ]( r[key], value ) );
}
function eqB( r, value, datatype ){
    const val = ( typeof value == "string" ) && value.includes('"')? "'"+ value + "'" : JSON.stringify(value);
    return it( `body[${datatype}] = ${ val }`, async function(){
        const result = await r.body();
        assert[ typeof value == "object"? "deepEqual" : "equal" ]( result, value );
        assert.equal( r.content.datatype, datatype );
    });
}


describe("GET application/x-www-form-urlencoded", () => {
    const
        uri = "/form?" + inputs.map(([k,v]) => encodeURIComponent(k)+"="+encodeURIComponent(v)).join("&"),
        r = cp.parse( new Duplex(), {
            "content-type": "application/x-www-form-urlencoded",
            ":method": "GET",
            ":path": uri
        });
    eqR( r, "method", "GET" );
    eqR( r, "path", "/form" );
    eqR( r.content, "mime", "application/x-www-form-urlencoded" );
    eqR( r, "flags", [ "response", "form", "safe", "idempotent", "cacheable" ] );
    eqB( r, r.query, "form" );
});


describe("PUT text/plain => ERROR", () => {
    let err;
    try{
        cp.parse( new Duplex(), {
            "content-type": "text/plain",
            ":method": "PUT",
            ":path": "/text"
        });
    }catch(e){ err = e; }
    eqR( err, "status", 411 );
    eqR( err, "message", "Length Required" );
});


describe("PUT text/plain", () => {
    const
        fsst = createReadStream( join( __dirname, "test.txt" ) ),
        r = cp.parse(
            new Duplex({read(){
                fsst.on("data", c => this.push(c))
                    .on("end", () => this.push(null));
            }}),
            {
                "content-type": "text/plain",
                "content-length": "10",
                ":method": "PUT",
                ":path": "/text"
            });
    eqR( r, "method", "PUT" );
    eqR( r, "path", "/text" );
    eqR( r.content, "mime", "text/plain" );
    eqR( r, "flags", [ "request", "idempotent" ] );
    eqB( r, "Test - OK", "text" );
});


describe("PUT text/plain ( with gzip )", () => {
    const
        fsst = createReadStream( join( __dirname, "test.txt.gz" ) ),
        r = cp.parse(
            new Duplex({read(){
                fsst.on("data", c => this.push(c))
                    .on("end", () => this.push(null));
            }}),
            {
                "content-type": "text/plain",
                "content-encoding": "gzip",
                "content-length": "30",
                ":method": "PUT",
                ":path": "/text"
            });
    eqR( r, "method", "PUT" );
    eqR( r, "path", "/text" );
    eqR( r.content, "mime", "text/plain" );
    eqR( r, "flags", [ "request", "idempotent" ] );
    eqB( r, "Test - OK", "text" );
});


describe("POST text/plain ( HTML5 form )", () => {
    const
        rs = Buffer.from(inputs.map(([k,v]) => [k,v].join("=")).join("\r\n")),
        r = cp.parse(
            new Duplex({read(){
                this.push(rs);
                this.push(null);
            }}),
            {
                "content-type": "text/plain",
                "content-length": String( rs.length ),
                ":method": "POST",
                ":path": "/text"
            });
    eqR( r, "method", "POST" );
    eqR( r, "path", "/text" );
    eqR( r.content, "mime", "text/x-form-plain" );
    eqR( r, "flags", [ "request", "response", "form", "fresh" ] );
    eqB( r, {"input1":["Rếver","Bob"],"input2":"mélanger"}, "form" );
});


describe("POST multipart/form-data", () => {
    const
        fsst = createReadStream( join( __dirname, "formdata.txt" ) ),
        r = cp.parse(
            new Duplex({read(){
                fsst.on("data", c => this.push(c))
                    .on("end", () => this.push(null));
            }}),
            {
                "content-type": "multipart/form-data; boundary=---------------------------114772229410704779042051621609",
                "content-length": "1770",
                ":method": "POST",
                ":path": "/data"
            });
    eqR( r, "method", "POST" );
    eqR( r, "path", "/data" );
    eqR( r.content, "mime", "multipart/form-data" );
    eqR( r.content, "length", 1770 );
    eqR( r, "flags", [ "request", "response", "form", "fresh" ] );
    eqR( r.content, "boundary", "---------------------------114772229410704779042051621609" );
    const promise = r.body();
    it( `body[form]`, async function(){
        await promise;
        assert.equal( r.content.datatype, "form" );
    });
    it( `body.name = "AJ ONeal"`, async function(){
        const body = await promise;
        assert.equal( body.name, "AJ ONeal" );
    });
    it( `body.email = "coolaj86@gmail.com"`, async function(){
        const body = await promise;
        assert.equal( body.email, "coolaj86@gmail.com" );
    });
    it( `body.avatar = Buffer( PNG smiley-cool.png )`, async function(){
        const body = await promise;
        assert.equal( body.avatar.content.mime, "image/png" );
        assert.equal( body.avatar.content.filename, "smiley-cool.png" );
        assert.equal( body.avatar.content.datatype, "buffer" );
    });
    it( `body.attachment = [2x text/plain fileN.txt "This is file N..."]`, async function(){
        const body = await promise;
        assert.equal( body.attachments.length, 2 );
        body.attachments.every(
            (x,i) => assert.equal( x.content.mime, "text/plain" ) &&
                assert.equal( x.content.datatype, "text" ) &&
                assert.equal( x.content.filename, `file${ i + 1 }.txt` ) &&
                assert.equal( x.body.substr(0,14), "This is file " + (i + 1) )
        );
    });
});
