import type Gio from 'gi://Gio';

import type {ProviderConfig} from '../settings.js';
import {MistralProtocol, mistralRecording} from './mistral.js';
import {OpenRouterTranscription, openrouterRecording} from './openrouter.js';
import type {RecordingTranscriber, Transcription} from './provider.js';
import {StreamTranscription} from './stream.js';
import {XaiProtocol, xaiRecording} from './xai.js';

export function transcriptionFor(
    provider: ProviderConfig,
    onPartial: (text: string) => void,
    cancellable: Gio.Cancellable,
): Transcription {
    switch (provider.kind) {
        case 'mistral':
            return new StreamTranscription(
                new MistralProtocol(provider), onPartial, cancellable);
        case 'openrouter':
            return new OpenRouterTranscription(provider, cancellable);
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
