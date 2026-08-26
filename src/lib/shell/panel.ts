import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import type {Destination} from './focus.js';

const FADE_MS = 150;
const RESULT_HOLD_MS = 1800;
const TAIL_SLACK_PX = 1;

export type PanelAction = 'cancel' | 'copy' | 'stop';

// Keys reach an actor only while it holds the stage's key focus, which mutter
// clears the moment any window is focused or anything in the shell takes over.
// The panel is on screen exactly while it holds that focus, so every way of
// looking somewhere else already collapses it and none of them is handled here.
class Card extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'MurmurCard'}, this);
    }

    onKeyPress: ((event: Clutter.Event) => boolean) | null = null;

    constructor() {
        super({
            can_focus: true,
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            style_class: 'popup-menu-content murmur-panel',
        });
    }

    override vfunc_key_press_event(event: Clutter.Event): boolean {
        if (this.onKeyPress?.(event))
            return Clutter.EVENT_STOP;
        return super.vfunc_key_press_event(event);
    }
}

export class MurmurPanel {
    onAction: ((action: PanelAction) => void) | null = null;

    readonly #card: Card;
    readonly #constraint: Layout.MonitorConstraint;
    readonly #container: St.Widget;
    readonly #countdown: St.Label;
    readonly #destinationIcon: St.Icon;
    readonly #destinationLabel: St.Label;
    readonly #hint: St.Label;
    readonly #scroll: St.Adjustment;
    readonly #status: St.Label;
    readonly #transcript: St.Label;

    #collapsed = false;
    #destination: Destination = {kind: 'clipboard'};
    #finished = false;
    #keyFocusId = 0;
    #resultId = 0;
    #shortcut = '';

