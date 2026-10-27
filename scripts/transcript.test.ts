import {expect, test} from 'bun:test';

import {
    type Header,
    linesOf,
    type Moment,
    momentText,
    type Piece,
    type Track,
    type Transcribed,
    untimed,
    type Utterance,
    utterancesOf,
    written
} from '../src/lib/transcript.ts';

const said = (start: number, end: number, speaker: string | null, text: string): Utterance =>
    ({end, speaker, start, text});

const timed = (...utterances: Utterance[]): Transcribed => ({timed: true, utterances});

const piece = (heardStart: number, ownStart: number, ownEnd: number, heardEnd: number): Piece =>
    ({heard: {end: heardEnd, start: heardStart}, own: {end: ownEnd, start: ownStart}});

const whole: Piece = piece(0, 0, 60, 60);

const microphone = (...pieces: Track['pieces']): Track =>
    ({diarized: false, pieces, unlabelled: 'Roman'});

const desktop = (...pieces: Track['pieces']): Track =>
    ({diarized: true, pieces, unlabelled: 'Others'});

test('groups words into utterances at a change of speaker or a pause', () => {
    expect(utterancesOf([
        said(0, 0.4, '0', 'Hast'),
        said(0.5, 0.8, '0', 'du'),
        said(0.9, 1.2, '0', 'Zeit?'),
        said(1.3, 1.6, '1', 'Ja,'),
        said(1.7, 2, '1', 'gleich.'),
        said(4, 4.5, '1', 'Moment.'),
    ])).toEqual([
        said(0, 1.2, '0', 'Hast du Zeit?'),
        said(1.3, 2, '1', 'Ja, gleich.'),
        said(4, 4.5, '1', 'Moment.'),
    ]);
});

test('ends a long utterance at the end of a sentence', () => {
    const words = Array.from({length: 30}, (_, index) =>
        said(index, index + 0.9, '0', index === 24 ? 'done.' : 'word'));

    const utterances = utterancesOf(words);

    expect(utterances).toHaveLength(2);
    expect(utterances[0]?.text.endsWith('done.')).toBe(true);
    expect(utterances[1]?.start).toBe(25);
});

test('writes both channels as one conversation in clock time', () => {
    const lines = linesOf([
        microphone({piece: whole, transcribed: timed(said(2, 4, null, 'Hast du den Link?'), said(20, 22, null, 'Danke.'))}),
        desktop({piece: whole, transcribed: timed(said(5, 7, 'speaker_3', 'Ja, schau in den Chat.'), said(10, 12, 'speaker_1', 'I can\'t hear you.'))}),
    ]);

    expect(written(lines, 19 * 3600 + 33 * 60 + 50)).toBe([
        '19:33:52 Roman: Hast du den Link?',
        '19:33:55 Speaker 1: Ja, schau in den Chat.',
        '19:34:00 Speaker 2: I can\'t hear you.',
        '19:34:10 Roman: Danke.',
    ].join('\n'));
});

test('counts from the start when the recording has no start time', () => {
    const lines = linesOf([desktop({piece: piece(0, 0, 120, 120), transcribed: timed(said(65, 66, 'a', 'Hi.'))})]);

    expect(written(lines, null)).toBe('00:01:05 Speaker 1: Hi.');
});

test('goes on past midnight', () => {
    const lines = linesOf([microphone({piece: whole, transcribed: timed(said(10, 11, null, 'Gute Nacht.'))})]);

    expect(written(lines, 23 * 3600 + 59 * 60 + 55)).toBe('00:00:05 Roman: Gute Nacht.');
});

test('writes what both pieces heard around a cut once', () => {
    const lines = linesOf([microphone(
        {piece: piece(0, 0, 100, 115), transcribed: timed(said(90, 95, null, 'Before.'), said(98, 103, null, 'Across.'), said(108, 110, null, 'After.'))},
        {piece: piece(85, 100, 200, 200), transcribed: timed(said(5, 10, null, 'Before.'), said(13, 15, null, 'Across.'), said(15.2, 18, null, 'tail'), said(23, 25, null, 'After.'))},
    )]);

    expect(lines.map(line => line.text)).toEqual(['Before.', 'Across.', 'After.']);
    expect(lines.map(line => line.start)).toEqual([90, 98, 108]);
});

