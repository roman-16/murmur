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

            const event = JSON.parse(String(raw)) as {type: string};
            if (event.type === 'session.update' && !stream.timer) {
                stream.timer = setInterval(() => {
                    const word = stream.words[stream.index++];
                    if (word === undefined) {
                        clearInterval(stream.timer!);
                        stream.timer = null;
                        return;
                    }
                    const text = stream.index === 1 ? word : ` ${word}`;
                    socket.send(JSON.stringify({type: 'transcription.text.delta', text}));
                }, DELTA_MS);
            }

            if (event.type === 'input_audio.end') {
                if (stream.timer) {
                    clearInterval(stream.timer);
                    stream.timer = null;
                }
                socket.send(JSON.stringify({type: 'transcription.done', text: SENTENCE}));
            }
        },
    },
});

// With a path, because the client sends the request line the same way it does
// to the real endpoint and a bare authority is not a valid one.
console.log(`ws://127.0.0.1:${server.port}/v1/audio/transcriptions/realtime`);
