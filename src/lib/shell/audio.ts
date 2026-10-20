import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type Gst from 'gi://Gst?version=1.0';

import {deferred, fromAsync, whenCancelled} from '../async.js';
import {cancellation, errorMessage} from '../errors.js';
import {deleteFile} from '../files.js';
import {SAMPLE_RATE} from '../transcription/provider.js';
import type {Piece, Stretch} from '../transcript.js';

export type Source = 'desktop' | 'microphone';

export type Channel = {index: number; of: number};

export type Layout = {channels: Source[] | null; seconds: number | null};

type Gstreamer = typeof Gst;

type Handlers = {
    onComment?: (comment: string) => void;
    onEnd: () => void;
    onError: (message: string) => void;
    onLevel?: (level: Level) => void;
    onPrerolled?: () => void;
};

type Listeners = Pick<Handlers, 'onComment' | 'onLevel'>;

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
const NS_PER_SECOND = 1000 * 1000 * 1000;
// Xiph's recommendation for a podcast, and the rate from which Opus is
// fullband, for each of the two channels.
const OPUS_BITRATE = 48000;
const PIECE_BITRATE = 32000;
const PULL_MS = 100;
const QUIET_INTERVAL_NS = 500 * 1000 * 1000;
const QUIET_SEARCH_SECONDS = 60;
// A recording's file says which of its channels heard what, in a tag of its
// own, so that only Murmur's own recordings are taken apart by channel and a
// stereo file from anywhere else is heard as the one track it is.
const CHANNELS_TAG = 'MURMUR_CHANNELS';
const RECORDED: Source[] = ['microphone', 'desktop'];
const SPEECH_CAPS =
    `audio/x-raw,format=S16LE,rate=${SAMPLE_RATE},channels=1,layout=interleaved`;

// PipeWire gives a stream two buffers unless it asks for more, a few
// milliseconds at a short quantum, and drops what it captures while a source
// that holds them all is waiting. Its converter allows 32 at most.
const CAPTURE = 'pipewiresrc min-buffers=32';
const MONO = 'audioconvert ! audio/x-raw,channels=1';
// WirePlumber links a capture stream that asks for a sink to the monitor of the
// default output, and follows it when the default changes.
const DESKTOP = `${CAPTURE} stream-properties="props,stream.capture.sink=true"`;
const MICROPHONE = CAPTURE;

const SOURCES: Record<Source, string> = {desktop: DESKTOP, microphone: MICROPHONE};

const PACKAGES: Record<string, string> = {
    appsink: "GStreamer's base plugins",
    audioconvert: "GStreamer's base plugins",
    audiointerleave: "GStreamer's base plugins",
    audioresample: "GStreamer's base plugins",
    decodebin: "GStreamer's base plugins",
    fakesink: 'GStreamer',
    filesink: 'GStreamer',
    filesrc: 'GStreamer',
    identity: 'GStreamer',
    level: "GStreamer's good plugins",
    oggmux: "GStreamer's base plugins",
    opusenc: "GStreamer's base plugins",
    pipewiresrc: "PipeWire's GStreamer plugin",
    taginject: "GStreamer's good plugins",
};

let gstreamer: Promise<Gstreamer> | null = null;

export function meterFromDecibels(decibels: number): number {
    return Math.min(1, Math.max(0, (decibels + METER_RANGE_DB) / METER_RANGE_DB));
}

export async function layoutOf(audio: Gio.File, cancellable: Gio.Cancellable): Promise<Layout> {
    const comments: string[] = [];
    const whole = await Playback.open(
        `filesrc name=recording ! decodebin ! identity name=decoded ! ${MONO} ! fakesink`,
        {recording: audio}, cancellable, {onComment: comment => comments.push(comment)});
    const seconds = whole.seconds;
    const count = whole.channels('decoded');
    whole.close();
    return {channels: channelsOf(comments, count), seconds};
}

// Pieces are cut where it is quietest before each mark, so no word is split,
// and each is sent with some of the pieces either side of it: the stretch
// both pieces heard is what ties one piece's speakers to the next one's.
export async function piecesOf(
    audio: Gio.File, seconds: number | null, sizes: {longest: number; overlap: number},
    cancellable: Gio.Cancellable): Promise<Piece[]> {
    if (seconds === null)
        return [{heard: {end: Infinity, start: 0}, own: {end: Infinity, start: 0}}];

    const {longest, overlap} = sizes;
    const cuts = [0];
    let start = 0;
    while (seconds - start > longest) {
        const mark = start + longest;
        start = await quietestMoment(audio, {
            end: mark,
            start: Math.max(start + longest / 2, mark - QUIET_SEARCH_SECONDS),
        }, cancellable);
        cuts.push(start);
    }
    cuts.push(seconds);
    return cuts.slice(1).map((end, index) => {
        const own = {end, start: cuts[index] ?? 0};
        return {
            heard: {end: Math.min(seconds, own.end + overlap), start: Math.max(0, own.start - overlap)},
            own,
        };
    });
}

