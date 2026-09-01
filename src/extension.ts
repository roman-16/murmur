import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {errorMessage} from './lib/errors.js';
import {History} from './lib/history.js';
import {Key, readRecordingConfig} from './lib/settings.js';
import {copyText} from './lib/shell/clipboard.js';
import {FocusTracker, type Destination} from './lib/shell/focus.js';
import {RecordingIndicator} from './lib/shell/indicator.js';
import {insertText, typingPace, type Pace} from './lib/shell/insertion.js';
import {MurmurPanel, type PanelAction} from './lib/shell/panel.js';
import {Session} from './lib/shell/session.js';
import {PROVIDERS} from './lib/transcription/provider.js';

export default class MurmurExtension extends Extension {
    #cancellable: Gio.Cancellable | null = null;
    #copyRequested = false;
    #countdownId = 0;
    #deadlineUs = 0;
    #focusTracker: FocusTracker | null = null;
    #history: History | null = null;
    #indicator: RecordingIndicator | null = null;
    #keybindingId = 0;
    #panel: MurmurPanel | null = null;
    #session: Session | null = null;
    #settings: Gio.Settings | null = null;
    #settingsChangedId = 0;

    enable(): void {
        const settings = this.getSettings();
        this.#settings = settings;
        this.#history = new History(this.uuid);
        this.#focusTracker = new FocusTracker();
        this.#bindShortcut();
        this.#settingsChangedId = settings.connect(`changed::${Key.toggleRecording}`, () => {
            this.#unbindShortcut();
            this.#bindShortcut();
        });
    }

    disable(): void {
        if (this.#settingsChangedId) {
            this.#settings?.disconnect(this.#settingsChangedId);
            this.#settingsChangedId = 0;
        }
        this.#unbindShortcut();
        this.#clearCountdown();
        this.#cancellable?.cancel();
        this.#cancellable = null;
        this.#session = null;
        this.#closeUi();
        this.#focusTracker?.destroy();
        this.#focusTracker = null;
        this.#history = null;
        this.#settings = null;
    }

    #bindShortcut(): void {
        const settings = this.#settings;
        if (!settings || settings.get_strv(Key.toggleRecording).length === 0)
            return;

        const modes = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
        const flags = Meta.KeyBindingFlags.NONE;
        const dictate = () => {
            this.dictate().catch(error => console.error(`murmur: ${errorMessage(error)}`));
        };
        const name = Key.toggleRecording;
        this.#keybindingId = Main.wm.addKeybinding(name, settings, flags, modes, dictate);
    }

    #unbindShortcut(): void {
        if (!this.#keybindingId)
            return;
        Main.wm.removeKeybinding(Key.toggleRecording);
        this.#keybindingId = 0;
    }

    // Public so anything inside the shell process can start a dictation, the
    // demo recording included: a virtual keyboard cannot reach a compositor
    // keybinding while a client window holds the focus.
    async dictate(): Promise<void> {
        const settings = this.#settings;
        const focusTracker = this.#focusTracker;
        if (!settings || !focusTracker)
            return;
        if (this.#session) {
            this.#stopRecording();
            return;
        }

        const config = readRecordingConfig(settings);
        if (!config.provider.apiKey) {
            const {vendor} = PROVIDERS[config.provider.kind];
            Main.notify('Murmur', `Set your ${vendor} API key in the extension preferences`);
            return;
        }

        this.#copyRequested = false;

        const panel = new MurmurPanel({collapsed: !config.showPanel});
        panel.destination = focusTracker.current();
        panel.onAction = action => this.#onPanelAction(action);
        this.#panel = panel;

        const indicator = new RecordingIndicator();
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
            onSilence: () => this.#stopRecording(),
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
                Main.notify('Murmur', `Error: ${errorMessage(error)}`);
        } finally {
            if (this.#session === session) {
                this.#session = null;
                this.#cancellable = null;
                focusTracker.onChanged = null;
            }
        }
    }

    async #deliver(
        transcript: string, destination: Destination, pace: Pace,
        cancellable: Gio.Cancellable): Promise<void> {
        this.#clearCountdown();
        this.#indicator?.destroy();
        this.#indicator = null;
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
        if (!this.#settings?.get_boolean(Key.rememberDictations))
            return;
        if (destination.kind === 'field' && destination.password)
            return;
        this.#history?.append(transcript)
            .catch(error => console.error(`murmur: history: ${errorMessage(error)}`));
    }

    #onPanelAction(action: PanelAction): void {
        if (action === 'cancel') {
            this.#cancel();
            return;
        }
        this.#copyRequested = action === 'copy';
        this.#stopRecording();
    }

    #stopRecording(): void {
        if (!this.#session)
            return;
        this.#clearCountdown();
        if (this.#panel) {
            this.#panel.status = 'Finishing…';
            this.#panel.countdown = '';
        }
        this.#session.stop();
    }

    #cancel(): void {
        this.#cancellable?.cancel();
        this.#closeUi();
    }

    #closeUi(): void {
        this.#clearCountdown();
        this.#indicator?.destroy();
        this.#indicator = null;
        this.#panel?.destroy();
        this.#panel = null;
    }

    #startCountdown(maxSeconds: number): void {
        this.#deadlineUs = GLib.get_monotonic_time() + maxSeconds * 1000000;
        this.#tick();
    }

    #tick(): void {
        const remainingUs = this.#deadlineUs - GLib.get_monotonic_time();
        const remaining = Math.max(0, Math.ceil(remainingUs / 1000000));
        const text = formatRemaining(remaining);
        if (this.#panel)
            this.#panel.countdown = text;
        if (this.#indicator)
            this.#indicator.countdown = text;

        if (remaining <= 0) {
            this.#stopRecording();
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

function formatRemaining(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const tail = String(seconds % 60).padStart(2, '0');
    if (minutes < 60)
        return `${minutes}:${tail}`;
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${tail}`;
}
