import type Gio from 'gi://Gio';

import type {LocalConfig} from '../settings.js';
import type {Engine, EngineRun} from './engine.js';
import {spokenText, transcribedOf} from './engine-protocol.js';
import type {RecordingTranscriber, Transcription} from './provider.js';

// The engine starts with the dictation, so the model loads while the user is
// still speaking, and takes the audio as it is heard: a model that streams
// answers with words on the way, any other one hears all of it at the end.
export class LocalTranscription implements Transcription {
    readonly #cancellable: Gio.Cancellable;
    readonly #config: LocalConfig;
    readonly #engine: Engine;
    readonly #onPartial: (text: string) => void;

    #run: EngineRun | null = null;

    constructor(
        engine: Engine, config: LocalConfig, onPartial: (text: string) => void,
        cancellable: Gio.Cancellable) {
        this.#cancellable = cancellable;
        this.#config = config;
        this.#engine = engine;
        this.#onPartial = onPartial;
    }

    async start(): Promise<void> {
        this.#run = await this.#engine.start('transcribe', {...request(this.#config), mode: 'dictation'},
            {input: true, onPartial: this.#onPartial}, this.#cancellable);
    }

    audio(chunk: Uint8Array): void {
        this.#run?.write(chunk);
    }

    end(): void {
        this.#run?.end();
    }

    get text(): Promise<string> {
        if (!this.#run)
            return Promise.reject(new Error('the engine was never started'));
        return this.#run.result.then(spokenText);
    }
}

export function localRecording(engine: Engine, config: LocalConfig): RecordingTranscriber {
    return async (audio, {diarize}, cancellable) => {
        const run = await engine.start('transcribe', {
            ...request(config),
            audio: audio.get_path(),
            mode: 'recording',
            speakers: diarize,
        }, {}, cancellable);
        return transcribedOf(await run.result);
    };
}

function request(config: LocalConfig): Record<string, unknown> {
    return {model: config.model, settings: config.settings, terms: config.terms};
}
