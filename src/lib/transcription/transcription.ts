import type Gio from 'gi://Gio';

import type {ProviderConfig} from '../settings.js';
import {GeminiProtocol} from './gemini.js';
import {MistralProtocol} from './mistral.js';
import {OpenRouterTranscription} from './openrouter.js';
import type {Transcription} from './provider.js';
import {StreamTranscription} from './stream.js';

export function transcriptionFor(
    provider: ProviderConfig,
    onPartial: (text: string) => void,
    cancellable: Gio.Cancellable,
): Transcription {
    switch (provider.kind) {
        case 'gemini':
            return new StreamTranscription(
                new GeminiProtocol(provider), onPartial, cancellable);
        case 'mistral':
            return new StreamTranscription(
                new MistralProtocol(provider), onPartial, cancellable);
        case 'openrouter':
            return new OpenRouterTranscription(provider, cancellable);
    }
}