    constructor(options: {collapsed?: boolean} = {}) {
        this.#collapsed = options.collapsed ?? false;
        this.#card = new Card();
        this.#card.onKeyPress = event => this.#onKeyPress(event);

        const header = new St.BoxLayout({style_class: 'murmur-header', x_expand: true});
        header.add_child(new St.Widget({
            style_class: 'murmur-recording-dot',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.#status = new St.Label({
            style_class: 'murmur-status',
            text: 'Listening…',
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this.#status);
        header.add_child(new St.Widget({x_expand: true}));
        this.#countdown = new St.Label({
            style_class: 'murmur-countdown',
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this.#countdown);
        header.add_child(iconButton('go-down-symbolic', 'Collapse', () => this.collapse()));
        header.add_child(
            iconButton('window-close-symbolic', 'Cancel', () => this.onAction?.('cancel')));
        this.#card.add_child(header);

        this.#transcript = new St.Label({text: ''});
        this.#transcript.clutter_text.line_wrap = true;
        this.#transcript.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        const viewport = new St.Viewport({
            layout_manager: new Clutter.BoxLayout({orientation: Clutter.Orientation.VERTICAL}),
        });
        viewport.add_child(this.#transcript);
        const scroll = new St.ScrollView({
            style_class: 'murmur-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            reactive: true,
            vscrollbar_policy: St.PolicyType.EXTERNAL,
        });
        scroll.child = viewport;
        this.#scroll = scroll.vadjustment;
        this.#followTail();
        this.#card.add_child(scroll);

        const destination = new St.BoxLayout({style_class: 'murmur-destination', x_expand: true});
        this.#destinationIcon = new St.Icon({y_align: Clutter.ActorAlign.CENTER});
        this.#destinationLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this.#destinationLabel.clutter_text.line_wrap = true;
        destination.add_child(this.#destinationIcon);
        destination.add_child(this.#destinationLabel);
        this.#card.add_child(destination);

        this.#card.add_child(this.#actions());

        this.#hint = new St.Label({style_class: 'murmur-hint'});
        this.#hint.clutter_text.line_wrap = true;
        this.#card.add_child(this.#hint);
        this.#syncHint();

        this.#constraint = new Layout.MonitorConstraint({
            index: workingMonitorIndex(),
            workArea: true,
        });
        this.#container = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            opacity: 0,
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_align: Clutter.ActorAlign.END,
            y_expand: true,
        });
        this.#container.add_constraint(this.#constraint);
        this.#container.add_child(this.#card);

        // Chrome sits above every window, so the input region has to be the card
        // and nothing else: the container stays unreactive and clicks anywhere
        // around it reach the application underneath.
        Main.layoutManager.addTopChrome(this.#container);
        // A fullscreen window is handed straight to the display unless something
        // says otherwise, and an unredirected window paints over chrome.
        global.compositor.disable_unredirect();
        if (this.#collapsed) {
            this.#container.opacity = 255;
            this.#container.hide();
        } else {
            this.#container.ease({
                opacity: 255,
                duration: FADE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        this.#keyFocusId = global.stage.connect('notify::key-focus', () => this.#syncKeyboard());
        if (!this.#collapsed)
            this.#card.grab_key_focus();
        this.#syncKeyboard();
        this.#syncDestination();
    }

    destroy(): void {
        if (this.#resultId) {
            GLib.source_remove(this.#resultId);
            this.#resultId = 0;
        }
        if (this.#keyFocusId) {
            global.stage.disconnect(this.#keyFocusId);
            this.#keyFocusId = 0;
        }
        this.#finished = true;
        this.releaseKeyboard();
        if (this.#container.get_parent()) {
            Main.layoutManager.removeChrome(this.#container);
            global.compositor.enable_unredirect();
        }
        this.#container.destroy();
    }

    get collapsed(): boolean {
        return this.#collapsed;
    }

    set countdown(text: string) {
        this.#countdown.text = text;
    }

    set destination(destination: Destination) {
        this.#destination = destination;
        this.#syncDestination();
    }

    set shortcut(label: string) {
        this.#shortcut = label;
        this.#syncHint();
    }

    set status(text: string) {
        this.#status.text = text;
    }

    set transcript(text: string) {
        this.#transcript.text = text;
    }

    collapse(): void {
        if (this.#collapsed)
            return;
        this.#collapsed = true;
        this.releaseKeyboard();
        this.#container.hide();
    }

    expand(): void {
        if (!this.#collapsed)
            return;
        this.#collapsed = false;
        this.#reveal();
        this.#card.grab_key_focus();
    }

    toggle(): void {
        if (this.#collapsed)
            this.expand();
        else
            this.collapse();
    }

    // Synthesized keystrokes are routed like real ones, so the transcription
    // would be typed into the card if it still held the keyboard.
    releaseKeyboard(): void {
        if (global.stage.get_key_focus() === this.#card)
            global.stage.set_key_focus(null);
    }

    // The last thing a dictation says, in the place the user was already
    // looking, rather than a second message somewhere else. The rows it
    // replaces are hidden rather than removed, so a late transcription or
    // destination still has somewhere harmless to land.
    showResult(message: string): void {
        this.#finished = true;
        this.releaseKeyboard();
        this.#collapsed = false;
        this.#reveal();
        for (const child of this.#card.get_children())
            child.hide();

        const row = new St.BoxLayout({style_class: 'murmur-result', x_expand: true});
        row.add_child(new St.Icon({
            icon_name: 'object-select-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        row.add_child(new St.Label({text: message, y_align: Clutter.ActorAlign.CENTER}));
        this.#card.add_child(row);

        this.#resultId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RESULT_HOLD_MS, () => {
            this.#resultId = 0;
            this.#container.ease({
                opacity: 0,
                duration: FADE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => this.destroy(),
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    // The panel belongs on the screen being worked on, which is a question with
    // a different answer every time it comes back.
    #reveal(): void {
        this.#constraint.index = workingMonitorIndex();
        this.#container.show();
    }

    #actions(): St.BoxLayout {
        const row = new St.BoxLayout({style_class: 'murmur-actions', x_expand: true});
        row.layout_manager.homogeneous = true;
        row.add_child(this.#button('copy', 'Copy', 'button'));
        row.add_child(this.#button('stop', 'Stop', 'button default'));
        return row;
    }

    #button(action: PanelAction, label: string, styleClass: string): St.Button {
        const button = new St.Button({
            can_focus: true,
            label,
            style_class: styleClass,
            x_expand: true,
        });
        button.connect('clicked', () => this.onAction?.(action));
        return button;
    }

    #onKeyPress(event: Clutter.Event): boolean {
        const symbol = event.get_key_symbol();

        if (symbol === Clutter.KEY_Escape) {
            this.onAction?.('cancel');
            return true;
        }
        if (symbol === Clutter.KEY_Return ||
            symbol === Clutter.KEY_KP_Enter ||
            symbol === Clutter.KEY_ISO_Enter) {
            const control = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
            this.onAction?.(control ? 'copy' : 'stop');
            return true;
        }
        return this.#scrollTranscript(symbol);
    }

    #followTail(): void {
        const adjustment = this.#scroll;
        const atTail = () =>
            adjustment.value >= adjustment.upper - adjustment.page_size - TAIL_SLACK_PX;
        let following = true;

        const changedId = adjustment.connect('changed', () => {
            if (following)
                adjustment.value = adjustment.upper - adjustment.page_size;
        });
        const valueId = adjustment.connect('notify::value', () => {
            following = atTail();
        });
        this.#card.connect('destroy', () => {
            adjustment.disconnect(changedId);
            adjustment.disconnect(valueId);
        });
    }

    #scrollTranscript(symbol: number): boolean {
        const adjustment = this.#scroll;

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

    #syncHint(): void {
        this.#hint.text = hintText(this.#shortcut);
    }

    #syncDestination(): void {
        const insert = this.#destination.kind === 'field';
        this.#destinationIcon.icon_name = insert
            ? 'input-keyboard-symbolic'
            : 'edit-copy-symbolic';
        this.#destinationLabel.text = destinationText(this.#destination);
    }

    // The panel is on screen exactly while it holds the keyboard. Looking
    // anywhere else - another window, the overview, a shell dialog - takes that
    // focus away, and the panel follows it out of sight rather than sitting
    // there ignoring the keys the user presses.
    #syncKeyboard(): void {
        if (this.#finished)
            return;
        const holds = global.stage.get_key_focus() === this.#card;
        if (!holds && !this.#collapsed)
            this.collapse();
        else if (holds && this.#collapsed)
            this.releaseKeyboard();
    }
}

function iconButton(icon: string, label: string, onClick: () => void): St.Button {
    const button = new St.Button({
        accessible_name: label,
        can_focus: true,
        child: new St.Icon({icon_name: icon}),
        style_class: 'icon-button',
        y_align: Clutter.ActorAlign.CENTER,
    });
    button.connect('clicked', onClick);
    return button;
}

// Read from mutter rather than from the stage's key focus the shell tracks,
// which the panel itself takes: that answer would be the panel's own monitor.
function workingMonitorIndex(): number {
    const focused = global.display.focus_window?.get_monitor() ?? -1;
    return focused >= 0 ? focused : global.display.get_current_monitor();
}

function hintText(shortcut: string): string {
    const keys = ['Enter types', 'Ctrl+Enter copies', 'Esc cancels'];
    if (shortcut)
        keys.push(`${shortcut} stops`);
    return keys.join('  ·  ');
}

function destinationText(destination: Destination): string {
    if (destination.kind === 'clipboard')
        return 'No text field focused · copies to the clipboard';
    return destination.app ? `Types into ${destination.app}` : 'Types into the focused text field';
}
