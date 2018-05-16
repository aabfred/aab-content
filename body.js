const
    { Transform, pipeline } = require("stream"),
    STOPS = [
        [ 400, "Length mismatch" ],
        [ 413, "Payload Too Large" ]
    ];


class SizeChecker extends Transform {

    constructor( body, size, islimit ){
        super();
        this.body = body;
        this.received = 0;
        this.size = size;
        this.islimit = !!islimit;
        this.raise = body.stop.bind( body, ...STOPS[ Number( this.islimit ) ] );
    }
    _transform( chunk, encoding, callback ){
        if( this.error )
            return callback( this.error );

        this.received += chunk.length;
        if( this.received > this.size )
            this.error = this.raise();
        else
            this.push( chunk, encoding );
        callback( this.error );
    }
    _flush( callback ){
        if( !this.error ){
            if( this.islimit || ( this.received == this.size ) )
                this.push( null );
            else
                this.error = this.raise();
        }
        callback( this.error );
    }
}


class BodyReader {

    static statusError( status, msg, cls=Error ){
        return Object.assign( new cls( msg ), typeof status == "number"? { status } : status );
    }

    constructor( parser, stream, content, headers, decompress ){
        Object.assign( this, { stream, decompress, decoder: content.decoder, pipes: new Set(), chunks: [] });
        this.decode = parser.decode.bind( parser, content, headers );
        // Check length before decompression
        decompress.unshift( new SizeChecker( this, content.length ) );
        // Check limit after decompression
        if( parser.limit )
            decompress.push( new SizeChecker( this, parser.limit, true ) );
    }

    stop( status, data ){
        if( this.end ) return;

        this.end = true;
        for( const [k,v] of Object.entries( this.listeners ) )
            this.stream.removeListener( k, v );

        if( status ){
            const error = this.error = data instanceof Error?
                Object.assign( data, { status: data.status || status } ) :
                BodyReader.statusError( status, data );
            for( const stream of this.pipes )
                process.nextTick(() => stream.destroy( error ));
            process.nextTick(() => this.stream.resume() );
            this.reject( error );
            return error;
        }

        if( this.decoder ){
            const chunk = this.decoder.decode();
            if( chunk ){
                this.chunks.push( chunk );
                for( const stream of this.pipes )
                    process.nextTick(() => stream.write( chunk ));
            }
        }
        data = this.decoder?
            this.chunks.join("") :
            Buffer.from( ...this.chunks );

        for( const stream of this.pipes )
            process.nextTick(() => stream.end());

        this.resolve( this.decode( data ) );
    }

    read(){
        return this.promise || (
            this.promise = new Promise( ( resolve, reject ) => {
                let { stream, decompress } = this;
                const listeners = {};
                Object.assign( this, { listeners, resolve, reject });
                ( this.stream = pipeline( stream, ...decompress ) )
                    .on( "data", listeners.data = this.onData.bind( this ) )
                    .once( "error", listeners.error = this.stop.bind( this, 500 ) )
                    .once( "end", listeners.end = this.stop.bind( this, null ) );
            })
        );
    }

    pipe( stream ){
        return new Promise(
            ( resolve, reject ) => {
                if( this.error )
                    return reject( this.error );
                stream
                    .once( "error", e => reject(e) )
                    .once( "finish", () => resolve( stream ) );
                const chunks = this.chunks;
                let n=0;
                while( n < chunks.length )
                    stream.write( chunks[ n++ ] );
                if( this.end )
                    stream.end();
                else{
                    this.pipes.add( stream );
                    if( !this.promise ) this.read();
                }
            }
        ).then(
            () => {
                this.pipes.delete( stream );
                return stream;
            },
            e => {
                stream.destroy( e );
                throw e;
            }
        );
    }

    onData( chunk ){
        if( this.end ) return;
        if( this.decoder )
            chunk = this.decoder.decode( chunk, { stream: true } );
        this.chunks.push( chunk );
        for( const stream of this.pipes )
            stream.write( chunk );
    }
}


module.exports = BodyReader;
