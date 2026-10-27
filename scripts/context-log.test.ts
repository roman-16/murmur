import {expect, test} from 'bun:test';

import {contextOf, headOf, logLine} from '../src/lib/context-log.ts';

const AUDIO = '/home/roman/Documents/Murmur/2026-10-27T09-15-59.opus';

const head = {
    audio: AUDIO,
    computer: 'bt-roman',
    microphone: 'Jabra Evolve2 65 Mono',
    network: 'BlueTomato-Corp',
    output: null,
};

test('reads back what was written, line by line', () => {
    const log = [
        logLine(head),
        logLine({app: 'Brave', at: 0, kind: 'focused', title: 'Jira - Brave'}),
        logLine({at: 12.5, kind: 'lock', on: true}),
    ].join('');

    expect(contextOf(log, AUDIO)).toEqual({
        head,
        moments: [
            {app: 'Brave', at: 0, kind: 'focused', title: 'Jira - Brave'},
            {at: 12.5, kind: 'lock', on: true},
        ],
    });
});

test('skips a line cut short, a kind it does not know and a field of the wrong type', () => {
    const log = [
        logLine(head),
        logLine({at: 1, kind: 'weather', sky: 'grey'}),
        logLine({app: 'Brave', at: 2, kind: 'call', on: 'yes'}),
        logLine({app: 'Brave', artist: null, at: 3, kind: 'playing', title: null}),
        '{"at":4,"kind":"ba',
    ].join('');

    expect(contextOf(log, AUDIO)?.moments).toEqual([
        {app: 'Brave', artist: null, at: 3, kind: 'playing', title: null},
    ]);
});

test('belongs to its own recording only', () => {
    expect(contextOf(logLine(head), '/tmp/2026-10-27T09-15-59.opus')).toBeNull();
});

test('has no head before anything was written', () => {
    expect(headOf('')).toBeNull();
    expect(contextOf('', AUDIO)).toBeNull();
});
