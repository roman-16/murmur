import type Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {errorMessage} from './lib/errors.js';
import {History} from './lib/history.js';
import {Key, type ShortcutKey} from './lib/settings.js';
import {Dictation} from './lib/shell/dictation.js';
import {withdrawAll} from './lib/shell/notify.js';
import {Recordings} from './lib/shell/recording.js';

const SHORTCUTS: ShortcutKey[] = [Key.toggleDictation, Key.toggleRecording];

export default class MurmurExtension extends Extension {
    readonly #bound = new Set<ShortcutKey>();

    #dictation: Dictation | null = null;
    #history: History | null = null;
    #recordings: Recordings | null = null;
    #sessionModeId = 0;
    #settings: Gio.Settings | null = null;
    #settingsChangedIds: number[] = [];

    enable(): void {
        const settings = this.getSettings();
        this.#settings = settings;
        this.#history = new History(this.uuid);
        this.#recordings = new Recordings(settings, this.uuid);

        this.#settingsChangedIds = SHORTCUTS.map(key =>
            settings.connect(`changed::${key}`, () => this.#syncShortcuts()));
        this.#sessionModeId = Main.sessionMode.connect('updated', () => this.#syncLock());
        this.#syncLock();

        this.#recordings.offerUntranscribed()
            .catch(error => console.error(`murmur: recording: ${errorMessage(error)}`));
    }

    // Murmur runs on the lock screen as well (session-modes lists unlock-dialog)
    // because a recording has to carry on while the screen is locked: a machine
    // left alone during a call locks itself. Everything that listens to the
    // keyboard - the shortcuts, and the dictation with its panel and its eye on
    // the focused field - is let go of on the lock screen, which #syncLock sees to.
    disable(): void {
        if (this.#sessionModeId) {
            Main.sessionMode.disconnect(this.#sessionModeId);
            this.#sessionModeId = 0;
        }
        for (const id of this.#settingsChangedIds)
            this.#settings?.disconnect(id);
        this.#settingsChangedIds = [];
        this.#unbindShortcuts();

        this.#dictation?.destroy();
        this.#dictation = null;
        this.#recordings?.destroy();
        this.#recordings = null;
        withdrawAll();
        this.#history = null;
        this.#settings = null;
    }

    // Public so anything inside the shell process can start a dictation, the
    // demo recording included: a virtual keyboard cannot reach a compositor
    // keybinding while a client window holds the focus.
    async dictate(): Promise<void> {
        await this.#dictation?.toggle();
    }

    // A dictation types into whatever has the focus, which on the lock screen is
    // the password field, so locking the screen ends one.
    #syncLock(): void {
        const locked: boolean = Main.sessionMode.isLocked;
        if (locked) {
            this.#dictation?.destroy();
            this.#dictation = null;
        } else if (!this.#dictation && this.#settings && this.#history) {
            this.#dictation = new Dictation(this.#settings, this.#history);
        }
        if (this.#recordings)
            this.#recordings.locked = locked;
        this.#syncShortcuts();
    }

    #syncShortcuts(): void {
        this.#unbindShortcuts();
        const settings = this.#settings;
        if (!settings || Main.sessionMode.isLocked)
            return;

        const actions: Record<ShortcutKey, () => Promise<void> | undefined> = {
            [Key.toggleDictation]: () => this.#dictation?.toggle(),
            [Key.toggleRecording]: () => this.#recordings?.toggle(),
        };
        const modes = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
        for (const key of SHORTCUTS) {
            if (settings.get_strv(key).length === 0)
                continue;
            const id = Main.wm.addKeybinding(key, settings, Meta.KeyBindingFlags.NONE, modes, () => {
                actions[key]()?.catch(error => console.error(`murmur: ${errorMessage(error)}`));
            });
            if (id)
                this.#bound.add(key);
        }
    }

    #unbindShortcuts(): void {
        for (const key of this.#bound)
            Main.wm.removeKeybinding(key);
        this.#bound.clear();
    }
}
