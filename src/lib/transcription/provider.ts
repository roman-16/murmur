import GLib from 'gi://GLib';

export const SAMPLE_RATE = 16000;

export type ProviderId = 'gemini' | 'mistral';

export type Provider = {
    keySource: string;
    label: string;
    // Absent where the service ends no session of its own, which leaves the
    // recording as long as the user sets it.
    maxSessionSeconds?: number;
    vendor: string;
};

export const PROVIDER_IDS: ProviderId[] = ['gemini', 'mistral'];

export const PROVIDERS: Record<ProviderId, Provider> = {
    gemini: {
        keySource: 'aistudio.google.com/apikey',
        label: 'Gemini 3.5 Transcribe Live',
        // Google ends a live transcription session after ten minutes.
        maxSessionSeconds: 600,
        vendor: 'Gemini',
    },
    mistral: {
        keySource: 'console.mistral.ai',
        label: 'Mistral Voxtral Realtime',
        vendor: 'Mistral',
    },
};

export type TranscriptionEvent =
    | {kind: 'done'; text: string}
    | {kind: 'error'; message: string}
    | {kind: 'transcript'; text: string};

export type Transcriber = {
    audio(chunk: Uint8Array): string[];
    end(): string[];
    readonly headers: [string, string][];
    open(): string[];
    // Whether the service will accept audio yet. A session holds what the
    // microphone produces until it does, rather than losing the first words.
    readonly ready: boolean;
    receive(message: string): TranscriptionEvent[];
    readonly url: string;
};

// A line break among typed keystrokes is Enter rather than a character: it sends
// the message, runs the command, submits the search. So a transcript is one line
// by the time anything shows, copies or types it.
export function oneLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

export function isProviderId(nick: string): nick is ProviderId {
    return nick in PROVIDERS;
}

// The override exists so the demo recording can drive a scripted endpoint
// instead of billing a real one; nothing sets it in a normal session.
export function endpoint(url: string): string {
    return GLib.getenv('MURMUR_REALTIME_URL') || url;
}

export function errorText(error: {message?: string} | string | undefined): string {
    if (typeof error === 'string')
        return error;
    if (typeof error?.message === 'string')
        return error.message;
    return JSON.stringify(error);
}
