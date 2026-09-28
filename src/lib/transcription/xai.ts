import {
    endpoint,
    errorText,
    type Frame,
    type RecordingTranscriber,
    SAMPLE_RATE,
    type StreamProtocol,
    type TranscriptionEvent,
    unhandled
} from './provider.js';
import {transcribeUpload} from './upload.js';

const MODEL = 'grok-voice-transcribe-2.0';
const RECORDING_URL = 'https://api.x.ai/v1/stt';
const URL = `wss://api.x.ai/v1/stt?model=${MODEL}` +
    `&sample_rate=${SAMPLE_RATE}&encoding=pcm&interim_results=true`;

type Segment = {start: number; text: string};

type ServerEvent =
    | {message?: string; type: 'error'}
    | {type: 'transcript.created'}
    | {text?: string; type: 'transcript.done'}
    | {is_final?: boolean; start?: number; text?: string; type: 'transcript.partial'};

// Grok streams a transcription in pieces, each placed by where it starts in the
// audio: a guess that is revised, then locked chunks, then the whole utterance
// once the speaker pauses. A locked piece supersedes whatever it starts at or
// before, so the text is the locked pieces in order with the current guess
// after them, however much of what came before either one repeats.
export class XaiProtocol implements StreamProtocol {
    readonly headers: [string, string][];
    readonly url = endpoint(URL);

    #finals: Segment[] = [];
    #interim: Segment | null = null;
    #ready = false;

    constructor(options: {apiKey: string}) {
        this.headers = [['Authorization', `Bearer ${options.apiKey}`]];
    }

    audio(chunk: Uint8Array): Frame[] {
        return [chunk];
    }

    end(): Frame[] {
        return [JSON.stringify({type: 'audio.done'})];
    }

    open(): Frame[] {
        return [];
    }

    get ready(): boolean {
        return this.#ready;
    }

    receive(message: string): TranscriptionEvent[] {
        let event: ServerEvent;
        try {
            event = JSON.parse(message) as ServerEvent;
        } catch {
            return [];
        }

        switch (event.type) {
            case 'error':
                return [{kind: 'error', message: errorText(event)}];
            case 'transcript.created':
                this.#ready = true;
                return [];
            case 'transcript.done':
                return [{kind: 'done', text: this.#transcribed(event.text?.trim() ?? '')}];
            case 'transcript.partial':
                this.#take({start: event.start ?? 0, text: event.text?.trim() ?? ''},
                    event.is_final === true);
                return [{kind: 'transcript', text: this.#displayed()}];
            default:
                return unhandled(event);
        }
    }

    #take(segment: Segment, final: boolean): void {
        if (!final) {
            this.#interim = segment;
            return;
        }
        this.#interim = null;
        if (!segment.text)
            return;
        this.#finals = this.#finals.filter(earlier => earlier.start < segment.start);
        this.#finals.push(segment);
    }

    #displayed(): string {
        const interim = this.#interim;
        const finals = interim
            ? this.#finals.filter(final => final.start < interim.start)
            : this.#finals;
        return [...finals, interim]
            .map(segment => segment?.text)
            .filter(Boolean)
            .join(' ');
    }

    // xAI does not say whether the closing transcript carries the whole
    // dictation or only its tail, so it wins only when it holds at least as
    // much as the pieces add up to.
    #transcribed(closing: string): string {
        const assembled = this.#displayed();
        return closing.length >= assembled.length ? closing : assembled;
    }
}

export function xaiRecording(options: {apiKey: string}): RecordingTranscriber {
    return (audio, cancellable) => transcribeUpload({
        apiKey: options.apiKey,
        audio,
        cancellable,
        fields: [],
        url: RECORDING_URL,
    });
}
