import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {deleteFile, readText, writePrivately} from './files.js';

export type Dictation = {
    at: string;
    text: string;
};

// One JSON object per line, oldest first, under the extension's own directory
// in $XDG_STATE_HOME - where the base directory specification puts an actions
// history.
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

    async newestFirst(): Promise<Dictation[]> {
        const kept: Dictation[] = [];
        for (const line of (await readText(this.#file)).split('\n')) {
            const entry = dictation(line);
            if (entry)
                kept.push(entry);
        }
        return kept.reverse();
    }

    append(text: string, kept: number): Promise<void> {
        const entry: Dictation = {at: GLib.DateTime.new_now_utc().format_iso8601() ?? '', text};
        return this.#rewrite(lines => [...lines, JSON.stringify(entry)].slice(-kept));
    }

    forget(entry: Dictation): Promise<void> {
        return this.#rewrite(lines => {
            const index = lines.findIndex(line => matches(dictation(line), entry));
            return index < 0 ? lines : lines.toSpliced(index, 1);
        });
    }

    restore(entry: Dictation): Promise<void> {
        return this.#rewrite(lines => {
            const later = lines.findIndex(line => {
                const other = dictation(line);
                return other !== null && other.at > entry.at;
            });
            return lines.toSpliced(later < 0 ? lines.length : later, 0, JSON.stringify(entry));
        });
    }

    clear(): Promise<void> {
        return deleteFile(this.#file);
    }

    monitor(): Gio.FileMonitor {
        return this.#file.monitor_file(Gio.FileMonitorFlags.NONE, null);
    }

    // Nobody waits for a save, so two of them are kept apart: overlapping
    // read-modify-writes would settle on whichever read first and lose the other.
    #rewrite(change: (lines: string[]) => string[]): Promise<void> {
        const write = async () => {
            const lines = (await readText(this.#file)).split('\n').filter(line => line.trim());
            const changed = change(lines);
            await writePrivately(this.#file, changed.length > 0 ? `${changed.join('\n')}\n` : '');
        };
        const done = this.#pending.catch(() => {}).then(write);
        this.#pending = done;
        return done;
    }
}

function matches(entry: Dictation | null, other: Dictation): boolean {
    return entry?.at === other.at && entry.text === other.text;
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
