import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {deleteFile, readText, writePrivately} from './files.js';

const LIMIT = 500;

export type Dictation = {
    at: string;
    text: string;
};

// One JSON object per line, oldest first, under the extension's own directory
// in $XDG_STATE_HOME - where the base directory specification puts an actions
// history. The file is capped, so a dictation costs a rewrite of at most the
// newest LIMIT entries rather than of everything ever said.
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
        for (const line of (await readText(this.#file)).split('\n')) {
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
            const lines = kept.slice(-LIMIT).map(entry => JSON.stringify(entry)).join('\n');
            await writePrivately(this.#file, lines ? `${lines}\n` : '');
        };
        const done = this.#pending.catch(() => {}).then(write);
        this.#pending = done;
        return done;
    }

    clear(): Promise<void> {
        return deleteFile(this.#file);
    }

    monitor(): Gio.FileMonitor {
        return this.#file.monitor_file(Gio.FileMonitorFlags.NONE, null);
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
