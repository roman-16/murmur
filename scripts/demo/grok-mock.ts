const SENTENCE = process.env.DEMO_SENTENCE ??
    'Murmur types what I say straight into the focused field.';
const DELTA_MS = Number(process.env.DEMO_DELTA_MS ?? 320);

type Streaming = {
    index: number;
    timer: ReturnType<typeof setInterval> | null;
    words: string[];
};

const streams = new WeakMap<object, Streaming>();

const server = Bun.serve({
    port: Number(process.env.DEMO_MOCK_PORT ?? 0),
    fetch(request, self) {
        if (self.upgrade(request))
            return undefined;
        return new Response('murmur demo mock');
    },
    websocket: {
        open(socket) {
            streams.set(socket, {index: 0, timer: null, words: SENTENCE.split(' ')});
            socket.send(JSON.stringify({type: 'transcript.created'}));
        },
        close(socket) {
            const stream = streams.get(socket);
            if (stream?.timer)
                clearInterval(stream.timer);
        },
        message(socket, raw) {
            const stream = streams.get(socket);
            if (!stream)
                return;

            if (typeof raw !== 'string') {
                stream.timer ??= setInterval(() => {
                    if (stream.index >= stream.words.length) {
                        clearInterval(stream.timer!);
                        stream.timer = null;
                        return;
                    }
                    const text = stream.words.slice(0, ++stream.index).join(' ');
                    socket.send(JSON.stringify({is_final: false, start: 0, text, type: 'transcript.partial'}));
                }, DELTA_MS);
                return;
            }

            const event = JSON.parse(raw) as {type: string};
            if (event.type === 'audio.done') {
                if (stream.timer) {
                    clearInterval(stream.timer);
                    stream.timer = null;
                }
                socket.send(JSON.stringify({text: SENTENCE, type: 'transcript.done'}));
                socket.close();
            }
        },
    },
});

// With a path, because the client sends the request line the same way it does
// to the real endpoint and a bare authority is not a valid one.
console.log(`ws://127.0.0.1:${server.port}/v1/stt`);
