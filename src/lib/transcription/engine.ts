import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {deferred, fromAsync, whenCancelled} from '../async.js';
import {cancellation} from '../errors.js';
import {exists, filesIn, readText} from '../files.js';
import {
    type Answer,
    descriptionOf,
    type DownloadPlan,
    type EngineStatus,
    lineOf,
    type ModelDescription,
    type ModelSettings,
    planOf,
    type Progress,
    statusOf
} from './engine-protocol.js';

const SIGTERM = 15;

export type EngineState =
    | {kind: 'missing'}
    | {kind: 'no-python'}
    | {kind: 'outdated'}
    | {kind: 'ready'; packaged: boolean};

export type RunOptions = {
    input?: boolean;
    onPartial?: (text: string) => void;
    onProgress?: (progress: Progress) => void;
};

type Place = {directory: string; packaged: boolean; python: string | null};

export type ModelRequest = {model: string; settings: ModelSettings; terms: string[]};

// The engine runs in a process of its own, started for one job and gone with
// it: a model loaded into the compositor would stall the desktop while it
// thinks, and GJS cannot call into the engine's C library at all.
export class Engine {
    readonly #extension: string;
    readonly #installed = new Set<() => void>();
    readonly #uuid: string;

    constructor(extension: {path: string; uuid: string}) {
        this.#extension = extension.path;
        this.#uuid = extension.uuid;
    }

