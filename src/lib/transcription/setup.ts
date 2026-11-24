import Gio from 'gi://Gio';

import {exists} from '../files.js';
import type {ProviderConfig} from '../settings.js';
import type {Engine} from './engine.js';
import {PROVIDERS} from './provider.js';

export type Setup =
    | {kind: 'engine'; outdated: boolean}
    | {kind: 'key'; vendor: string}
    | {kind: 'model'}
    | {kind: 'model-gone'; path: string}
    | {kind: 'python'};

export async function setupNeeded(provider: ProviderConfig, engine: Engine): Promise<Setup | null> {
    if (provider.kind !== 'local')
        return provider.apiKey ? null : {kind: 'key', vendor: PROVIDERS[provider.kind].vendor};
    const state = await engine.state();
    switch (state.kind) {
        case 'missing':
        case 'outdated':
            return {kind: 'engine', outdated: state.kind === 'outdated'};
        case 'no-python':
            return {kind: 'python'};
        case 'ready':
            break;
    }
    if (!provider.model)
        return {kind: 'model'};
    if (!await exists(Gio.File.new_for_path(provider.model)))
        return {kind: 'model-gone', path: provider.model};
    return null;
}

export type SetupMessage = {body: string | null; title: string};

export function setupMessage(setup: Setup): SetupMessage {
    switch (setup.kind) {
        case 'engine':
            return {
                body: null,
                title: setup.outdated
                    ? 'The engine needs an update'
                    : 'Download the engine to transcribe on this computer',
            };
        case 'key':
            return {body: null, title: `Set your ${setup.vendor} API key in the extension preferences`};
        case 'model':
            return {body: null, title: 'Choose a model file in the extension preferences'};
        case 'model-gone':
            return {
                body: `${setup.path}. Choose another in the extension preferences`,
                title: 'The model file is gone',
            };
        case 'python':
            return {body: null, title: 'Install Python 3 to transcribe on this computer'};
    }
}

export function setupError(setup: Setup): Error {
    const {body, title} = setupMessage(setup);
    return new Error(body ? `${title}: ${body}` : title);
}
