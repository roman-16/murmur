import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const SAMPLE_RATE = 16000;

export type ProviderId = 'mistral' | 'openrouter' | 'xai';

export type Provider = {
    // Absent where the service streams a dictation of any length, which leaves
    // it as long as the user sets.
    dictationSeconds?: number;
    keySource: string;
    label: string;
    // Absent where the service takes a recording far longer than anyone makes.
    recordingSeconds?: number;
    vendor: string;
};

export const PROVIDER_IDS: ProviderId[] = ['mistral', 'openrouter', 'xai'];

export const PROVIDERS: Record<ProviderId, Provider> = {
    mistral: {
        keySource: 'console.mistral.ai',
        label: 'Mistral Voxtral',
        // Voxtral Mini Transcribe 2 takes three hours of audio in one request.
        recordingSeconds: 3 * 3600,
        vendor: 'Mistral',
    },
    openrouter: {
        // A dictation is transcribed in one request, so its length is also how
        // much audio is held in memory and how much a model is asked to take at
        // once; ten minutes is as far as either goes comfortably.
        dictationSeconds: 600,
        keySource: 'openrouter.ai/settings/keys',
        label: 'OpenRouter',
        // An upload is capped at 25 MB, which is two hours and a quarter of the
        // recording's Opus.
        recordingSeconds: 2 * 3600,
        vendor: 'OpenRouter',
    },
    xai: {
        keySource: 'console.x.ai',
        label: 'Grok Voice Transcribe 2.0',
        vendor: 'xAI',
    },
};

export type TranscriptionEvent =
    | {kind: 'done'; text: string}
    | {kind: 'error'; message: string}
    | {kind: 'transcript'; text: string};

export type Frame = string | Uint8Array;

// What one service says over its own WebSocket: the endpoint, the frames to
// send, and the events to make of what comes back. Nothing of the microphone
// and nothing of the connection carrying them.
export type StreamProtocol = {
    audio(chunk: Uint8Array): Frame[];
    end(): Frame[];
    readonly headers: [string, string][];
    open(): Frame[];
    // Whether the service will accept audio yet. What the microphone produces
    // meanwhile is held rather than lost, so no dictation loses its first words.
    readonly ready: boolean;
    receive(message: string): TranscriptionEvent[];
    readonly url: string;
};

// One dictation becoming words: it is fed the audio, told when the microphone
// is released, and finally hands over the transcription. Whether that happens
// over a socket that answers while the speaker talks or in a single request
// once they are done is the service's business and the dictation's business
// neither way.
export type Transcription = {
    audio(chunk: Uint8Array): void;
    end(): void;
    start(): Promise<void>;
    readonly text: Promise<string>;
};

// One recording on disk becoming the text the service makes of it, untouched.
export type RecordingTranscriber = (
    audio: Gio.File, cancellable: Gio.Cancellable) => Promise<string>;

// A line break among typed keystrokes is Enter rather than a character: it sends
// the message, runs the command, submits the search. So a transcript is one line
// by the time anything shows, copies or types it.
export function oneLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

// Keeps an event switch exhaustive at compile time while staying harmless if
// the API grows an event type at runtime.
export function unhandled(event: never): TranscriptionEvent[] {
    console.debug(`murmur: ignoring unknown realtime event ${JSON.stringify(event)}`);
    return [];
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
