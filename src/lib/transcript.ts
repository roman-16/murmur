export type Stretch = {end: number; start: number};

export type Piece = {heard: Stretch; own: Stretch};

export type Utterance = {end: number; speaker: string | null; start: number; text: string};

export type Transcribed = {timed: boolean; utterances: Utterance[]};

export type TrackPiece = {piece: Piece; transcribed: Transcribed | null};

export type Track = {diarized: boolean; pieces: TrackPiece[]; unlabelled: string | null};

export type Line = {speaker: string | null; start: number; text: string};

const DAY_SECONDS = 24 * 60 * 60;
const LONG_UTTERANCE_SECONDS = 20;
const MATCH_SECONDS = 0.5;
const PAUSE_SECONDS = 1;
const SENTENCE_END = /[.!?…]["')\]]*$/;

type Spoken = Utterance & {id: number | null};

export function untimed(text: string): Transcribed {
    const trimmed = text.trim();
    return {
        timed: false,
        utterances: trimmed ? [{end: 0, speaker: null, start: 0, text: trimmed}] : [],
    };
}

export function utterancesOf(words: Utterance[]): Utterance[] {
    const utterances: Utterance[] = [];
    let current: Utterance | null = null;
    for (const word of words) {
        const text = word.text.trim();
        if (!text)
            continue;
        if (current && continues(current, word)) {
            current.text = `${current.text} ${text}`;
            current.end = Math.max(current.end, word.end);
            continue;
        }
        current = {end: word.end, speaker: word.speaker, start: word.start, text};
        utterances.push(current);
    }
    return utterances;
}

function continues(current: Utterance, word: Utterance): boolean {
    if (word.speaker !== current.speaker || word.start - current.end >= PAUSE_SECONDS)
        return false;
    return current.end - current.start < LONG_UTTERANCE_SECONDS || !SENTENCE_END.test(current.text);
}

export function linesOf(tracks: Track[]): Line[] {
    const spoken = tracks.flatMap((track, index) =>
        spokenOn(track).map(utterance => ({index, track, utterance})));
    spoken.sort((first, second) => first.utterance.start - second.utterance.start);

    const numbers = new Map<string, number>();
    return spoken.map(({index, track, utterance}) => {
        const {id} = utterance;
        if (!track.diarized || id === null)
            return {speaker: track.unlabelled, start: utterance.start, text: utterance.text};
        const key = `${index}:${id}`;
        const number = numbers.get(key) ?? numbers.size + 1;
        numbers.set(key, number);
        return {speaker: `Speaker ${number}`, start: utterance.start, text: utterance.text};
    });
}

export function written(lines: Line[], startedAt: number | null): string {
    return lines
        .map(line => {
            const time = clock((startedAt ?? 0) + line.start);
            return line.speaker ? `${time} ${line.speaker}: ${line.text}` : `${time} ${line.text}`;
        })
        .join('\n\n');
}

function clock(seconds: number): string {
    const within = ((Math.floor(seconds) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
    return [within / 3600, (within % 3600) / 60, within % 60]
        .map(part => String(Math.floor(part)).padStart(2, '0'))
        .join(':');
}

function spokenOn(track: Track): Spoken[] {
    const kept: Spoken[] = [];
    let previous: Spoken[] | null = null;
    let previousPiece: Piece | null = null;
    let handover = -Infinity;
    let nextId = 0;

    for (const {piece, transcribed} of track.pieces) {
        const lower = Math.max(piece.own.start, handover);
        if (!transcribed?.timed) {
            const text = transcribed?.utterances.map(utterance => utterance.text).join(' ') ?? '';
            if (text)
                kept.push({end: piece.own.end, id: null, speaker: null, start: piece.own.start, text});
            previous = null;
            previousPiece = null;
            handover = piece.own.end;
            continue;
        }

        const heard = transcribed.utterances
            .map(utterance => ({
                ...utterance,
                end: utterance.end + piece.heard.start,
                start: utterance.start + piece.heard.start,
                text: utterance.text.trim(),
            }))
            .filter(utterance => utterance.text);
        const ids: Map<string, number> = previous && previousPiece
            ? matched(previous, heard, {end: previousPiece.heard.end, start: piece.heard.start})
            : new Map<string, number>();
        const current = heard.map((utterance): Spoken => {
            const {speaker} = utterance;
            if (speaker === null)
                return {...utterance, id: null};
            if (!ids.has(speaker))
                ids.set(speaker, nextId++);
            return {...utterance, id: ids.get(speaker) ?? null};
        });

        const own = current.filter(utterance =>
            (utterance.start + utterance.end) / 2 >= lower && utterance.start < piece.own.end);
        kept.push(...own);
        handover = Math.max(piece.own.end, ...own.map(utterance => utterance.end));
        previous = current;
        previousPiece = piece;
    }
    return kept;
}

function matched(
    previous: Spoken[], current: Utterance[], shared: Stretch): Map<string, number> {
    const together = new Map<string, {id: number; label: string; seconds: number}>();
    for (const before of previous) {
        if (before.id === null)
            continue;
        for (const after of current) {
            if (after.speaker === null)
                continue;
            const seconds = Math.min(before.end, after.end, shared.end) -
                Math.max(before.start, after.start, shared.start);
            if (seconds <= 0)
                continue;
            const key = `${before.id}:${after.speaker}`;
            const pair = together.get(key) ?? {id: before.id, label: after.speaker, seconds: 0};
            pair.seconds += seconds;
            together.set(key, pair);
        }
    }

    const ids = new Map<string, number>();
    const taken = new Set<number>();
    const pairs = [...together.values()].sort((first, second) => second.seconds - first.seconds);
    for (const {id, label, seconds} of pairs) {
        if (seconds < MATCH_SECONDS || ids.has(label) || taken.has(id))
            continue;
        ids.set(label, id);
        taken.add(id);
    }
    return ids;
}
