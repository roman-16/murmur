import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {fromAsync} from '../async.js';
import {errorMessage, isCancelled} from '../errors.js';
import {deleteFile, exists} from '../files.js';
import {type RecordingFile, RecordingFiles, recordingOf} from '../recording-files.js';
import {readProvider, readProviderConfig} from '../settings.js';
import {
    isProviderId,
    type ProviderId,
    PROVIDERS,
    type RecordingTranscriber
} from '../transcription/provider.js';
import {recordingTranscriberFor} from '../transcription/transcription.js';
import {
    linesOf,
    type Piece,
    type Track,
    type TrackPiece,
    type Transcribed,
    written
} from '../transcript.js';
import {type Channel, cutPiece, type Layout, layoutOf, piecesOf, Recorder} from './audio.js';
import {copyText} from './clipboard.js';
import {duration} from './clock.js';
import {notify} from './notify.js';
import {RecordingIndicator} from './recording-indicator.js';

const OVERLAP_SECONDS = 15;
const PIECE_SECONDS = 600;

type Listening = {channel: Channel | null; diarize: boolean; unlabelled: string | null};

type Active = {
    file: RecordingFile;
    indicator: RecordingIndicator;
    recorder: Recorder;
    startedUs: number;
    tickId: number;
};

export class Recordings {
    readonly #cancellable = new Gio.Cancellable();
    readonly #files: RecordingFiles;
    readonly #indicators = new Set<RecordingIndicator>();
    readonly #settings: Gio.Settings;
    readonly #transcribing = new Set<string>();

    #active: Active | null = null;
    #locked = false;
    #starting = false;

    constructor(settings: Gio.Settings, uuid: string) {
        this.#files = new RecordingFiles(settings, uuid);
        this.#settings = settings;
    }

