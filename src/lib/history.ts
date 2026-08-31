import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {fromAsync} from './async.js';

const DIRECTORY_MODE = 0o700;
const LIMIT = 500;
const WRITE_FLAGS =
    Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION;

export type Dictation = {
    at: string;
    text: string;
};

// One JSON object per line, oldest first, under the extension's own directory
// in $XDG_STATE_HOME - where the base directory specification puts an actions
// history. The file is capped, so a dictation costs a rewrite of at most the
// newest LIMIT entries rather than of everything ever said.
//
// The shell process is the compositor, so nothing here touches the disk from
// the thread drawing the screen: every call is the asynchronous form, which
// GIO runs on a worker and answers on the main loop.
export class History {
    readonly #file: Gio.File;
    readonly #path: string;

    #pending: Promise<unknown> = Promise.resolve();

    constructor(uuid: string) {
        this.#path = GLib.build_filenamev([GLib.get_user_state_dir(), uuid, 'history.jsonl']);
        this.#file = Gio.File.new_for_path(this.#path);
    }

    get path(): string {
        return this.#path;
    }

    // Newest first, which is the order it is read in.
    async entries(): Promise<Dictation[]> {
        const kept: Dictation[] = [];
        for (const line of (await this.#read()).split('\n')) {
            const entry = dictation(line);
            if (entry)
                kept.push(entry);
        }
        return kept.reverse();
    }

    // A dictation is read, capped and written back, and the caller does not
    // wait for it, so two of them are kept apart: overlapping read-modify-writes
    // would settle on whichever read first and lose the other.
    append(text: string): Promise<void> {
        const write = async () => {
            const kept = (await this.entries()).reverse();
            kept.push({at: GLib.DateTime.new_now_utc().format_iso8601() ?? '', text});
            await this.#write(kept.slice(-LIMIT));
        };
        const done = this.#pending.catch(() => {}).then(write);
        this.#pending = done;
        return done;
    }

    async clear(): Promise<void> {
        await ignoreMissing(fromAsync(
            callback => this.#file.delete_async(GLib.PRIORITY_DEFAULT, null, callback),
            result => this.#file.delete_finish(result)));
    }

    monitor(): Gio.FileMonitor {
        return this.#file.monitor_file(Gio.FileMonitorFlags.NONE, null);
    }

    // Nothing said yet and no file yet are the same answer, so the read asks
    // for the contents rather than asking first whether there are any.
    async #read(): Promise<string> {
        const contents = await ignoreMissing(fromAsync(
            callback => this.#file.load_contents_async(null, callback),
            result => this.#file.load_contents_finish(result)[1]));
        return contents ? new TextDecoder().decode(contents) : '';
    }

    // PRIVATE makes the file readable by its owner alone at the moment it is
    // created, so there is no instant in which what was dictated is world
    // readable, as a write followed by a chmod would leave.
    async #write(entries: Dictation[]): Promise<void> {
        const lines = entries.map(entry => JSON.stringify(entry)).join('\n');
        const bytes = new GLib.Bytes(new TextEncoder().encode(lines ? `${lines}\n` : ''));

        const replace = () => fromAsync(
            callback => this.#file.replace_contents_bytes_async(
                bytes, null, false, WRITE_FLAGS, null, callback),
            result => this.#file.replace_contents_finish(result));

        // The directory is there for every dictation but the first, so it is
        // made when a write asks for it rather than looked for before each one.
        try {
            await replace();
        } catch (error) {
            const directory = this.#file.get_parent();
            if (!directory || !isMissing(error))
                throw error;
            await makeDirectory(directory);
            await replace();
        }
    }
}

// A line that is not a dictation is dropped rather than taken as the end of the
// file, so one damaged write costs one entry instead of the whole history.
function dictation(line: string): Dictation | null {
    if (!line.trim())
        return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch {
        return null;
    }

    const entry = parsed as Partial<Dictation>;
    if (typeof entry?.text !== 'string' || typeof entry.at !== 'string')
        return null;
    return {at: entry.at, text: entry.text};
}

// GIO has no asynchronous form of "make this and every directory above it", so
// a missing level asks for the one above it and the walk unwinds downwards.
// Each level Murmur creates is its own, and the base directory specification
// asks for 0700.
async function makeDirectory(directory: Gio.File): Promise<void> {
    try {
        await fromAsync(
            callback => directory.make_directory_async(GLib.PRIORITY_DEFAULT, null, callback),
            result => directory.make_directory_finish(result));
    } catch (error) {
        if (matches(error, Gio.IOErrorEnum.EXISTS))
            return;
        const parent = directory.get_parent();
        if (!parent || !isMissing(error))
            throw error;
        await makeDirectory(parent);
        await makeDirectory(directory);
        return;
    }

    const mode = new Gio.FileInfo();
    mode.set_attribute_uint32('unix::mode', DIRECTORY_MODE);
    await fromAsync(
        callback => directory.set_attributes_async(
            mode, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, callback),
        result => directory.set_attributes_finish(result));
}

async function ignoreMissing<T>(operation: Promise<T>): Promise<T | null> {
    try {
        return await operation;
    } catch (error) {
        if (isMissing(error))
            return null;
        throw error;
    }
}

function isMissing(error: unknown): boolean {
    return matches(error, Gio.IOErrorEnum.NOT_FOUND);
}

function matches(error: unknown, code: number): boolean {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, code);
}
