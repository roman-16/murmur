import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {BarLevel} from 'resource:///org/gnome/shell/ui/barLevel.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import type {Destination} from './focus.js';

const FADE_MS = 150;
const LEVEL_MS = 100;
const RESULT_HOLD_MS = 1800;
const TAIL_SLACK_PX = 1;

export type PanelAction = 'cancel' | 'copy' | 'stop';

// Keys reach an actor only while it holds the stage's key focus, which mutter
// clears the moment any window is focused or anything in the shell takes over.
// The panel is on screen exactly while that focus is inside it, so every way of
// looking somewhere else already collapses it and none of them is handled here.
//
// The frame is a popover because a surface that floats over a window has to
// carry its own edge, and that is the class every theme dresses for it.
class Frame extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'MurmurFrame'}, this);
    }

    onKeyPress: ((event: Clutter.Event) => boolean) | null = null;

    constructor() {
        super({
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            style_class: 'popup-menu-content murmur-panel',
        });

        // The keyboard sits on the button that acts, so a key the panel answers
        // for itself has to be taken on the way down: a button activates on
        // Return whatever modifier is held, and would stop rather than copy.
        this.connect('captured-event', (_actor, event: Clutter.Event) => {
            if (event.type() !== Clutter.EventType.KEY_PRESS)
                return Clutter.EVENT_PROPAGATE;
            return this.onKeyPress?.(event) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        });
    }

    // Chrome is laid out at the height it is asked for, and asked without being
    // told how wide it will be - which a wrapping label answers with one line
    // however much it holds. The panel's width is its own and is never
    // negotiated, and there is no shorter panel than the one that fits what it
    // holds, so both answers are the same answer.
    override vfunc_get_preferred_height(forWidth: number): [number, number] {
        const width = forWidth >= 0 ? forWidth : this.get_preferred_width(-1)[1];
        const [, natural] = super.vfunc_get_preferred_height(width);
        return [natural, natural];
    }
}

// A scroll view asks for nothing, because scrolling is what it does when it is
// given less than it holds. The card is laid out at the height it says it needs
// at least, so the transcription has to ask for the room it wants: what it holds
// at the width it is given, up to the height the stylesheet caps it at.
class Transcript extends St.ScrollView {
    static {
        GObject.registerClass({GTypeName: 'MurmurTranscript'}, this);
    }

    override vfunc_get_preferred_height(forWidth: number): [number, number] {
        const [, natural] = super.vfunc_get_preferred_height(forWidth);
        return [natural, natural];
    }
}

export class MurmurPanel {
    onAction: ((action: PanelAction) => void) | null = null;

    readonly #actions: St.Bin;
    readonly #body: St.BoxLayout;
    readonly #card: St.BoxLayout;
    readonly #constraint: Layout.MonitorConstraint;
    readonly #container: St.Widget;
    readonly #copy: St.Button;
    readonly #countdown: St.Label;
    readonly #frame: Frame;
    readonly #icon: St.Icon;
    readonly #level: BarLevel;
    readonly #status: St.Label;
    readonly #stop: St.Button;
    readonly #tail: St.Adjustment;
    readonly #title: St.Label;
    readonly #transcript: St.Label;
    readonly #transcriptView: Transcript;

    #collapsed = false;
    #destination: Destination = {kind: 'clipboard'};
    #finished = false;
    #keyFocusId = 0;
    #resultId = 0;
    #tailChangedId = 0;
    #tailValueId = 0;

