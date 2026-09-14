import GLib from 'gi://GLib';

export const SAMPLE_RATE = 16000;

export type ProviderId = 'gemini' | 'mistral' | 'openrouter';

export type Provider = {
    keySource: string;
    label: string;
    // Absent where the service transcribes a recording of any length, which
    // leaves it as long as the user sets.
    maxSeconds?: number;
    vendor: string;
};

export const PROVIDER_IDS: ProviderId[] = ['gemini', 'mistral', 'openrouter'];

export const PROVIDERS: Record<ProviderId, Provider> = {
    gemini: {
        keySource: 'aistudio.google.com/apikey',
        label: 'Gemini 3.5 Transcribe Live',
        // Google ends a live transcription session after ten minutes.
        maxSeconds: 600,
        vendor: 'Gemini',
    },
    mistral: {
        keySource: 'console.mistral.ai',
        label: 'Mistral Voxtral Realtime',
        vendor: 'Mistral',
    },
    openrouter: {
        keySource: 'openrouter.ai/settings/keys',
        label: 'OpenRouter',
        // The recording is transcribed in one request, so its length is also
        // how much audio is held in memory and how much a model is asked to
        // take at once; ten minutes is as far as either goes comfortably.
        maxSeconds: 600,
        vendor: 'OpenRouter',
    },
};

export type TranscriptionEvent =
    | {kind: 'done'; text: string}
    | {kind: 'error'; message: string}
    | {kind: 'transcript'; text: string};

// What one service says over its own WebSocket: the endpoint, the frames to
// send, and the events to make of what comes back. Nothing of the microphone
// and nothing of the connection carrying them.
export type StreamProtocol = {
    audio(chunk: Uint8Array): string[];
    end(): string[];
    readonly headers: [string, string][];
    open(): string[];
    // Whether the service will accept audio yet. What the microphone produces
    // meanwhile is held rather than lost, so no dictation loses its first words.
    readonly ready: boolean;
    receive(message: string): TranscriptionEvent[];
    readonly url: string;
};

// One recording becoming words: it is fed the audio, told when the microphone
// is released, and finally hands over the transcription. Whether that happens
// over a socket that answers while the speaker talks or in a single request
// once they are done is the service's business and the recording's business
// neither way.
export type Transcription = {
    audio(chunk: Uint8Array): void;
    end(): void;
    start(): Promise<void>;
    readonly text: Promise<string>;
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
