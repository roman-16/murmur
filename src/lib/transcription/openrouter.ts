import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {deferred, fromAsync, whenCancelled} from '../async.js';
import {errorMessage, isCancelled} from '../errors.js';
import {
    errorText,
    type RecordingTranscriber,
    SAMPLE_RATE,
    type Transcription
} from './provider.js';
import {transcribeUpload} from './upload.js';

const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;
const HEADER_BYTES = 44;
// OpenRouter gives the model it routes to a minute to answer.
const TIMEOUT_SECONDS = 60;
const URL = 'https://openrouter.ai/api/v1/audio/transcriptions';

type Answer = {error?: {message?: string} | string; text?: string};

// OpenRouter transcribes a dictation in one request rather than while it is
// spoken, so there is nothing to show until the speaker stops: the audio is
// kept as it is heard and sent whole the moment the microphone is released.
export class OpenRouterTranscription implements Transcription {
    readonly #apiKey: string;
    readonly #cancellable: Gio.Cancellable;
    readonly #completion = deferred<string>();
    readonly #model: string;
    readonly #release: () => void;

    #chunks: Uint8Array[] = [];
    #ended = false;
    #http: Soup.Session | null = null;
    #recorded = 0;
    #settled = false;

    constructor(options: {apiKey: string; model: string}, cancellable: Gio.Cancellable) {
        this.#apiKey = options.apiKey;
        this.#cancellable = cancellable;
        this.#model = options.model;
        this.#release = whenCancelled(cancellable, () => this.#abort());
    }

    // Nothing is opened ahead of the dictation: the service learns of it when
    // the whole of it arrives.
    async start(): Promise<void> {}

    audio(chunk: Uint8Array): void {
        if (this.#ended)
            return;
        this.#chunks.push(chunk);
        this.#recorded += chunk.length;
    }

    end(): void {
        if (this.#ended)
            return;
        this.#ended = true;
        this.#transcribe().catch(error => {
            if (isCancelled(error))
                return;
            this.#fail(errorMessage(error));
        });
    }

    get text(): Promise<string> {
        return this.#completion.promise;
    }

    async #transcribe(): Promise<void> {
        if (this.#settled)
            return;
        if (this.#recorded === 0) {
            this.#finish('');
            return;
        }

        const http = new Soup.Session({timeout: TIMEOUT_SECONDS});
        this.#http = http;

        const message = Soup.Message.new('POST', URL);
        message.get_request_headers().append('Authorization', `Bearer ${this.#apiKey}`);
        message.set_request_body_from_bytes('application/json', new TextEncoder().encode(
            JSON.stringify({
                input_audio: {data: GLib.base64_encode(this.#wave()), format: 'wav'},
                model: this.#model,
            })));

        const reply = await fromAsync(
            callback => http.send_and_read_async(
                message, GLib.PRIORITY_DEFAULT, this.#cancellable, callback),
            result => http.send_and_read_finish(result));

        const status = message.get_status();
        const answer = parse(reply.get_data());
        if (answer?.error)
            throw new Error(errorText(answer.error));
        if (status !== Soup.Status.OK)
            throw new Error(`the service answered ${status}`);
        if (typeof answer?.text !== 'string')
            throw new Error('the service sent no transcription');
        this.#finish(answer.text);
    }

    // The endpoint takes a file rather than a stream of samples, and the models
    // that transcribe a dictation best take it as the uncompressed WAV the
    // microphone already produces: the header in front of the samples is the
    // whole of the conversion.
    #wave(): Uint8Array {
        const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);
        const wave = new Uint8Array(HEADER_BYTES + this.#recorded);
        const header = new DataView(wave.buffer, 0, HEADER_BYTES);

        tag(header, 0, 'RIFF');
        header.setUint32(4, HEADER_BYTES - 8 + this.#recorded, true);
        tag(header, 8, 'WAVE');
        tag(header, 12, 'fmt ');
        header.setUint32(16, 16, true);
        header.setUint16(20, 1, true);
        header.setUint16(22, CHANNELS, true);
        header.setUint32(24, SAMPLE_RATE, true);
        header.setUint32(28, SAMPLE_RATE * blockAlign, true);
        header.setUint16(32, blockAlign, true);
        header.setUint16(34, BITS_PER_SAMPLE, true);
        tag(header, 36, 'data');
        header.setUint32(40, this.#recorded, true);

        let offset = HEADER_BYTES;
        for (const chunk of this.#chunks) {
            wave.set(chunk, offset);
            offset += chunk.length;
        }
        this.#chunks = [];
        return wave;
    }

    #finish(text: string): void {
        if (this.#settled)
            return;
        this.#settled = true;
        this.#release();
        this.#dispose();
        this.#completion.resolve(text);
    }

    #fail(reason: string): void {
        if (this.#settled)
            return;
        this.#settled = true;
        this.#release();
        this.#dispose();
        this.#completion.reject(new Error(reason));
    }

    #abort(): void {
        if (this.#settled)
            return;
        this.#settled = true;
        this.#dispose();
        this.#completion.reject(new Error('cancelled'));
    }

    #dispose(): void {
        this.#chunks = [];
        this.#recorded = 0;
        if (this.#http) {
            this.#http.abort();
            this.#http = null;
        }
    }
}

export function openrouterRecording(
    options: {apiKey: string; model: string}): RecordingTranscriber {
    return (audio, cancellable) => transcribeUpload({
        apiKey: options.apiKey,
        audio,
        cancellable,
        fields: [['model', options.model]],
        url: URL,
    });
}

function parse(data: Uint8Array | null): Answer | null {
    if (!data)
        return null;
    try {
        return JSON.parse(new TextDecoder().decode(data)) as Answer;
    } catch {
        return null;
    }
}

function tag(header: DataView, offset: number, text: string): void {
    for (let index = 0; index < text.length; index++)
        header.setUint8(offset + index, text.charCodeAt(index));
}
