import GLib from 'gi://GLib';

const MODEL = 'voxtral-mini-transcribe-realtime-2602';

// The override exists so the demo recording can drive a scripted endpoint
// instead of billing a real one; nothing sets it in a normal session.
export const REALTIME_URL = GLib.getenv('MURMUR_REALTIME_URL') ||
    `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=${MODEL}`;
export const SAMPLE_RATE = 16000;

export type ClientMessage =
    | {audio: string; type: 'input_audio.append'}
    | {type: 'input_audio.end'}
    | {type: 'input_audio.flush'}
    | {
        session: {
            audio_format: {encoding: 'pcm_s16le'; sample_rate: number};
            target_streaming_delay_ms: number;
        };
        type: 'session.update';
    };

export type ServerEvent =
    | {error?: {message?: string} | string; type: 'error'}
    | {text?: string; type: 'transcription.done'}
    | {text?: string; type: 'transcription.text.delta'};

export function parseServerEvent(bytes: GLib.Bytes): ServerEvent | null {
    const data = bytes.get_data();
    if (!data)
        return null;
    try {
        return JSON.parse(new TextDecoder().decode(data)) as ServerEvent;
    } catch {
        return null;
    }
}

// Keeps the event switch exhaustive at compile time while staying harmless if
// the API grows an event type at runtime.
export function unhandledEvent(event: never): void {
    console.debug(`murmur: ignoring unknown realtime event ${JSON.stringify(event)}`);
}

export function serverErrorMessage(error: {message?: string} | string | undefined): string {
    if (typeof error === 'string')
        return error;
    if (typeof error?.message === 'string')
        return error.message;
    return JSON.stringify(error);
}
