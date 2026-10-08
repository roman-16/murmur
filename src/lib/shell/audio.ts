import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type Gst from 'gi://Gst?version=1.0';

import {deferred, fromAsync, whenCancelled} from '../async.js';
import {cancellation, errorMessage} from '../errors.js';
import {deleteFile} from '../files.js';
import {SAMPLE_RATE} from '../transcription/provider.js';

export type Source = 'desktop' | 'microphone';

export type Stretch = {end: number; start: number};

type Gstreamer = typeof Gst;

type Handlers = {
    onEnd: () => void;
    onError: (message: string) => void;
    onLevel?: (level: Level) => void;
    onPrerolled?: () => void;
};

type Level = {decibels: number; element: string; seconds: number};

type ValueArray = {get_nth(index: number): unknown};

// A recording is closed after this long whether or not the end of the stream
// made it through, since a source that went quiet may never pass it on.
const FINISH_TIMEOUT_MS = 3000;
const LEVEL_INTERVAL_NS = 100 * 1000 * 1000;
// Loudness reads as a curve rather than a ratio, so the meter spans the decibels
// a voice moves through: full scale down to -50 dB, and quieter than that is a
// room with nobody talking in it.
const METER_RANGE_DB = 50;
const MIX_CAPS = 'audio/x-raw,format=F32LE,rate=48000,channels=1';
const NS_PER_SECOND = 1000 * 1000 * 1000;
// Xiph's recommendation for a podcast, and the rate from which Opus is fullband.
const OPUS_BITRATE = 24000;
const PIECE_BITRATE = 32000;
const PULL_MS = 100;
const QUIET_INTERVAL_NS = 500 * 1000 * 1000;
const QUIET_SEARCH_SECONDS = 60;
const SPEECH_CAPS =
    `audio/x-raw,format=S16LE,rate=${SAMPLE_RATE},channels=1,layout=interleaved`;

// PipeWire gives a stream two buffers unless it asks for more, a few
// milliseconds at a short quantum, and drops what it captures while a source
// that holds them all is waiting. Its converter allows 32 at most.
const CAPTURE = 'pipewiresrc min-buffers=32';
const DECODED = 'oggdemux ! opusdec ! audioconvert';
// WirePlumber links a capture stream that asks for a sink to the monitor of the
// default output, and follows it when the default changes.
const DESKTOP = `${CAPTURE} stream-properties="props,stream.capture.sink=true"`;
const MICROPHONE = CAPTURE;

const PACKAGES: Record<string, string> = {
    appsink: "GStreamer's base plugins",
    audioconvert: "GStreamer's base plugins",
    audiomixer: "GStreamer's base plugins",
    audioresample: "GStreamer's base plugins",
    fakesink: 'GStreamer',
    filesink: 'GStreamer',
    filesrc: 'GStreamer',
    level: "GStreamer's good plugins",
    oggdemux: "GStreamer's base plugins",
    oggmux: "GStreamer's base plugins",
    opusdec: "GStreamer's base plugins",
    opusenc: "GStreamer's base plugins",
    pipewiresrc: "PipeWire's GStreamer plugin",
};

let gstreamer: Promise<Gstreamer> | null = null;

export function meterFromDecibels(decibels: number): number {
    return Math.min(1, Math.max(0, (decibels + METER_RANGE_DB) / METER_RANGE_DB));
}

export async function piecesOf(
    audio: Gio.File, longest: number, cancellable: Gio.Cancellable): Promise<Stretch[]> {
    const whole = await Playback.open(
        `filesrc name=recording ! ${DECODED} ! fakesink`, {recording: audio}, cancellable);
    const seconds = whole.seconds;
    whole.close();
    if (seconds === null)
        return [{end: Infinity, start: 0}];

    const pieces: Stretch[] = [];
    let start = 0;
    while (seconds - start > longest) {
        const mark = start + longest;
        const end = await quietestMoment(audio, {
            end: mark,
            start: Math.max(start + longest / 2, mark - QUIET_SEARCH_SECONDS),
        }, cancellable);
        pieces.push({end, start});
        start = end;
    }
    pieces.push({end: seconds, start});
    return pieces;
}

