import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {type ContextLog, contextOf, headOf} from './context-log.js';
import {
    createPrivately,
    deleteFile,
    exists,
    filesIn,
    moveOver,
    readText,
    sizeOf,
    writePrivately
} from './files.js';
import {Key} from './settings.js';

const AUDIO = '.opus';
const CONTEXT = '.jsonl';
const JOINED = 'joined';
const JOINING = 'joining';
const NAME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/;
const TRANSCRIPT = '.md';

export type RecordingFile = {
    audio: Gio.File;
    name: string;
    place: string;
    startedAt: GLib.DateTime | null;
    transcript: Gio.File;
};

export type Join = (parts: Gio.File[], whole: Gio.File) => Promise<void>;

export class RecordingFiles {
    readonly #contexts: Gio.File;
    readonly #settings: Gio.Settings;
    readonly #untranscribed: Gio.File;

    #pending: Promise<unknown> = Promise.resolve();

    constructor(settings: Gio.Settings, uuid: string) {
        const state = GLib.build_filenamev([GLib.get_user_state_dir(), uuid]);
        this.#contexts = Gio.File.new_for_path(GLib.build_filenamev([state, 'context']));
        this.#settings = settings;
        this.#untranscribed = Gio.File.new_for_path(
            GLib.build_filenamev([state, 'untranscribed']));
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

    async nextPart(recording: RecordingFile): Promise<Gio.File> {
        const numbers = (await partsOf(recording)).map(part => part.number);
        const part = sibling(recording, String(Math.max(1, ...numbers) + 1));
        await createPrivately(part);
        return part;
    }

    async makeWhole(recording: RecordingFile, join: Join): Promise<void> {
        const joined = sibling(recording, JOINED);
        if (!await exists(joined)) {
            const parts = (await partsOf(recording)).map(part => part.file);
            if (parts.length === 0)
                return;
            const heard = await withAudio([recording.audio, ...parts]);
            const [only] = heard;
            if (heard.length > 1) {
                const joining = sibling(recording, JOINING);
                await deleteFile(joining);
                await createPrivately(joining);
                await join(heard, joining);
                await moveOver(joining, joined);
            } else if (only && !only.equal(recording.audio)) {
                await moveOver(only, joined);
            }
        }
        for (const part of await partsOf(recording))
            await deleteFile(part.file);
        if (await exists(joined))
            await moveOver(joined, recording.audio);
    }

    async discard(recording: RecordingFile): Promise<void> {
        for (const part of await partsOf(recording))
            await deleteFile(part.file);
        await deleteFile(sibling(recording, JOINED));
        await deleteFile(sibling(recording, JOINING));
        await deleteFile(recording.audio);
        await deleteFile(this.contextLog(recording));
        await this.forget(recording);
    }

    contextLog(recording: RecordingFile): Gio.File {
        return this.#contexts.get_child(`${recording.name}${CONTEXT}`);
    }

    async context(recording: RecordingFile): Promise<ContextLog | null> {
        const path = recording.audio.get_path();
        return path ? contextOf(await readText(this.contextLog(recording)), path) : null;
    }

    async forgetVanished(): Promise<void> {
        for (const log of await filesIn(this.#contexts)) {
            const audio = headOf(await readText(log))?.audio;
            if (audio && !await exists(Gio.File.new_for_path(audio)))
                await deleteFile(log);
        }
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

function sibling(recording: RecordingFile, label: string): Gio.File {
    const basename = `${recording.name}.${label}${AUDIO}`;
    return recording.audio.get_parent()?.get_child(basename) ?? Gio.File.new_for_path(basename);
}

async function partsOf(recording: RecordingFile): Promise<{file: Gio.File; number: number}[]> {
    const folder = recording.audio.get_parent();
    if (!folder || !recording.startedAt || !recording.audio.get_basename()?.endsWith(AUDIO))
        return [];
    const prefix = `${recording.name}.`;
    const parts: {file: Gio.File; number: number}[] = [];
    for (const file of await filesIn(folder)) {
        const basename = file.get_basename() ?? '';
        if (!basename.startsWith(prefix) || !basename.endsWith(AUDIO))
            continue;
        const label = basename.slice(prefix.length, -AUDIO.length);
        if (/^\d+$/.test(label))
            parts.push({file, number: Number(label)});
    }
    return parts.sort((one, other) => one.number - other.number);
}

async function withAudio(files: Gio.File[]): Promise<Gio.File[]> {
    const sizes = await Promise.all(files.map(file => sizeOf(file).catch(() => 0)));
    return files.filter((_, index) => (sizes[index] ?? 0) > 0);
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
