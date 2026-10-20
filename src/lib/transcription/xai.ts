import {type Transcribed, untimed, utterancesOf} from '../transcript.js';
import {
    endpoint,
    errorText,
    type Frame,
    numberOr,
    type RecordingTranscriber,
    SAMPLE_RATE,
    type StreamProtocol,
    termsWithin,
    type TranscriptionEvent,
    unhandled
} from './provider.js';
import {type Answer, listOf, textOf, transcribeUpload} from './upload.js';

const RECORDING_URL = 'https://api.x.ai/v1/stt';
const TERMS = {count: 100, length: 50};
// xAI names no alias for its newest model; a request that names none gets it.
const URL = `wss://api.x.ai/v1/stt?sample_rate=${SAMPLE_RATE}&encoding=pcm&interim_results=true`;

type Options = {apiKey: string; terms: string[]};

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
    readonly url: string;

    #finals: Segment[] = [];
    #interim: Segment | null = null;
    #ready = false;

    constructor(options: Options) {
        this.headers = [['Authorization', `Bearer ${options.apiKey}`]];
        this.url = endpoint([
            URL,
            ...termsWithin(options.terms, TERMS).map(term => `keyterm=${encodeURIComponent(term)}`),
        ].join('&'));
    }

    audio(chunk: Uint8Array): Frame[] {
        return [chunk];
    }

    end(): Frame[] {
        return [JSON.stringify({type: 'audio.done'})];
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

export function xaiRecording(options: Options): RecordingTranscriber {
    return async (audio, {diarize}, cancellable) => transcribed(await transcribeUpload({
        apiKey: options.apiKey,
        audio,
        body: {
            fields: [
                ...(diarize ? [['diarize', 'true'] as [string, string]] : []),
                ...termsWithin(options.terms, TERMS)
                    .map(term => ['keyterm', term] as [string, string]),
            ],
            format: 'ogg',
            kind: 'form',
        },
        cancellable,
        url: RECORDING_URL,
    }));
}

function transcribed(answer: Answer): Transcribed {
    const words = listOf(answer, 'words');
    if (words.length === 0)
        return untimed(textOf(answer));
    return {
        timed: true,
        utterances: utterancesOf(words.map(word => {
            const start = numberOr(word.start, 0);
            return {
                end: numberOr(word.end, start),
                speaker: typeof word.speaker === 'number' ? String(word.speaker) : null,
                start,
                text: typeof word.text === 'string' ? word.text : '',
            };
        })),
    };
}