export async function cutPiece(
    audio: Gio.File, piece: Stretch, cancellable: Gio.Cancellable): Promise<Gio.File> {
    const [file, stream] = await fromAsync(
        callback => Gio.file_new_tmp_async('murmur-XXXXXX.ogg', GLib.PRIORITY_DEFAULT,
            cancellable, callback),
        result => Gio.file_new_tmp_finish(result));
    try {
        await fromAsync(
            callback => stream.close_async(GLib.PRIORITY_DEFAULT, cancellable, callback),
            result => stream.close_finish(result));
        const playback = await Playback.open(
            `filesrc name=recording ! ${DECODED} ! audioresample ! ` +
            `opusenc bitrate=${PIECE_BITRATE} ! oggmux ! filesink name=piece`,
            {piece: file, recording: audio}, cancellable);
        try {
            await playback.play(piece);
        } finally {
            playback.close();
        }
        return file;
    } catch (error) {
        await deleteFile(file).catch(() => {});
        throw error;
    }
}

async function quietestMoment(
    audio: Gio.File, within: Stretch, cancellable: Gio.Cancellable): Promise<number> {
    const quietest = {decibels: Infinity, seconds: within.end};
    const playback = await Playback.open(
        `filesrc name=recording ! ${DECODED} ! level interval=${QUIET_INTERVAL_NS} ! fakesink`,
        {recording: audio}, cancellable, ({decibels, seconds}) => {
            if (seconds <= within.start || seconds >= within.end || decibels >= quietest.decibels)
                return;
            quietest.decibels = decibels;
            quietest.seconds = seconds;
        });
    try {
        await playback.play(within);
    } finally {
        playback.close();
    }
    return quietest.seconds;
}

export class Microphone {
    readonly #pipeline: Pipeline;
    readonly #sink: Gst.Element;

    #ended = false;
    #onChunk: ((chunk: Uint8Array) => void) | null = null;
    #onEnd: (() => void) | null = null;
    #pullId = 0;

    static async open(): Promise<Microphone> {
        const handlers: Handlers = {onEnd: () => {}, onError: () => {}};
        const pipeline = await Pipeline.launch(
            `${MICROPHONE} ! audioconvert ! audioresample ! ${SPEECH_CAPS} ! ` +
            'appsink name=sink sync=false',
            handlers);
        const microphone = new Microphone(pipeline);
        handlers.onEnd = () => microphone.#end();
        handlers.onError = message => {
            console.error(`murmur: microphone: ${message}`);
            microphone.#end();
        };
        pipeline.start();
        return microphone;
    }

    private constructor(pipeline: Pipeline) {
        this.#pipeline = pipeline;
        const sink = pipeline.byName('sink');
        if (!sink)
            throw new Error('the microphone has no sink');
        this.#sink = sink;
    }

    // What is heard before anyone listens is held, so nothing said while the
    // service is still being reached is lost. GJS cannot run JavaScript on a
    // GStreamer streaming thread, so the samples are collected from the main
    // loop rather than handed over as they arrive.
    listen(onChunk: (chunk: Uint8Array) => void, onEnd: () => void): void {
        this.#onChunk = onChunk;
        this.#onEnd = onEnd;
        if (this.#ended) {
            this.#end();
            return;
        }
        this.#pull();
        this.#pullId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PULL_MS, () => {
            this.#pull();
            return GLib.SOURCE_CONTINUE;
        });
    }

    finish(): void {
        this.#pipeline.end();
    }

    close(): void {
        this.#stopPulling();
        this.#pipeline.close();
    }

    #end(): void {
        this.#ended = true;
        if (!this.#onEnd)
            return;
        this.#pull();
        this.#stopPulling();
        const onEnd = this.#onEnd;
        this.#onEnd = null;
        onEnd();
    }

    #pull(): void {
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
            const sample = pullSample(this.#sink);
            if (!sample)
                break;
            const buffer = sample.get_buffer();
            if (!buffer)
                continue;
            const data = buffer.extract_dup(0, buffer.get_size());
            chunks.push(data);
            size += data.length;
        }
        if (size === 0)
            return;

        const chunk = new Uint8Array(size);
        let offset = 0;
        for (const data of chunks) {
            chunk.set(data, offset);
            offset += data.length;
        }
        this.#onChunk?.(chunk);
    }

    #stopPulling(): void {
        if (!this.#pullId)
            return;
        GLib.source_remove(this.#pullId);
        this.#pullId = 0;
    }
}

export class Recorder {
    onFailure: ((message: string) => void) | null = null;
    onLevel: ((source: Source, level: number) => void) | null = null;

    readonly #ended = deferred<void>();
    readonly #pipeline: Pipeline;

    #failed = false;

