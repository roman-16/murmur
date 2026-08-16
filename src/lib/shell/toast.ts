import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const FADE_MS = 120;
const HOLD_MS = 1600;

// A message that outlives the overlay it replaces. The shell's own OSD manager
// takes different arguments on GNOME 47/48 than on 49/50, so this draws the
// same pill itself and borrows only the styling.
export class Toast {
    #actor: St.Widget | null;
    #timeoutId = 0;

    constructor(message: string) {
        const pill = new St.BoxLayout({style_class: 'osd-window'});
        pill.add_child(new St.Label({text: message, y_align: Clutter.ActorAlign.CENTER}));

        const actor = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            opacity: 0,
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_align: Clutter.ActorAlign.END,
            y_expand: true,
        });
        actor.add_constraint(new Layout.MonitorConstraint({primary: true}));
        actor.add_child(pill);
        actor.connect('destroy', () => {
            this.#actor = null;
        });
        this.#actor = actor;

        Main.layoutManager.uiGroup.add_child(actor);
        Main.layoutManager.uiGroup.set_child_above_sibling(actor, null);
        actor.ease({
            opacity: 255,
            duration: FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this.#timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOLD_MS, () => {
            this.#timeoutId = 0;
            this.#fadeOut();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy(): void {
        if (this.#timeoutId) {
            GLib.source_remove(this.#timeoutId);
            this.#timeoutId = 0;
        }
        this.#actor?.destroy();
    }

    #fadeOut(): void {
        this.#actor?.ease({
            opacity: 0,
            duration: FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this.#actor?.destroy(),
        });
    }
}