    async version(): Promise<string> {
        const pins = JSON.parse(await readText(this.#file('lib', 'transcription', 'engine.json'))) as
            {version?: unknown};
        if (typeof pins.version !== 'string')
            throw new Error('engine.json names no version');
        return pins.version;
    }

    async state(): Promise<EngineState> {
        const place = await this.#place();
        if (place.packaged)
            return {kind: 'ready', packaged: true};
        if (!place.python)
            return {kind: 'no-python'};
        const directory = Gio.File.new_for_path(place.directory);
        if (await exists(directory.get_child('ready')))
            return {kind: 'ready', packaged: false};
        const root = directory.get_parent();
        for (const sibling of root ? await filesIn(root) : []) {
            if (await exists(sibling.get_child('ready')))
                return {kind: 'outdated'};
        }
        return {kind: 'missing'};
    }

    async plan(cancellable: Gio.Cancellable): Promise<DownloadPlan> {
        return planOf(await this.#answer('plan', {}, {}, cancellable));
    }

    async status(cancellable: Gio.Cancellable): Promise<EngineStatus> {
        return statusOf(await this.#answer('status', {}, {}, cancellable));
    }

    async install(onProgress: (progress: Progress) => void, cancellable: Gio.Cancellable): Promise<void> {
        await this.#answer('install', {}, {onProgress}, cancellable);
        for (const listener of this.#installed)
            listener();
    }

    onInstalled(listener: () => void): () => void {
        this.#installed.add(listener);
        return () => {
            this.#installed.delete(listener);
        };
    }

    async describe(request: ModelRequest, cancellable: Gio.Cancellable): Promise<ModelDescription> {
        return descriptionOf(await this.#answer('describe', request, {}, cancellable));
    }

    async probe(request: ModelRequest, cancellable: Gio.Cancellable): Promise<void> {
        await this.#answer('probe', request, {}, cancellable);
    }

    async start(
        command: string, request: Record<string, unknown>, options: RunOptions,
        cancellable: Gio.Cancellable): Promise<EngineRun> {
        const place = await this.#place();
        if (!place.python)
            throw new Error('Install Python 3 to transcribe on this computer');
        const helper = this.#file('lib', 'transcription', 'engine.py').get_path() ?? '';
        const argv = [
            place.python, helper, command, JSON.stringify({...request, engine: place.directory}),
        ];
        return new EngineRun(argv, options, cancellable);
    }

    async #answer(
        command: string, request: Record<string, unknown>, options: RunOptions,
        cancellable: Gio.Cancellable): Promise<Answer> {
        const run = await this.start(command, request, options, cancellable);
        return run.result;
    }

    async #place(): Promise<Place> {
        const packaged = this.#file('engine');
        if (await exists(packaged.get_child('ready'))) {
            return {
                directory: packaged.get_path() ?? '',
                packaged: true,
                python: packaged.get_child('python').get_path(),
            };
        }
        return {
            directory: GLib.build_filenamev(
                [GLib.get_user_data_dir(), this.#uuid, 'engine', await this.version()]),
            packaged: false,
            python: GLib.find_program_in_path('python3'),
        };
    }

    #file(...names: string[]): Gio.File {
        return Gio.File.new_for_path(GLib.build_filenamev([this.#extension, ...names]));
    }
}

// Standard error carries the native library's own chatter, which no one reads.
export class EngineRun {
    readonly #options: RunOptions;
    readonly #process: Gio.Subprocess;
    readonly #release: () => void;
    readonly #result = deferred<Answer>();

    #settled = false;
    #stdin: Gio.OutputStream | null;
    #writing: Promise<void> = Promise.resolve();

    constructor(argv: string[], options: RunOptions, cancellable: Gio.Cancellable) {
        const input = options.input ? Gio.SubprocessFlags.STDIN_PIPE : Gio.SubprocessFlags.NONE;
        this.#options = options;
        this.#process = Gio.Subprocess.new(argv,
            input | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        this.#stdin = options.input ? this.#process.get_stdin_pipe() : null;
        this.#result.promise.catch(() => {});
        this.#release = whenCancelled(cancellable, () => this.#cancel());
        if (cancellable.is_cancelled())
            this.#cancel();
        void this.#read();
    }

    get result(): Promise<Answer> {
        return this.#result.promise;
    }

    write(chunk: Uint8Array): void {
        const stdin = this.#stdin;
        if (!stdin || chunk.length === 0)
            return;
        this.#writing = this.#writing.then(() => writeAll(stdin, chunk)).catch(() => {});
    }

    end(): void {
        const stdin = this.#stdin;
        if (!stdin)
            return;
        this.#stdin = null;
        this.#writing = this.#writing
            .then(() => fromAsync(
                callback => stdin.close_async(GLib.PRIORITY_DEFAULT, null, callback),
                result => stdin.close_finish(result)))
            .then(() => {}, () => {});
    }

    async #read(): Promise<void> {
        try {
            const stdout = new Gio.DataInputStream({
                base_stream: this.#process.get_stdout_pipe() ?? undefined,
                close_base_stream: true,
            });
            for (;;) {
                const [text] = await fromAsync(
                    callback => stdout.read_line_async(GLib.PRIORITY_DEFAULT, null, callback),
                    result => stdout.read_line_finish_utf8(result));
                if (text === null)
                    break;
                this.#take(text);
            }
            await fromAsync(
                callback => this.#process.wait_async(null, callback),
                result => this.#process.wait_finish(result));
            this.#fail(new Error(this.#ending()));
        } catch (error) {
            this.#fail(error);
        } finally {
            this.#release();
        }
    }

    #take(text: string): void {
        const line = lineOf(text);
        switch (line?.kind) {
            case 'error':
                this.#fail(new Error(line.message));
                break;
            case 'partial':
                if (!this.#settled)
                    this.#options.onPartial?.(line.text);
                break;
            case 'progress':
                if (!this.#settled)
                    this.#options.onProgress?.(line.progress);
                break;
            case 'result':
                if (this.#settle())
                    this.#result.resolve(line.result);
                break;
            case undefined:
                break;
        }
    }

    #fail(error: unknown): void {
        if (this.#settle())
            this.#result.reject(error);
    }

    #settle(): boolean {
        if (this.#settled)
            return false;
        this.#settled = true;
        this.#stdin = null;
        return true;
    }

    #cancel(): void {
        if (this.#settled)
            return;
        this.#process.send_signal(SIGTERM);
        this.#fail(cancellation());
    }

    #ending(): string {
        if (this.#process.get_if_signaled())
            return `the engine stopped (signal ${this.#process.get_term_sig()})`;
        return `the engine stopped (exit status ${this.#process.get_exit_status()})`;
    }
}

async function writeAll(stream: Gio.OutputStream, chunk: Uint8Array): Promise<void> {
    let rest = chunk;
    while (rest.length > 0) {
        const bytes = new GLib.Bytes(rest);
        const written = await fromAsync(
            callback => stream.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, null, callback),
            result => stream.write_bytes_finish(result));
        rest = rest.subarray(written);
    }
}