    destroy(): void {
        this.#cancellable.cancel();
        const active = this.#active;
        this.#active = null;
        if (active) {
            clearTick(active);
            active.recorder.close();
        }
        for (const indicator of this.#indicators)
            indicator.destroy();
        this.#indicators.clear();
    }

    set locked(locked: boolean) {
        this.#locked = locked;
        for (const indicator of this.#indicators)
            indicator.locked = locked;
    }

    async toggle(): Promise<void> {
        if (this.#active) {
            await this.#stop(this.#active);
            return;
        }
        if (this.#starting)
            return;

        const provider = readProviderConfig(this.#settings);
        if (!provider.apiKey) {
            const {vendor} = PROVIDERS[provider.kind];
            notify({title: `Set your ${vendor} API key in the extension preferences`});
            return;
        }

        this.#starting = true;
        try {
            await this.#start();
        } catch (error) {
            notify({body: errorMessage(error), title: 'The recording could not start'});
        } finally {
            this.#starting = false;
        }
    }

    async offerUntranscribed(): Promise<void> {
        for (const file of await this.#files.untranscribed()) {
            const when = file.startedAt?.format('%d.%m.%Y %H:%M');
            notify({
                actions: [
                    {
                        label: 'Transcribe',
                        run: () => void this.#transcribe(file, readProvider(this.#settings)),
                    },
                    {label: 'Leave it', run: () => void this.#forget(file)},
                ],
                body: `The audio is in ${file.place}.`,
                title: when
                    ? `A recording from ${when} was never transcribed`
                    : `${file.name} was never transcribed`,
            });
        }
    }

    async transcribeFile(path: string, service: string): Promise<void> {
        if (!isProviderId(service))
            throw new Error(`No transcription service is named ${service}`);
        if (!GLib.path_is_absolute(path))
            throw new Error(`${path} is not a full path`);
        const file = recordingOf(Gio.File.new_for_path(path));
        const name = file.audio.get_basename() ?? path;
        if (file.transcript.equal(file.audio))
            throw new Error(`${name} would be written over by its own transcript`);
        if (!readProviderConfig(this.#settings, service).apiKey)
            throw new Error(`Set your ${PROVIDERS[service].vendor} API key in the extension preferences`);
        if (this.#active?.file.audio.equal(file.audio))
            throw new Error('That recording is still going - stop it first');
        if (!await exists(file.audio))
            throw new Error(`${path} does not exist`);
        try {
            await layoutOf(file.audio, this.#cancellable);
        } catch (error) {
            throw new Error(`Murmur can't read this file: ${errorMessage(error)}`);
        }
        if (this.#transcribing.has(keyOf(file)))
            throw new Error(`${name} is already being transcribed`);
        void this.#transcribe(file, service);
    }

    async #start(): Promise<void> {
        const file = await this.#files.create();
        let recorder: Recorder;
        try {
            recorder = await Recorder.open(file.audio);
        } catch (error) {
            await this.#files.discard(file).catch(() => {});
            throw error;
        }
        if (this.#cancellable.is_cancelled()) {
            recorder.close();
            await this.#files.discard(file).catch(() => {});
            return;
        }

        const indicator = this.#indicator({transcribing: false});
        const active: Active = {
            file,
            indicator,
            recorder,
            startedUs: GLib.get_monotonic_time(),
            tickId: 0,
        };
        this.#active = active;

        indicator.onStop = () => void this.#stop(active);
        indicator.onDiscard = () => void this.#discard(active);
        recorder.onLevel = (source, level) => indicator.level(source, level);
        recorder.onFailure = message => {
            notify({body: message, title: 'The recording stopped'});
            void this.#stop(active);
        };
        this.#tick(active);
    }

    async #stop(active: Active): Promise<void> {
        if (this.#active !== active)
            return;
        this.#active = null;
        clearTick(active);
        active.indicator.transcribing();
        await active.recorder.finish();
        await this.#transcribe(active.file, readProvider(this.#settings), active.indicator);
    }

    async #discard(active: Active): Promise<void> {
        if (this.#active !== active)
            return;
        this.#active = null;
        clearTick(active);
        active.recorder.close();
        this.#drop(active.indicator);
        await this.#files.discard(active.file)
            .catch(error => console.error(`murmur: recording: ${errorMessage(error)}`));
    }

    async #transcribe(
        file: RecordingFile, service: ProviderId,
        shown: RecordingIndicator | null = null): Promise<void> {
        const key = keyOf(file);
        if (this.#transcribing.has(key)) {
            if (shown)
                this.#drop(shown);
            return;
        }
        this.#transcribing.add(key);
        const indicator = shown ?? this.#indicator({transcribing: true});
        try {
            const provider = readProviderConfig(this.#settings, service);
            if (!provider.apiKey)
                throw new Error(`Set your ${PROVIDERS[service].vendor} API key in the extension preferences`);
            const transcriber = recordingTranscriberFor(provider);
            const layout = await layoutOf(file.audio, this.#cancellable);
            const pieces = await piecesOf(file.audio, layout.seconds,
                {longest: PIECE_SECONDS, overlap: OVERLAP_SECONDS}, this.#cancellable);
            const listening = listeningTo(layout);
            const heard = listening.map((): TrackPiece[] => []);
            for (const [index, piece] of pieces.entries()) {
                if (pieces.length > 1)
                    indicator.transcribing({of: pieces.length, piece: index + 1});
                const transcribed = await Promise.all(listening.map(track =>
                    this.#transcribePiece(transcriber, file.audio, piece, track)));
                transcribed.forEach((result, track) => heard[track]?.push({piece, transcribed: result}));
            }
            const tracks = listening.map((track, index): Track => ({
                diarized: track.diarize,
                pieces: heard[index] ?? [],
                unlabelled: track.unlabelled,
            }));
            const text = written(linesOf(tracks), secondOfDay(file.startedAt));
            await this.#files.save(file, text);
            this.#announce(file, secondsOf(pieces), text);
        } catch (error) {
            if (isCancelled(error) || this.#cancellable.is_cancelled())
                return;
            notify({
                actions: [{label: 'Retry', run: () => void this.#transcribe(file, service)}],
                body: `${errorMessage(error)}\nThe audio is in ${file.place}.`,
                title: 'The recording could not be transcribed',
            });
        } finally {
            this.#transcribing.delete(key);
            this.#drop(indicator);
        }
    }

    async #transcribePiece(
        transcriber: RecordingTranscriber, audio: Gio.File, piece: Piece,
        track: Listening): Promise<Transcribed | null> {
        const cut = await cutPiece(audio, piece.heard, track.channel, this.#cancellable);
        if (!cut)
            return null;
        try {
            return await transcriber(cut, {diarize: track.diarize}, this.#cancellable);
        } finally {
            await deleteFile(cut).catch(() => {});
        }
    }

    #announce(file: RecordingFile, seconds: number | null, text: string): void {
        const heard = text.trim().length > 0;
        const lines = [
            seconds === null ? null : duration(seconds),
            heard ? `Saved as ${file.transcript.get_basename()}` : 'No words were heard',
        ].filter(line => line !== null);
        notify({
            actions: [
                {label: 'Open', run: () => void open(file.transcript)},
                ...(heard ? [{label: 'Copy', run: () => copyText(text)}] : []),
            ],
            body: lines.join('\n'),
            title: 'Recording transcribed',
        });
    }

    async #forget(file: RecordingFile): Promise<void> {
        await this.#files.forget(file)
            .catch(error => console.error(`murmur: recording: ${errorMessage(error)}`));
    }

    #indicator(options: {transcribing: boolean}): RecordingIndicator {
        const indicator = new RecordingIndicator(options);
        indicator.locked = this.#locked;
        this.#indicators.add(indicator);
        return indicator;
    }

    #drop(indicator: RecordingIndicator): void {
        if (!this.#indicators.delete(indicator))
            return;
        indicator.destroy();
    }

    #tick(active: Active): void {
        active.indicator.elapsed = elapsedSeconds(active);
        active.tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            active.tickId = 0;
            this.#tick(active);
            return GLib.SOURCE_REMOVE;
        });
    }
}

function elapsedSeconds(active: Active): number {
    return Math.floor((GLib.get_monotonic_time() - active.startedUs) / 1000000);
}

function keyOf(file: RecordingFile): string {
    return file.audio.get_path() ?? file.audio.get_uri();
}

function secondsOf(pieces: Piece[]): number | null {
    const end = pieces.at(-1)?.own.end ?? Infinity;
    return Number.isFinite(end) ? Math.round(end) : null;
}

// The microphone is the person recording, and everyone else is heard through
// the desktop, where only the service can tell their voices apart.
function listeningTo(layout: Layout): Listening[] {
    const {channels} = layout;
    if (!channels)
        return [{channel: null, diarize: true, unlabelled: null}];
    return channels.map((source, index) => ({
        channel: {index, of: channels.length},
        diarize: source === 'desktop',
        unlabelled: source === 'desktop' ? 'Others' : ownName(),
    }));
}

// GLib answers Unknown for an account with no name of its own.
function ownName(): string {
    const name = GLib.get_real_name();
    return name && name !== 'Unknown' ? name : GLib.get_user_name();
}

function secondOfDay(time: GLib.DateTime | null): number | null {
    return time ? time.get_hour() * 3600 + time.get_minute() * 60 + time.get_second() : null;
}

function clearTick(active: Active): void {
    if (!active.tickId)
        return;
    GLib.source_remove(active.tickId);
    active.tickId = 0;
}

async function open(file: Gio.File): Promise<void> {
    try {
        await fromAsync(
            callback => Gio.AppInfo.launch_default_for_uri_async(file.get_uri(),
                global.create_app_launch_context(0, -1), null, callback),
            result => Gio.AppInfo.launch_default_for_uri_finish(result));
    } catch (error) {
        notify({body: errorMessage(error), title: `${file.get_basename()} could not be opened`});
    }
}
