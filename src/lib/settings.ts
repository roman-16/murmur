import type Gio from 'gi://Gio';

import {PROVIDERS, providerId, type ProviderId} from './transcription/provider.js';

export const Key = {
    geminiApiKey: 'gemini-api-key',
    geminiSmartTranscription: 'gemini-smart-transcription',
    maxRecordingSeconds: 'max-recording-seconds',
    mistralApiKey: 'mistral-api-key',
    showPanelOnStart: 'show-panel-on-start',
    silenceSeconds: 'silence-timeout-seconds',
    toggleRecording: 'toggle-recording',
    transcriptionDelayMs: 'transcription-delay-ms',
    transcriptionProvider: 'transcription-provider',
    typingSpeed: 'typing-speed',
} as const;

export type ProviderConfig =
    | {apiKey: string; delayMs: number; kind: 'mistral'}
    | {apiKey: string; kind: 'gemini'; smart: boolean};

export type RecordingConfig = {
    maxSeconds: number;
    provider: ProviderConfig;
    showPanel: boolean;
    silenceSeconds: number;
    typingSpeed: number;
};

export function readRecordingConfig(settings: Gio.Settings): RecordingConfig {
    const provider = readProviderConfig(settings);
    return {
        // A service that ends the session itself decides the real ceiling, so
        // the countdown counts down to the earlier of the two.
        maxSeconds: Math.min(
            settings.get_int(Key.maxRecordingSeconds),
            PROVIDERS[provider.kind].maxSessionSeconds),
        provider,
        showPanel: settings.get_boolean(Key.showPanelOnStart),
        silenceSeconds: settings.get_int(Key.silenceSeconds),
        typingSpeed: settings.get_int(Key.typingSpeed),
    };
}

export function readProvider(settings: Gio.Settings): ProviderId {
    return providerId(settings.get_string(Key.transcriptionProvider));
}

export function readAccelerator(settings: Gio.Settings): string {
    return settings.get_strv(Key.toggleRecording)[0] ?? '';
}

export function readIntRange(settings: Gio.Settings, key: string): {lower: number; upper: number} {
    const schemaKey = settings.settings_schema.get_key(key);
    const range = schemaKey.get_range().get_child_value(1).get_variant();
    if (!range)
        throw new Error(`${key} has no range in the schema`);

    const [lower, upper] = range.deep_unpack() as [number, number];
    return {lower, upper};
}

function readProviderConfig(settings: Gio.Settings): ProviderConfig {
    switch (readProvider(settings)) {
        case 'gemini':
            return {
                apiKey: settings.get_string(Key.geminiApiKey),
                kind: 'gemini',
                smart: settings.get_boolean(Key.geminiSmartTranscription),
            };
        case 'mistral':
            return {
                apiKey: settings.get_string(Key.mistralApiKey),
                delayMs: settings.get_int(Key.transcriptionDelayMs),
                kind: 'mistral',
            };
    }
}