test('keeps the same number for whoever speaks across a cut', () => {
    const lines = linesOf([desktop(
        {piece: piece(0, 0, 100, 115), transcribed: timed(said(10, 12, 'speaker_0', 'Eins.'), said(20, 22, 'speaker_1', 'Zwei.'), said(88, 95, 'speaker_0', 'Noch eins.'), said(104, 110, 'speaker_1', 'Noch zwei.'))},
        {piece: piece(85, 100, 200, 200), transcribed: timed(said(3, 10, 'speaker_1', 'Noch eins.'), said(19, 25, 'speaker_0', 'Noch zwei.'), said(40, 42, 'speaker_0', 'Drei.'), said(50, 52, 'speaker_1', 'Vier.'))},
    )]);

    expect(lines.map(line => `${line.speaker}: ${line.text}`)).toEqual([
        'Speaker 1: Eins.',
        'Speaker 2: Zwei.',
        'Speaker 1: Noch eins.',
        'Speaker 2: Noch zwei.',
        'Speaker 2: Drei.',
        'Speaker 1: Vier.',
    ]);
});

test('gives someone silent at a cut a new number', () => {
    const lines = linesOf([desktop(
        {piece: piece(0, 0, 100, 115), transcribed: timed(said(10, 12, 'a', 'Eins.'), said(20, 22, 'b', 'Zwei.'), said(95, 98, 'a', 'Weiter.'))},
        {piece: piece(85, 100, 200, 200), transcribed: timed(said(10, 13, 'x', 'Weiter.'), said(40, 42, 'y', 'Zwei wieder.'))},
    )]);

    expect(lines.map(line => line.speaker)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 1', 'Speaker 3']);
});

test('names speech without a label after its track', () => {
    const mono: Track = {diarized: true, pieces: [{piece: whole, transcribed: timed(said(1, 2, null, 'Hello.'))}], unlabelled: null};

    expect(written(linesOf([
        desktop({piece: whole, transcribed: timed(said(3, 4, null, 'Hi.'))}),
        mono,
    ]), null)).toBe('00:00:01 Hello.\n00:00:03 Others: Hi.');
});

test('writes a piece the service split into paragraphs as one line', () => {
    const lines = linesOf([desktop({piece: whole, transcribed: untimed('Erster Absatz.\n\nZweiter\nAbsatz.')})]);

    expect(written(lines, 14 * 3600 + 2 * 60 + 8)).toBe('14:02:08 Others: Erster Absatz. Zweiter Absatz.');
});

test('writes an untimed piece as one line where the piece starts', () => {
    const lines = linesOf([desktop(
        {piece: piece(0, 0, 100, 115), transcribed: untimed('All of the first piece.')},
        {piece: piece(85, 100, 200, 200), transcribed: timed(said(20, 22, 'a', 'Timed again.'))},
    )]);

    expect(lines).toEqual([
        {speaker: 'Others', start: 0, text: 'All of the first piece.'},
        {speaker: 'Speaker 1', start: 105, text: 'Timed again.'},
    ]);
});

test('skips a silent piece and numbers the next one afresh', () => {
    const lines = linesOf([desktop(
        {piece: piece(0, 0, 100, 115), transcribed: timed(said(10, 12, 'a', 'Eins.'))},
        {piece: piece(85, 100, 200, 215), transcribed: null},
        {piece: piece(185, 200, 300, 300), transcribed: timed(said(20, 22, 'a', 'Wieder da.'))},
    )]);

    expect(lines.map(line => `${line.start} ${line.speaker}`)).toEqual(['10 Speaker 1', '205 Speaker 2']);
});

test('writes nothing when nothing was heard', () => {
    expect(written(linesOf([microphone({piece: whole, transcribed: null}), desktop({piece: whole, transcribed: untimed('  ')})]), 0)).toBe('');
});

const header: Header = {
    computer: 'roman-nixos',
    day: 'Tuesday',
    ended: '2026-10-27T10:02:13',
    microphone: 'Jabra Evolve2 65 Mono',
    network: null,
    output: 'Jabra Evolve2 65 Stereo',
    started: '2026-10-27T09:15:59',
    transcribedBy: 'Mistral Voxtral (voxtral-small-transcribe-3)',
};

test('opens with where and when it was recorded, and puts what went on among what was said', () => {
    const lines = linesOf([
        microphone({piece: whole, transcribed: timed(said(2, 4, null, 'Seht ihr meinen Bildschirm?'))}),
        desktop({piece: whole, transcribed: timed(said(0, 1, 'a', 'Morgen.'))}),
    ]);

    expect(written(lines, 9 * 3600 + 15 * 60 + 59, {
        header,
        moments: [
            {app: 'Brave', at: 0, kind: 'focused', title: 'Architecture weekly | Microsoft Teams - Brave'},
            {app: 'Brave', at: 0, kind: 'call', on: true},
            {at: 3.5, kind: 'sharing', on: true},
            {at: 2, kind: 'camera', on: true},
        ],
    })).toBe([
        '---',
        'computer: roman-nixos',
        'day: Tuesday',
        'ended: 2026-10-27T10:02:13',
        'microphone: Jabra Evolve2 65 Mono',
        'output: Jabra Evolve2 65 Stereo',
        'started: 2026-10-27T09:15:59',
        'transcribed-by: Mistral Voxtral (voxtral-small-transcribe-3)',
        '---',
        '09:15:59 [focused] Brave: "Architecture weekly | Microsoft Teams - Brave"',
        '09:15:59 [on a call] Brave has the microphone',
        '09:15:59 Speaker 1: Morgen.',
        '09:16:01 [camera on]',
        '09:16:01 Roman: Seht ihr meinen Bildschirm?',
        '09:16:02 [sharing screen]',
    ].join('\n'));
});

test('quotes a header value only where YAML would read it as something else', () => {
    const text = written([], 0, {
        header: {
            ...header,
            computer: 'yes',
            ended: null,
            microphone: 'Mic: "Studio"',
            network: "Roman's iPhone, VPN BT",
            output: '2024',
        },
        moments: [],
    });

    expect(text.split('\n')).toEqual([
        '---',
        'computer: "yes"',
        'day: Tuesday',
        'microphone: "Mic: \\"Studio\\""',
        'network: "Roman\'s iPhone, VPN BT"',
        'output: "2024"',
        'started: 2026-10-27T09:15:59',
        'transcribed-by: Mistral Voxtral (voxtral-small-transcribe-3)',
        '---',
    ]);
});

test('writes the header alone when nothing was said or happened', () => {
    expect(written([], 0, {header, moments: []}).split('\n').at(-1)).toBe('---');
});

test('says each kind of moment in words', () => {
    const said: [Moment, string][] = [
        [{kind: 'away', seconds: 300}, '[away] no input for 5 minutes'],
        [{kind: 'away', seconds: 1}, '[away] no input for 1 second'],
        [{kind: 'back'}, '[back]'],
        [{app: 'Brave', kind: 'call', on: false}, '[off the call] Brave'],
        [{kind: 'camera', on: false}, '[camera off]'],
        [{app: 'Ghostty', kind: 'focused', title: ''}, '[focused] Ghostty'],
        [{app: '', kind: 'focused', title: 'Untitled'}, '[focused] "Untitled"'],
        [{kind: 'lock', on: true}, '[locked]'],
        [{kind: 'lock', on: false}, '[unlocked]'],
        [{device: null, kind: 'microphone'}, '[microphone] none'],
        [{kind: 'network', name: 'BlueTomato-Corp, VPN BT'}, '[network] BlueTomato-Corp, VPN BT'],
        [{app: 'Obsidian', kind: 'open', title: 'Backlog - vault - Obsidian'}, '[open] Obsidian: "Backlog - vault - Obsidian"'],
        [{device: 'Built-in Audio Analog Stereo', kind: 'output'}, '[output] Built-in Audio Analog Stereo'],
        [{app: 'Brave', artist: 'Some Artist', kind: 'playing', title: 'A Song\n(Live)'}, '[playing] Brave: "A Song (Live)" by Some Artist'],
        [{app: 'Discord', artist: null, kind: 'playing', title: null}, '[playing] Discord'],
        [{kind: 'sharing', on: false}, '[stopped sharing]'],
        [{app: 'Brave', kind: 'stopped'}, '[stopped] Brave'],
    ];

    expect(said.map(([moment]) => momentText(moment))).toEqual(said.map(([, text]) => text));
});
