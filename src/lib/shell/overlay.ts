import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {MODIFIER_MASK, type Shortcut} from './accelerator.js';
import type {Destination} from './focus.js';

// The shortcut that opens the overlay is typically still held while the overlay
// takes key focus, so ignore it for a moment instead of stopping right away.
const STOP_GUARD_US = 500000;
const TAIL_SLACK_PX = 1;

export class MurmurOverlay extends ModalDialog.ModalDialog {
    static {
        GObject.registerClass({GTypeName: 'MurmurOverlay'}, this);
    }

    onCancel: (() => void) | null = null;
    onStop: ((destination: Destination) => void) | null = null;

    readonly #countdown: St.Label;
    readonly #destinationLabel: St.Label;
    readonly #hint: St.Label;
    readonly #status: St.Label;
    readonly #transcript: St.Label;
    readonly #transcriptScroll: St.Adjustment;
    #destination: Destination = 'field';
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
        this.#transcript.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        const column = new St.Viewport({
            layout_manager: new Clutter.BoxLayout({orientation: Clutter.Orientation.VERTICAL}),
        });
        column.add_child(this.#transcript);

        const scroll = new St.ScrollView({
            style_class: 'murmur-scroll',
            reactive: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        scroll.child = column;

        const adjustment = scroll.vadjustment;
        this.#transcriptScroll = adjustment;

        const atTail = () =>
            adjustment.value >= adjustment.upper - adjustment.page_size - TAIL_SLACK_PX;
        let followTail = true;
        const changedId = adjustment.connect('changed', () => {
            if (followTail)
                adjustment.value = adjustment.upper - adjustment.page_size;
        });
        const valueId = adjustment.connect('notify::value', () => {
            followTail = atTail();
        });
        this.connect('destroy', () => {
            adjustment.disconnect(changedId);
            adjustment.disconnect(valueId);
        });

        this.#destinationLabel = new St.Label({style_class: 'murmur-destination', text: ''});
        this.#destinationLabel.clutter_text.line_wrap = true;

        this.#hint = new St.Label({style_class: 'murmur-hint', text: ''});
        this.#updateLabels();

        this.contentLayout.add_child(header);
        this.contentLayout.add_child(this.#destinationLabel);
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

    set destination(destination: Destination) {
        this.#destination = destination;
        this.#updateLabels();
    }

    set shortcut(shortcut: Shortcut | null) {
        this.#shortcut = shortcut;
        this.#updateLabels();
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
            const control = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
            this.onStop?.(control ? 'clipboard' : this.#destination);
            return Clutter.EVENT_STOP;
        }

        const shortcut = this.#shortcut;
        if (shortcut && symbol === shortcut.keyval &&
            (event.get_state() & MODIFIER_MASK) === shortcut.mods) {
            if (GLib.get_monotonic_time() - this.#openedAt > STOP_GUARD_US)
                this.onStop?.(this.#destination);
            return Clutter.EVENT_STOP;
        }
        if (this.#scrollTranscript(symbol))
            return Clutter.EVENT_STOP;
        return super.vfunc_key_press_event(event);
    }

    // Copying is what Ctrl+Enter always does, so it is only worth a line when it
    // differs from what Enter would do anyway.
    #updateLabels(): void {
        const insert = this.#destination === 'field';
        this.#destinationLabel.text = insert
            ? 'Types into the focused text field'
            : 'No text field focused · copies to the clipboard';

        const stop = this.#shortcut ? `Enter / ${this.#shortcut.label}` : 'Enter';
        this.#hint.text = (insert
            ? [`${stop}: type`, 'Ctrl+Enter: copy', 'Esc: cancel']
            : [`${stop}: copy`, 'Esc: cancel']).join('     ·     ');
    }

    #scrollTranscript(symbol: number): boolean {
        const adjustment = this.#transcriptScroll;

        switch (symbol) {
            case Clutter.KEY_Down:
            case Clutter.KEY_KP_Down:
                adjustment.value += adjustment.step_increment;
                return true;
            case Clutter.KEY_End:
            case Clutter.KEY_KP_End:
                adjustment.value = adjustment.upper - adjustment.page_size;
                return true;
            case Clutter.KEY_Home:
            case Clutter.KEY_KP_Home:
                adjustment.value = 0;
                return true;
            case Clutter.KEY_Page_Down:
            case Clutter.KEY_KP_Page_Down:
                adjustment.value += adjustment.page_increment;
                return true;
            case Clutter.KEY_Page_Up:
            case Clutter.KEY_KP_Page_Up:
                adjustment.value -= adjustment.page_increment;
                return true;
            case Clutter.KEY_Up:
            case Clutter.KEY_KP_Up:
                adjustment.value -= adjustment.step_increment;
                return true;
            default:
                return false;
        }
    }
}
