import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type {DictationConfig} from '../settings.js';
import {oneLine, SAMPLE_RATE, type Transcription} from '../transcription/provider.js';
import {transcriptionFor} from '../transcription/transcription.js';
import {meterFromDecibels, Microphone} from './audio.js';

// The microphone is stopped the moment the user is, and this is how long it then
// has to hand over what it had already heard before the dictation counts as
// spoken - so that a microphone which never reaches its end cannot hang a panel.
const DRAIN_TIMEOUT_MS = 1000;
const SILENCE_RMS = 0.01;

export type SessionHandlers = {
    onLevel: (level: number) => void;
    onPartial: (text: string) => void;
    onSilence: () => void;
};

// One dictation's audio: it opens the microphone, meters it, watches it for
// silence, and hands what it hears to the service that turns it into words.
export class Session {
    readonly #handlers: SessionHandlers;
    readonly #silenceLimitUs: number;
    readonly #transcription: Transcription;

    #drainId = 0;
    #ended = false;
    #microphone: Microphone | null = null;
    #listening = true;
    #silentUs = 0;

    constructor(
        config: DictationConfig, handlers: SessionHandlers, cancellable: Gio.Cancellable) {
        this.#handlers = handlers;
        this.#silenceLimitUs = config.silenceSeconds * 1000000;
        // Every service's words reach the panel, the clipboard and the keyboard
        // through here, which is what makes one line a property of a transcript
        // rather than of one service or one way of delivering it.
        this.#transcription = transcriptionFor(
            config.provider, text => handlers.onPartial(oneLine(text)), cancellable);
    }

    // Listens, streams and transcribes until the service is done, then resolves
    // with the full transcription.
    async run(): Promise<string> {
        const microphone = await Microphone.open();
        this.#microphone = microphone;
        if (!this.#listening) {
            this.#release();
            return '';
        }

        try {
            await this.#transcription.start();
        } catch (error) {
            this.#release();
            throw error;
        }

        microphone.listen(chunk => {
            this.#trackAudio(chunk);
            this.#transcription.audio(chunk);
        }, () => this.#endAudio());

        try {
            return oneLine(await this.#transcription.text);
        } finally {
            this.#release();
        }
    }

    // Releases the microphone; the service still owes the transcription.
    stop(): void {
        if (!this.#listening)
            return;
        this.#listening = false;
        if (!this.#microphone)
            return;
        this.#microphone.finish();
        this.#awaitDrain();
    }

    #endAudio(): void {
        if (this.#ended)
            return;
        this.#ended = true;
        this.#clearDrain();
        this.#transcription.end();
    }

    #awaitDrain(): void {
        if (this.#drainId || this.#ended)
            return;
        this.#drainId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DRAIN_TIMEOUT_MS, () => {
            this.#drainId = 0;
            this.#endAudio();
            return GLib.SOURCE_REMOVE;
        });
    }

    // How loud the microphone is, and for how long it has been quiet. The
    // silence is measured in audio time, not wall time, so a backlog of held
    // samples cannot be mistaken for a long pause.
    #trackAudio(data: Uint8Array): void {
        if (!this.#listening)
            return;
        const samples = data.length >> 1;
        if (samples === 0)
            return;

        const loudness = rootMeanSquare(data, samples);
        this.#handlers.onLevel(loudness > 0 ? meterFromDecibels(20 * Math.log10(loudness)) : 0);

        if (!this.#silenceLimitUs)
            return;
        if (loudness >= SILENCE_RMS) {
            this.#silentUs = 0;
            return;
        }

        this.#silentUs += (samples / SAMPLE_RATE) * 1000000;
        if (this.#silentUs >= this.#silenceLimitUs)
            this.#handlers.onSilence();
    }

    #release(): void {
        this.#listening = false;
        this.#clearDrain();
        this.#microphone?.close();
        this.#microphone = null;
    }

    #clearDrain(): void {
        if (!this.#drainId)
            return;
        GLib.source_remove(this.#drainId);
        this.#drainId = 0;
    }
}

// Signed 16-bit samples, little-endian, as the microphone delivers them.
function rootMeanSquare(data: Uint8Array, samples: number): number {
    let squareSum = 0;
    for (let index = 0; index + 1 < data.length; index += 2) {
        let sample = (data[index] ?? 0) | ((data[index + 1] ?? 0) << 8);
        if (sample >= 0x8000)
            sample -= 0x10000;
        squareSum += sample * sample;
    }
    return Math.sqrt(squareSum / samples) / 32768;
}
