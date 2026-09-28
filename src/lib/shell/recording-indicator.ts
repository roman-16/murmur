import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {BarLevel} from 'resource:///org/gnome/shell/ui/barLevel.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import type {Source} from './audio.js';
import {clock, duration} from './clock.js';

const LEVEL_MS = 100;

// Every pill needs a role of its own, and a recording that is still being
// transcribed keeps its pill while the next one records.
let serial = 0;

// A recording in the top bar: how long it has run, and a menu with what it
// hears and the two ways to end it. The pill stays while the recording is being
// transcribed, and is what says so.
export class RecordingIndicator {
    onDiscard: (() => void) | null = null;
    onStop: (() => void) | null = null;

    readonly #button: PanelMenu.Button;
    readonly #label: St.Label;
    readonly #levels: Record<Source, BarLevel>;

    #dialog: ModalDialog.ModalDialog | null = null;
    #elapsedSeconds = 0;
    #locked = false;
    #transcribing = false;

    constructor(options: {limit: string | null; transcribing: boolean}) {
        this.#button = new PanelMenu.Button(0, 'Murmur recording', false);
        this.#button.add_style_class_name('screen-recording-indicator');

        const box = new St.BoxLayout();
        this.#label = new St.Label({text: '', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this.#label);
        box.add_child(new St.Icon({icon_name: 'audio-headset-symbolic'}));
        this.#button.add_child(box);

        const menu = this.#button.menu as PopupMenu.PopupMenu;
        const microphone = meterRow(menu, 'Microphone');
        const desktop = meterRow(menu, 'Desktop audio');
        this.#levels = {desktop, microphone};
        if (options.limit)
            menu.addMenuItem(new PopupMenu.PopupMenuItem(options.limit, {reactive: false}));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menuItem(menu, 'Stop and transcribe', () => this.onStop?.());
        menuItem(menu, 'Discard…', () => this.#confirmDiscard());

        Main.panel.addToStatusArea(`murmur-recording-${++serial}`, this.#button, 0, 'right');
        if (options.transcribing)
            this.transcribing();
    }

    destroy(): void {
        this.#closeDialog();
        this.#button.destroy();
    }

    set elapsed(seconds: number) {
        this.#elapsedSeconds = seconds;
        if (!this.#transcribing)
            this.#label.text = clock(seconds);
    }

    // Seen on the lock screen, where a recording carries on, and out of reach
    // there: nobody at a locked machine gets to stop or discard it.
    set locked(locked: boolean) {
        this.#locked = locked;
        if (locked) {
            this.#closeDialog();
            this.#button.menu.close();
        }
        this.#syncSensitive();
    }

    level(source: Source, level: number): void {
        this.#levels[source].ease_property('value', level, {
            duration: LEVEL_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    transcribing(): void {
        this.#transcribing = true;
        this.#closeDialog();
        this.#button.menu.close();
        this.#syncSensitive();
        this.#label.text = 'Transcribing…';
    }

    #confirmDiscard(): void {
        const dialog = new ModalDialog.ModalDialog({destroyOnClose: true});
        dialog.contentLayout.add_child(new Dialog.MessageDialogContent({
            description: 'The audio is deleted and nothing is transcribed.',
            title: `Discard ${duration(this.#elapsedSeconds)} of recording?`,
        }));
        dialog.setButtons([
            {action: () => dialog.close(), key: Clutter.KEY_Escape, label: 'Cancel'},
            {
                action: () => {
                    dialog.close();
                    this.onDiscard?.();
                },
                label: 'Discard',
            },
        ]);
        dialog.connect('destroy', () => {
            if (this.#dialog === dialog)
                this.#dialog = null;
        });
        this.#dialog = dialog;
        dialog.open();
    }

    #syncSensitive(): void {
        this.#button.setSensitive(!this.#locked && !this.#transcribing);
    }

    #closeDialog(): void {
        this.#dialog?.close();
        this.#dialog = null;
    }
}

function meterRow(menu: PopupMenu.PopupMenu, title: string): BarLevel {
    const row = new PopupMenu.PopupMenuItem(title, {can_focus: false, reactive: false});
    row.label.x_expand = true;
    const level = new BarLevel({
        style_class: 'slider murmur-level',
        y_align: Clutter.ActorAlign.CENTER,
    });
    row.add_child(level);
    menu.addMenuItem(row);
    return level;
}

function menuItem(menu: PopupMenu.PopupMenu, label: string, run: () => void): void {
    const item = new PopupMenu.PopupMenuItem(label);
    item.connect('activate', run);
    menu.addMenuItem(item);
}
