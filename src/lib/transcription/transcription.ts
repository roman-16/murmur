import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type {ProviderConfig} from '../settings.js';
import type {Engine} from './engine.js';
import {LocalTranscription, localRecording} from './local.js';
import {MISTRAL_MODEL, mistralDictation, mistralRecording} from './mistral.js';
import {openrouterDictation, openrouterRecording} from './openrouter.js';
import {PROVIDERS, type RecordingTranscriber, type Transcription} from './provider.js';
import {StreamTranscription} from './stream.js';
import {UploadTranscription} from './upload-transcription.js';
import {XaiProtocol, xaiRecording} from './xai.js';

export function transcriptionFor(
    provider: ProviderConfig,
    engine: Engine,
    onPartial: (text: string) => void,
    cancellable: Gio.Cancellable,
): Transcription {
    switch (provider.kind) {
        case 'local':
            return new LocalTranscription(engine, provider, onPartial, cancellable);
        case 'mistral':
            return new UploadTranscription(mistralDictation(provider), cancellable);
        case 'openrouter':
            return new UploadTranscription(openrouterDictation(provider), cancellable);
        case 'xai':
            return new StreamTranscription(
                new XaiProtocol(provider), onPartial, cancellable);
    }
}

export function recordingTranscriberFor(
    provider: ProviderConfig, engine: Engine): RecordingTranscriber {
    switch (provider.kind) {
        case 'local':
            return localRecording(engine, provider);
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
        case 'local':
            return `${PROVIDERS.local.label} (${GLib.path_get_basename(provider.model)})`;
        case 'mistral':
            return `${PROVIDERS.mistral.label} (${MISTRAL_MODEL})`;
        case 'openrouter':
            return `${PROVIDERS.openrouter.label} (${provider.model})`;
        case 'xai':
            return PROVIDERS.xai.label;
    }
}
