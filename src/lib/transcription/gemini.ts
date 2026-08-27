import GLib from 'gi://GLib';

import {
    endpoint,
    errorText,
    SAMPLE_RATE,
    type Transcriber,
    type TranscriptionEvent
} from './provider.js';

const MODEL = 'gemini-3.5-transcribe-live';
const URL = 'wss://generativelanguage.googleapis.com/ws/' +
    'google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

type Transcription = {text?: string};

type ServerMessage = {
    error?: {message?: string} | string;
    serverContent?: {
        generationComplete?: boolean;
        inputTranscription?: Transcription;
        interimInputTranscription?: Transcription;
        turnComplete?: boolean;
    };
    setupComplete?: object;
};

// The Live API streams two kinds of transcription: interim hypotheses that are
// revised as the speaker carries on, and a finalized segment each time a turn
// ends. So the text is the finalized segments plus whatever the current
// hypothesis is, and the interim disappears the moment it is superseded.
export class GeminiTranscriber implements Transcriber {
    readonly headers: [string, string][];
    readonly url = endpoint(URL);

    readonly #smart: boolean;
    #ended = false;
    #finals: string[] = [];
    #interim = '';
    #ready = false;
    #started = false;

    constructor(options: {apiKey: string; smart: boolean}) {
        // The documented handshake carries the key in the query string, which
        // would put it in every URL this connection is named by; the endpoint
        // reads it from this header just as happily.
        this.headers = [['x-goog-api-key', options.apiKey]];
        this.#smart = options.smart;
    }

    // The first chunk opens the turn, because a dictation begins when the
    // shortcut is pressed and the service is told so rather than left to hear
    // it: with its own speech detection left on, this endpoint accepts a whole
    // dictation and transcribes none of it.
    audio(chunk: Uint8Array): string[] {
        const frames = [];
        if (!this.#started) {
            this.#started = true;
            frames.push(JSON.stringify({realtimeInput: {activityStart: {}}}));
        }
        frames.push(JSON.stringify({
            realtimeInput: {
                audio: {
                    data: GLib.base64_encode(chunk),
                    mimeType: `audio/pcm;rate=${SAMPLE_RATE}`,
                },
            },
        }));
        return frames;
    }

    end(): string[] {
        this.#ended = true;
        if (!this.#started)
            return [];
        return [JSON.stringify({realtimeInput: {activityEnd: {}}})];
    }

    open(): string[] {
        return [JSON.stringify({
            setup: {
                generationConfig: {responseModalities: ['TEXT']},
                inputAudioTranscription: {
                    // Empty means the model identifies the language itself, and
                    // keeps up when the speaker changes it mid-sentence.
                    languageCodes: [],
                    ...(this.#smart ? {mode: 'SMART'} : {}),
                },
                model: `models/${MODEL}`,
                realtimeInputConfig: {automaticActivityDetection: {disabled: true}},
            },
        })];
    }

    get ready(): boolean {
        return this.#ready;
    }

    receive(message: string): TranscriptionEvent[] {
        let parsed: ServerMessage;
        try {
            parsed = JSON.parse(message) as ServerMessage;
        } catch {
            return [];
        }

        if (parsed.error)
            return [{kind: 'error', message: errorText(parsed.error)}];
        if (parsed.setupComplete) {
            this.#ready = true;
            return [];
        }

        const content = parsed.serverContent;
        if (!content)
            return [];

        const events: TranscriptionEvent[] = [];
        const final = content.inputTranscription?.text?.trim();
        const interim = content.interimInputTranscription?.text?.trim();
        if (final) {
            this.#finals.push(final);
            this.#interim = '';
        }
        if (interim !== undefined)
            this.#interim = interim;
        if (final || interim !== undefined)
            events.push({kind: 'transcript', text: this.#displayed()});

        // The service reports a finished transcription as generation being
        // complete, and only once the turn has been closed from this end.
        if ((content.generationComplete || content.turnComplete) && this.#ended)
            events.push({kind: 'done', text: this.#transcribed()});
        return events;
    }

    #displayed(): string {
        return [...this.#finals, this.#interim].filter(Boolean).join(' ');
    }

    // The finalized segments are the authority; the last hypothesis is all
    // there is when the service finalized nothing at all.
    #transcribed(): string {
        return this.#finals.length > 0 ? this.#finals.join(' ') : this.#interim;
    }
}
