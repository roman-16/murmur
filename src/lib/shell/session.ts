import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {deferred} from '../async.js';
import {errorMessage, isCancelled} from '../errors.js';
import {
    parseServerEvent,
    REALTIME_URL,
    SAMPLE_RATE,
    serverErrorMessage,
    unhandledEvent,
    type ClientMessage
} from '../protocol.js';
import type {RecordingConfig} from '../settings.js';

const CHUNK_BYTES = (SAMPLE_RATE * 2 * 100) / 1000;
const SILENCE_RMS = 0.01;

export type SessionHandlers = {
    onPartial: (text: string) => void;
    onSilence: () => void;
};

export class Session {
    readonly #cancellable: Gio.Cancellable;
    readonly #completion = deferred<string>();
    readonly #config: RecordingConfig;
    readonly #handlers: SessionHandlers;
    readonly #silenceLimitUs: number;

    #connection: Soup.WebsocketConnection | null = null;
    #http: Soup.Session | null = null;
    #recorder: Gio.Subprocess | null = null;
    #recording = true;
    #settled = false;
    #silentUs = 0;
    #text = '';

    constructor(
        config: RecordingConfig, handlers: SessionHandlers, cancellable: Gio.Cancellable) {
        this.#cancellable = cancellable;
        this.#config = config;
        this.#handlers = handlers;
        this.#silenceLimitUs = config.silenceSeconds * 1000000;
        this.#cancellable.connect(() => this.#abort());
    }

    // Records, streams and transcribes until the server is done, then resolves
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

        const uri = GLib.Uri.parse(REALTIME_URL, GLib.UriFlags.NONE);
        const message = Soup.Message.new_from_uri('GET', uri);
        message.get_request_headers().append('Authorization', `Bearer ${this.#config.apiKey}`);

        const priority = GLib.PRIORITY_DEFAULT;
        try {
            this.#connection = await http.websocket_connect_async(
                message, null, null, priority, this.#cancellable);
        } catch (error) {
            if (isCancelled(error))
                throw error;
            throw new Error(`websocket: ${errorMessage(error)}`);
        }

        const connection = this.#connection;
        connection.connect('message', (_c, type, bytes) => this.#onMessage(type, bytes));
        connection.connect('closed', () => this.#finish());
        connection.connect('error', (_c, error) => this.#fail(`websocket: ${error.message}`));

        this.#send({
            session: {
                audio_format: {encoding: 'pcm_s16le', sample_rate: SAMPLE_RATE},
                target_streaming_delay_ms: this.#config.delayMs,
            },
            type: 'session.update',
        });
        this.#streamAudio(stdout).catch(error => {
            if (!isCancelled(error))
                this.#fail(`microphone: ${errorMessage(error)}`);
        });

        return await this.#completion.promise;
    }

    // Releases the microphone; the server still owes the tail of the transcription.
    stop(): void {
        if (!this.#recording)
            return;
        this.#recording = false;
        this.#stopRecorder();
    }

    async #streamAudio(stream: Gio.InputStream): Promise<void> {
        const cancellable = this.#cancellable;

        for (;;) {
            let bytes: GLib.Bytes;
            try {
                bytes = await stream.read_bytes_async(
                    CHUNK_BYTES, GLib.PRIORITY_DEFAULT, cancellable);
            } catch (error) {
                if (!isCancelled(error))
                    console.error(`murmur: mic read failed: ${errorMessage(error)}`);
                return;
            }

            if (bytes.get_size() === 0) {
                this.#send({type: 'input_audio.flush'});
                this.#send({type: 'input_audio.end'});
                return;
            }

            const data = bytes.get_data();
            if (!data)
                continue;
            this.#send({audio: GLib.base64_encode(data), type: 'input_audio.append'});
            this.#trackSilence(data);
        }
    }

    // Measured in audio time, not wall time, so a backlog of buffered chunks
    // cannot be mistaken for a long silence.
    #trackSilence(data: Uint8Array): void {
        if (!this.#silenceLimitUs || !this.#recording)
            return;

        let squareSum = 0;
        let samples = 0;
        for (let index = 0; index + 1 < data.length; index += 2) {
            let sample = (data[index] ?? 0) | ((data[index + 1] ?? 0) << 8);
            if (sample >= 0x8000)
                sample -= 0x10000;
            squareSum += sample * sample;
            samples++;
        }
        if (samples === 0)
            return;

        if (Math.sqrt(squareSum / samples) / 32768 >= SILENCE_RMS) {
            this.#silentUs = 0;
            return;
        }

        this.#silentUs += (samples / SAMPLE_RATE) * 1000000;
        if (this.#silentUs >= this.#silenceLimitUs)
            this.#handlers.onSilence();
    }

    #onMessage(type: Soup.WebsocketDataType, bytes: GLib.Bytes): void {
        if (this.#settled || type !== Soup.WebsocketDataType.TEXT)
            return;

        const event = parseServerEvent(bytes);
        if (!event)
            return;

        switch (event.type) {
            case 'error':
                this.#fail(serverErrorMessage(event.error));
                break;
            case 'transcription.done':
                if (typeof event.text === 'string' && event.text.length >= this.#text.length)
                    this.#text = event.text;
                this.#finish();
                break;
            case 'transcription.text.delta':
                if (event.text) {
                    this.#text += event.text;
                    this.#handlers.onPartial(this.#text);
                }
                break;
            default:
                unhandledEvent(event);
        }
    }

    #send(message: ClientMessage): void {
        if (this.#connection?.get_state() === Soup.WebsocketState.OPEN)
            this.#connection.send_text(JSON.stringify(message));
    }

    #finish(): void {
        if (this.#settled)
            return;
        this.#settled = true;
        this.#cleanup();
        this.#completion.resolve(this.#text);
    }

    #fail(reason: string): void {
        if (this.#settled)
            return;
        this.#settled = true;
        this.#cleanup();
        this.#completion.reject(new Error(reason));
    }

    #abort(): void {
        if (this.#settled)
            return;
        this.#settled = true;
        this.#cleanup();
        this.#completion.reject(new Error('cancelled'));
    }

    #cleanup(): void {
        this.#recording = false;
        this.#stopRecorder();

        if (this.#connection) {
            try {
                this.#connection.close(Soup.WebsocketCloseCode.NORMAL, null);
            } catch {}
            this.#connection = null;
        }
        if (this.#http) {
            this.#http.abort();
            this.#http = null;
        }
    }

    #stopRecorder(): void {
        try {
            this.#recorder?.send_signal(15);
        } catch {}
    }
}
