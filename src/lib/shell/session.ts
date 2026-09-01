import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {deferred, fromAsync} from '../async.js';
import {errorMessage, isCancelled} from '../errors.js';
import type {RecordingConfig} from '../settings.js';
import {oneLine, SAMPLE_RATE, type Transcriber} from '../transcription/provider.js';
import {transcriberFor} from '../transcription/transcriber.js';

const CHUNK_BYTES = (SAMPLE_RATE * 2 * 100) / 1000;
// Loudness reads as a curve rather than a ratio, so the meter spans the decibels
// a voice moves through: full scale down to -50 dB, and quieter than that is a
// room with nobody talking in it.
const METER_RANGE_DB = 50;
const SIGTERM = 15;
const SILENCE_RMS = 0.01;
// A service that has to open a session of its own gets this long to do it. Audio
// waits meanwhile, so without the bound a service that answered the handshake
// and nothing else would record for ten minutes and transcribe nothing.
const SETUP_TIMEOUT_MS = 10000;
// The tail of a transcription arrives after the microphone is released, so this
// is how long "Finishing…" can last before Murmur delivers what it has.
const TAIL_TIMEOUT_MS = 5000;

export type SessionHandlers = {
    onLevel: (level: number) => void;
    onPartial: (text: string) => void;
    onSilence: () => void;
};

export class Session {
    readonly #cancellable: Gio.Cancellable;
    readonly #completion = deferred<string>();
    readonly #handlers: SessionHandlers;
    readonly #silenceLimitUs: number;
    readonly #transcriber: Transcriber;

    #cancelledId = 0;
    #connection: Soup.WebsocketConnection | null = null;
    #ended = false;
    #http: Soup.Session | null = null;
    #pending: Uint8Array[] = [];
    #recorder: Gio.Subprocess | null = null;
    #recording = true;
    #setupId = 0;
    #settled = false;
    #silentUs = 0;
    #strayByte: number | null = null;
    #tailId = 0;
    #text = '';

