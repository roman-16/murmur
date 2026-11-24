import {expect, test} from 'bun:test';

import {
    descriptionOf,
    lineOf,
    planOf,
    spokenText,
    transcribedOf
} from '../src/lib/transcription/engine-protocol.ts';

test('each kind of line the engine prints is told apart', () => {
    expect(lineOf('{"partial": "And so"}')).toEqual({kind: 'partial', text: 'And so'});
    expect(lineOf('{"progress": {"done": 5, "total": 10}}'))
        .toEqual({kind: 'progress', progress: {done: 5, total: 10}});
    expect(lineOf('{"error": "bad.gguf isn\'t a speech model the engine can run"}'))
        .toEqual({kind: 'error', message: 'bad.gguf isn\'t a speech model the engine can run'});
    expect(lineOf('{"result": {"text": ""}}')).toEqual({kind: 'result', result: {text: ''}});
});

test('a line that is not the engine\'s is passed over', () => {
    expect(lineOf('ggml_vulkan: Found 1 Vulkan devices')).toBeNull();
    expect(lineOf('[1, 2]')).toBeNull();
    expect(lineOf('{"something": "else"}')).toBeNull();
});

test('a model is described by what it can do and the settings it takes', () => {
    const description = descriptionOf({
        device: 'NVIDIA GeForce RTX 4070 SUPER',
        languages: ['en'],
        problem: null,
        settings: [
            {default: true, kind: 'switch', live: false, name: 'live'},
            {default: -1, kind: 'integer', live: true, name: 'ParakeetBufferedStreamOptions.right_ms'},
            {default: '', kind: 'choice', live: false, name: 'language', choices: ['de', 'en']},
            {default: [], kind: 'switch', name: 'broken'},
            {default: 1, kind: 'dial', name: 'unknown'},
        ],
        streams: true,
        terms: false,
    });
    expect(description).toEqual({
        device: 'NVIDIA GeForce RTX 4070 SUPER',
        languages: ['en'],
        problem: null,
        settings: [
            {choices: [], default: true, kind: 'switch', live: false, name: 'live'},
            {
                choices: [],
                default: -1,
                kind: 'integer',
                live: true,
                name: 'ParakeetBufferedStreamOptions.right_ms',
            },
            {choices: ['de', 'en'], default: '', kind: 'choice', live: false, name: 'language'},
        ],
        streams: true,
        terms: false,
    });
});

test('a model on the processor has no device', () => {
    expect(descriptionOf({device: null}).device).toBeNull();
});

test('what is left to download is counted in bytes', () => {
    expect(planOf({bytes: 163405681, hosts: ['huggingface.co']}))
        .toEqual({bytes: 163405681, hosts: ['huggingface.co']});
    expect(planOf({})).toEqual({bytes: 0, hosts: []});
});

test('a dictation answers with its text', () => {
    expect(spokenText({text: 'Ask not.'})).toBe('Ask not.');
    expect(() => spokenText({})).toThrow();
});

test('a recording\'s words become timed utterances, one per voice and pause', () => {
    const transcribed = transcribedOf({
        words: [
            {end: 0.6, speaker: '1', start: 0.3, text: 'And'},
            {end: 1.0, speaker: '1', start: 0.7, text: 'so.'},
            {end: 3.4, speaker: '2', start: 3.0, text: 'Ja.'},
            {end: 9.0, speaker: null, start: 8.0, text: 'Danke.'},
        ],
    });
    expect(transcribed).toEqual({
        timed: true,
        utterances: [
            {end: 1.0, speaker: '1', start: 0.3, text: 'And so.'},
            {end: 3.4, speaker: '2', start: 3.0, text: 'Ja.'},
            {end: 9.0, speaker: null, start: 8.0, text: 'Danke.'},
        ],
    });
});

test('a recording without words was silent', () => {
    expect(transcribedOf({words: []})).toEqual({timed: true, utterances: []});
    expect(() => transcribedOf({text: 'no words'})).toThrow();
});
