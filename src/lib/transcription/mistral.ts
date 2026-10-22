import type Gio from 'gi://Gio';

import {type Transcribed, untimed} from '../transcript.js';
import {type DictationSender, numberOr, type RecordingTranscriber} from './provider.js';
import {type Answer, listOf, textOf, transcribeDictation, transcribeUpload} from './upload.js';

const MODEL = 'voxtral-small-transcribe-3';
const URL = 'https://api.mistral.ai/v1/audio/transcriptions';

type Field = [string, string];

type Options = {apiKey: string; terms: string[]};

export function mistralDictation(options: Options): DictationSender {
    return async (wave, cancellable) => textOf(await transcribeDictation({
        apiKey: options.apiKey,
        audio: wave,
        body: {fields: fields(options), format: 'wav', kind: 'form'},
        cancellable,
        url: URL,
    }));
}

export function mistralRecording(options: Options): RecordingTranscriber {
    return async (audio: Gio.File, {diarize}, cancellable) => transcribed(await transcribeUpload({
        apiKey: options.apiKey,
        audio,
        body: {
            fields: [
                ...fields(options),
                ...(diarize ? [['diarize', 'true'] as Field] : []),
                ['timestamp_granularities', 'segment'],
            ],
            format: 'ogg',
            kind: 'form',
        },
        cancellable,
        url: URL,
    }));
}

function fields(options: Options): Field[] {
    return [
        ...options.terms.map((term): Field => ['context_bias', term]),
        ['model', MODEL],
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
