import type {Happened, Moment} from './transcript.js';

export type Head = {
    audio: string;
    computer: string;
    microphone: string | null;
    network: string | null;
    output: string | null;
};

export type ContextLog = {head: Head; moments: Happened[]};

type Field = 'boolean' | 'number' | 'string' | 'text';

const FIELDS: Record<Moment['kind'], Record<string, Field>> = {
    away: {seconds: 'number'},
    back: {},
    call: {app: 'string', on: 'boolean'},
    camera: {on: 'boolean'},
    focused: {app: 'string', title: 'string'},
    lock: {on: 'boolean'},
    microphone: {device: 'text'},
    network: {name: 'text'},
    open: {app: 'string', title: 'string'},
    output: {device: 'text'},
    playing: {app: 'string', artist: 'text', title: 'text'},
    sharing: {on: 'boolean'},
    stopped: {app: 'string'},
};

export function logLine(entry: Happened | Head): string {
    return `${JSON.stringify(entry)}\n`;
}

export function headOf(text: string): Head | null {
    const parsed = parsedLine(text.split('\n', 1)[0] ?? '');
    if (!parsed || typeof parsed.audio !== 'string' || typeof parsed.computer !== 'string')
        return null;
    return {
        audio: parsed.audio,
        computer: parsed.computer,
        microphone: textOf(parsed.microphone),
        network: textOf(parsed.network),
        output: textOf(parsed.output),
    };
}

export function contextOf(text: string, audio: string): ContextLog | null {
    const head = headOf(text);
    if (head?.audio !== audio)
        return null;
    const moments = text.split('\n').slice(1)
        .map(line => happenedOf(parsedLine(line)))
        .filter(moment => moment !== null);
    return {head, moments};
}

function happenedOf(parsed: Record<string, unknown> | null): Happened | null {
    const kind = parsed?.kind;
    if (!parsed || typeof kind !== 'string' || !Object.hasOwn(FIELDS, kind) ||
        typeof parsed.at !== 'number' || !Number.isFinite(parsed.at))
        return null;
    const happened: Record<string, unknown> = {at: parsed.at, kind};
    for (const [name, field] of Object.entries(FIELDS[kind as Moment['kind']])) {
        const value = parsed[name];
        if (field === 'text') {
            if (value !== null && typeof value !== 'string')
                return null;
        } else if (typeof value !== field) {
            return null;
        }
        happened[name] = value;
    }
    return happened as Happened;
}

function parsedLine(line: string): Record<string, unknown> | null {
    if (!line.trim())
        return null;
    try {
        const parsed: unknown = JSON.parse(line);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

function textOf(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}
