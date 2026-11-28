import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type {ModelSettings} from './transcription/engine-protocol.js';
import {isProviderId, PROVIDERS, type ProviderId} from './transcription/provider.js';

export const Key = {
    interruptedRecording: 'interrupted-recording',
    keptDictations: 'kept-dictations',
    localModel: 'local-model',
    localModelSettings: 'local-model-settings',
    maxDictationSeconds: 'max-dictation-seconds',
    mistralApiKey: 'mistral-api-key',
    namesAndTerms: 'names-and-terms',
    openrouterApiKey: 'openrouter-api-key',
    openrouterModel: 'openrouter-model',
    recordContext: 'record-context',
    recordingFolder: 'recording-folder',
    recordingPieceMinutes: 'recording-piece-minutes',
    rememberDictations: 'remember-dictations',
    showPanelOnStart: 'show-panel-on-start',
    silenceSeconds: 'silence-timeout-seconds',
    toggleDictation: 'toggle-dictation',
    toggleRecording: 'toggle-recording',
    transcriptionProvider: 'transcription-provider',
    typingSpeed: 'typing-speed',
    xaiApiKey: 'xai-api-key',
} as const;

export type ShortcutKey = typeof Key.toggleDictation | typeof Key.toggleRecording;

export type LocalConfig = {kind: 'local'; model: string; settings: ModelSettings; terms: string[]};

export type ProviderConfig =
    | LocalConfig
    | {apiKey: string; kind: 'mistral'; terms: string[]}
    | {apiKey: string; kind: 'openrouter'; model: string; terms: string[]}
    | {apiKey: string; kind: 'xai'; terms: string[]};

export type DictationConfig = {
    maxSeconds: number;
    provider: ProviderConfig;
    showPanel: boolean;
    silenceSeconds: number;
    typingSpeed: number;
};

export function readDictationConfig(settings: Gio.Settings): DictationConfig {
    const provider = readProviderConfig(settings);
    return {
        maxSeconds: cappedSeconds(settings, provider.kind),
        provider,
        showPanel: settings.get_boolean(Key.showPanelOnStart),
        silenceSeconds: settings.get_int(Key.silenceSeconds),
        typingSpeed: settings.get_int(Key.typingSpeed),
    };
}

export function readPieceSeconds(settings: Gio.Settings): number {
    const minutes = settings.get_int(Key.recordingPieceMinutes);
    return minutes === 0 ? Infinity : minutes * 60;
}

export function readProvider(settings: Gio.Settings): ProviderId {
    const nick = settings.get_string(Key.transcriptionProvider);
    // The key is an enum, so GSettings answers with one of the schema's own
    // nicks and the schema's default is reached only if the two disagree.
    return isProviderId(nick) ? nick : schemaProvider(settings);
}

export function readProviderConfig(
    settings: Gio.Settings, id: ProviderId = readProvider(settings)): ProviderConfig {
    const terms = readTerms(settings);
    switch (id) {
        case 'local': {
            const model = settings.get_string(Key.localModel);
            return {kind: 'local', model, settings: readModelSettings(settings, model), terms};
        }
        case 'mistral':
            return {apiKey: settings.get_string(Key.mistralApiKey), kind: 'mistral', terms};
        case 'openrouter':
            return {
                apiKey: settings.get_string(Key.openrouterApiKey),
                kind: 'openrouter',
                model: settings.get_string(Key.openrouterModel),
                terms,
            };
        case 'xai':
            return {apiKey: settings.get_string(Key.xaiApiKey), kind: 'xai', terms};
    }
}

export function readModelSettings(settings: Gio.Settings, model: string): ModelSettings {
    const all = settings.get_value(Key.localModelSettings)
        .recursiveUnpack<Record<string, ModelSettings>>();
    return all[model] ?? {};
}

export function writeModelSetting(
    settings: Gio.Settings, model: string, name: string, value: GLib.Variant | null): void {
    const all = settings.get_value(Key.localModelSettings)
        .deepUnpack<Record<string, Record<string, GLib.Variant>>>();
    const own = {...all[model]};
    if (value)
        own[name] = value;
    else
        delete own[name];
    if (Object.keys(own).length > 0)
        all[model] = own;
    else
        delete all[model];
    settings.set_value(Key.localModelSettings, new GLib.Variant('a{sa{sv}}', all));
}

export function readTerms(settings: Gio.Settings): string[] {
    return termsOf(settings.get_strv(Key.namesAndTerms).join(','));
}

export function termsOf(text: string): string[] {
    return [...new Set(text.split(',').map(term => term.trim().replace(/\s+/g, ' ')).filter(Boolean))];
}

export function readAccelerator(settings: Gio.Settings, key: ShortcutKey): string {
    return settings.get_strv(key)[0] ?? '';
}

export function readIntRange(settings: Gio.Settings, key: string): {lower: number; upper: number} {
    const schemaKey = settings.settings_schema.get_key(key);
    const range = schemaKey.get_range().get_child_value(1).get_variant();
    if (!range)
        throw new Error(`${key} has no range in the schema`);

    const [lower, upper] = range.deep_unpack() as [number, number];
    return {lower, upper};
}

function cappedSeconds(settings: Gio.Settings, kind: ProviderId): number {
    const seconds = settings.get_int(Key.maxDictationSeconds);
    const cap = PROVIDERS[kind].dictationSeconds;
    return cap === undefined ? seconds : Math.min(seconds, cap);
}

function schemaProvider(settings: Gio.Settings): ProviderId {
    const nick = settings.settings_schema.get_key(Key.transcriptionProvider)
        .get_default_value()
        .deep_unpack() as string;
    if (!isProviderId(nick))
        throw new Error(`no transcription service is named ${nick}`);
    return nick;
}