    constructor(
        config: RecordingConfig, handlers: SessionHandlers, cancellable: Gio.Cancellable) {
        this.#cancellable = cancellable;
        this.#handlers = handlers;
        this.#silenceLimitUs = config.silenceSeconds * 1000000;
        this.#transcriber = transcriberFor(config.provider);
        this.#cancelledId = cancellable.connect(() => this.#abort());
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

        const http = new Soup.Session();
        this.#http = http;

        const uri = GLib.Uri.parse(this.#transcriber.url, GLib.UriFlags.NONE);
        const message = Soup.Message.new_from_uri('GET', uri);
        for (const [name, value] of this.#transcriber.headers)
            message.get_request_headers().append(name, value);

        const priority = GLib.PRIORITY_DEFAULT;
        try {
            this.#connection = await fromAsync(
                callback => http.websocket_connect_async(
                    message, null, null, priority, this.#cancellable, callback),
                result => http.websocket_connect_finish(result));
        } catch (error) {
            if (isCancelled(error))
                throw error;
            throw new Error(`websocket: ${errorMessage(error)}`);
        }

        const connection = this.#connection;
        connection.connect('message', (_c, _type, bytes) => this.#onMessage(bytes));
        connection.connect('closed', () => this.#onClosed());
        connection.connect('error', (_c, error) => this.#fail(`websocket: ${error.message}`));

        for (const frame of this.#transcriber.open())
            this.#send(frame);
        this.#awaitSetup();
        this.#streamAudio(stdout).catch(error => {
            if (!isCancelled(error))
                this.#fail(`microphone: ${errorMessage(error)}`);
        });

        return await this.#completion.promise;
    }

    // Releases the microphone; the service still owes the tail of the transcription.
    stop(): void {
        if (!this.#recording)
            return;
        this.#recording = false;
        this.#stopRecorder();
        this.#awaitTail();
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
                if (!isCancelled(error))
                    console.error(`murmur: mic read failed: ${errorMessage(error)}`);
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
            this.#queueAudio(chunk);
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

    #queueAudio(chunk: Uint8Array): void {
        if (!this.#transcriber.ready) {
            this.#pending.push(chunk);
            return;
        }
        for (const frame of this.#transcriber.audio(chunk))
            this.#send(frame);
    }

    #flushAudio(): void {
        if (!this.#transcriber.ready)
            return;
        if (this.#setupId) {
            GLib.source_remove(this.#setupId);
            this.#setupId = 0;
        }
        if (this.#pending.length === 0)
            return;
        const pending = this.#pending;
        this.#pending = [];
        for (const chunk of pending)
            this.#queueAudio(chunk);
    }

    #endAudio(): void {
        if (this.#ended)
            return;
        this.#flushAudio();
        this.#ended = true;
        for (const frame of this.#transcriber.end())
            this.#send(frame);
        this.#awaitTail();
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

    // The Live API sends its JSON in binary frames as readily as in text ones,
    // so the frame type says nothing about whether this is for us.
    #onMessage(bytes: GLib.Bytes): void {
        if (this.#settled)
            return;

        const data = bytes.get_data();
        if (!data)
            return;

        for (const event of this.#transcriber.receive(new TextDecoder().decode(data))) {
            switch (event.kind) {
                case 'done':
                    this.#transcribe(event.text);
                    this.#finish();
                    return;
                case 'error':
                    this.#fail(event.message);
                    return;
                case 'transcript':
                    this.#transcribe(event.text);
                    this.#handlers.onPartial(this.#text);
                    break;
            }
        }
        this.#flushAudio();
    }

    // Every service's words reach the panel, the clipboard and the keyboard
    // through here, which is what makes one line a property of a transcript
    // rather than of one service or one way of delivering it.
    #transcribe(text: string): void {
        this.#text = oneLine(text);
    }

    // A close once the microphone is released is the service finishing; before
    // that it is the service refusing, and its reason is the only explanation
    // there is. A rejected key arrives exactly this way, after a handshake that
    // succeeded.
    #onClosed(): void {
        if (this.#settled)
            return;
        if (this.#ended) {
            this.#finish();
            return;
        }
        const code = this.#connection?.get_close_code() ?? 0;
        const reason = this.#connection?.get_close_data() ?? '';
        this.#fail(reason || `the connection closed (${code})`);
    }

    #awaitSetup(): void {
        if (this.#transcriber.ready)
            return;
        this.#setupId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETUP_TIMEOUT_MS, () => {
            this.#setupId = 0;
            this.#fail('the service did not start a transcription session');
            return GLib.SOURCE_REMOVE;
        });
    }

    #awaitTail(): void {
        if (this.#tailId || this.#settled)
            return;
        this.#tailId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TAIL_TIMEOUT_MS, () => {
            this.#tailId = 0;
            this.#finish();
            return GLib.SOURCE_REMOVE;
        });
    }

    #send(message: string): void {
        if (this.#connection?.get_state() === Soup.WebsocketState.OPEN)
            this.#connection.send_text(message);
    }

    #finish(): void {
        if (this.#settled)
            return;
        // Nothing arrived because the service never opened a session for the
        // audio, which is worth saying rather than closing on an empty panel.
        if (!this.#transcriber.ready) {
            this.#fail('the service did not start a transcription session');
            return;
        }
        this.#settled = true;
        this.#stopWatchingCancellation();
        this.#cleanup();
        this.#completion.resolve(this.#text);
    }

    #fail(reason: string): void {
        if (this.#settled)
            return;
        this.#settled = true;
        this.#stopWatchingCancellation();
        this.#cleanup();
        this.#completion.reject(new Error(reason));
    }

    // Runs from the cancellable's own handler, which must not be disconnected
    // from inside itself.
    #abort(): void {
        if (this.#settled)
            return;
        this.#settled = true;
        this.#cancelledId = 0;
        this.#cleanup();
        this.#completion.reject(new Error('cancelled'));
    }

    #stopWatchingCancellation(): void {
        if (!this.#cancelledId)
            return;
        this.#cancellable.disconnect(this.#cancelledId);
        this.#cancelledId = 0;
    }

    #cleanup(): void {
        this.#recording = false;
        this.#pending = [];
        this.#stopRecorder();

        if (this.#setupId) {
            GLib.source_remove(this.#setupId);
            this.#setupId = 0;
        }
        if (this.#tailId) {
            GLib.source_remove(this.#tailId);
            this.#tailId = 0;
        }
        // Closing a connection the service already closed is a warning in the
        // shell's journal, and a rejected key arrives as exactly that close.
        if (this.#connection) {
            if (this.#connection.get_state() === Soup.WebsocketState.OPEN)
                this.#connection.close(Soup.WebsocketCloseCode.NORMAL, null);
            this.#connection = null;
        }
        if (this.#http) {
            this.#http.abort();
            this.#http = null;
        }
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
