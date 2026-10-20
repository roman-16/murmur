import type Gio from 'gi://Gio';

import {deferred, whenCancelled} from '../async.js';
import {errorMessage, isCancelled} from '../errors.js';
import {type DictationSender, SAMPLE_RATE, type Transcription} from './provider.js';

const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;
const HEADER_BYTES = 44;

export class UploadTranscription implements Transcription {
    readonly #cancellable: Gio.Cancellable;
    readonly #completion = deferred<string>();
    readonly #release: () => void;
    readonly #send: DictationSender;

    #chunks: Uint8Array[] = [];
    #ended = false;
    #recorded = 0;
    #settled = false;

    constructor(send: DictationSender, cancellable: Gio.Cancellable) {
        this.#cancellable = cancellable;
        this.#send = send;
        this.#release = whenCancelled(cancellable, () => this.#settle(new Error('cancelled')));
    }

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
            if (!isCancelled(error))
                this.#settle(new Error(errorMessage(error)));
        });
    }

    get text(): Promise<string> {
        return this.#completion.promise;
    }

    async #transcribe(): Promise<void> {
        if (this.#settled)
            return;
        if (this.#recorded === 0) {
            this.#settle('');
            return;
        }
        this.#settle(await this.#send(this.#wave(), this.#cancellable));
    }

    // The services that take a dictation whole take it as the uncompressed WAV
    // the microphone already produces: the header in front of the samples is
    // the whole of the conversion.
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

    #settle(outcome: Error | string): void {
        if (this.#settled)
            return;
        this.#settled = true;
        this.#release();
        this.#chunks = [];
        this.#recorded = 0;
        if (typeof outcome === 'string')
            this.#completion.resolve(outcome);
        else
            this.#completion.reject(outcome);
    }
}

function tag(header: DataView, offset: number, text: string): void {
    for (let index = 0; index < text.length; index++)
        header.setUint8(offset + index, text.charCodeAt(index));
}
