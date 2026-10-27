import type Gio from 'gi://Gio';

import type {ProviderConfig} from '../settings.js';
import {MISTRAL_MODEL, mistralDictation, mistralRecording} from './mistral.js';
import {openrouterDictation, openrouterRecording} from './openrouter.js';
import {PROVIDERS, type RecordingTranscriber, type Transcription} from './provider.js';
import {StreamTranscription} from './stream.js';
import {UploadTranscription} from './upload-transcription.js';
import {XaiProtocol, xaiRecording} from './xai.js';

export function transcriptionFor(
    provider: ProviderConfig,
    onPartial: (text: string) => void,
    cancellable: Gio.Cancellable,
): Transcription {
    switch (provider.kind) {
        case 'mistral':
            return new UploadTranscription(mistralDictation(provider), cancellable);
        case 'openrouter':
            return new UploadTranscription(openrouterDictation(provider), cancellable);
        case 'xai':
            return new StreamTranscription(
                new XaiProtocol(provider), onPartial, cancellable);
    }
}

export function recordingTranscriberFor(provider: ProviderConfig): RecordingTranscriber {
    switch (provider.kind) {
        case 'mistral':
            return mistralRecording(provider);
        case 'openrouter':
            return openrouterRecording(provider);
        case 'xai':
            return xaiRecording(provider);
    }
}

export function serviceOf(provider: ProviderConfig): string {
    switch (provider.kind) {
        case 'mistral':
            return `${PROVIDERS.mistral.label} (${MISTRAL_MODEL})`;
        case 'openrouter':
            return `${PROVIDERS.openrouter.label} (${provider.model})`;
        case 'xai':
            return PROVIDERS.xai.label;
    }
}