    static async open(file: Gio.File): Promise<Recorder> {
        const path = file.get_path();
        if (!path)
            throw new Error('the recording has nowhere to go');

        const handlers: Handlers = {onEnd: () => {}, onError: () => {}};
        const pipeline = await Pipeline.launch([
            `audiomixer name=mixer ! audioconvert ! opusenc bitrate=${OPUS_BITRATE} ! ` +
            'oggmux ! filesink name=file',
            branch(MICROPHONE, 'microphone'),
            branch(DESKTOP, 'desktop'),
        ].join(' '), handlers);
        const recorder = new Recorder(pipeline);
        handlers.onEnd = () => recorder.#ended.resolve();
        handlers.onError = message => recorder.#fail(message);
        handlers.onLevel = ({decibels, element}) => {
            if (element === 'desktop' || element === 'microphone')
                recorder.onLevel?.(element, meterFromDecibels(decibels));
        };

        pipeline.byName('file')?.set_property('location', path);
        pipeline.start();
        return recorder;
    }

    private constructor(pipeline: Pipeline) {
        this.#pipeline = pipeline;
    }

    // The end of the stream is what makes the muxer write the last page, so the
    // recording is closed once it has passed through, or has had its chance to.
    async finish(): Promise<void> {
        if (!this.#failed) {
            this.#pipeline.end();
            let timeoutId = 0;
            await Promise.race([
                this.#ended.promise,
                new Promise<void>(resolve => {
                    timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FINISH_TIMEOUT_MS, () => {
                        timeoutId = 0;
                        resolve();
                        return GLib.SOURCE_REMOVE;
                    });
                }),
            ]);
            if (timeoutId)
                GLib.source_remove(timeoutId);
        }
        this.#pipeline.close();
    }

    close(): void {
        this.#pipeline.close();
    }

    #fail(message: string): void {
        if (this.#failed)
            return;
        this.#failed = true;
        this.#ended.resolve();
        this.onFailure?.(message);
    }
}

class Playback {
    readonly #ended = deferred<void>();
    readonly #pipeline: Pipeline;
    readonly #prerolled = deferred<void>();
    readonly #release: () => void;

    static async open(
        description: string, files: Record<string, Gio.File>, cancellable: Gio.Cancellable,
        onLevel?: (level: Level) => void): Promise<Playback> {
        const handlers: Handlers = {onEnd: () => {}, onError: () => {}, onLevel};
        const pipeline = await Pipeline.launch(description, handlers);
        for (const [name, file] of Object.entries(files)) {
            const path = file.get_path();
            if (!path) {
                pipeline.close();
                throw new Error(`${file.get_uri()} is not a local file`);
            }
            pipeline.byName(name)?.set_property('location', path);
        }

        const playback = new Playback(pipeline, cancellable);
        handlers.onEnd = () => playback.#ended.resolve();
        handlers.onError = message => playback.#fail(new Error(message));
        handlers.onPrerolled = () => playback.#prerolled.resolve();
        try {
            pipeline.pause();
            await playback.#prerolled.promise;
        } catch (error) {
            playback.close();
            throw error;
        }
        return playback;
    }

    private constructor(pipeline: Pipeline, cancellable: Gio.Cancellable) {
        this.#pipeline = pipeline;
        this.#ended.promise.catch(() => {});
        this.#prerolled.promise.catch(() => {});
        this.#release = whenCancelled(cancellable, () => this.#fail(cancellation()));
        if (cancellable.is_cancelled())
            this.#fail(cancellation());
    }

    get seconds(): number | null {
        return this.#pipeline.seconds;
    }

    async play(stretch: Stretch): Promise<void> {
        this.#pipeline.seek(stretch);
        this.#pipeline.start();
        await this.#ended.promise;
    }

    close(): void {
        this.#release();
        this.#pipeline.close();
    }

    #fail(error: unknown): void {
        this.#ended.reject(error);
        this.#prerolled.reject(error);
    }
}

class Pipeline {
    readonly #bin: Gst.Pipeline;
    readonly #bus: Gst.Bus;
    readonly #busId: number;
    readonly #gst: Gstreamer;

    #closed = false;

    static async launch(description: string, handlers: Handlers): Promise<Pipeline> {
        const gst = await loadGstreamer();
        for (const element of Object.keys(PACKAGES)) {
            if (description.includes(element) && !gst.ElementFactory.find(element))
                throw new Error(`GStreamer has no ${element} element; install ${PACKAGES[element]}`);
        }
        return new Pipeline(gst, gst.parse_launch(description) as Gst.Pipeline, handlers);
    }

