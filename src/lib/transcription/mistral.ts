import GLib from 'gi://GLib';

import {
    endpoint,
    errorText,
    SAMPLE_RATE,
    type Transcriber,
    type TranscriptionEvent
} from './provider.js';

const MODEL = 'voxtral-mini-transcribe-realtime-2602';
const URL = `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=${MODEL}`;

type ServerEvent =
    | {error?: {message?: string} | string; type: 'error'}
    | {text?: string; type: 'transcription.done'}
    | {text?: string; type: 'transcription.text.delta'};

// Voxtral streams the transcription as deltas to append and finishes with the
// whole of it, so the text is simply everything that has arrived.
export class MistralTranscriber implements Transcriber {
    readonly headers: [string, string][];
    readonly ready = true;
    readonly url = endpoint(URL);

    readonly #delayMs: number;
    #text = '';

    constructor(options: {apiKey: string; delayMs: number}) {
        this.headers = [['Authorization', `Bearer ${options.apiKey}`]];
        this.#delayMs = options.delayMs;
    }

    audio(chunk: Uint8Array): string[] {
        return [JSON.stringify({audio: GLib.base64_encode(chunk), type: 'input_audio.append'})];
    }

    end(): string[] {
        return [
            JSON.stringify({type: 'input_audio.flush'}),
            JSON.stringify({type: 'input_audio.end'}),
        ];
    }

    open(): string[] {
        return [JSON.stringify({
            session: {
                audio_format: {encoding: 'pcm_s16le', sample_rate: SAMPLE_RATE},
                target_streaming_delay_ms: this.#delayMs,
            },
            type: 'session.update',
        })];
    }

    receive(message: string): TranscriptionEvent[] {
        let event: ServerEvent;
        try {
            event = JSON.parse(message) as ServerEvent;
        } catch {
            return [];
        }

        switch (event.type) {
            case 'error':
                return [{kind: 'error', message: errorText(event.error)}];
            case 'transcription.done':
                if (typeof event.text === 'string' && event.text.length >= this.#text.length)
                    this.#text = event.text;
                return [{kind: 'done', text: this.#text}];
            case 'transcription.text.delta':
                if (!event.text)
                    return [];
                this.#text += event.text;
                return [{kind: 'transcript', text: this.#text}];
            default:
                return unhandled(event);
        }
    }
}

// Keeps the event switch exhaustive at compile time while staying harmless if
// the API grows an event type at runtime.
function unhandled(event: never): TranscriptionEvent[] {
    console.debug(`murmur: ignoring unknown realtime event ${JSON.stringify(event)}`);
    return [];
}
