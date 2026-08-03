import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {sleep} from './lib/async.js';
import {errorMessage} from './lib/errors.js';
import {Key, readAccelerator, readRecordingConfig} from './lib/settings.js';
import {parseAccelerator} from './lib/shell/accelerator.js';
import {insertText, typingPace} from './lib/shell/insertion.js';
import {MurmurOverlay} from './lib/shell/overlay.js';
import {Session} from './lib/shell/session.js';

// Focus only returns to the target field once the modal is gone, so wait for the
// close animation before typing.
const FOCUS_RETURN_MS = 150;

export default class MurmurExtension extends Extension {
    #cancellable: Gio.Cancellable | null = null;
    #countdownId = 0;
    #deadlineUs = 0;
    #keybindingId = 0;
    #overlay: MurmurOverlay | null = null;
    #session: Session | null = null;
    #settings: Gio.Settings | null = null;
    #settingsChangedId = 0;

    enable(): void {
        const settings = this.getSettings();
        this.#settings = settings;
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
        this.#overlay?.destroy();
        this.#overlay = null;
        this.#settings = null;
    }

    #bindShortcut(): void {
        const settings = this.#settings;
        if (!settings || settings.get_strv(Key.toggleRecording).length === 0)
            return;

        const modes = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
        const flags = Meta.KeyBindingFlags.NONE;
        const dictate = () => {
            this.#dictate().catch(error => console.error(`murmur: ${errorMessage(error)}`));
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

    async #dictate(): Promise<void> {
        const settings = this.#settings;
        if (!settings || this.#session)
            return;

        const config = readRecordingConfig(settings);
        if (!config.apiKey) {
            Main.notify('Murmur', 'Set your Mistral API key in the extension preferences');
            return;
        }

        const overlay = new MurmurOverlay();
        overlay.shortcut = parseAccelerator(readAccelerator(settings));
        overlay.onCancel = () => this.#cancel();
        overlay.onStop = () => this.#stopRecording();
        if (!overlay.open()) {
            overlay.destroy();
            Main.notify('Murmur', 'Could not open the overlay');
            return;
        }
        this.#overlay = overlay;

        const cancellable = new Gio.Cancellable();
        this.#cancellable = cancellable;
        const session = new Session(config, {
            onPartial: text => {
                overlay.transcript = text;
            },
            onSilence: () => this.#stopRecording(),
        }, cancellable);
        this.#session = session;
        this.#startCountdown(config.maxSeconds);

        try {
            const transcript = await session.run();
            this.#closeOverlay();

            if (transcript.trim()) {
                await sleep(FOCUS_RETURN_MS, cancellable);
                if (!cancellable.is_cancelled())
                    await insertText(transcript, typingPace(config.typingSpeed), cancellable);
            }
        } catch (error) {
            this.#closeOverlay();
            if (!cancellable.is_cancelled())
                Main.notify('Murmur', `Error: ${errorMessage(error)}`);
        } finally {
            if (this.#session === session) {
                this.#session = null;
                this.#cancellable = null;
            }
        }
    }

    #stopRecording(): void {
        if (!this.#session)
            return;
        this.#clearCountdown();
        if (this.#overlay) {
            this.#overlay.status = 'Finishing…';
            this.#overlay.countdown = '';
        }
        this.#session.stop();
    }

    #cancel(): void {
        this.#cancellable?.cancel();
        this.#closeOverlay();
    }

    #closeOverlay(): void {
        this.#clearCountdown();
        this.#overlay?.close();
        this.#overlay = null;
    }

    #startCountdown(maxSeconds: number): void {
        this.#deadlineUs = GLib.get_monotonic_time() + maxSeconds * 1000000;
        this.#tick();
    }

    #tick(): void {
        const remainingUs = this.#deadlineUs - GLib.get_monotonic_time();
        const remaining = Math.max(0, Math.ceil(remainingUs / 1000000));
        if (this.#overlay)
            this.#overlay.countdown = formatRemaining(remaining);

        if (remaining <= 0) {
            this.#stopRecording();
            return;
        }
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
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
