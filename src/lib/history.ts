import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
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

    constructor(uuid: string) {
        this.#path = GLib.build_filenamev([GLib.get_user_state_dir(), uuid, 'history.jsonl']);
        this.#file = Gio.File.new_for_path(this.#path);
    }

    get path(): string {
        return this.#path;
    }

    // Newest first, which is the order it is read in.
    entries(): Dictation[] {
        const kept: Dictation[] = [];
        for (const line of this.#read().split('\n')) {
            const entry = dictation(line);
            if (entry)
                kept.push(entry);
        }
        return kept.reverse();
    }

    append(text: string): void {
        const kept = this.entries().reverse();
        kept.push({at: GLib.DateTime.new_now_utc().format_iso8601() ?? '', text});
        this.#write(kept.slice(-LIMIT));
    }

    clear(): void {
        if (this.#file.query_exists(null))
            this.#file.delete(null);
    }

    monitor(): Gio.FileMonitor {
        return this.#file.monitor_file(Gio.FileMonitorFlags.NONE, null);
    }

    #read(): string {
        if (!this.#file.query_exists(null))
            return '';
        const [, contents] = this.#file.load_contents(null);
        return new TextDecoder().decode(contents);
    }

    #write(entries: Dictation[]): void {
        const directory = this.#file.get_parent()?.get_path();
        if (!directory)
            return;
        GLib.mkdir_with_parents(directory, DIRECTORY_MODE);

        const lines = entries.map(entry => JSON.stringify(entry)).join('\n');
        this.#file.replace_contents(
            new TextEncoder().encode(lines ? `${lines}\n` : ''), null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        this.#file.set_attribute_uint32(
            'unix::mode', FILE_MODE, Gio.FileQueryInfoFlags.NONE, null);
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
