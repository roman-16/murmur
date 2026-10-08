import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type Gst from 'gi://Gst?version=1.0';

import {deferred} from '../async.js';
import {errorMessage} from '../errors.js';
import {SAMPLE_RATE} from '../transcription/provider.js';

export type Source = 'desktop' | 'microphone';

type Gstreamer = typeof Gst;

type Handlers = {
    onEnd: () => void;
    onError: (message: string) => void;
    onLevel?: (source: Source, level: number) => void;
};

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
// Xiph's recommendation for a podcast, and the rate from which Opus is fullband.
const OPUS_BITRATE = 24000;
const PULL_MS = 100;
const SPEECH_CAPS =
    `audio/x-raw,format=S16LE,rate=${SAMPLE_RATE},channels=1,layout=interleaved`;

// PipeWire gives a stream two buffers unless it asks for more, a few
// milliseconds at a short quantum, and drops what it captures while a source
// that holds them all is waiting. Its converter allows 32 at most.
const CAPTURE = 'pipewiresrc min-buffers=32';
// WirePlumber links a capture stream that asks for a sink to the monitor of the
// default output, and follows it when the default changes.
const DESKTOP = `${CAPTURE} stream-properties="props,stream.capture.sink=true"`;
const MICROPHONE = CAPTURE;

const PACKAGES: Record<string, string> = {
    appsink: "GStreamer's base plugins",
    audioconvert: "GStreamer's base plugins",
    audiomixer: "GStreamer's base plugins",
    audioresample: "GStreamer's base plugins",
    filesink: 'GStreamer',
    level: "GStreamer's good plugins",
    oggmux: "GStreamer's base plugins",
    opusenc: "GStreamer's base plugins",
    pipewiresrc: "PipeWire's GStreamer plugin",
};

let gstreamer: Promise<Gstreamer> | null = null;

export function meterFromDecibels(decibels: number): number {
    return Math.min(1, Math.max(0, (decibels + METER_RANGE_DB) / METER_RANGE_DB));
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
        handlers.onLevel = (source, level) => recorder.onLevel?.(source, level);

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

    start(): void {
        if (this.#bin.set_state(this.#gst.State.PLAYING) !== this.#gst.StateChangeReturn.FAILURE)
            return;
        const reason = this.#bus.pop_filtered(this.#gst.MessageType.ERROR)?.parse_error()[0]?.message;
        this.close();
        throw new Error(reason ?? 'the audio could not be opened');
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

    #onMessage(message: Gst.Message, handlers: Handlers): void {
        const {MessageType} = this.#gst;
        switch (message.type) {
            case MessageType.EOS:
                handlers.onEnd();
                break;
            case MessageType.ERROR: {
                const [error, debug] = message.parse_error();
                handlers.onError(error?.message ?? debug);
                break;
            }
            case MessageType.ELEMENT: {
                const source = message.src?.get_name();
                const structure = message.get_structure();
                if (structure?.get_name() !== 'level')
                    break;
                if (source !== 'desktop' && source !== 'microphone')
                    break;
                const decibels = (structure.get_value('rms') as ValueArray | null)?.get_nth(0);
                if (typeof decibels === 'number')
                    handlers.onLevel?.(source, meterFromDecibels(decibels));
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
