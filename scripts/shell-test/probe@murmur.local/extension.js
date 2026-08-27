import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MURMUR_UUID = 'murmur@roman-16.github.io';
const SETTLE_MS = 400;
const WINDOW_TRIES = 20;

export default class Probe extends Extension {
    #failures = [];
    #panel = null;
    #passes = 0;
    #pointer = null;
    #client = null;
    #timeouts = [];
    #window = null;

    enable() {
        Main.overview.hide();
        Main.overview.connect('showing', () => Main.overview.hide());
        this.#pointer = Clutter.get_default_backend()
            .get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        this.#after(SETTLE_MS, () => {
            this.#run().catch(error => {
                this.#fail('the probe itself', `${error}\n${error.stack}`);
                this.#report();
            });
        });
    }

    disable() {
        for (const id of this.#timeouts)
            GLib.source_remove(id);
        this.#timeouts = [];
        this.#panel?.destroy();
        this.#panel = null;
        this.#window?.force_exit();
        this.#window = null;
    }

    // ------------------------------------------------------------------ checks

    #ok(what, condition, detail = '') {
        if (condition) {
            this.#passes++;
            console.error(`PROBE-PASS ${what}`);
        } else {
            this.#fail(what, detail);
        }
    }

    #fail(what, detail) {
        this.#failures.push(what);
        console.error(`PROBE-FAIL ${what}${detail ? `: ${detail}` : ''}`);
    }

    #report() {
        const marker = GLib.getenv('PROBE_RESULT');
        const summary = `${this.#passes} passed, ${this.#failures.length} failed`;
        console.error(`PROBE-DONE ${summary}`);
        if (marker)
            GLib.file_set_contents(marker, `${this.#failures.length}\n${summary}\n`);
        this.#after(SETTLE_MS, () => global.context.terminate());
    }

    // ------------------------------------------------------------- the harness

    #after(milliseconds, action) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            this.#timeouts = this.#timeouts.filter(other => other !== id);
            action();
            return GLib.SOURCE_REMOVE;
        });
        this.#timeouts.push(id);
    }

    #settle(milliseconds = SETTLE_MS) {
        return new Promise(resolve => this.#after(milliseconds, resolve));
    }

    // A press that never lands is a test that cannot fail, so the pointer is
    // warped first: a virtual device alone leaves the pointer where it was and
    // the click is delivered to whatever is under it, which is nothing.
    // Warping alone delivers no crossing, so an actor the pointer is warped onto
    // never receives enter and reads as unhovered however healthy it is. The
    // pointer is therefore put down beside the target and moved onto it.
    async #click(x, y, watch = null) {
        const seat = Clutter.get_default_backend().get_default_seat();
        seat.warp_pointer(x + 2, y + 2);
        this.#pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + 2, y + 2);
        await this.#settle(100);
        this.#pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        const hovered = watch ? await this.#until(() => watch.hover) : null;

        this.#pointer.notify_button(
            GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        // Briefly: a press held for a second is a long press, which is a
        // different gesture and opens things this is not testing.
        const pressed = watch ? await this.#until(() => watch.pressed, 6, 50) : null;

        this.#pointer.notify_button(
            GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await this.#settle();
        return {hovered, pressed};
    }

    // Waited for rather than slept on: how long the first pointer event of a
    // session takes to be delivered is not a number worth hard-coding, and a
    // check that samples too early reports a healthy button as broken.
    async #until(predicate, tries = 12, interval = 100) {
        for (let attempt = 0; attempt < tries; attempt++) {
            if (predicate())
                return true;
            await this.#settle(interval);
        }
        return false;
    }

    #centre(actor) {
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        return [x + width / 2, y + height / 2];
    }

    #descendants(root, predicate) {
        const found = [];
        const walk = actor => {
            if (predicate(actor))
                found.push(actor);
            for (const child of actor.get_children())
                walk(child);
        };
        walk(root);
        return found;
    }

    #card() {
        const [card] = this.#descendants(
            Main.layoutManager.uiGroup,
            actor => actor.style_class?.includes('murmur-panel') ?? false);
        return card ?? null;
    }

    #buttons() {
        const card = this.#card();
        if (!card)
            return [];
        return this.#descendants(card, actor => actor instanceof St.Button);
    }

    #holdsKeyboard() {
        const card = this.#card();
        return card !== null && global.stage.get_key_focus() === card;
    }

    // A real client, so that focus behaves the way it does in a session. Nothing
    // in the extension can produce one: it runs inside the compositor.
    //
    // Waited on until it actually holds the focus, not merely until it exists:
    // a window actor appears before the compositor focuses it, and asserting in
    // between tests the gap rather than the rule.
    async #openWindow() {
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDERR_SILENCE,
        });
        // Started with the shell's own typelib path, the client loads a Gio
        // built against a different GLib than its interpreter and dies before it
        // can open anything. run.sh passes the one belonging to a session that
        // is known to run GTK applications.
        const typelibs = GLib.getenv('PROBE_CLIENT_TYPELIBS');
        if (typelibs)
            launcher.setenv('GI_TYPELIB_PATH', typelibs, true);
        this.#window = launcher.spawnv(
            ['gjs', GLib.build_filenamev([this.path, 'window.js'])]);

        for (let tries = 0; tries < WINDOW_TRIES; tries++) {
            const window = global.display.focus_window;
            if (window?.window_type === Meta.WindowType.NORMAL) {
                this.#client = window;
                return window;
            }
            await this.#settle(500);
        }
        return null;
    }

    // Where the transcription goes is read when the recording stops, which is
    // while the panel still has the keyboard. If holding it were to end the
    // client's text-input focus, every dictation would land on the clipboard.
    async #checkDestination(FocusTracker, MurmurPanel) {
        if (!this.#client) {
            this.#fail('a client is available to read a destination from', 'none opened');
            return;
        }

        this.#panel?.destroy();
        this.#panel = null;
        this.#client.activate(global.get_current_time());
        await this.#settle(800);

        // Reported alongside the verdict, because every way this fails looks
        // identical from the outside: the client not announcing a field at all
        // and the panel having taken the announcement away are both "clipboard".
        const state = () => {
            const focus = Main.inputMethod.currentFocus;
            return `currentFocus=${focus !== null} isFocused=${focus?.is_focused()} ` +
                `panelHasKeyboard=${this.#holdsKeyboard()}`;
        };

        const tracker = new FocusTracker();
        try {
            this.#ok('a focused text field reads as a field',
                tracker.current().kind === 'field', state());

            this.#panel = new MurmurPanel();
            await this.#settle(500);
            this.#ok('the destination survives the panel taking the keyboard',
                tracker.current().kind === 'field', state());

            this.#panel.releaseKeyboard();
            await this.#settle(500);
            this.#ok('the destination comes back once the keyboard is released',
                tracker.current().kind === 'field', state());
        } finally {
            tracker.destroy();
        }
    }

    // -------------------------------------------------------------- the checks

    async #run() {
        const murmur = Main.extensionManager.lookup(MURMUR_UUID);
        if (!murmur?.stateObj || !murmur.path)
            throw new Error(`${MURMUR_UUID} is not loaded`);

        const {acceleratorLabel} =
            await import(`file://${murmur.path}/lib/shell/accelerator.js`);
        const {MurmurPanel} = await import(`file://${murmur.path}/lib/shell/panel.js`);
        const {RecordingIndicator} =
            await import(`file://${murmur.path}/lib/shell/indicator.js`);
        const {FocusTracker} = await import(`file://${murmur.path}/lib/shell/focus.js`);

        this.#ok('an accelerator becomes a label',
            acceleratorLabel('<Super>space') === 'Super+Space',
            `got "${acceleratorLabel('<Super>space')}"`);
        this.#ok('an unset accelerator becomes nothing', acceleratorLabel('') === '');

        // The first pointer interaction of a session produces no crossing, so
        // whatever it lands on reads as unhovered however healthy it is. Spend
        // it on empty desktop, before there is a panel for it to collapse.
        await this.#click(640, 300);

        const fired = [];
        this.#panel = new MurmurPanel();
        this.#panel.shortcut = 'Super+Space';
        this.#panel.destination = {app: 'Text Editor', kind: 'field'};
        this.#panel.transcript = 'the quick brown fox';
        this.#panel.onAction = action => fired.push(action);
        await this.#settle(600);

        await this.#checkButtons(fired);
        await this.#checkKeyboard();
        await this.#checkCollapse();
        await this.#checkDestination(FocusTracker, MurmurPanel);
        await this.#checkPlacement(MurmurPanel);
        await this.#checkCollapsedStart(MurmurPanel);
        await this.#checkTeardown(RecordingIndicator);
        this.#checkExtensionCycle(murmur);
        this.#report();
    }

    // The regression this whole harness exists for: a button that is hit-tested
    // correctly, wired correctly, and still does nothing when clicked, because
    // something above it consumed the press and cancelled its gesture.
    async #checkButtons(fired) {
        const buttons = this.#buttons();
        this.#ok('the panel has its four controls', buttons.length === 4,
            `found ${buttons.length}`);

        for (const button of buttons) {
            const name = button.label ?? button.accessible_name ?? '?';
            const [x, y] = this.#centre(button);

            // A control the size of GNOME's own: comfortable to hit, and the
            // reason this panel is laid out at the shell's dialog scale rather
            // than its menu scale.
            const [, height] = button.get_transformed_size();
            this.#ok(`"${name}" is a full-size control`, height >= 40, `${height}px tall`);

            // Set a height and a button gets taller; whether what is written on
            // it follows is St's business, and only pressing it tells you.
            const [content] = button.get_children();
            if (content) {
                const [, contentY] = content.get_transformed_position();
                const [, contentHeight] = content.get_transformed_size();
                const drift = Math.abs((contentY + contentHeight / 2) - y);
                this.#ok(`"${name}" reads centred`, drift <= 1,
                    `${drift.toFixed(1)}px off the button's middle`);
            }

            const hit = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
            this.#ok(`"${name}" is what the pointer would hit`,
                hit === button || button.contains(hit),
                `hit ${hit?.constructor?.name}`);

            const before = fired.length;
            const collapsedBefore = this.#panel.collapsed;
            const {hovered, pressed} = await this.#click(x, y, button);

            // Without this the check above can pass on a click that never
            // happened, which is how the regression shipped in the first place.
            this.#ok(`"${name}" takes the press`, hovered === true && pressed === true,
                `hover=${hovered} pressed=${pressed}`);
            this.#ok(`clicking "${name}" does something`,
                fired.length > before || this.#panel.collapsed !== collapsedBefore);

            if (this.#panel.collapsed)
                this.#panel.expand();
        }
    }

    // The one invariant the panel is built on: it is on screen exactly while it
    // holds the keyboard. Every check here is one way of breaking that.
    async #checkKeyboard() {
        this.#panel.expand();
        await this.#settle();
        this.#ok('an open panel holds the keyboard', this.#holdsKeyboard());

        this.#panel.releaseKeyboard();
        await this.#settle();
        this.#ok('a panel that loses the keyboard collapses', this.#panel.collapsed);

        this.#panel.expand();
        await this.#settle();
        this.#ok('opening it takes the keyboard back',
            this.#holdsKeyboard() && !this.#panel.collapsed);

        // What pressing Super does: the shell takes the keyboard for the
        // overview. Anything modal in the shell arrives here the same way.
        const grab = Main.pushModal(global.stage);
        await this.#settle();
        this.#ok('the shell taking the keyboard collapses the panel',
            this.#panel.collapsed);

        Main.popModal(grab);
        await this.#settle();
        this.#ok('a collapsed panel is not handed the keyboard back',
            !this.#holdsKeyboard(),
            'it would swallow Enter while invisible');
    }

    // Both ways the panel gets out of the way, tested apart, because they fire
    // on different signals and only the first survives with the keyboard
    // setting turned off.
    async #checkCollapse() {
        this.#panel.expand();
        await this.#settle();

        const window = await this.#openWindow();
        this.#ok('a window can be opened to test against', window !== null);
        if (!window)
            return;

        this.#ok('a window coming forward collapses the panel', this.#panel.collapsed);

        this.#panel.expand();
        await this.#settle();
        this.#ok('the panel can be brought back',
            !this.#panel.collapsed && this.#holdsKeyboard());

        // The case that made this rule what it is: the window clicked is the one
        // that already had the focus, so nothing about the window changes and
        // only the keyboard moving can be what collapses the panel.
        const frame = window.get_frame_rect();
        await this.#click(frame.x + 40, frame.y + 40);
        this.#ok('clicking the already focused window releases the keyboard',
            !this.#holdsKeyboard());
        this.#ok('clicking the already focused window collapses the panel',
            this.#panel.collapsed);
    }

    // The panel opens on the screen being worked on, and above whatever that
    // screen reserves. Both are invisible on one monitor with nothing docked to
    // it, so the session runs two screens and this puts a dock on the second.
    async #checkPlacement(MurmurPanel) {
        const STRUT_HEIGHT = 40;
        const MARGIN_FLOOR = 40;
        const monitor = Main.layoutManager.monitors[1];
        if (!monitor || !this.#client) {
            this.#fail('a second monitor and a client are available',
                `monitors=${Main.layoutManager.monitors.length} client=${!!this.#client}`);
            return;
        }

        this.#client.move_to_monitor(1);
        this.#client.activate(global.get_current_time());
        await this.#settle(800);
        this.#ok('the window moved to the second monitor',
            this.#client.get_monitor() === 1, `on ${this.#client.get_monitor()}`);

        const dock = new St.Widget({
            height: STRUT_HEIGHT,
            width: monitor.width,
            x: monitor.x,
            y: monitor.y + monitor.height - STRUT_HEIGHT,
        });
        Main.layoutManager.addChrome(dock, {affectsStruts: true});
        await this.#settle(800);

        try {
            const workArea = Main.layoutManager.getWorkAreaForMonitor(1);
            this.#ok('the dock reserves space on the second monitor',
                workArea.height === monitor.height - STRUT_HEIGHT,
                `work area ${workArea.height} of ${monitor.height}`);

            this.#panel?.destroy();
            this.#panel = new MurmurPanel();
            this.#panel.transcript = 'placed where the work is';
            await this.#settle(600);

            const card = this.#card();
            const [x, y] = card?.get_transformed_position() ?? [-1, -1];
            const [, height] = card?.get_transformed_size() ?? [0, 0];

            this.#ok('the panel opens on the focused window\'s monitor',
                x >= monitor.x && x < monitor.x + monitor.width,
                `card at x=${x}, monitor spans ${monitor.x}..${monitor.x + monitor.width}`);

            // Placed against the monitor instead of its work area, the card
            // would end up inside the dock's 40 pixels rather than above them.
            const gap = workArea.y + workArea.height - (y + height);
            this.#ok('the panel clears what the second monitor reserves',
                gap >= MARGIN_FLOOR, `${gap}px above the work area's bottom`);
        } finally {
            Main.layoutManager.removeChrome(dock);
            dock.destroy();
            await this.#settle(400);
        }
    }

    // What "Show the panel when recording starts" turns off: a recording that
    // draws nothing over the user's work until they ask for it.
    async #checkCollapsedStart(MurmurPanel) {
        this.#panel.destroy();
        this.#panel = new MurmurPanel({collapsed: true});
        this.#panel.transcript = 'started out of the way';
        await this.#settle();

        // Mapped rather than merely present: a collapsed panel is still built,
        // it is just not on screen, which is the whole difference the setting
        // makes to the user.
        this.#ok('a collapsed start draws no panel', this.#card()?.mapped !== true);
        this.#ok('a collapsed start takes no keyboard',
            global.stage.get_key_focus() === null);

        this.#panel.expand();
        await this.#settle();
        const card = this.#card();
        this.#ok('the panel can be opened from collapsed', card?.mapped === true);

        // Three lines of transcription are in view before a word is spoken,
        // which is what keeps a short dictation from sitting in an empty box.
        const [scroll] = this.#descendants(
            card ?? Main.layoutManager.uiGroup,
            actor => actor.style_class?.includes('murmur-scroll') ?? false);
        const [, scrollHeight] = scroll?.get_transformed_size() ?? [0, 0];
        this.#ok('three lines of transcription are in view', scrollHeight >= 68,
            `${scrollHeight}px of transcription`);
        this.#ok('the panel is opaque once opened', card?.get_parent()?.opacity === 255,
            `opacity=${card?.get_parent()?.opacity}`);
    }

    async #checkTeardown(RecordingIndicator) {
        const indicator = new RecordingIndicator();
        indicator.countdown = '9:41';
        await this.#settle();
        this.#ok('the indicator reaches the top bar',
            Main.panel.statusArea['murmur'] !== undefined);

        indicator.destroy();
        this.#panel.destroy();
        this.#panel.destroy();
        this.#panel = null;
        await this.#settle();

        this.#ok('nothing of the panel is left', this.#card() === null);
        this.#ok('nothing of the indicator is left',
            Main.panel.statusArea['murmur'] === undefined);
    }

    #checkExtensionCycle(murmur) {
        try {
            murmur.stateObj.disable();
            murmur.stateObj.enable();
            this.#ok('the extension survives disable and enable', true);
        } catch (error) {
            this.#fail('the extension survives disable and enable', `${error}`);
        }
    }
}
