import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {fromAsync} from '../async.js';
import {errorMessage, isCancelled} from '../errors.js';
import {deleteFile} from '../files.js';
import {type RecordingFile, RecordingFiles} from '../recording-files.js';
import {readProviderConfig} from '../settings.js';
import {PROVIDERS, type RecordingTranscriber} from '../transcription/provider.js';
import {recordingTranscriberFor} from '../transcription/transcription.js';
import {cutPiece, piecesOf, Recorder, type Stretch} from './audio.js';
import {copyText} from './clipboard.js';
import {duration} from './clock.js';
import {notify} from './notify.js';
import {RecordingIndicator} from './recording-indicator.js';

const PIECE_SECONDS = 600;

type Active = {
    file: RecordingFile;
    indicator: RecordingIndicator;
    recorder: Recorder;
    startedUs: number;
    tickId: number;
};

// Everything the computer plays and the microphone hears, recorded until it is
// stopped and then transcribed into a file beside the audio. One records at a
// time; the one before it may still be transcribing meanwhile.
export class Recordings {
    readonly #cancellable = new Gio.Cancellable();
    readonly #files: RecordingFiles;
    readonly #indicators = new Set<RecordingIndicator>();
    readonly #settings: Gio.Settings;

    #active: Active | null = null;
    #locked = false;
    #starting = false;

    constructor(settings: Gio.Settings, uuid: string) {
        this.#files = new RecordingFiles(uuid);
        this.#settings = settings;
    }

    // What is recording is closed where it stands: the audio up to here stays
    // on disk, and is offered for transcription the next time Murmur starts.
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
                    {label: 'Transcribe', run: () => void this.#transcribe(file, null)},
                    {label: 'Leave it', run: () => void this.#forget(file)},
                ],
                body: `The audio is in ${this.#files.place}.`,
                title: when
                    ? `A recording from ${when} was never transcribed`
                    : `${file.name} was never transcribed`,
            });
        }
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
        const seconds = elapsedSeconds(active);
        active.indicator.transcribing();
        await active.recorder.finish();
        await this.#transcribe(active.file, seconds, active.indicator);
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
        file: RecordingFile, seconds: number | null,
        shown: RecordingIndicator | null = null): Promise<void> {
        const indicator = shown ?? this.#indicator({transcribing: true});
        try {
            const provider = readProviderConfig(this.#settings);
            if (!provider.apiKey)
                throw new Error(`Set your ${PROVIDERS[provider.kind].vendor} API key in the extension preferences`);
            const transcriber = recordingTranscriberFor(provider);
            const pieces = await piecesOf(file.audio, PIECE_SECONDS, this.#cancellable);
            const texts: string[] = [];
            for (const [index, piece] of pieces.entries()) {
                if (pieces.length === 1) {
                    texts.push(await transcriber(file.audio, this.#cancellable));
                    continue;
                }
                indicator.transcribing({of: pieces.length, piece: index + 1});
                texts.push(await this.#transcribePiece(transcriber, file.audio, piece));
            }
            const text = texts.map(piece => piece.trim()).filter(Boolean).join(' ');
            await this.#files.save(file, text);
            this.#announce(file, seconds, text);
        } catch (error) {
            if (isCancelled(error) || this.#cancellable.is_cancelled())
                return;
            notify({
                actions: [{label: 'Retry', run: () => void this.#transcribe(file, seconds)}],
                body: `${errorMessage(error)}\nThe audio is in ${this.#files.place}.`,
                title: 'The recording could not be transcribed',
            });
        } finally {
            this.#drop(indicator);
        }
    }

    async #transcribePiece(
        transcriber: RecordingTranscriber, audio: Gio.File, piece: Stretch): Promise<string> {
        const cut = await cutPiece(audio, piece, this.#cancellable);
        try {
            return await transcriber(cut, this.#cancellable);
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
