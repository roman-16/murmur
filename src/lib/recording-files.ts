import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {createPrivately, deleteFile, exists, readText, writePrivately} from './files.js';

const AUDIO = '.opus';
const NAME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/;
const TRANSCRIPT = '.md';

export type RecordingFile = {
    audio: Gio.File;
    name: string;
    startedAt: GLib.DateTime | null;
    transcript: Gio.File;
};

// A recording is its audio and its transcript side by side in Murmur's folder
// in Documents, named by the local time it started, which sorts as it reads.
// Which recordings still owe a transcript is kept apart from them, in the
// extension's state, so a transcript someone deleted is not asked for again.
export class RecordingFiles {
    readonly #folder: Gio.File;
    readonly #untranscribed: Gio.File;

    #pending: Promise<unknown> = Promise.resolve();

    constructor(uuid: string) {
        this.#folder = recordingFolder();
        this.#untranscribed = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_state_dir(), uuid, 'untranscribed']));
    }

    get place(): string {
        return recordingPlace();
    }

    async create(): Promise<RecordingFile> {
        const name = GLib.DateTime.new_now_local().format('%Y-%m-%dT%H-%M-%S') ?? 'recording';
        const recording = recordingOf(this.#folder.get_child(`${name}${AUDIO}`));
        await createPrivately(recording.audio);
        const path = recording.audio.get_path();
        await this.#change(paths => (path ? [...paths, path] : paths));
        return recording;
    }

    async save(recording: RecordingFile, text: string): Promise<void> {
        await writePrivately(recording.transcript, text);
        await this.forget(recording);
    }

    async discard(recording: RecordingFile): Promise<void> {
        await deleteFile(recording.audio);
        await this.forget(recording);
    }

    forget(recording: RecordingFile): Promise<void> {
        const path = recording.audio.get_path();
        return this.#change(paths => paths.filter(kept => kept !== path));
    }

    async untranscribed(): Promise<RecordingFile[]> {
        const waiting: RecordingFile[] = [];
        for (const path of await this.#paths()) {
            const recording = recordingOf(Gio.File.new_for_path(path));
            if (await exists(recording.audio) && !await exists(recording.transcript))
                waiting.push(recording);
        }
        return waiting;
    }

    async #paths(): Promise<string[]> {
        return (await readText(this.#untranscribed)).split('\n').filter(Boolean);
    }

    // Read, changed and written back while nothing else is, so two changes that
    // overlap cannot settle on whichever read first.
    #change(change: (paths: string[]) => string[]): Promise<void> {
        const write = async () => {
            const paths = change(await this.#paths());
            await writePrivately(this.#untranscribed, paths.map(path => `${path}\n`).join(''));
        };
        const done = this.#pending.catch(() => {}).then(write);
        this.#pending = done;
        return done;
    }
}

// The folder as a person would write it.
export function recordingPlace(): string {
    const path = recordingFolder().get_path() ?? '';
    const home = GLib.get_home_dir();
    return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function recordingFolder(): Gio.File {
    const documents = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOCUMENTS) ??
        GLib.build_filenamev([GLib.get_home_dir(), 'Documents']);
    return Gio.File.new_for_path(GLib.build_filenamev([documents, 'Murmur']));
}

function recordingOf(audio: Gio.File): RecordingFile {
    const basename = audio.get_basename() ?? '';
    const name = basename.endsWith(AUDIO) ? basename.slice(0, -AUDIO.length) : basename;
    const transcript = audio.get_parent()?.get_child(`${name}${TRANSCRIPT}`) ??
        Gio.File.new_for_path(`${name}${TRANSCRIPT}`);
    return {audio, name, startedAt: startedAt(name), transcript};
}

function startedAt(name: string): GLib.DateTime | null {
    const parts = NAME.exec(name)?.slice(1).map(Number);
    if (!parts || parts.length !== 6)
        return null;
    const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = parts;
    return GLib.DateTime.new_local(year, month, day, hour, minute, second);
}
