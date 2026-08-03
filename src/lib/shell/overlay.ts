import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {MODIFIER_MASK, type Shortcut} from './accelerator.js';

// The shortcut that opens the overlay is typically still held while the overlay
// takes key focus, so ignore it for a moment instead of stopping right away.
const STOP_GUARD_US = 500000;

export class MurmurOverlay extends ModalDialog.ModalDialog {
    static {
        GObject.registerClass({GTypeName: 'MurmurOverlay'}, this);
    }

    onCancel: (() => void) | null = null;
    onStop: (() => void) | null = null;

    readonly #countdown: St.Label;
    readonly #hint: St.Label;
    readonly #status: St.Label;
    readonly #transcript: St.Label;
    #openedAt = 0;
    #shortcut: Shortcut | null = null;

    constructor() {
        super({styleClass: 'murmur-overlay', destroyOnClose: true});

        this.#status = new St.Label({style_class: 'murmur-status', text: 'Listening…'});
        this.#countdown = new St.Label({style_class: 'murmur-countdown', text: ''});

        const header = new St.BoxLayout({style_class: 'murmur-header'});
        header.add_child(this.#status);
        header.add_child(new St.Widget({x_expand: true}));
        header.add_child(this.#countdown);

        this.#transcript = new St.Label({style_class: 'murmur-text', text: ''});
        this.#transcript.clutter_text.line_wrap = true;
        // St.Label ellipsizes by default, which clips the text; disable it so the
        // ScrollView scrolls instead of showing a trailing "…".
        this.#transcript.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        const textBox = new St.BoxLayout({style_class: 'murmur-textbox'});
        textBox.add_child(this.#transcript);

        const scroll = new St.ScrollView({
            style_class: 'murmur-scroll',
            reactive: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        scroll.child = textBox;

        const adjustment = scroll.vadjustment;
        const changedId = adjustment.connect('changed', () => {
            adjustment.value = Math.max(0, adjustment.upper - adjustment.page_size);
        });
        this.connect('destroy', () => adjustment.disconnect(changedId));

        this.#hint = new St.Label({style_class: 'murmur-hint', text: ''});

        this.contentLayout.add_child(header);
        this.contentLayout.add_child(scroll);
        this.contentLayout.add_child(this.#hint);
    }

    override open(): boolean {
        const opened = super.open();
        this.#openedAt = GLib.get_monotonic_time();
        return opened;
    }

    set countdown(text: string) {
        this.#countdown.text = text;
    }

    set shortcut(shortcut: Shortcut | null) {
        this.#shortcut = shortcut;
        const insert = shortcut ? `Enter / ${shortcut.label}` : 'Enter';
        this.#hint.text = `${insert}: insert     ·     Esc: cancel`;
    }

    set status(text: string) {
        this.#status.text = text;
    }

    set transcript(text: string) {
        this.#transcript.text = text;
    }

    override vfunc_key_press_event(event: Clutter.Event): boolean {
        const symbol = event.get_key_symbol();

        if (symbol === Clutter.KEY_Escape) {
            this.onCancel?.();
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Return ||
            symbol === Clutter.KEY_KP_Enter ||
            symbol === Clutter.KEY_ISO_Enter) {
            this.onStop?.();
            return Clutter.EVENT_STOP;
        }

        const shortcut = this.#shortcut;
        if (shortcut && symbol === shortcut.keyval &&
            (event.get_state() & MODIFIER_MASK) === shortcut.mods) {
            if (GLib.get_monotonic_time() - this.#openedAt > STOP_GUARD_US)
                this.onStop?.();
            return Clutter.EVENT_STOP;
        }
        return super.vfunc_key_press_event(event);
    }
}
