
# aab-content

a@b framework - Http2 content parser

* parses content information from headers
* automates decompression
* parses body returning object, text or buffer
* native support for text, HTML5 forms, multipart and json
* customisable to render any media type as wou want
* allows pipe copies

## Quick example

    const parse = require("aab-content");
    ...
    Promise.resolve()
        .then( parse( stream, headers ) )
        .then( result => {
            ...
            if( !result.content ){
                ...
            }else if( result.content.mime == "image/png" )
                result.pipe( fs.createWriteStream( "exemple.png" ) );
            else
                result
                    .body()
                    .then( data => {
                        /* use data */
                    })
        })
        .catch( e => stream.respond( e.status, { endStream: true } ) );

### parse( stream, headers )
Parses content returns a **result**.
Parsing may throw an **error** at any moment. That's why **parse()** is enclosed into a promise in example above *( ie. unsupported method will be detected immediatly )*.

#### errors
Error should have a status property, otherwise, you can consider that status is 400 *( ie: uncompress failure on bad content )*.
Parser doesn't replies directly. Script may alter response, especially on **405** status that requires **Allow** header to list supported methods for the requested path *( depends on your app )*.


Possible status:
* **405** with method as error message: Method is not defined in parser.methods ( see Advanced use )
* **411** "Length Required": Request should contain a Content-Length header
* **413** "Playload Too Large": Lenth or decompressed length exceeds limit option *( see Advanced use )*
* **415** "Charset not supported": You should install [full-icu](https://www.npmjs.com/package/full-icu) to resolve problems
* **415** "Compression not supported": Algorythm is not defined in parser.compress *( see Advanced use )*
* **500** with error thrown by stream reading: May be caused by socket.close() while reading
* **400** "Length mismatch": Content-Length is not correct

#### result
Result is an object containing at least:
* method *( string, upper case )*
* domain *( string, lower case )*
* protocol *( string, lower case )*
* path *( without query string )*
* flags *( array of lower case strings )*
* port *( number if defined in url )*
* hash *( string, lower case if defined in url )*
* username *( string, if defined in url )*
* password *( string, if defined in url )*
* query *( object resulting querystring.parse() on defined query )*

On content, result also contains:
* a content object
* a body() method to read content
* a pipe() method to copy content to streams *( not available on application/x-www-form-urlencoded )*

Example:

    {
        method: "POST",
        path: "/requested/path",
        flags: [ "request", "response", "form", "fresh" ],
        query: { a: "1", b: ["2","3"] },
        content: {
            mime: "multipart/form-data",
            length: 126,
            charset: "iso-8859-1",
            boundary: "------Boundary",
            encodings: ["gzip"],
            languages: ["fr", "fr-fr"],
            custom: "Custom content-type attribute example"
        },
        body(),
        pipe()
    }


#### result.flags
Flags are keywords reflecting HTTP method properties:
* **request** = Request has body
* **response** = Successful response has body
* **form** = Allowed in HTML forms
* **safe** = Doesn't alter the state of the server
* **idempotent** = Many calls will act as a single call
* **cacheable** = Response can be cached
* **fresh** = cacheable only if freshness information is included

#### result.content
Content is an object containing:
* **mime** *( string, lower case )* = media type, allways defined
* **length** *( number )* = Content-Length header *( absent on application/x-www-form-urlencoded )*
* **charset** *( string, lower case, optional )*
* **boundary** *( string, optional )* = multipart boundary
* **encodings** *( array of strings, optional )* = Content-Encoding header
* **languages** *( array of strings, optional )* = Content-Language header
* other custom attributes defined in Content-Type *( string )*


##### Note for HTML5 "text/plain" forms:
When method is POST and media type is "text/plain", it is supposed to be an HTML5 form answer, and **content.mime** is **text/x-form-plain**.

If you don't plan to use text/plain to submit forms, you can override **text/x-form-plain** decoder *( see Advanced use )*.

#### result.body()
Read body, returning a promise.


The kind of result returned by promise is defined in content.datatype:
* **form** for application/x-www-form-urlencoded, multipart/form-data, text/x-form-plain
* **json** for &#042;/json and &#042;/&#042;+json
* **multi** for multipart/&#042;, result will render a tree of { content, headers, body } elements
* **text** for text/&#042; and &#042;/&#042;+xml
* **buffer** in other cases

#### result.pipe( stream )
Pipe body to a stream, returning a promise.


You can read and pipe content many times without caring for "content already read" error relative to Readable.

## Install

    npm -i aab-content aab-utils --save

As you see, it requires [aab-utils](https://www.npmjs.com/package/aab-utils), but it's not placed into dependencies as you may want to put it somewhere else in your app tree.

## Advanced use
### new ContentParser( options )

By default, **index.js** builds an instance of ContentParser with no options and returns parser.parse() method.

You may define options by creating your own ContentParser.

    require("aab-utils/headersparser");
    const
        ContentParser = require("aab-content/content"),
        parser = new ContentParser({
            decoders: {
	            "text/*": ( content, headers, text ) => typeof text == "string"? text.replace( /\n$/, "" ) : text
	        }
        });
    ...
    parser.parse( stream, headers );

In options, you can define or override:
* **methods**, { METHOD: flags, ... }
* **decoders**, { "type/subtype": handler, "&#042;/subtype": handler, "type/&#042;": handler }
* **compress**, { name: handler }
* **limit**, number of bytes accepted for request content


Limit, when defined is checked twice:
* if Content-Length header is higher
* if decompressed result is higher
### ContentParser.prototype.datatype( mime )
This function returns the value that will define content.datatype.

### ContentParser.prototype.decode( content, headers, body )
This function parses uncompressed stream data *( text or buffer )* collected in body parameter.
It returns a promise.
You'd better use **decoders** instead of overriding this function. Otherwise, don't forget to define **content.datatype**.
