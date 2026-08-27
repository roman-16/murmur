import type {ProviderConfig} from '../settings.js';
import {GeminiTranscriber} from './gemini.js';
import {MistralTranscriber} from './mistral.js';
import type {Transcriber} from './provider.js';

export function transcriberFor(provider: ProviderConfig): Transcriber {
    switch (provider.kind) {
        case 'gemini':
            return new GeminiTranscriber(provider);
        case 'mistral':
            return new MistralTranscriber(provider);
    }
}
