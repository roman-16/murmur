const SENTENCE = process.env.PROBE_SENTENCE;
if (!SENTENCE)
    throw new Error('PROBE_SENTENCE is unset');

const server = Bun.serve({
    async fetch(request) {
        await request.arrayBuffer();
        if (request.headers.get('authorization') === 'Bearer probe-silent')
            return Response.json({segments: [], text: ''});
        return Response.json({
            segments: [{end: 1.2, speaker_id: null, start: 0.2, text: SENTENCE}],
            text: SENTENCE,
        });
    },
    hostname: '127.0.0.1',
    port: 0,
});

console.log(`http://127.0.0.1:${server.port}/v1/audio/transcriptions`);
