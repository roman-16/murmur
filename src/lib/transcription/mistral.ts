import GLib from 'gi://GLib';

import {
    endpoint,
    errorText,
    type RecordingTranscriber,
    SAMPLE_RATE,
    type StreamProtocol,
    type TranscriptionEvent,
    unhandled
} from './provider.js';
import {transcribeUpload} from './upload.js';

const BUSY = /\b(?:MaxQueuedTokensError|QueueOverflowError)\b/;
const GRPC = /status = StatusCode\.(\w+)\s+details = "([^"]*)"/;
const MODEL = 'voxtral-mini-transcribe-realtime-2602';
const RECORDING_MODEL = 'voxtral-mini-latest';
const RECORDING_URL = 'https://api.mistral.ai/v1/audio/transcriptions';
const SERVER_FAULTS = new Set(['ABORTED', 'DATA_LOSS', 'DEADLINE_EXCEEDED', 'INTERNAL', 'UNAVAILABLE', 'UNKNOWN']);
const URL = `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=${MODEL}`;

type ServerEvent =
    | {error?: {message?: string} | string; type: 'error'}
    | {text?: string; type: 'transcription.done'}
    | {text?: string; type: 'transcription.text.delta'};

// Voxtral streams the transcription as deltas to append and finishes with the
// whole of it, so the text is simply everything that has arrived.
export class MistralProtocol implements StreamProtocol {
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
                return [{kind: 'error', message: explained(errorText(event.error))}];
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

export function mistralRecording(options: {apiKey: string}): RecordingTranscriber {
    return (audio, cancellable) => transcribeUpload({
        apiKey: options.apiKey,
        audio,
        cancellable,
        fields: [['model', RECORDING_MODEL]],
        url: RECORDING_URL,
    });
}

// Mistral passes a failure of the servers behind its realtime endpoint through
// as the dump of a Python gRPC error. A rejection by the admission control of
// their vLLM engine names the exception and says nothing else, and a fault on
// their side is detailed with the Python exception behind it, so the status is
// all that tells someone dictating what happened.
function explained(message: string): string {
    const grpc = GRPC.exec(message);
    const [, status = '', details = ''] = grpc ?? [];
    if (BUSY.test(message) || status === 'RESOURCE_EXHAUSTED')
        return 'Mistral is busy right now; try again in a moment';
    if (!grpc)
        return message;
    if (SERVER_FAULTS.has(status))
        return 'Mistral dropped the dictation; try again';
    return `Mistral failed: ${details.trim() || status}`;
}