export async function cutPiece(
    audio: Gio.File, stretch: Stretch, channel: Channel | null,
    cancellable: Gio.Cancellable): Promise<Gio.File | null> {
    const [file, stream] = await fromAsync(
        callback => Gio.file_new_tmp_async('murmur-XXXXXX.ogg', GLib.PRIORITY_DEFAULT,
            cancellable, callback),
        result => Gio.file_new_tmp_finish(result));
    try {
        await fromAsync(
            callback => stream.close_async(GLib.PRIORITY_DEFAULT, cancellable, callback),
            result => stream.close_finish(result));
        let loudest = -Infinity;
        const playback = await Playback.open(
            `filesrc name=recording ! decodebin ! ${channel ? only(channel) : MONO} ! ` +
            `level interval=${QUIET_INTERVAL_NS} ! audioresample ! ` +
            `opusenc bitrate=${PIECE_BITRATE} ! oggmux ! filesink name=piece`,
            {piece: file, recording: audio}, cancellable, {
                onLevel: ({decibels}) => {
                    loudest = Math.max(loudest, decibels);
                },
            });
        try {
            await playback.play(stretch);
        } finally {
            playback.close();
        }
        if (loudest > -METER_RANGE_DB)
            return file;
        await deleteFile(file);
        return null;
    } catch (error) {
        await deleteFile(file).catch(() => {});
        throw error;
    }
}

async function quietestMoment(
    audio: Gio.File, within: Stretch, cancellable: Gio.Cancellable): Promise<number> {
    const quietest = {decibels: Infinity, seconds: within.end};
    const playback = await Playback.open(
        `filesrc name=recording ! decodebin ! ${MONO} ! level interval=${QUIET_INTERVAL_NS} ! fakesink`,
        {recording: audio}, cancellable, {
            onLevel: ({decibels, seconds}) => {
                if (seconds <= within.start || seconds >= within.end || decibels >= quietest.decibels)
                    return;
                quietest.decibels = decibels;
                quietest.seconds = seconds;
            },
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
            'audiointerleave name=channels ! audioconvert ! taginject name=tags ! ' +
            `opusenc bitrate=${OPUS_BITRATE} ! oggmux ! filesink name=file`,
            ...RECORDED.map(branch),
        ].join(' '), handlers);
        const recorder = new Recorder(pipeline);
        handlers.onEnd = () => recorder.#ended.resolve();
        handlers.onError = message => recorder.#fail(message);
        handlers.onLevel = ({decibels, element}) => {
            if (element === 'desktop' || element === 'microphone')
                recorder.onLevel?.(element, meterFromDecibels(decibels));
        };

        pipeline.byName('file')?.set_property('location', path);
        pipeline.byName('tags')?.set_property('tags',
            `extended-comment="${CHANNELS_TAG}=${RECORDED.join(',')}"`);
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
        listeners: Listeners = {}): Promise<Playback> {
        const handlers: Handlers = {...listeners, onEnd: () => {}, onError: () => {}};
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

    channels(element: string): number | null {
        return this.#pipeline.channels(element);
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

    channels(element: string): number | null {
        const caps = this.byName(element)?.get_static_pad('src')?.get_current_caps();
        const [known, channels] = caps?.get_structure(0)?.get_int('channels') ?? [false, 0];
        return known ? channels : null;
    }

    pause(): void {
        this.#enter(this.#gst.State.PAUSED);
    }

    start(): void {
        this.#enter(this.#gst.State.PLAYING);
    }

    seek(stretch: Stretch): void {
        const {Format, SeekFlags, SeekType} = this.#gst;
        const bounded = Number.isFinite(stretch.end);
        const sought = this.#bin.seek(1.0, Format.TIME, SeekFlags.FLUSH | SeekFlags.ACCURATE,
            SeekType.SET, Math.round(stretch.start * NS_PER_SECOND),
            bounded ? SeekType.SET : SeekType.NONE,
            bounded ? Math.round(stretch.end * NS_PER_SECOND) : 0);
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
            case MessageType.TAG: {
                const tags = message.parse_tag();
                const count = tags.get_tag_size(this.#gst.TAG_EXTENDED_COMMENT);
                for (let index = 0; index < count; index++) {
                    const [found, comment] =
                        tags.get_string_index(this.#gst.TAG_EXTENDED_COMMENT, index);
                    if (found)
                        handlers.onComment?.(comment);
                }
                break;
            }
            case MessageType.ERROR: {
                const [error, debug] = message.parse_error();
                handlers.onError(error?.message ?? debug);
                break;
            }
        }
    }
}

// Each source arrives as one channel placed on its own side, left then right,
// so the recording is ordinary stereo to anything that plays it.
function branch(name: Source, index: number): string {
    const caps = `audio/x-raw,format=F32LE,rate=48000,channels=1,channel-mask=(bitmask)${1 << index}`;
    return `${SOURCES[name]} ! audioconvert ! audioresample ! ${caps} ! ` +
        `level name=${name} interval=${LEVEL_INTERVAL_NS} ! channels.sink_${index}`;
}

function only(channel: Channel): string {
    const row = Array.from({length: channel.of},
        (_, index) => `(float)${index === channel.index ? '1.0' : '0.0'}`);
    return `audioconvert mix-matrix=<<${row.join(',')}>> ! audio/x-raw,channels=1`;
}

function channelsOf(comments: string[], count: number | null): Source[] | null {
    const prefix = `${CHANNELS_TAG}=`;
    const declared = comments
        .find(comment => comment.toUpperCase().startsWith(prefix))
        ?.slice(prefix.length)
        .split(',');
    if (!declared || declared.length < 2 || declared.length !== count)
        return null;
    return declared.every(isSource) ? declared : null;
}

function isSource(name: string): name is Source {
    return Object.hasOwn(SOURCES, name);
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
