import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {errorMessage, isCancelled} from '../errors.js';
import type {Engine} from '../transcription/engine.js';
import {type Setup, setupMessage} from '../transcription/setup.js';
import {notify} from './notify.js';

// What a dictation or a recording still needs, said where the shortcut was
// pressed. A missing engine is offered for download right here: installing it
// takes the press of a button, which is what extensions.gnome.org asks for.
export class SetupNotices {
    readonly #cancellable = new Gio.Cancellable();
    readonly #engine: Engine;

    #downloading = false;

    constructor(engine: Engine) {
        this.#engine = engine;
    }

    show(setup: Setup, then: () => void = () => {}): void {
        const {body, title} = setupMessage(setup);
        if (setup.kind !== 'engine') {
            notify({body: body ?? undefined, title});
            return;
        }
        this.#engine.plan(this.#cancellable).then(
            plan => notify({
                actions: [{label: 'Download', run: () => void this.#download(then)}],
                body: `${GLib.format_size(plan.bytes)} from ${plan.hosts.join(' and ')}`,
                title,
            }),
            error => {
                if (!isCancelled(error))
                    notify({body: errorMessage(error), title});
            });
    }

    destroy(): void {
        this.#cancellable.cancel();
    }

    async #download(then: () => void): Promise<void> {
        if (this.#downloading)
            return;
        this.#downloading = true;
        notify({title: 'Downloading the engine…'});
        try {
            await this.#engine.install(() => {}, this.#cancellable);
            notify({title: 'The engine is ready'});
            then();
        } catch (error) {
            if (!isCancelled(error)) {
                notify({
                    actions: [{label: 'Retry', run: () => void this.#download(then)}],
                    body: errorMessage(error),
                    title: 'The engine could not be downloaded',
                });
            }
        } finally {
            this.#downloading = false;
        }
    }
}
