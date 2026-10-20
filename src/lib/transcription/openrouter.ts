import {type Transcribed, untimed, type Utterance, utterancesOf} from '../transcript.js';
import {
    type DictationSender,
    numberOr,
    type RecordingTranscriber,
    termsWithin
} from './provider.js';
import {
    type Answer,
    listOf,
    Refusal,
    textOf,
    transcribeDictation,
    transcribeUpload
} from './upload.js';

const TERMS = {count: 1000, length: 100};
const URL = 'https://openrouter.ai/api/v1/audio/transcriptions';

type Extra = 'diarize' | 'terms' | 'timed';

type Options = {apiKey: string; model: string; terms: string[]};

// OpenRouter does not say which of its models can label speakers, take terms or
// time what they heard, and answers 400 to a request for something the model
// cannot do. The extras are given up one at a time, in this order, and what a
// model turned away is not asked of it again.
const GIVEN_UP_IN_ORDER: Extra[] = ['diarize', 'terms', 'timed'];
const refused = new Map<string, Set<Extra>>();

export function openrouterDictation(options: Options): DictationSender {
    return async (wave, cancellable) => textOf(await degrading(options, ['terms'],
        extras => transcribeDictation({
            apiKey: options.apiKey,
            audio: wave,
            body: {fields: fields(options, extras), format: 'wav', kind: 'json'},
            cancellable,
            url: URL,
        })));
}

export function openrouterRecording(options: Options): RecordingTranscriber {
    return async (audio, {diarize}, cancellable) => transcribed(await degrading(options,
        diarize ? ['diarize', 'terms', 'timed'] : ['terms', 'timed'],
        extras => transcribeUpload({
            apiKey: options.apiKey,
            audio,
            body: {fields: fields(options, extras), format: 'ogg', kind: 'json'},
            cancellable,
            url: URL,
        })));
}

async function degrading(
    options: Options, wanted: Extra[],
    attempt: (extras: Set<Extra>) => Promise<Answer>): Promise<Answer> {
    const known = refused.get(options.model) ?? new Set<Extra>();
    const extras = new Set(wanted.filter(extra =>
        !known.has(extra) && (extra !== 'terms' || termsOf(options).length > 0)));
    const given: Extra[] = [];
    for (;;) {
        try {
            const answer = await attempt(extras);
            if (given.length > 0)
                refused.set(options.model, new Set([...known, ...given]));
            return answer;
        } catch (error) {
            const next = GIVEN_UP_IN_ORDER.find(extra => extras.has(extra));
            if (!(error instanceof Refusal) || error.status !== 400 || next === undefined)
                throw error;
            extras.delete(next);
            given.push(next);
        }
    }
}

function fields(options: Options, extras: Set<Extra>): Record<string, unknown> {
    return {
        ...(extras.has('diarize') ? {diarize: true} : {}),
        ...(extras.has('terms') ? {keyterms: termsOf(options)} : {}),
        model: options.model,
        ...(extras.has('timed')
            ? {response_format: 'verbose_json', timestamp_granularities: ['segment', 'word']}
            : {}),
    };
}

function termsOf(options: Options): string[] {
    return termsWithin(options.terms, TERMS);
}

function transcribed(answer: Answer): Transcribed {
    const words = listOf(answer, 'words').map(word => timedOf(word, word.word ?? word.text));
    if (words.some(word => word.speaker !== null))
        return {timed: true, utterances: utterancesOf(words)};
    const segments = listOf(answer, 'segments');
    if (segments.length > 0)
        return {timed: true, utterances: segments.map(segment => timedOf(segment, segment.text))};
    if (words.length > 0)
        return {timed: true, utterances: utterancesOf(words)};
    return untimed(textOf(answer));
}

function timedOf(item: Record<string, unknown>, text: unknown): Utterance {
    const start = numberOr(item.start, 0);
    const speaker = item.speaker_label ?? item.speaker;
    return {
        end: numberOr(item.end, start),
        speaker: typeof speaker === 'string' || typeof speaker === 'number' ? String(speaker) : null,
        start,
        text: typeof text === 'string' ? text : '',
    };
}
