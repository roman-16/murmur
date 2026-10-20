import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type {Transcribed} from '../transcript.js';

export const SAMPLE_RATE = 16000;

export type ProviderId = 'mistral' | 'openrouter' | 'xai';

export type Provider = {
    dictationSeconds?: number;
    keySource: string;
    label: string;
    vendor: string;
};

export const PROVIDER_IDS: ProviderId[] = ['mistral', 'openrouter', 'xai'];

export const PROVIDERS: Record<ProviderId, Provider> = {
    mistral: {
        dictationSeconds: 600,
        keySource: 'console.mistral.ai',
        label: 'Mistral Voxtral',
        vendor: 'Mistral',
    },
    openrouter: {
        dictationSeconds: 600,
        keySource: 'openrouter.ai/settings/keys',
        label: 'OpenRouter',
        vendor: 'OpenRouter',
    },
    xai: {
        keySource: 'console.x.ai',
        label: 'Grok',
        vendor: 'xAI',
    },
};

export type TranscriptionEvent =
    | {kind: 'done'; text: string}
    | {kind: 'error'; message: string}
    | {kind: 'transcript'; text: string};

export type Frame = string | Uint8Array;

export type StreamProtocol = {
    audio(chunk: Uint8Array): Frame[];
    end(): Frame[];
    readonly headers: [string, string][];
    readonly ready: boolean;
    receive(message: string): TranscriptionEvent[];
    readonly url: string;
};

export type Transcription = {
    audio(chunk: Uint8Array): void;
    end(): void;
    start(): Promise<void>;
    readonly text: Promise<string>;
};

export type DictationSender = (wave: Uint8Array, cancellable: Gio.Cancellable) => Promise<string>;

export type RecordingTranscriber = (
    audio: Gio.File, options: {diarize: boolean}, cancellable: Gio.Cancellable) => Promise<Transcribed>;

export function oneLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

export function unhandled(event: never): TranscriptionEvent[] {
    console.debug(`murmur: ignoring unknown realtime event ${JSON.stringify(event)}`);
    return [];
}

export function isProviderId(nick: string): nick is ProviderId {
    return Object.hasOwn(PROVIDERS, nick);
}

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

export function termsWithin(terms: string[], limits: {count: number; length: number}): string[] {
    return terms.filter(term => term.length <= limits.length).slice(0, limits.count);
}

export function numberOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
