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
    async #point(x, y) {
        const seat = Clutter.get_default_backend().get_default_seat();
        seat.warp_pointer(x + 2, y + 2);
        this.#pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + 2, y + 2);
        await this.#settle(100);
        this.#pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
    }

    async #click(x, y, watch = null) {
        await this.#point(x, y);
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

    async #checkDestination(FocusTracker, MurmurPanel) {
        if (!this.#client) {
            this.#fail('a client is available to read a destination from', 'none opened');
            return;
        }

        this.#panel?.destroy();
        this.#panel = null;
        this.#client.activate(global.get_current_time());
        await this.#settle(800);

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

    async #run() {
        const murmur = Main.extensionManager.lookup(MURMUR_UUID);
        if (!murmur?.stateObj || !murmur.path)
            throw new Error(`${MURMUR_UUID} is not loaded`);

        const {MurmurPanel} = await import(`file://${murmur.path}/lib/shell/panel.js`);
        const {DictationIndicator} =
            await import(`file://${murmur.path}/lib/shell/dictation-indicator.js`);
        const {RecordingIndicator} =
            await import(`file://${murmur.path}/lib/shell/recording-indicator.js`);
        const {FocusTracker} = await import(`file://${murmur.path}/lib/shell/focus.js`);
        const {History} = await import(`file://${murmur.path}/lib/history.js`);
        const {oneLine} =
            await import(`file://${murmur.path}/lib/transcript.js`);

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
        await this.#checkEmptyWrite(murmur.path);

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
        await this.#checkTeardown(DictationIndicator);
        await this.#checkRecordingPill(RecordingIndicator);
        const recorded = await this.#checkAudio(murmur.path);
        await this.#checkContext(murmur.path);
        await this.#checkBus(murmur, recorded);
        recorded?.delete(null);
        this.#report();
    }

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

        const modeOf = path => Gio.File.new_for_path(path)
            .query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
            .get_attribute_uint32('unix::mode') & 0o7777;
        const directory = GLib.path_get_dirname(history.path);
        this.#ok('the history is readable by nobody else',
            modeOf(history.path) === 0o600 && modeOf(directory) === 0o700,
            `file ${modeOf(history.path).toString(8)}, ` +
                `directory ${modeOf(directory).toString(8)}`);

        let queued;
        for (let index = 0; index < 501; index++)
            queued = history.append(`dictation ${index}`);
        await queued;

        const capped = await history.entries();
        this.#ok('the history stops at 500 dictations', capped.length === 500,
            `${capped.length} kept`);
        this.#ok('the oldest dictation is the one dropped',
            capped.at(-1)?.text === 'dictation 1', `oldest is ${capped.at(-1)?.text}`);

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

    // A transcript of nothing and a list of no recordings are both an empty
    // file, and GIO handed no bytes to write asserts and never answers, which
    // would leave a recording transcribing for ever.
    async #checkEmptyWrite(path) {
        const {writePrivately} = await import(`file://${path}/lib/files.js`);
        const file = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_cache_dir(), 'probe', 'empty']));
        const written = await Promise.race([
            writePrivately(file, '').then(() => true),
            this.#settle(2000).then(() => false),
        ]);
        this.#ok('nothing to write is written', written &&
            GLib.file_test(file.get_path(), GLib.FileTest.EXISTS) &&
            file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size() === 0);
    }

    // The theme gives a class meant for sitting inside another surface a
    // transparent border and shadow, which leaves a card the colour of the
    // window behind it with nothing to separate it. Read from the theme rather
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

    // A button can be hit-tested correctly, wired correctly, and still do
    // nothing when clicked, because something above it consumed the press and
    // cancelled its gesture.
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
            // happened.
            this.#ok(`"${name}" takes the press`, hovered === true && pressed === true,
                `hover=${hovered} pressed=${pressed}`);
            this.#ok(`clicking "${name}" does something`,
                fired.length > before || this.#panel.collapsed !== collapsedBefore);

            if (this.#panel.collapsed)
                this.#panel.expand();
        }
    }

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

            const gap = workArea.y + workArea.height - (y + height);
            this.#ok('the panel clears what the second monitor reserves',
                gap >= MARGIN_FLOOR, `${gap}px above the work area's bottom`);
        } finally {
            Main.layoutManager.removeChrome(dock);
            dock.destroy();
            await this.#settle(400);
        }
    }

    async #checkCollapsedStart(MurmurPanel) {
        this.#panel.destroy();
        this.#panel = new MurmurPanel({collapsed: true});
        this.#panel.transcript = 'started out of the way';
        await this.#settle();

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

    async #checkTranscript(MurmurPanel) {
        this.#panel.destroy();
        this.#panel = new MurmurPanel();
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

    async #checkTeardown(DictationIndicator) {
        const indicator = new DictationIndicator();
        indicator.countdown = '9:41';
        await this.#settle();
        const pill = Main.panel.statusArea['murmur-dictation'];
        this.#ok('the indicator reaches the top bar', pill !== undefined);

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
            Main.panel.statusArea['murmur-dictation'] === undefined);
    }

    async #checkRecordingPill(RecordingIndicator) {
        const before = new Set(Object.keys(Main.panel.statusArea));
        const indicator = new RecordingIndicator({transcribing: false});
        indicator.elapsed = 4332;
        const fired = [];
        indicator.onStop = () => fired.push('stop');
        indicator.onDiscard = () => fired.push('discard');
        await this.#settle();

        const role = Object.keys(Main.panel.statusArea)
            .find(key => !before.has(key) && key.startsWith('murmur-recording-'));
        const pill = role ? Main.panel.statusArea[role] : undefined;
        this.#ok('the recording reaches the top bar', pill !== undefined);
        if (!pill) {
            indicator.destroy();
            return;
        }

        const texts = root => this.#descendants(root, actor => actor instanceof St.Label)
            .map(label => label.text);
        this.#ok('the pill shows how long the recording has run',
            texts(pill).includes('1:12:12'), JSON.stringify(texts(pill)));

        const open = async () => {
            if (!pill.menu.isOpen) {
                const [x, y] = this.#centre(pill);
                await this.#click(x, y);
            }
            return pill.menu.isOpen;
        };
        const item = text => this.#descendants(pill.menu.actor,
            actor => actor instanceof St.Label && actor.text === text)[0]?.get_parent() ?? null;

        this.#ok('clicking the pill opens its menu', await open());
        this.#ok('the menu shows the microphone and the desktop',
            ['Microphone', 'Desktop audio'].every(text => texts(pill.menu.actor).includes(text)),
            JSON.stringify(texts(pill.menu.actor)));

        const stop = item('Stop and transcribe');
        if (stop) {
            const [x, y] = this.#centre(stop);
            await this.#click(x, y);
        }
        this.#ok('Stop and transcribe stops the recording', fired.includes('stop'),
            JSON.stringify(fired));

        await open();
        const discard = item('Discard…');
        if (discard) {
            const [x, y] = this.#centre(discard);
            await this.#click(x, y);
        }
        const question = 'Discard 1 h 12 min of recording?';
        const dialogs = Main.layoutManager.modalDialogGroup;
        this.#ok('discarding asks first', texts(dialogs).includes(question) &&
            !fired.includes('discard'), JSON.stringify(texts(dialogs)));
        const confirm = this.#descendants(dialogs,
            actor => actor instanceof St.Button && actor.label === 'Discard')[0];
        if (confirm) {
            const [x, y] = this.#centre(confirm);
            await this.#click(x, y);
        }
        this.#ok('confirming discards the recording', fired.includes('discard'),
            JSON.stringify(fired));
        this.#ok('the question goes once answered', !texts(dialogs).includes(question));

        pill.menu.close();
        indicator.locked = true;
        await this.#settle();
        this.#ok('a locked screen leaves the menu shut', !await open());
        indicator.locked = false;
        await this.#settle();
        this.#ok('unlocking gives the menu back', await open());
        pill.menu.close();

        indicator.transcribing();
        await this.#settle();
        this.#ok('the pill says it is transcribing', texts(pill).includes('Transcribing…'),
            JSON.stringify(texts(pill)));
        this.#ok('a recording being transcribed has nothing left to stop', !await open());
        indicator.transcribing({done: 2, of: 6});
        await this.#settle();
        this.#ok('the pill counts the pieces it has transcribed',
            texts(pill).includes('Transcribing\u2026 2 of 6 done'), JSON.stringify(texts(pill)));

        indicator.destroy();
        await this.#settle();
        this.#ok('nothing of the pill is left', Main.panel.statusArea[role] === undefined);
    }

    // Nothing short of running GStreamer inside the compositor proves it is
    // there with every plugin it needs.
    async #checkAudio(path) {
        const audio = await import(`file://${path}/lib/shell/audio.js`);
        const {layoutOf, Microphone, Recorder} = audio;
        const file = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_cache_dir(), 'probe.opus']));
        GLib.mkdir_with_parents(GLib.get_user_cache_dir(), 0o700);
        await this.#checkPieces(audio);

        const heard = new Set();
        try {
            const recorder = await Recorder.open(file);
            recorder.onLevel = source => heard.add(source);
            await this.#settle(1500);
            await recorder.finish();
        } catch (error) {
            this.#fail('a recording opens', `${error}`);
            return null;
        }
        this.#ok('a recording hears the microphone', heard.has('microphone'));
        this.#ok('a recording hears the desktop', heard.has('desktop'));

        const [, contents] = file.load_contents(null);
        const head = String.fromCharCode(...contents.slice(0, 40));
        this.#ok('a recording is an Ogg Opus file',
            head.startsWith('OggS') && head.includes('OpusHead'), JSON.stringify(head));
        try {
            const {channels} = await layoutOf(file, new Gio.Cancellable());
            this.#ok('a recording keeps the microphone and the desktop on channels of their own',
                JSON.stringify(channels) === '["microphone","desktop"]', JSON.stringify(channels));
        } catch (error) {
            this.#fail('a recording keeps the microphone and the desktop on channels of their own',
                `${error}`);
        }

        const microphone = await Microphone.open();
        let bytes = 0;
        let ended = false;
        let whole = true;
        microphone.listen(chunk => {
            bytes += chunk.length;
            whole &&= chunk.length % 2 === 0;
        }, () => {
            ended = true;
        });
        await this.#settle(1000);
        microphone.finish();
        await this.#until(() => ended);
        microphone.close();
        this.#ok('a dictation hears the microphone in whole samples', bytes > 0 && whole,
            `${bytes} bytes`);
        this.#ok('a dictation hears the end of what it heard', ended);
        return file;
    }

    async #checkContext(path) {
        const {ContextWatch} = await import(`file://${path}/lib/shell/context.js`);
        const {contextOf} = await import(`file://${path}/lib/context-log.js`);
        const {Recorder} = await import(`file://${path}/lib/shell/audio.js`);
        if (!this.#client) {
            this.#fail('a recording notes what is around it', 'no client window was opened');
            return;
        }

        const cache = GLib.get_user_cache_dir();
        const audio = Gio.File.new_for_path(GLib.build_filenamev([cache, 'probe-context.opus']));
        const log = Gio.File.new_for_path(GLib.build_filenamev([cache, 'probe-context.jsonl']));
        const own = Gio.File.new_for_path(GLib.build_filenamev([cache, 'probe-own.opus']));
        removeFile(log);

        this.#client.activate(global.get_current_time());
        await this.#settle(800);
        const title = this.#client.get_title();
        const app = Shell.WindowTracker.get_default().get_window_app(this.#client)?.get_name();

        const media = this.#mediaPlayer();
        await this.#settle();
        const watch = new ContextWatch({
            audio, awaySeconds: 2, follow: true, log, settleSeconds: 1,
            startedUs: GLib.get_monotonic_time(),
        });
        const others = [];
        let recorder = null;
        try {
            recorder = await Recorder.open(own);
            const raw = ['--raw', '--format', 's16', '--rate', '48000', '--channels', '1'];
            others.push(this.#spawn(['pw-cat', '--playback', ...raw, '--volume', '0', '/dev/zero']));
            others.push(this.#spawn(['pw-cat', '--record', ...raw, '/dev/null']));
            await this.#settle(4000);
            watch.locked = true;
            watch.locked = false;
            await this.#point(400, 300);
            others.forEach(other => other.force_exit());
            others.length = 0;
            media.release();
            await this.#settle(3500);
        } catch (error) {
            this.#fail('a recording notes what is around it', `${error}`);
        } finally {
            others.forEach(other => other.force_exit());
            media.release();
            await watch.stop();
            await recorder?.finish();
            removeFile(own);
        }

        const contents = GLib.file_test(log.get_path(), GLib.FileTest.EXISTS)
            ? new TextDecoder().decode(log.load_contents(null)[1])
            : '';
        removeFile(log);
        const context = contextOf(contents, audio.get_path());
        const moments = context?.moments ?? [];
        const of = kind => moments.filter(moment => moment.kind === kind);
        const detail = JSON.stringify(context);
        const playing = of('playing').find(moment => moment.app !== 'Murmur Probe');
        const calls = of('call');

        this.#ok('a recording notes the computer it was made on',
            context?.head.computer === GLib.get_host_name(), detail);
        this.#ok('a recording notes the windows open as it starts',
            of('open').some(moment => moment.app === app && moment.title === title), detail);
        this.#ok('a recording notes the window in front and its application',
            of('focused').some(moment => moment.app === app && moment.title === title), detail);
        this.#ok('a recording notes an application playing, and stopping',
            playing !== undefined && of('stopped').some(moment => moment.app === playing.app),
            detail);
        this.#ok('a recording names what a media player plays, and by whom',
            of('playing').some(moment => moment.app === 'Murmur Probe' &&
                moment.title === 'Probe tune' && moment.artist === 'The Probes'), detail);
        this.#ok('a recording notes an application taking the microphone, and letting go',
            calls.some(moment => moment.on) && calls.some(moment => !moment.on), detail);
        this.#ok('a recording never takes its own microphone for a call',
            calls.length > 0 && calls.every(moment => moment.app === playing?.app), detail);
        this.#ok('a recording notes time away from the keyboard, and the return',
            of('away').length > 0 && of('back').some(moment => moment.at > of('away')[0].at),
            detail);
        this.#ok('a recording notes the screen locking and unlocking',
            JSON.stringify(of('lock').map(moment => moment.on)) === '[true,false]', detail);
    }

    #spawn(argv) {
        return Gio.Subprocess.new(argv,
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
    }

    #mediaPlayer() {
        const root = Gio.DBusExportedObject.wrapJSObject(
            '<node><interface name="org.mpris.MediaPlayer2">' +
            '<property name="Identity" type="s" access="read"/>' +
            '</interface></node>',
            {Identity: 'Murmur Probe'});
        const player = Gio.DBusExportedObject.wrapJSObject(
            '<node><interface name="org.mpris.MediaPlayer2.Player">' +
            '<property name="PlaybackStatus" type="s" access="read"/>' +
            '<property name="Metadata" type="a{sv}" access="read"/>' +
            '</interface></node>',
            {
                Metadata: {
                    'xesam:artist': new GLib.Variant('as', ['The Probes']),
                    'xesam:title': new GLib.Variant('s', 'Probe tune'),
                },
                PlaybackStatus: 'Playing',
            });
        root.export(Gio.DBus.session, '/org/mpris/MediaPlayer2');
        player.export(Gio.DBus.session, '/org/mpris/MediaPlayer2');
        let ownerId = Gio.bus_own_name_on_connection(Gio.DBus.session,
            'org.mpris.MediaPlayer2.MurmurProbe', Gio.BusNameOwnerFlags.NONE, null, null);
        return {
            release: () => {
                if (!ownerId)
                    return;
                Gio.bus_unown_name(ownerId);
                ownerId = 0;
                root.unexport();
                player.unexport();
            },
        };
    }

    async #checkBus(murmur, recorded) {
        const call = (path, service) => new Promise(resolve => {
            Gio.DBus.session.call('org.gnome.Shell', '/org/gnome/Shell/Extensions/Murmur',
                'org.gnome.Shell.Extensions.Murmur', 'Transcribe',
                new GLib.Variant('(ss)', [path, service]), null, Gio.DBusCallFlags.NONE, -1,
                null, (connection, result) => {
                    try {
                        connection.call_finish(result);
                        resolve(null);
                    } catch (error) {
                        Gio.DBusError.strip_remote_error(error);
                        resolve(error.message);
                    }
                });
        });
        const settings = murmur.stateObj.getSettings();
        const keys = ['mistral-api-key', 'xai-api-key'];
        const saved = keys.map(key => settings.get_string(key));
        settings.set_string('mistral-api-key', 'probe');
        settings.set_string('xai-api-key', '');

        const cache = GLib.get_user_cache_dir();
        const notes = GLib.build_filenamev([cache, 'probe-notes.txt']);
        GLib.file_set_contents(notes, 'not a sound in here\n');
        const missing = GLib.build_filenamev([cache, 'nowhere', 'probe.opus']);
        const audio = recorded?.get_path() ?? missing;

        const refused = [
            ['an unknown service', audio, 'whisper', 'No transcription service is named whisper'],
            ['a path that is not a full path', 'probe.opus', 'mistral', 'probe.opus is not a full path'],
            ['a service with no key', audio, 'xai', 'Set your xAI API key in the extension preferences'],
            ['a file that is not there', missing, 'mistral', `${missing} does not exist`],
            ['a file that is not audio', notes, 'mistral', "Murmur can't read this file: "],
        ];
        for (const [what, path, service, message] of refused) {
            const answer = await call(path, service);
            this.#ok(`transcribing refuses ${what}`, answer?.startsWith(message) ?? false,
                JSON.stringify(answer));
        }
        GLib.unlink(notes);

        const before = new Set(Object.keys(Main.panel.statusArea));
        const answer = recorded ? await call(audio, 'mistral') : 'nothing was recorded';
        const role = Object.keys(Main.panel.statusArea)
            .find(key => !before.has(key) && key.startsWith('murmur-recording-'));
        const labels = role
            ? this.#descendants(Main.panel.statusArea[role], actor => actor instanceof St.Label)
                .map(label => label.text)
            : [];
        this.#checkExtensionCycle(murmur);
        this.#ok('transcribing a file is accepted', answer === null, JSON.stringify(answer));
        this.#ok('a file being transcribed shows its pill', labels.includes('Transcribing…'),
            JSON.stringify(labels));

        await this.#settle();
        this.#ok('the pill goes with the extension',
            role !== undefined && Main.panel.statusArea[role] === undefined);
        this.#ok('the extension answers on the bus again', await call(missing, 'mistral') ===
            `${missing} does not exist`);
        await this.#checkTranscribedContext(call, murmur);
        await this.#checkTranscribed(call, settings);
        keys.forEach((key, index) => settings.set_string(key, saved[index]));
    }

    async #checkTranscribedContext(call, murmur) {
        const cache = GLib.get_user_cache_dir();
        const name = '2026-10-27T09-15-59';
        const audio = Gio.File.new_for_path(GLib.build_filenamev([cache, `${name}.opus`]));
        const transcript = GLib.build_filenamev([cache, `${name}.md`]);
        const log = GLib.build_filenamev(
            [GLib.get_user_state_dir(), MURMUR_UUID, 'context', `${name}.jsonl`]);
        try {
            await this.#writeStereo(audio);
        } catch (error) {
            this.#fail('a transcript opens with where and when it was recorded', `${error}`);
            return;
        }
        GLib.mkdir_with_parents(GLib.path_get_dirname(log), 0o700);
        GLib.file_set_contents(log, [
            {audio: audio.get_path(), computer: 'probe-computer', microphone: 'Probe microphone',
                network: null, output: 'Probe output'},
            {app: 'Probe', at: 0, kind: 'focused', title: 'Probe window'},
        ].map(entry => `${JSON.stringify(entry)}\n`).join(''));

        const heard = await this.#transcribed(call, audio);
        heard.notification?.destroy();
        const written = GLib.file_test(transcript, GLib.FileTest.EXISTS)
            ? new TextDecoder().decode(GLib.file_get_contents(transcript)[1])
            : '';
        this.#ok('a transcript opens with where and when it was recorded',
            written.startsWith([
                '---',
                'computer: probe-computer',
                'day: Tuesday',
                'ended: 2026-10-27T09:16:01',
                'microphone: Probe microphone',
                'output: Probe output',
                'started: 2026-10-27T09:15:59',
                'transcribed-by: Mistral Voxtral (voxtral-small-transcribe-3)',
                '---',
                '09:15:59 [focused] Probe: "Probe window"',
            ].join('\n')),
            `${JSON.stringify(written)} after ${heard.said}`);
        this.#ok('a transcript with a header still holds what was said',
            written.includes(GLib.getenv('PROBE_SENTENCE') ?? '-'), JSON.stringify(written));

        audio.delete(null);
        removeFile(Gio.File.new_for_path(transcript));
        murmur.stateObj.disable();
        murmur.stateObj.enable();
        const gone = await this.#until(() => !GLib.file_test(log, GLib.FileTest.EXISTS));
        this.#ok('what was around a recording goes once its audio is gone', gone, log);
        removeFile(Gio.File.new_for_path(log));
    }

    async #checkTranscribed(call, settings) {
        const cache = GLib.get_user_cache_dir();
        const audio = Gio.File.new_for_path(GLib.build_filenamev([cache, 'probe-call.opus']));
        const transcript = GLib.build_filenamev([cache, 'probe-call.md']);
        try {
            await this.#writeStereo(audio);
        } catch (error) {
            this.#fail('a transcribed recording ends in a notification', `${error}`);
            return;
        }

        const heard = await this.#transcribed(call, audio);
        this.#ok('a transcribed recording ends in a notification',
            heard.notification?.title === 'Recording transcribed', heard.said);
        this.#ok('its notification offers Open and Copy path',
            this.#offers(heard.notification) === 'Open, Copy path', this.#offers(heard.notification));
        const copied = heard.notification ? await this.#copyPath(heard.notification) : heard.said;
        this.#ok('Copy path puts the transcript\'s path on the clipboard', copied === transcript,
            JSON.stringify(copied));
        const sentence = GLib.getenv('PROBE_SENTENCE') ?? '';
        const written = GLib.file_test(transcript, GLib.FileTest.EXISTS)
            ? new TextDecoder().decode(GLib.file_get_contents(transcript)[1])
            : '';
        this.#ok('the transcript holds what the service heard',
            sentence.length > 0 && written.includes(sentence),
            `${JSON.stringify(written)} after ${heard.said}`);

        settings.set_string('mistral-api-key', 'probe-silent');
        const silent = await this.#transcribed(call, audio);
        this.#ok('a recording with no words heard offers Open and Copy path',
            (silent.notification?.body?.includes('No words were heard') ?? false) &&
                this.#offers(silent.notification) === 'Open, Copy path',
            `${silent.said} with ${this.#offers(silent.notification)}`);
        silent.notification?.destroy();
        audio.delete(null);
        if (GLib.file_test(transcript, GLib.FileTest.EXISTS))
            GLib.unlink(transcript);
    }

    async #transcribed(call, audio) {
        const source = () => Main.messageTray.getSources()
            .find(candidate => candidate.title === 'Murmur');
        const seen = new Set(source()?.notifications ?? []);
        const refusal = await call(audio.get_path(), 'mistral');
        if (refusal !== null)
            return {notification: null, said: `refused: ${refusal}`};
        const fresh = () => source()?.notifications.find(notification => !seen.has(notification));
        await this.#until(() => fresh() !== undefined, 100, 200);
        const notification = fresh() ?? null;
        return {
            notification,
            said: notification
                ? `"${notification.title}": ${JSON.stringify(notification.body)}`
                : 'no notification within 20 seconds',
        };
    }

    #offers(notification) {
        return notification?.actions.map(action => action.label).join(', ') ?? 'no notification';
    }

    async #copyPath(notification) {
        const clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, 'nothing was copied');
        const banner = () => this.#descendants(Main.layoutManager.uiGroup, actor =>
            actor.notification === notification &&
                (actor.style_class?.includes('notification-banner') ?? false))[0] ?? null;
        const button = () => {
            const shown = banner();
            return shown
                ? this.#descendants(shown, actor =>
                    actor instanceof St.Button && actor.label === 'Copy path')[0] ?? null
                : null;
        };
        if (!await this.#until(() => banner()?.mapped === true, 30))
            return 'the notification never showed as a banner';
        await this.#settle();
        const shown = banner();
        if (!shown)
            return 'the banner went before the pointer reached it';

        const {primaryMonitor} = Main.layoutManager;
        await this.#point(primaryMonitor.x + primaryMonitor.width / 2,
            primaryMonitor.y + primaryMonitor.height / 2);
        await this.#point(...this.#centre(shown));
        if (!await this.#until(() => shown.expanded && button()?.mapped === true, 20))
            return 'hovering the banner never showed its buttons';
        await this.#settle();

        const target = button();
        if (!target)
            return 'the banner went before its button was pressed';
        const {hovered, pressed} = await this.#click(...this.#centre(target), target);
        if (!hovered || !pressed)
            return `Copy path never took the press: hover=${hovered} pressed=${pressed}`;
        return new Promise(resolve => clipboard.get_text(St.ClipboardType.CLIPBOARD,
            (_clipboard, text) => resolve(text)));
    }

    async #checkPieces({cutPiece, layoutOf, piecesOf}) {
        const cancellable = new Gio.Cancellable();
        const file = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_cache_dir(), 'probe-stereo.opus']));
        let layout;
        let pieces;
        try {
            await this.#writeStereo(file);
            layout = await layoutOf(file, cancellable);
            pieces = await piecesOf(file, layout.seconds, {longest: 0.5, overlap: 0.1}, cancellable);
        } catch (error) {
            this.#fail('a recording is planned as pieces', `${error}`);
            return;
        }
        this.#ok('a recording is read as the channels it names',
            JSON.stringify(layout.channels) === '["microphone","desktop"]',
            JSON.stringify(layout));
        const near = (first, second) => Math.abs(first - second) < 0.001;
        this.#ok('a recording is planned as pieces end to end',
            pieces.length >= 3 && pieces[0].own.start === 0 &&
            near(pieces.at(-1).own.end, layout.seconds) && pieces.every((piece, index) =>
                piece.own.end > piece.own.start &&
                (index === 0 || piece.own.start === pieces[index - 1].own.end)),
            JSON.stringify(pieces));
        this.#ok('each piece also hears a tenth of a second of its neighbours',
            pieces.every(({heard, own}) =>
                near(heard.start, Math.max(0, own.start - 0.1)) &&
                near(heard.end, Math.min(layout.seconds, own.end + 0.1))),
            JSON.stringify(pieces));

        const {heard} = pieces[1];
        try {
            const tone = await cutPiece(file, heard, {index: 0, of: 2}, cancellable);
            const silence = await cutPiece(file, heard, {index: 1, of: 2}, cancellable);
            const both = await cutPiece(file, heard, null, cancellable);
            const halves = await cutPiece(file, {end: 1, start: 0}, {index: 0, of: 2}, cancellable);
            const cut = tone && await layoutOf(tone, cancellable);
            [tone, both, halves].forEach(piece => piece?.delete(null));
            this.#ok('a channel is cut out of the recording at the length its piece hears',
                cut !== null && Math.abs(cut.seconds - (heard.end - heard.start)) < 0.05 &&
                cut.channels === null,
                `${JSON.stringify(cut)} for ${JSON.stringify(heard)}`);
            this.#ok('a channel with nothing on it is not cut at all', silence === null);
            this.#ok('a recording can be cut as one track', both !== null);
            this.#ok('a piece a whole number of half seconds long is heard', halves !== null);
        } catch (error) {
            this.#fail('a channel is cut out of the recording at the length its piece hears',
                `${error}`);
        }
        file.delete(null);
    }

    async #writeStereo(file) {
        const {default: Gst} = await import('gi://Gst?version=1.0');
        Gst.init(null);
        const source = (wave, mask, pad) =>
            `audiotestsrc num-buffers=150 samplesperbuffer=480 wave=${wave} ! ` +
            `audio/x-raw,format=F32LE,rate=48000,channels=1,channel-mask=(bitmask)${mask} ! ` +
            `channels.sink_${pad}`;
        const pipeline = Gst.parse_launch([
            'audiointerleave name=channels ! audioconvert ! taginject name=tags ! opusenc ! ' +
            'oggmux ! filesink name=file',
            source('sine', 1, 0),
            source('silence', 2, 1),
        ].join(' '));
        pipeline.get_by_name('file').set_property('location', file.get_path());
        pipeline.get_by_name('tags').set_property('tags',
            'extended-comment="MURMUR_CHANNELS=microphone,desktop"');
        pipeline.set_state(Gst.State.PLAYING);
        const message = pipeline.get_bus().timed_pop_filtered(5 * Gst.SECOND,
            Gst.MessageType.EOS | Gst.MessageType.ERROR);
        pipeline.set_state(Gst.State.NULL);
        if (message?.type !== Gst.MessageType.EOS)
            throw new Error(message?.parse_error()[0]?.message ?? 'the stereo file was not written');
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

function removeFile(file) {
    try {
        file.delete(null);
    } catch {
    }
}
