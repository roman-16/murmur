import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MURMUR_UUID = 'murmur@roman-16.github.io';
const POLL_MS = 250;
const STEP_US = 20000;
const SETTLE_MS = 2000;
const RECORD_MS = 4500;
const INSERT_MS = 2500;

// Drives the take from inside the compositor: a virtual keyboard reaches
// Murmur's keybinding the same way a real one does, which nothing outside this
// session can do while the host owns the keyboard.
export default class DemoDriver extends Extension {
    #device = null;
    #overviewId = 0;
    #timeouts = [];

    enable() {
        // The session opens in the overview and returns to it whenever a window
        // closes, which is not what the take should show.
        this.#overviewId = Main.overview.connect('showing', () => Main.overview.hide());

        this.#device = Clutter.get_default_backend()
            .get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);

        this.#whenRecording(() => this.#whenReady(() => {
            this.#dictate();
            this.#at(RECORD_MS, () => this.#tap(Clutter.KEY_Return));
            this.#at(RECORD_MS + INSERT_MS, () => this.#finish());
        }));
    }

    disable() {
        if (this.#overviewId) {
            Main.overview.disconnect(this.#overviewId);
            this.#overviewId = 0;
        }
        for (const id of this.#timeouts)
            GLib.source_remove(id);
        this.#timeouts = [];
        this.#device = null;
    }

    // Nothing is worth performing before the recorder is up.
    #whenRecording(action) {
        const marker = GLib.getenv('DEMO_RECORDING_FILE');
        if (!marker || GLib.file_test(marker, GLib.FileTest.EXISTS)) {
            action();
            return;
        }
        this.#at(POLL_MS, () => this.#whenRecording(action));
    }

    // The session opens in the overview, and the application window is only a
    // thumbnail there, so the take starts once it is the focused window.
    #whenReady(action) {
        if (Main.overview.visible)
            Main.overview.hide();

        const window = global.get_window_actors()
            .map(actor => actor.meta_window)
            .find(candidate => candidate.window_type === Meta.WindowType.NORMAL);

        if (!window) {
            this.#at(POLL_MS, () => this.#whenReady(action));
            return;
        }

        window.activate(global.get_current_time());
        this.#at(SETTLE_MS, action);
    }

    #at(milliseconds, action) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            this.#timeouts = this.#timeouts.filter(other => other !== id);
            action();
            return GLib.SOURCE_REMOVE;
        });
        this.#timeouts.push(id);
    }

    // A virtual keyboard cannot reach a compositor keybinding while a client
    // window holds the focus, so the take starts at the entry point the
    // shortcut would have called.
    #dictate() {
        const murmur = Main.extensionManager.lookup(MURMUR_UUID)?.stateObj;
        if (!murmur) {
            console.error('demo driver: murmur is not loaded');
            return;
        }
        murmur.dictate().catch(error => console.error(`demo driver: ${error}`));
    }

    // Each event needs its own, later timestamp: sent all at once, a modifier
    // and its key read as two separate presses, and a lone Super opens the
    // overview instead of reaching the shortcut.
    #tap(keyval, modifier) {
        let time = GLib.get_monotonic_time();
        const press = (value, state) => {
            time += STEP_US;
            this.#device.notify_keyval(time, value, state);
        };

        if (modifier)
            press(modifier, Clutter.KeyState.PRESSED);
        press(keyval, Clutter.KeyState.PRESSED);
        press(keyval, Clutter.KeyState.RELEASED);
        if (modifier)
            press(modifier, Clutter.KeyState.RELEASED);
    }

    #finish() {
        const marker = GLib.getenv('DEMO_DONE_FILE');
        if (marker)
            GLib.file_set_contents(marker, 'done');
    }
}
