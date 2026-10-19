import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {createPrivately, deleteFile, exists, readText, writePrivately} from './files.js';
import {Key} from './settings.js';

const AUDIO = '.opus';
const NAME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/;
const TRANSCRIPT = '.md';

export type RecordingFile = {
    audio: Gio.File;
    name: string;
    place: string;
    startedAt: GLib.DateTime | null;
    transcript: Gio.File;
};

export class RecordingFiles {
    readonly #settings: Gio.Settings;
    readonly #untranscribed: Gio.File;

    #pending: Promise<unknown> = Promise.resolve();

    constructor(settings: Gio.Settings, uuid: string) {
        this.#settings = settings;
        this.#untranscribed = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_state_dir(), uuid, 'untranscribed']));
    }

    async create(): Promise<RecordingFile> {
        const name = GLib.DateTime.new_now_local().format('%Y-%m-%dT%H-%M-%S') ?? 'recording';
        const folder = recordingFolder(this.#settings);
        const recording = recordingOf(folder.get_child(`${name}${AUDIO}`));
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

export function recordingPlace(settings: Gio.Settings): string {
    return placeOf(recordingFolder(settings));
}

export function recordingFolder(settings: Gio.Settings): Gio.File {
    return folderAt(settings.get_string(Key.recordingFolder) || defaultRecordingFolder(settings));
}

export function defaultRecordingFolder(settings: Gio.Settings): string {
    return settings.get_default_value(Key.recordingFolder)?.unpack() as string;
}

function folderAt(path: string): Gio.File {
    if (path === '~' || path.startsWith('~/'))
        return Gio.File.new_for_path(`${GLib.get_home_dir()}${path.slice(1)}`);
    return Gio.File.new_for_path(path);
}

function placeOf(folder: Gio.File | null): string {
    const path = folder?.get_path() ?? '';
    const home = GLib.get_home_dir();
    if (path === home)
        return '~';
    return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export function recordingOf(audio: Gio.File): RecordingFile {
    const basename = audio.get_basename() ?? '';
    const extension = basename.lastIndexOf('.');
    const name = extension > 0 ? basename.slice(0, extension) : basename;
    const folder = audio.get_parent();
    const transcript = folder?.get_child(`${name}${TRANSCRIPT}`) ??
        Gio.File.new_for_path(`${name}${TRANSCRIPT}`);
    return {audio, name, place: placeOf(folder), startedAt: startedAt(name), transcript};
}

function startedAt(name: string): GLib.DateTime | null {
    const parts = NAME.exec(name)?.slice(1).map(Number);
    if (!parts || parts.length !== 6)
        return null;
    const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = parts;
    return GLib.DateTime.new_local(year, month, day, hour, minute, second);
}
