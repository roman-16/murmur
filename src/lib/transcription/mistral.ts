import type Gio from 'gi://Gio';

import {type Transcribed, untimed} from '../transcript.js';
import {
    type DictationSender,
    numberOr,
    type RecordingTranscriber,
    termsWithin
} from './provider.js';
import {type Answer, listOf, textOf, transcribeDictation, transcribeUpload} from './upload.js';

const MODEL = 'voxtral-mini-latest';
const TERMS = {count: 100, length: Infinity};
const URL = 'https://api.mistral.ai/v1/audio/transcriptions';

type Options = {apiKey: string; terms: string[]};

export function mistralDictation(options: Options): DictationSender {
    return async (wave, cancellable) => spaced(await transcribeDictation({
        apiKey: options.apiKey,
        audio: wave,
        body: {fields: fields(options, false), format: 'wav', kind: 'form'},
        cancellable,
        url: URL,
    }));
}

export function mistralRecording(options: Options): RecordingTranscriber {
    return async (audio: Gio.File, {diarize}, cancellable) => transcribed(await transcribeUpload({
        apiKey: options.apiKey,
        audio,
        body: {fields: fields(options, diarize), format: 'ogg', kind: 'form'},
        cancellable,
        url: URL,
    }));
}

// Mistral turns away a term with a space or a comma in it, and writes a phrase
// with underscores where its words meet.
function fields(options: Options, diarize: boolean): [string, string][] {
    return [
        ['model', MODEL],
        ['timestamp_granularities', 'segment'],
        ...(diarize ? [['diarize', 'true'] as [string, string]] : []),
        ...termsWithin(options.terms, TERMS)
            .map(term => ['context_bias', term.replace(/[\s,]+/g, '_')] as [string, string]),
    ];
}

function transcribed(answer: Answer): Transcribed {
    const segments = listOf(answer, 'segments');
    if (segments.length === 0)
        return untimed(textOf(answer));
    return {
        timed: true,
        utterances: segments.map(segment => {
            const start = numberOr(segment.start, 0);
            return {
                end: numberOr(segment.end, start),
                speaker: typeof segment.speaker_id === 'string' ? segment.speaker_id : null,
                start,
                text: typeof segment.text === 'string' ? segment.text : '',
            };
        }),
    };
}

// Mistral transcribes in windows of about half a minute and runs them together
// without a space where one ends on a full stop, in its text and in the first
// segment of each window alike, so the words are put back together from the
// segments.
function spaced(answer: Answer): string {
    const {utterances} = transcribed(answer);
    return utterances.map(utterance => utterance.text.trim()).filter(Boolean).join(' ');
}
