import type Gio from 'gi://Gio';

export const Key = {
    apiKey: 'mistral-api-key',
    maxRecordingSeconds: 'max-recording-seconds',
    silenceSeconds: 'silence-timeout-seconds',
    toggleRecording: 'toggle-recording',
    transcriptionDelayMs: 'transcription-delay-ms',
    typingSpeed: 'typing-speed',
} as const;

export type RecordingConfig = {
    apiKey: string;
    delayMs: number;
    maxSeconds: number;
    silenceSeconds: number;
    typingSpeed: number;
};

export function readRecordingConfig(settings: Gio.Settings): RecordingConfig {
    return {
        apiKey: settings.get_string(Key.apiKey),
        delayMs: settings.get_int(Key.transcriptionDelayMs),
        maxSeconds: settings.get_int(Key.maxRecordingSeconds),
        silenceSeconds: settings.get_int(Key.silenceSeconds),
        typingSpeed: settings.get_int(Key.typingSpeed),
    };
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
