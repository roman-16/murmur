import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {deferred, fromAsync, whenCancelled} from '../async.js';
import {errorMessage, isCancelled} from '../errors.js';
import type {Frame, StreamProtocol, Transcription} from './provider.js';

// A service that has to open a session of its own gets this long to do it. Audio
// waits meanwhile, so without the bound a service that answered the handshake
// and nothing else would listen to a whole dictation and transcribe none of it.
const SETUP_TIMEOUT_MS = 10000;
// The tail of a transcription arrives after the microphone is released, so this
// is how long "Finishing…" can last before Murmur delivers what it has.
const TAIL_TIMEOUT_MS = 5000;

// A service that transcribes while the speaker talks, over a socket that carries
// audio one way and words the other. The words reach the panel as they arrive,
// and the last of them is what the dictation says.
export class StreamTranscription implements Transcription {
    readonly #cancellable: Gio.Cancellable;
    readonly #completion = deferred<string>();
    readonly #onPartial: (text: string) => void;
    readonly #protocol: StreamProtocol;
    readonly #release: () => void;

    #connection: Soup.WebsocketConnection | null = null;
    #endSent = false;
    #ended = false;
    #http: Soup.Session | null = null;
    #pending: Uint8Array[] = [];
    #setupId = 0;
    #settled = false;
    #tailId = 0;
    #text = '';

    constructor(
        protocol: StreamProtocol, onPartial: (text: string) => void,
        cancellable: Gio.Cancellable) {
        this.#cancellable = cancellable;
        this.#onPartial = onPartial;
        this.#protocol = protocol;
        this.#release = whenCancelled(cancellable, () => this.#abort());
    }

    async start(): Promise<void> {
        const http = new Soup.Session();
        this.#http = http;

        const uri = GLib.Uri.parse(this.#protocol.url, GLib.UriFlags.NONE);
        const message = Soup.Message.new_from_uri('GET', uri);
        for (const [name, value] of this.#protocol.headers)
            message.get_request_headers().append(name, value);

        const priority = GLib.PRIORITY_DEFAULT;
        try {
            this.#connection = await fromAsync(
                callback => http.websocket_connect_async(
                    message, null, null, priority, this.#cancellable, callback),
                result => http.websocket_connect_finish(result));
        } catch (error) {
            this.#settled = true;
            this.#release();
            this.#dispose();
            if (isCancelled(error))
                throw error;
            throw new Error(refusal(message) ?? `websocket: ${errorMessage(error)}`);
        }

        const connection = this.#connection;
        connection.connect('message', (_c, _type, bytes) => this.#onMessage(bytes));
        connection.connect('closed', () => this.#onClosed());
        connection.connect('error', (_c, error) => this.#fail(`websocket: ${error.message}`));

        for (const frame of this.#protocol.open())
            this.#send(frame);
        this.#awaitSetup();
    }

    audio(chunk: Uint8Array): void {
        if (!this.#protocol.ready) {
            this.#pending.push(chunk);
            return;
        }
        for (const frame of this.#protocol.audio(chunk))
            this.#send(frame);
    }

    end(): void {
        if (this.#ended)
            return;
        this.#ended = true;
        this.#flush();
        this.#awaitTail();
    }

    get text(): Promise<string> {
        return this.#completion.promise;
    }

    // The end of the audio is announced only once the audio held back for a
    // session still being opened has gone up, or the service would stop
    // listening before it heard any of it.
    #flush(): void {
        if (!this.#protocol.ready)
            return;
        if (this.#setupId) {
            GLib.source_remove(this.#setupId);
            this.#setupId = 0;
        }
        const pending = this.#pending;
        this.#pending = [];
        for (const chunk of pending)
            this.audio(chunk);
        if (!this.#ended || this.#endSent)
            return;
        this.#endSent = true;
        for (const frame of this.#protocol.end())
            this.#send(frame);
    }

    // A service may send its JSON in binary frames as readily as in text ones,
    // so the frame type says nothing about whether this is for us.
    #onMessage(bytes: GLib.Bytes): void {
        if (this.#settled)
            return;

        const data = bytes.get_data();
        if (!data)
            return;

        for (const event of this.#protocol.receive(new TextDecoder().decode(data))) {
            switch (event.kind) {
                case 'done':
                    this.#text = event.text;
                    this.#finish();
                    return;
                case 'error':
                    this.#fail(event.message);
                    return;
                case 'transcript':
                    this.#text = event.text;
                    this.#onPartial(this.#text);
                    break;
            }
        }
        this.#flush();
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
        if (this.#protocol.ready)
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

    #send(frame: Frame): void {
        if (this.#connection?.get_state() !== Soup.WebsocketState.OPEN)
            return;
        if (typeof frame === 'string')
            this.#connection.send_text(frame);
        else
            this.#connection.send_binary(frame);
    }

    #finish(): void {
        if (this.#settled)
            return;
        // Nothing arrived because the service never opened a session for the
        // audio, which is worth saying rather than closing on an empty panel.
        if (!this.#protocol.ready) {
            this.#fail('the service did not start a transcription session');
            return;
        }
        this.#settled = true;
        this.#release();
        this.#dispose();
        this.#completion.resolve(this.#text);
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
        this.#pending = [];

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
}

// A service can turn a key away before the socket opens, answering the upgrade
// with a plain HTTP status. libsoup's own error then says only that the
// handshake failed, so the status is the explanation there is.
function refusal(message: Soup.Message): string | null {
    const status = message.get_status();
    if (status < Soup.Status.CONTINUE || status === Soup.Status.SWITCHING_PROTOCOLS)
        return null;
    const reason = message.get_reason_phrase();
    return `the service refused the connection (${reason ? `${status} ${reason}` : status})`;
}
