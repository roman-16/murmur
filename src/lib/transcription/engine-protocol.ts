import {type Transcribed, type Utterance, utterancesOf} from '../transcript.js';

export type ModelSetting = boolean | number | string;

export type ModelSettings = Record<string, ModelSetting>;

export type SettingKind = 'choice' | 'integer' | 'number' | 'switch' | 'text';

export type SettingDescription = {
    choices: string[];
    default: ModelSetting;
    kind: SettingKind;
    live: boolean;
    name: string;
};

export type ModelDescription = {
    device: string | null;
    languages: string[];
    problem: string | null;
    settings: SettingDescription[];
    streams: boolean;
    terms: boolean;
};

export type EngineStatus = {device: string | null; version: string};

export type DownloadPlan = {bytes: number; hosts: string[]};

export type Progress = {done: number; total: number};

export type Answer = Record<string, unknown>;

export type Line =
    | {kind: 'error'; message: string}
    | {kind: 'partial'; text: string}
    | {kind: 'progress'; progress: Progress}
    | {kind: 'result'; result: Answer};

const KINDS: SettingKind[] = ['choice', 'integer', 'number', 'switch', 'text'];

export function lineOf(text: string): Line | null {
    let line: unknown;
    try {
        line = JSON.parse(text);
    } catch {
        return null;
    }
    if (!isRecord(line))
        return null;
    if (typeof line.error === 'string')
        return {kind: 'error', message: line.error};
    if (typeof line.partial === 'string')
        return {kind: 'partial', text: line.partial};
    if (isRecord(line.progress))
        return {kind: 'progress', progress: {done: count(line.progress.done), total: count(line.progress.total)}};
    if (isRecord(line.result))
        return {kind: 'result', result: line.result};
    return null;
}

export function descriptionOf(answer: Answer): ModelDescription {
    const settings = Array.isArray(answer.settings) ? answer.settings : [];
    return {
        device: typeof answer.device === 'string' ? answer.device : null,
        languages: strings(answer.languages),
        problem: typeof answer.problem === 'string' ? answer.problem : null,
        settings: settings.flatMap(setting => {
            const described = settingOf(setting);
            return described ? [described] : [];
        }),
        streams: answer.streams === true,
        terms: answer.terms === true,
    };
}

export function statusOf(answer: Answer): EngineStatus {
    if (typeof answer.version !== 'string')
        throw new Error('the engine did not say which version it is');
    return {device: typeof answer.device === 'string' ? answer.device : null, version: answer.version};
}

export function planOf(answer: Answer): DownloadPlan {
    return {bytes: count(answer.bytes), hosts: strings(answer.hosts)};
}

export function spokenText(answer: Answer): string {
    if (typeof answer.text !== 'string')
        throw new Error('the engine sent no text back');
    return answer.text;
}

export function transcribedOf(answer: Answer): Transcribed {
    if (!Array.isArray(answer.words))
        throw new Error('the engine sent no words back');
    const words = answer.words.flatMap((word): Utterance[] => {
        if (!isRecord(word) || typeof word.text !== 'string')
            return [];
        const start = seconds(word.start);
        return [{
            end: Math.max(start, seconds(word.end)),
            speaker: typeof word.speaker === 'string' ? word.speaker : null,
            start,
            text: word.text,
        }];
    });
    return {timed: true, utterances: utterancesOf(words)};
}

function settingOf(setting: unknown): SettingDescription | null {
    if (!isRecord(setting) || typeof setting.name !== 'string')
        return null;
    const kind = KINDS.find(known => known === setting.kind);
    const value = setting.default;
    if (!kind || !(typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string'))
        return null;
    return {
        choices: strings(setting.choices),
        default: value,
        kind,
        live: setting.live === true,
        name: setting.name,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

function count(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function seconds(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
