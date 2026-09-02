import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// In preference order, and every one of them a client that reports a focused
// text field: an editor with the caret in its document, a terminal whenever it
// is focused.
const CLIENT_APPS = [
    'org.gnome.TextEditor.desktop',
    'org.gnome.gedit.desktop',
    'org.gnome.Console.desktop',
    'org.gnome.Ptyxis.desktop',
    'org.gnome.Terminal.desktop',
];
const MURMUR_UUID = 'murmur@roman-16.github.io';
const SETTLE_MS = 400;
const WINDOW_TRIES = 30;

export default class Probe extends Extension {
    #app = null;
    #failures = [];
    #panel = null;
    #passes = 0;
    #pointer = null;
    #client = null;
    #timeouts = [];

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
        this.#app?.request_quit();
        this.#app = null;
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
        const focus = global.stage.get_key_focus();
        return card !== null && focus !== null && card.contains(focus);
    }

    // A real client, so that focus behaves the way it does in a session. Nothing
    // in the extension can produce one: it runs inside the compositor.
    //
    // An application the session already has, rather than a window this harness
    // builds. Announcing a text field takes a whole toolkit, and a toolkit is
    // loadable only by an interpreter from the closure it was built against, so
    // a client of our own is a client that aborts on any machine whose GJS and
    // whose GTK come from different places. The compositor launching an
    // installed application is also what a real dictation is aimed at.
    //
    // Waited on until it actually holds the focus, not merely until it exists:
    // a window actor appears before the compositor focuses it, and asserting in
    // between tests the gap rather than the rule.
    async #openWindow() {
        const installed = Shell.AppSystem.get_default();
        this.#app = CLIENT_APPS.map(id => installed.lookup_app(id)).find(app => app) ?? null;
        if (!this.#app)
            return null;
        this.#app.activate();

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

        const {MurmurPanel} = await import(`file://${murmur.path}/lib/shell/panel.js`);
        const {RecordingIndicator} =
            await import(`file://${murmur.path}/lib/shell/indicator.js`);
        const {FocusTracker} = await import(`file://${murmur.path}/lib/shell/focus.js`);
        const {History} = await import(`file://${murmur.path}/lib/history.js`);
        const {oneLine} =
            await import(`file://${murmur.path}/lib/transcription/provider.js`);

        // A line break reaching the keyboard is typed as Enter, which sends the
        // message, runs the command and submits the search.
        const formatted = oneLine('three things:\n- The report\n- The laptop');
        this.#ok('a formatted transcript becomes one line',
            formatted === 'three things: - The report - The laptop', `got "${formatted}"`);
        this.#ok('a transcript keeps no break of any kind',
            oneLine('Restart the worker.\n') === 'Restart the worker.' &&
                oneLine('one\ttwo') === 'one two');

        // The first pointer interaction of a session produces no crossing, so
        // whatever it lands on reads as unhovered however healthy it is. Spend
        // it on empty desktop, before there is a panel for it to collapse.
        await this.#click(640, 300);

        const fired = [];
        await this.#checkHistory(History);

        this.#panel = new MurmurPanel();
        this.#panel.destination = {app: 'Text Editor', kind: 'field', password: false};
        this.#panel.transcript = 'the quick brown fox';
        this.#panel.onAction = action => fired.push(action);
        await this.#settle(600);

        this.#checkSurface();
        await this.#checkButtons(fired);
        await this.#checkKeyboard();
        await this.#checkCollapse();
        await this.#checkDestination(FocusTracker, MurmurPanel);
        await this.#checkPlacement(MurmurPanel);
        await this.#checkCollapsedStart(MurmurPanel);
        await this.#checkTranscript(MurmurPanel);
        await this.#checkTeardown(RecordingIndicator);
        this.#checkExtensionCycle(murmur);
        this.#report();
    }

    // What a dictation leaves behind, checked where it is written rather than in
    // the abstract: the session's own state directory, from inside the shell
    // process that does the writing.
    async #checkHistory(History) {
        const history = new History('probe@murmur.local');
        await history.clear();
        this.#ok('a history nothing was said into is empty',
            (await history.entries()).length === 0);

        await history.append('the first thing said');
        await history.append('the second thing said');
        const kept = await history.entries();
        this.#ok('a dictation is kept, newest first',
            kept[0]?.text === 'the second thing said' &&
                kept[1]?.text === 'the first thing said',
            JSON.stringify(kept));
        this.#ok('a kept dictation carries when it was said',
            typeof kept[0]?.at === 'string' && kept[0].at.length > 0, `at=${kept[0]?.at}`);
        this.#ok('the history is a file on disk',
            GLib.file_test(history.path, GLib.FileTest.EXISTS), history.path);

        // Nothing but the user reads what the user dictated, which the write
        // has to settle as it creates the file: a mode corrected afterwards
        // leaves an instant in which it is not true.
        const modeOf = path => Gio.File.new_for_path(path)
            .query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
            .get_attribute_uint32('unix::mode') & 0o7777;
        const directory = GLib.path_get_dirname(history.path);
        this.#ok('the history is readable by nobody else',
            modeOf(history.path) === 0o600 && modeOf(directory) === 0o700,
            `file ${modeOf(history.path).toString(8)}, ` +
                `directory ${modeOf(directory).toString(8)}`);

        // Appends queue behind one another, so the last one to be handed over
        // is the last one to be written and waiting for it waits for them all.
        let queued;
        for (let index = 0; index < 501; index++)
            queued = history.append(`dictation ${index}`);
        await queued;

        const capped = await history.entries();
        this.#ok('the history stops at 500 dictations', capped.length === 500,
            `${capped.length} kept`);
        this.#ok('the oldest dictation is the one dropped',
            capped.at(-1)?.text === 'dictation 1', `oldest is ${capped.at(-1)?.text}`);

        // A half-written line costs its own entry and nothing else.
        GLib.file_set_contents(history.path,
            '{"at":"2026-01-01T00:00:00Z","text":"kept"}\n{"at":"2026-01\n');
        const survivors = await history.entries();
        this.#ok('a damaged line is skipped rather than losing the file',
            survivors.length === 1 && survivors[0]?.text === 'kept', JSON.stringify(survivors));

        await history.clear();
        this.#ok('clearing leaves nothing behind',
            (await history.entries()).length === 0 &&
                !GLib.file_test(history.path, GLib.FileTest.EXISTS));
    }

    // What made the panel disappear into a dark desktop: the class it wore is
    // styled for sitting inside another surface, so the theme gave its frame a
    // transparent border and a transparent shadow, and a card the colour of the
    // window behind it had nothing to separate it. Read from the theme rather
    // than from a screenshot, because whether it shows depends on the wallpaper.
    #checkSurface() {
        const node = this.#card().get_theme_node();
        const border = node.get_border_color(St.Side.TOP);
        this.#ok('the theme draws the panel an edge of its own', border.alpha > 0,
            `border alpha ${border.alpha}, width ${node.get_border_width(St.Side.TOP)}`);

        // A frame that holds the keyboard wears the theme's focus ring for as
        // long as it is open, which no shell surface does.
        const focus = global.stage.get_key_focus();
        this.#ok('the keyboard is on the action, not on the frame',
            focus instanceof St.Button && focus.label === 'Stop',
            `focus is ${focus?.constructor?.name} "${focus?.label ?? focus?.style_class}"`);
    }

    // The regression this whole harness exists for: a button that is hit-tested
    // correctly, wired correctly, and still does nothing when clicked, because
    // something above it consumed the press and cancelled its gesture.
    async #checkButtons(fired) {
        const buttons = this.#buttons();
        this.#ok('the panel has its three actions', buttons.length === 3,
            `found ${buttons.map(button => button.label).join(', ') || 'none'}`);

        // Nothing here measures the buttons. They are the shell's own
        // notification buttons and their size is the installed theme's answer,
        // so a number checked here would be a number Murmur had to set.
        for (const button of buttons) {
            const name = button.label ?? button.accessible_name ?? '?';
            const [x, y] = this.#centre(button);

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
        this.#ok('a window can be opened to test against', window !== null,
            this.#app
                ? `${this.#app.get_id()} opened no focused window`
                : `none of ${CLIENT_APPS.join(', ')} is installed system-wide`);
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
        // The middle of the window, which is its document or its terminal: a
        // corner is the header bar, where a click can hit a button and open
        // something this is not testing.
        const frame = window.get_frame_rect();
        await this.#click(frame.x + frame.width / 2, frame.y + frame.height / 2);
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
        this.#ok('the panel is opaque once opened', card?.get_parent()?.opacity === 255,
            `opacity=${card?.get_parent()?.opacity}`);
    }

    // The card is only as tall as what has been said: nothing yet is nothing on
    // screen, and a long dictation stops growing rather than filling the screen.
    async #checkTranscript(MurmurPanel) {
        this.#panel.destroy();
        this.#panel = new MurmurPanel();
        // Through the setter rather than straight from the constructor: a
        // service that sends an empty partial has to leave the card as small as
        // one that has sent nothing at all.
        this.#panel.transcript = '';
        await this.#settle(400);

        this.#ok('an unspoken transcript takes no room',
            this.#transcriptHeight() === 0, `${this.#transcriptHeight()}px of transcription`);

        this.#panel.transcript = 'the quick brown fox';
        await this.#settle(300);
        const spoken = this.#transcriptHeight();
        this.#ok('a spoken word opens the transcript', spoken > 0, `${spoken}px`);

        this.#panel.transcript = 'the quick brown fox jumps over the lazy dog. '.repeat(40);
        await this.#settle(400);
        const long = this.#transcriptHeight();
        this.#ok('a long transcript stops at its cap', long > spoken && long <= 8 * spoken,
            `${long}px from ${spoken}px`);

        // Copying is a choice only while there is a field to type into; with
        // nothing focused it does what stopping does.
        this.#panel.destination = {app: 'Text Editor', kind: 'field', password: false};
        await this.#settle(200);
        const withField = this.#buttons().filter(button => button.visible).length;
        this.#panel.destination = {kind: 'clipboard'};
        await this.#settle(200);
        const withClipboard = this.#buttons().filter(button => button.visible).length;
        this.#ok('copying is offered for a field and not for the clipboard',
            withField === 3 && withClipboard === 2,
            `${withField} with a field, ${withClipboard} with none`);
    }

    #transcriptHeight() {
        const [scroll] = this.#descendants(
            this.#card() ?? Main.layoutManager.uiGroup,
            actor => actor.style_class?.includes('murmur-transcript') ?? false);
        if (!scroll?.visible)
            return 0;
        const [, height] = scroll.get_transformed_size();
        return height;
    }

    async #checkTeardown(RecordingIndicator) {
        const indicator = new RecordingIndicator();
        indicator.countdown = '9:41';
        await this.#settle();
        const pill = Main.panel.statusArea['murmur'];
        this.#ok('the indicator reaches the top bar', pill !== undefined);

        // The only way back to a panel that has been clicked away, so a press
        // that lands on it and does nothing loses the recording behind it.
        let toggled = false;
        indicator.onToggle = () => {
            toggled = true;
        };
        if (pill) {
            const [x, y] = this.#centre(pill);
            await this.#click(x, y);
            this.#ok('clicking the indicator asks for the panel back', toggled);
        }

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
