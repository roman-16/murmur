import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {fromAsync} from '../async.js';
import {errorMessage, isCancelled} from '../errors.js';
import type {RecordingConfig} from '../settings.js';
import {oneLine, SAMPLE_RATE, type Transcription} from '../transcription/provider.js';
import {transcriptionFor} from '../transcription/transcription.js';

const CHUNK_BYTES = (SAMPLE_RATE * 2 * 100) / 1000;
// The recorder is stopped the moment the user is, and this is how long it then
// has to hand over what it had already buffered before the dictation counts as
// spoken - so that a recorder which never closes its pipe cannot hang a panel.
const DRAIN_TIMEOUT_MS = 1000;
// Loudness reads as a curve rather than a ratio, so the meter spans the decibels
// a voice moves through: full scale down to -50 dB, and quieter than that is a
// room with nobody talking in it.
const METER_RANGE_DB = 50;
const SIGTERM = 15;
const SILENCE_RMS = 0.01;

export type SessionHandlers = {
    onLevel: (level: number) => void;
    onPartial: (text: string) => void;
    onSilence: () => void;
};

// The microphone: it opens one, meters it, watches it for silence, and hands
// what it hears to the service that turns it into words.
export class Session {
    readonly #cancellable: Gio.Cancellable;
    readonly #handlers: SessionHandlers;
    readonly #silenceLimitUs: number;
    readonly #transcription: Transcription;

    #drainId = 0;
    #ended = false;
    #recorder: Gio.Subprocess | null = null;
    #recording = true;
    #silentUs = 0;
    #strayByte: number | null = null;

    constructor(
        config: RecordingConfig, handlers: SessionHandlers, cancellable: Gio.Cancellable) {
        this.#cancellable = cancellable;
        this.#handlers = handlers;
        this.#silenceLimitUs = config.silenceSeconds * 1000000;
        // Every service's words reach the panel, the clipboard and the keyboard
        // through here, which is what makes one line a property of a transcript
        // rather than of one service or one way of delivering it.
        this.#transcription = transcriptionFor(
            config.provider, text => handlers.onPartial(oneLine(text)), cancellable);
    }

    // Records, streams and transcribes until the service is done, then resolves
    // with the full transcription.
    async run(): Promise<string> {
        const pwRecord = GLib.find_program_in_path('pw-record');
        if (!pwRecord)
            throw new Error('pw-record not found; install PipeWire');

        const argv = [
            pwRecord, '--rate', String(SAMPLE_RATE),
            '--channels', '1', '--format', 's16', '--raw', '-',
        ];
        const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE;
        try {
            this.#recorder = Gio.Subprocess.new(argv, flags);
        } catch (error) {
            throw new Error(`pw-record: ${errorMessage(error)}`);
        }

        const stdout = this.#recorder.get_stdout_pipe();
        if (!stdout)
            throw new Error('pw-record: no output stream');

        try {
            await this.#transcription.start();
        } catch (error) {
            this.#release();
            throw error;
        }

        this.#streamAudio(stdout).catch(error => {
            if (!isCancelled(error))
                console.error(`murmur: microphone: ${errorMessage(error)}`);
        });

        try {
            return oneLine(await this.#transcription.text);
        } finally {
            this.#release();
        }
    }

    // Releases the microphone; the service still owes the transcription.
    stop(): void {
        if (!this.#recording)
            return;
        this.#recording = false;
        this.#stopRecorder();
        this.#awaitDrain();
    }

    async #streamAudio(stream: Gio.InputStream): Promise<void> {
        const cancellable = this.#cancellable;

        for (;;) {
            let bytes: GLib.Bytes;
            try {
                bytes = await fromAsync(
                    callback => stream.read_bytes_async(
                        CHUNK_BYTES, GLib.PRIORITY_DEFAULT, cancellable, callback),
                    result => stream.read_bytes_finish(result));
            } catch (error) {
                if (isCancelled(error))
                    return;
                console.error(`murmur: mic read failed: ${errorMessage(error)}`);
                this.#endAudio();
                return;
            }

            if (bytes.get_size() === 0) {
                this.#endAudio();
                return;
            }

            const data = bytes.get_data();
            if (!data)
                continue;
            const chunk = this.#wholeSamples(data);
            if (chunk.length === 0)
                continue;
            this.#trackAudio(chunk);
            this.#transcription.audio(chunk);
        }
    }

    // A read from the microphone can end halfway through a sample, and half a
    // sample is not audio: a service is entitled to reject the request that
    // carries it, and one of them closes the connection over it. So the odd
    // byte waits here for the one that completes it.
    #wholeSamples(data: Uint8Array): Uint8Array {
        let chunk = data;
        if (this.#strayByte !== null) {
            chunk = new Uint8Array(data.length + 1);
            chunk[0] = this.#strayByte;
            chunk.set(data, 1);
            this.#strayByte = null;
        }
        if (chunk.length % 2 === 0)
            return chunk;
        this.#strayByte = chunk[chunk.length - 1] ?? null;
        return chunk.subarray(0, chunk.length - 1);
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
    // silence is measured in audio time, not wall time, so a backlog of buffered
    // chunks cannot be mistaken for a long pause.
    #trackAudio(data: Uint8Array): void {
        if (!this.#recording)
            return;
        const samples = data.length >> 1;
        if (samples === 0)
            return;

        const loudness = rootMeanSquare(data, samples);
        this.#handlers.onLevel(meterLevel(loudness));

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
        this.#recording = false;
        this.#clearDrain();
        this.#stopRecorder();
    }

    #clearDrain(): void {
        if (!this.#drainId)
            return;
        GLib.source_remove(this.#drainId);
        this.#drainId = 0;
    }

    #stopRecorder(): void {
        this.#recorder?.send_signal(SIGTERM);
        this.#recorder = null;
    }
}

// Signed 16-bit samples, little-endian, as the recorder writes them.
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

function meterLevel(loudness: number): number {
    if (loudness <= 0)
        return 0;
    const decibels = 20 * Math.log10(loudness);
    return Math.min(1, Math.max(0, (decibels + METER_RANGE_DB) / METER_RANGE_DB));
}