    private constructor(gst: Gstreamer, bin: Gst.Pipeline, handlers: Handlers) {
        this.#bin = bin;
        this.#gst = gst;
        // pipewiresrc stamps each buffer with the monotonic time it was captured
        // at and holds it until the pipeline's clock reaches that time. The clock
        // it offers counts the device's samples and drifts from those stamps, so
        // the hold would grow for as long as the pipeline runs.
        bin.use_clock(gst.SystemClock.obtain());
        this.#bus = bin.get_bus();
        this.#bus.add_signal_watch();
        this.#busId = this.#bus.connect('message',
            (_bus: Gst.Bus, message: Gst.Message) => this.#onMessage(message, handlers));
    }

    byName(name: string): Gst.Element | null {
        return this.#bin.get_by_name(name);
    }

    get seconds(): number | null {
        const [known, duration] = this.#bin.query_duration(this.#gst.Format.TIME);
        return known && Number(duration) > 0 ? Number(duration) / NS_PER_SECOND : null;
    }

    pause(): void {
        this.#enter(this.#gst.State.PAUSED);
    }

    start(): void {
        this.#enter(this.#gst.State.PLAYING);
    }

    seek(stretch: Stretch): void {
        const {Format, SeekFlags, SeekType} = this.#gst;
        const sought = this.#bin.seek(1.0, Format.TIME, SeekFlags.FLUSH | SeekFlags.ACCURATE,
            SeekType.SET, Math.round(stretch.start * NS_PER_SECOND),
            SeekType.SET, Math.round(stretch.end * NS_PER_SECOND));
        if (!sought)
            throw new Error('the recording could not be cut');
    }

    end(): void {
        if (!this.#closed)
            this.#bin.send_event(this.#gst.Event.new_eos());
    }

    close(): void {
        if (this.#closed)
            return;
        this.#closed = true;
        this.#bus.disconnect(this.#busId);
        this.#bus.remove_signal_watch();
        this.#bin.set_state(this.#gst.State.NULL);
    }

    #enter(state: Gst.State): void {
        if (this.#bin.set_state(state) !== this.#gst.StateChangeReturn.FAILURE)
            return;
        const reason = this.#bus.pop_filtered(this.#gst.MessageType.ERROR)?.parse_error()[0]?.message;
        this.close();
        throw new Error(reason ?? 'the audio could not be opened');
    }

    #onMessage(message: Gst.Message, handlers: Handlers): void {
        const {MessageType} = this.#gst;
        switch (message.type) {
            case MessageType.ASYNC_DONE:
                handlers.onPrerolled?.();
                break;
            case MessageType.ELEMENT: {
                const structure = message.get_structure();
                if (structure?.get_name() !== 'level')
                    break;
                const decibels = (structure.get_value('rms') as ValueArray | null)?.get_nth(0);
                const [, streamTime] = structure.get_uint64('stream-time');
                const [, duration] = structure.get_uint64('duration');
                if (typeof decibels === 'number') {
                    handlers.onLevel?.({
                        decibels,
                        element: message.src?.get_name() ?? '',
                        seconds: (streamTime + duration / 2) / NS_PER_SECOND,
                    });
                }
                break;
            }
            case MessageType.EOS:
                handlers.onEnd();
                break;
            case MessageType.ERROR: {
                const [error, debug] = message.parse_error();
                handlers.onError(error?.message ?? debug);
                break;
            }
        }
    }
}

function branch(source: string, name: Source): string {
    return `${source} ! audioconvert ! audioresample ! ${MIX_CAPS} ! ` +
        `level name=${name} interval=${LEVEL_INTERVAL_NS} ! mixer.`;
}

// The action signal needs none of GstApp's bindings, which a system can have
// GStreamer without.
function pullSample(sink: Gst.Element): Gst.Sample | null {
    return (sink.emit('try-pull-sample', 0) as unknown as Gst.Sample | null) ?? null;
}

// Loaded when audio is first asked for rather than with the extension, so a
// system without GStreamer is told so when it presses a shortcut instead of
// finding an extension that fails to load.
function loadGstreamer(): Promise<Gstreamer> {
    gstreamer ??= import('gi://Gst?version=1.0').then(
        ({default: gst}) => {
            gst.init([]);
            return gst;
        },
        (error: unknown) => {
            gstreamer = null;
            throw new Error(`GStreamer is not installed: ${errorMessage(error)}`);
        });
    return gstreamer;
}