    constructor(options: {collapsed?: boolean} = {}) {
        this.#collapsed = options.collapsed ?? false;
        this.#frame = new Frame();
        this.#frame.onKeyPress = event => this.#onKeyPress(event);
        // Reactive because St reads that as sensitive: the shell's own message is
        // a button, and a card that is not one is styled as a disabled one, which
        // dims every word it holds to four tenths.
        this.#card = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            style_class: 'message',
            x_expand: true,
        });
        this.#frame.add_child(this.#card);

        this.#icon = new St.Icon({
            icon_name: 'audio-input-microphone-symbolic',
            style_class: 'message-source-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.#status = new St.Label({
            style_class: 'message-source-title',
            text: 'Listening…',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.#level = new BarLevel({
            style_class: 'slider murmur-level',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.#countdown = new St.Label({
            style_class: 'event-time',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const headerContent = new St.BoxLayout({
            style_class: 'message-header-content',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerContent.add_child(this.#status);
        headerContent.add_child(this.#level);
        headerContent.add_child(this.#countdown);

        const header = new St.BoxLayout({
            style_class: 'message-header murmur-header',
            x_expand: true,
            y_expand: true,
        });
        header.add_child(this.#icon);
        header.add_child(headerContent);
        this.#card.add_child(header);

        this.#title = new St.Label({style_class: 'message-title'});
        this.#title.clutter_text.line_wrap = true;

        this.#transcript = new St.Label({text: ''});
        this.#transcript.clutter_text.line_wrap = true;
        this.#transcript.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        const viewport = new St.Viewport({
            layout_manager: new Clutter.BoxLayout({orientation: Clutter.Orientation.VERTICAL}),
        });
        viewport.add_child(this.#transcript);
        this.#transcriptView = new Transcript({
            style_class: 'murmur-transcript',
            hscrollbar_policy: St.PolicyType.NEVER,
            reactive: true,
            visible: false,
            vscrollbar_policy: St.PolicyType.EXTERNAL,
        });
        this.#transcriptView.child = viewport;
        this.#tail = this.#transcriptView.vadjustment;
        this.#followTail();

        const content = new St.BoxLayout({
            style_class: 'message-content',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        content.add_child(this.#title);
        content.add_child(this.#transcriptView);
        this.#body = new St.BoxLayout({style_class: 'message-box', x_expand: true});
        this.#body.add_child(content);
        this.#card.add_child(this.#body);

        this.#copy = this.#button('copy', 'Copy');
        this.#stop = this.#button('stop', 'Stop');
        const buttons = new St.BoxLayout({
            style_class: 'notification-buttons-bin',
            x_expand: true,
        });
        buttons.add_child(this.#button('cancel', 'Cancel'));
        buttons.add_child(this.#copy);
        buttons.add_child(this.#stop);
        this.#actions = new St.Bin({
            style_class: 'message-action-bin',
            child: buttons,
            x_expand: true,
        });
        this.#card.add_child(this.#actions);

        this.#constraint = new Layout.MonitorConstraint({
            index: workingMonitorIndex(),
            workArea: true,
        });
        this.#container = new St.Widget({
            opacity: 0,
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_align: Clutter.ActorAlign.END,
            y_expand: true,
        });
        this.#container.add_constraint(this.#constraint);
        this.#container.add_child(this.#frame);

        // Chrome sits above every window, so the input region has to be the
        // panel and nothing else: the container stays unreactive and clicks
        // anywhere around it reach the application underneath.
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
            this.#stop.grab_key_focus();
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
        if (this.#tailChangedId) {
            this.#tail.disconnect(this.#tailChangedId);
            this.#tailChangedId = 0;
        }
        if (this.#tailValueId) {
            this.#tail.disconnect(this.#tailValueId);
            this.#tailValueId = 0;
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

    // How loud the microphone is right now, from silence to full scale. Eased
    // over the interval between two readings, so the bar moves with the voice
    // rather than stepping.
    set level(level: number) {
        this.#level.ease_property('value', level, {
            duration: LEVEL_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    set status(text: string) {
        this.#status.text = text;
    }

    set transcript(text: string) {
        this.#transcript.text = text;
        this.#transcriptView.visible = text.length > 0;
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
        this.#stop.grab_key_focus();
    }

    toggle(): void {
        if (this.#collapsed)
            this.expand();
        else
            this.collapse();
    }

    // Synthesized keystrokes are routed like real ones, so the transcription
    // would be typed into the panel if it still held the keyboard.
    releaseKeyboard(): void {
        if (this.#holdsKeyboard())
            global.stage.set_key_focus(null);
    }

    // The last thing a dictation says, in the place the user was already
    // looking, rather than a second message somewhere else. What it replaces is
    // hidden rather than removed, so a late transcription or destination still
    // has somewhere harmless to land.
    showResult(message: string): void {
        this.#finished = true;
        this.releaseKeyboard();
        this.#collapsed = false;
        this.#reveal();

        this.#icon.icon_name = 'object-select-symbolic';
        this.#status.text = message;
        this.#actions.hide();
        this.#body.hide();
        this.#countdown.hide();
        this.#level.hide();

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

    #button(action: PanelAction, label: string): St.Button {
        const button = new St.Button({
            can_focus: true,
            label,
            style_class: 'notification-button',
            x_expand: true,
        });
        button.connect('clicked', () => this.onAction?.(action));
        return button;
    }

    // Cancelling and copying are the panel's own, whichever button the keyboard
    // is on. Stopping is the button it is on, so Enter and Space are left to it.
    #onKeyPress(event: Clutter.Event): boolean {
        const symbol = event.get_key_symbol();

        if (symbol === Clutter.KEY_Escape) {
            this.onAction?.('cancel');
            return true;
        }
        const enter = symbol === Clutter.KEY_Return ||
            symbol === Clutter.KEY_KP_Enter ||
            symbol === Clutter.KEY_ISO_Enter;
        if (enter && (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0) {
            this.onAction?.('copy');
            return true;
        }
        return false;
    }

    #followTail(): void {
        const adjustment = this.#tail;
        const atTail = () =>
            adjustment.value >= adjustment.upper - adjustment.page_size - TAIL_SLACK_PX;
        let following = true;

        this.#tailChangedId = adjustment.connect('changed', () => {
            if (following)
                adjustment.value = adjustment.upper - adjustment.page_size;
        });
        this.#tailValueId = adjustment.connect('notify::value', () => {
            following = atTail();
        });
    }

    // Copying is a choice only while the words have somewhere else to go; with
    // nothing focused it is what stopping already does.
    #syncDestination(): void {
        this.#copy.visible = this.#destination.kind === 'field';
        this.#title.text = destinationText(this.#destination);
    }

    // The keyboard is on the action it would take, so what makes the panel the
    // focus is the focus being anywhere inside it.
    #holdsKeyboard(): boolean {
        const focus = global.stage.get_key_focus();
        return focus !== null && this.#frame.contains(focus);
    }

    // The panel is on screen exactly while it holds the keyboard. Looking
    // anywhere else - another window, the overview, a shell dialog - takes that
    // focus away, and the panel follows it out of sight rather than sitting
    // there ignoring the keys the user presses.
    #syncKeyboard(): void {
        if (this.#finished)
            return;
        const holds = this.#holdsKeyboard();
        if (!holds && !this.#collapsed)
            this.collapse();
        else if (holds && this.#collapsed)
            this.releaseKeyboard();
    }
}

// Read from mutter rather than from the stage's key focus the shell tracks,
// which the panel itself takes: that answer would be the panel's own monitor.
function workingMonitorIndex(): number {
    const focused = global.display.focus_window?.get_monitor() ?? -1;
    return focused >= 0 ? focused : global.display.get_current_monitor();
}

function destinationText(destination: Destination): string {
    if (destination.kind === 'clipboard')
        return 'Copies to the clipboard';
    return destination.app ? `Types into ${destination.app}` : 'Types into the focused text field';
}
