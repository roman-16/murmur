import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {errorMessage} from '../errors.js';
import type {History} from '../history.js';
import {Key, readDictationConfig} from '../settings.js';
import {PROVIDERS} from '../transcription/provider.js';
import {copyText} from './clipboard.js';
import {clock} from './clock.js';
import {DictationIndicator} from './dictation-indicator.js';
import {type Destination, FocusTracker} from './focus.js';
import {insertText, typingPace, type Pace} from './insertion.js';
import {notify} from './notify.js';
import {MurmurPanel, type PanelAction} from './panel.js';
import {Session} from './session.js';

export class Dictation {
    readonly #focusTracker: FocusTracker;
    readonly #history: History;
    readonly #settings: Gio.Settings;

    #cancellable: Gio.Cancellable | null = null;
    #copyRequested = false;
    #countdownId = 0;
    #deadlineUs = 0;
    #indicator: DictationIndicator | null = null;
    #panel: MurmurPanel | null = null;
    #session: Session | null = null;

    constructor(settings: Gio.Settings, history: History) {
        this.#focusTracker = new FocusTracker();
        this.#history = history;
        this.#settings = settings;
    }

    destroy(): void {
        this.cancel();
        this.#focusTracker.destroy();
    }

    async toggle(): Promise<void> {
        if (this.#session) {
            this.#stop();
            return;
        }

        const config = readDictationConfig(this.#settings);
        if (!config.provider.apiKey) {
            const {vendor} = PROVIDERS[config.provider.kind];
            notify({title: `Set your ${vendor} API key in the extension preferences`});
            return;
        }

        const focusTracker = this.#focusTracker;
        this.#copyRequested = false;

        const panel = new MurmurPanel({collapsed: !config.showPanel});
        panel.destination = focusTracker.current();
        panel.onAction = action => this.#onPanelAction(action);
        this.#panel = panel;

        const indicator = new DictationIndicator();
        indicator.onToggle = () => panel.toggle();
        this.#indicator = indicator;

        focusTracker.onChanged = () => {
            panel.destination = focusTracker.current();
        };

        const cancellable = new Gio.Cancellable();
        this.#cancellable = cancellable;
        const session = new Session(config, {
            onLevel: level => {
                panel.level = level;
            },
            onPartial: text => {
                panel.transcript = text;
            },
            onSilence: () => this.#stop(),
        }, cancellable);
        this.#session = session;
        this.#startCountdown(config.maxSeconds);

        try {
            const transcript = await session.run();
            const destination: Destination =
                this.#copyRequested ? {kind: 'clipboard'} : focusTracker.current();
            await this.#deliver(transcript, destination, typingPace(config.typingSpeed),
                cancellable);
        } catch (error) {
            this.#closeUi();
            if (!cancellable.is_cancelled())
                notify({body: errorMessage(error), title: 'The dictation failed'});
        } finally {
            if (this.#session === session) {
                this.#session = null;
                this.#cancellable = null;
            }
        }
    }

    cancel(): void {
        this.#cancellable?.cancel();
        this.#closeUi();
    }

    async #deliver(
        transcript: string, destination: Destination, pace: Pace,
        cancellable: Gio.Cancellable): Promise<void> {
        this.#endListening();
        this.#panel?.releaseKeyboard();

        if (!transcript.trim()) {
            this.#closeUi();
            return;
        }
        this.#remember(transcript, destination);

        if (destination.kind === 'clipboard') {
            copyText(transcript);
            // The panel fades itself out once the message has been read; the
            // reference stays so that disabling the extension still tears it
            // down, and destroying it twice is harmless.
            this.#panel?.showResult('Copied to the clipboard');
            return;
        }

        this.#closeUi();
        if (!cancellable.is_cancelled())
            await insertText(transcript, pace, cancellable);
    }

    // A password the client announced as one is delivered and forgotten; there
    // is nothing to gain from a dictation that is kept where the password is.
    //
    // The words land first and the record follows: waiting for the disk before
    // typing would hand a slow filesystem a say in how soon the text appears.
    #remember(transcript: string, destination: Destination): void {
        if (!this.#settings.get_boolean(Key.rememberDictations))
            return;
        if (destination.kind === 'field' && destination.password)
            return;
        this.#history.append(transcript)
            .catch(error => console.error(`murmur: history: ${errorMessage(error)}`));
    }

    #onPanelAction(action: PanelAction): void {
        if (action === 'cancel') {
            this.cancel();
            return;
        }
        this.#copyRequested = action === 'copy';
        this.#stop();
    }

    #stop(): void {
        if (!this.#session)
            return;
        this.#clearCountdown();
        if (this.#panel) {
            this.#panel.status = 'Finishing…';
            this.#panel.countdown = '';
        }
        this.#session.stop();
    }

    #closeUi(): void {
        this.#endListening();
        this.#panel?.destroy();
        this.#panel = null;
    }

    #endListening(): void {
        this.#clearCountdown();
        this.#indicator?.destroy();
        this.#indicator = null;
        this.#focusTracker.onChanged = null;
    }

    #startCountdown(maxSeconds: number): void {
        this.#deadlineUs = GLib.get_monotonic_time() + maxSeconds * 1000000;
        this.#tick();
    }

    #tick(): void {
        const remainingUs = this.#deadlineUs - GLib.get_monotonic_time();
        const remaining = Math.max(0, Math.ceil(remainingUs / 1000000));
        const text = clock(remaining);
        if (this.#panel)
            this.#panel.countdown = text;
        if (this.#indicator)
            this.#indicator.countdown = text;

        if (remaining <= 0) {
            this.#stop();
            return;
        }
        this.#clearCountdown();
        this.#countdownId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this.#countdownId = 0;
            this.#tick();
            return GLib.SOURCE_REMOVE;
        });
    }

    #clearCountdown(): void {
        if (!this.#countdownId)
            return;
        GLib.source_remove(this.#countdownId);
        this.#countdownId = 0;
    }
}
