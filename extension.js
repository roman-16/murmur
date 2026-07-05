import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Soup from 'gi://Soup?version=3.0';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {dotoolCandidates} from './lib/dotool.js';

const KEYBIND = 'toggle-recording';
const MODEL = 'voxtral-mini-transcribe-realtime-2602';
const WS_URL = `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=${MODEL}`;
const SAMPLE_RATE = 16000;
const TARGET_DELAY_MS = 2400;
const CHUNK_BYTES = (SAMPLE_RATE * 2 * 100) / 1000;
const MAX_SECONDS = 120;
const TYPE_INTERVAL_MS = 3;
const STOP_GUARD_US = 500000;

const NORMALIZE = {
    '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'",
    '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u201f': '"',
    '\u00ab': '"', '\u00bb': '"', '\u2039': "'", '\u203a': "'",
    '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-',
    '\u2026': '...',
    '\u00a0': ' ', '\u2009': ' ', '\u200a': ' ', '\u202f': ' ',
};

function buildDotoolScript(text) {
    const cmds = [];
    text.split('\n').forEach((line, i) => {
        if (i > 0)
            cmds.push('key enter');
        if (line.length > 0)
            cmds.push(`type ${line}`);
    });
    return `${cmds.join('\n')}\n`;
}

function normalizeForKeyval(text) {
    let out = '';
    for (const ch of text)
        out += NORMALIZE[ch] ?? ch;
    return out;
}

function charToKeyval(ch) {
    if (ch === '\n' || ch === '\r')
        return Clutter.KEY_Return;
    if (ch === '\t')
        return Clutter.KEY_Tab;
    return Clutter.unicode_to_keysym(ch.codePointAt(0));
}

const ACCEL_MODIFIERS = [
    {re: /<(Super|Mod4)>/i, mask: Clutter.ModifierType.MOD4_MASK, label: 'Super'},
    {re: /<(Primary|Control|Ctrl)>/i, mask: Clutter.ModifierType.CONTROL_MASK, label: 'Ctrl'},
    {re: /<(Alt|Mod1)>/i, mask: Clutter.ModifierType.MOD1_MASK, label: 'Alt'},
    {re: /<Shift>/i, mask: Clutter.ModifierType.SHIFT_MASK, label: 'Shift'},
];
const ACCEL_MASK = ACCEL_MODIFIERS.reduce((m, x) => m | x.mask, 0);

// The shell process has no accelerator parser and must not import Gtk, so parse
// a GSettings accelerator like "<Super>space" into a keyval, modifier mask, and
// display label by hand.
function parseAccel(accel) {
    if (!accel)
        return null;
    const name = accel.replace(/<[^>]+>/g, '');
    const keyval = Clutter[`KEY_${name}`];
    if (!keyval)
        return null;
    const mods = ACCEL_MODIFIERS.filter(m => m.re.test(accel));
    return {
        keyval,
        mods: mods.reduce((m, x) => m | x.mask, 0),
        label: [...mods.map(m => m.label), name.replace(/^./, c => c.toUpperCase())].join('+'),
    };
}

const MurmurOverlay = GObject.registerClass(
class MurmurOverlay extends ModalDialog.ModalDialog {
    _init() {
        super._init({styleClass: 'murmur-overlay', destroyOnClose: true});

        this.onStop = null;
        this.onCancel = null;
        this._openedAt = 0;

        this._status = new St.Label({style_class: 'murmur-status', text: 'Listening…'});
        this._countdown = new St.Label({style_class: 'murmur-countdown', text: ''});

        const header = new St.BoxLayout({style_class: 'murmur-header'});
        header.add_child(this._status);
        header.add_child(new St.Widget({x_expand: true}));
        header.add_child(this._countdown);

        this._text = new St.Label({style_class: 'murmur-text', text: ''});
        this._text.clutter_text.line_wrap = true;
        // St.Label ellipsizes by default, which clips the text; disable it so the
        // ScrollView scrolls instead of showing a trailing "…".
        this._text.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        const textBox = new St.BoxLayout({style_class: 'murmur-textbox'});
        textBox.add_child(this._text);

        this._scroll = new St.ScrollView({
            style_class: 'murmur-scroll',
            reactive: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        this._scroll.child = textBox;
        this._scrollChangedId = this._scroll.vadjustment.connect('changed', adj => {
            adj.value = Math.max(0, adj.upper - adj.page_size);
        });

        this._hint = new St.Label({style_class: 'murmur-hint', text: ''});

        this.contentLayout.add_child(header);
        this.contentLayout.add_child(this._scroll);
        this.contentLayout.add_child(this._hint);

        this.connect('destroy', this._onDestroy.bind(this));
    }

    _onDestroy() {
        if (this._scrollChangedId) {
            this._scroll.vadjustment.disconnect(this._scrollChangedId);
            this._scrollChangedId = 0;
        }
        this._status.destroy();
        this._countdown.destroy();
        this._text.destroy();
        this._scroll.destroy();
        this._hint.destroy();
        this._status = null;
        this._countdown = null;
        this._text = null;
        this._scroll = null;
        this._hint = null;
    }

    open() {
        const ok = super.open();
        this._openedAt = GLib.get_monotonic_time();
        return ok;
    }

    setStatus(text) {
        this._status.text = text;
    }

    setCountdown(text) {
        this._countdown.text = text;
    }

    setText(text) {
        this._text.text = text;
    }

    setShortcut(shortcut) {
        this._shortcut = shortcut;
        const insert = shortcut ? `Enter / ${shortcut.label}` : 'Enter';
        this._hint.text = `${insert}: insert     ·     Esc: cancel`;
    }

    vfunc_key_press_event(event) {
        const symbol = event.get_key_symbol();
        const state = event.get_state();

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
        const shortcut = this._shortcut;
        if (shortcut && symbol === shortcut.keyval && (state & ACCEL_MASK) === shortcut.mods) {
            // Ignore the opening shortcut press if it is still held.
            if (GLib.get_monotonic_time() - this._openedAt > STOP_GUARD_US)
                this.onStop?.();
            return Clutter.EVENT_STOP;
        }
        return super.vfunc_key_press_event(event);
    }
});

class Session {
    constructor(apiKey, {onUpdate, onComplete, onError}) {
        this._apiKey = apiKey;
        this._onUpdate = onUpdate;
        this._onComplete = onComplete;
        this._onError = onError;

        this._cancellable = new Gio.Cancellable();
        this._rec = null;
        this._stdout = null;
        this._httpSession = null;
        this._conn = null;

        this._recording = true;
        this._audioEnded = false;
        this._transcriptionEnded = false;
        this._settled = false;

        this._text = '';

        this._committing = false;
        this._commitDone = null;
        this._typeId = 0;
        this._device = null;
    }

    start() {
        const pwRecord = GLib.find_program_in_path('pw-record');
        if (!pwRecord) {
            this._fail('pw-record not found; install PipeWire');
            return;
        }

        try {
            this._rec = Gio.Subprocess.new(
                [pwRecord, '--rate', String(SAMPLE_RATE), '--channels', '1',
                    '--format', 's16', '--raw', '-'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            this._fail(`pw-record: ${e.message}`);
            return;
        }
        this._stdout = this._rec.get_stdout_pipe();

        this._httpSession = new Soup.Session();
        const msg = Soup.Message.new_from_uri('GET', GLib.Uri.parse(WS_URL, GLib.UriFlags.NONE));
        msg.get_request_headers().append('Authorization', `Bearer ${this._apiKey}`);

        this._httpSession.websocket_connect_async(
            msg, null, null, GLib.PRIORITY_DEFAULT, this._cancellable,
            (session, res) => {
                try {
                    this._conn = session.websocket_connect_finish(res);
                } catch (e) {
                    this._fail(`websocket: ${e.message}`);
                    return;
                }
                this._conn.connect('message', (_c, type, bytes) => this._onMessage(type, bytes));
                this._conn.connect('closed', () => this._endTranscription());
                this._conn.connect('error', (_c, err) => this._fail(`websocket: ${err.message}`));

                this._send({
                    type: 'session.update',
                    session: {
                        audio_format: {encoding: 'pcm_s16le', sample_rate: SAMPLE_RATE},
                        target_streaming_delay_ms: TARGET_DELAY_MS,
                    },
                });
                this._readChunk();
            });
    }

    finalize() {
        if (!this._recording)
            return;
        this._recording = false;
        this._stopRecorder();
    }

    commit(text, onDone) {
        if (this._settled) {
            onDone?.();
            return;
        }
        this._committing = true;
        this._commitDone = onDone;
        this._typeViaDotool(dotoolCandidates(), text);
    }

    abort() {
        if (this._settled)
            return;
        this._settled = true;
        this._cancellable.cancel();
        this._cleanup();
    }

    _stopRecorder() {
        if (this._rec) {
            try {
                this._rec.send_signal(15);
            } catch {}
        }
    }

    _readChunk() {
        if (this._audioEnded)
            return;
        this._stdout.read_bytes_async(
            CHUNK_BYTES, GLib.PRIORITY_DEFAULT, this._cancellable, (stream, res) => {
                let bytes;
                try {
                    bytes = stream.read_bytes_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        logError(e, 'murmur: mic read failed');
                    return;
                }
                if (bytes.get_size() === 0) {
                    this._endAudio();
                    return;
                }
                this._send({type: 'input_audio.append', audio: GLib.base64_encode(bytes.get_data())});
                this._readChunk();
            });
    }

    _endAudio() {
        if (this._audioEnded)
            return;
        this._audioEnded = true;
        this._send({type: 'input_audio.flush'});
        this._send({type: 'input_audio.end'});
    }

    _onMessage(type, bytes) {
        if (this._settled || type !== Soup.WebsocketDataType.TEXT)
            return;
        let ev;
        try {
            ev = JSON.parse(new TextDecoder().decode(bytes.get_data()));
        } catch {
            return;
        }
        switch (ev.type) {
        case 'transcription.text.delta':
            if (ev.text) {
                this._text += ev.text;
                this._onUpdate(this._text);
            }
            break;
        case 'transcription.done':
            if (typeof ev.text === 'string' && ev.text.length >= this._text.length)
                this._text = ev.text;
            this._endTranscription();
            break;
        case 'error': {
            const m = ev.error?.message;
            this._fail(typeof m === 'string' ? m : JSON.stringify(m ?? ev.error));
            break;
        }
        }
    }

    _send(obj) {
        if (this._conn && this._conn.get_state() === Soup.WebsocketState.OPEN)
            this._conn.send_text(JSON.stringify(obj));
    }

    _endTranscription() {
        if (this._settled || this._transcriptionEnded)
            return;
        this._transcriptionEnded = true;
        this._closeStream();
        this._onComplete(this._text);
    }

    _closeStream() {
        this._stopRecorder();
        if (this._conn) {
            try {
                this._conn.close(Soup.WebsocketCloseCode.NORMAL, null);
            } catch {}
            this._conn = null;
        }
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
    }

    // Try each dotool tier, then the virtual keyboard. A tier that is
    // unavailable fails before emitting input, so falling through never
    // double-types.
    _typeViaDotool(candidates, text) {
        if (candidates.length === 0) {
            this._typeViaKeyval(text);
            return;
        }
        const [{bin}, ...rest] = candidates;
        let proc;
        try {
            proc = Gio.Subprocess.new(
                [bin], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            logError(e, `murmur: ${bin} spawn failed`);
            this._typeViaDotool(rest, text);
            return;
        }
        proc.communicate_utf8_async(buildDotoolScript(text), this._cancellable, (p, res) => {
            if (this._settled)
                return;
            let ok = false;
            try {
                p.communicate_utf8_finish(res);
                ok = p.get_successful();
            } catch {}
            if (ok)
                this._finishCommit();
            else
                this._typeViaDotool(rest, text);
        });
    }

    _typeViaKeyval(text) {
        const seat = Clutter.get_default_backend().get_default_seat();
        this._device = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const chars = [...normalizeForKeyval(text)];
        let i = 0;

        this._typeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TYPE_INTERVAL_MS, () => {
            if (this._settled) {
                this._typeId = 0;
                return GLib.SOURCE_REMOVE;
            }
            if (i >= chars.length) {
                this._typeId = 0;
                this._finishCommit();
                return GLib.SOURCE_REMOVE;
            }
            const keyval = charToKeyval(chars[i++]);
            if (keyval) {
                const t = GLib.get_monotonic_time();
                this._device.notify_keyval(t, keyval, Clutter.KeyState.PRESSED);
                this._device.notify_keyval(t, keyval, Clutter.KeyState.RELEASED);
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _finishCommit() {
        if (!this._committing || this._settled)
            return;
        this._settled = true;
        this._cleanup();
        this._commitDone?.();
    }

    _fail(reason) {
        if (this._settled)
            return;
        this._settled = true;
        log(`murmur: ${reason}`);
        this._cleanup();
        this._onError(reason);
    }

    _cleanup() {
        if (this._typeId) {
            GLib.source_remove(this._typeId);
            this._typeId = 0;
        }
        this._device = null;
        this._closeStream();
    }
}

export default class MurmurExtension extends Extension {
    enable() {
        this._session = null;
        this._overlay = null;
        this._recording = false;
        this._tickId = 0;
        this._commitDelayId = 0;
        this._deadlineUs = 0;
        this._settings = this.getSettings();
        this._bound = false;

        this._bind();
        this._changedId = this._settings.connect(`changed::${KEYBIND}`, () => {
            this._unbind();
            this._bind();
        });
    }

    disable() {
        if (this._changedId) {
            this._settings.disconnect(this._changedId);
            this._changedId = 0;
        }
        this._unbind();
        this._clearCountdown();
        if (this._commitDelayId) {
            GLib.source_remove(this._commitDelayId);
            this._commitDelayId = 0;
        }
        this._session?.abort();
        this._session = null;
        this._overlay?.destroy();
        this._overlay = null;
        this._recording = false;
        this._settings = null;
    }

    _bind() {
        if (this._settings.get_strv(KEYBIND).length === 0)
            return;
        Main.wm.addKeybinding(
            KEYBIND,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._toggle());
        this._bound = true;
    }

    _unbind() {
        if (!this._bound)
            return;
        Main.wm.removeKeybinding(KEYBIND);
        this._bound = false;
    }

    _toggle() {
        if (this._session)
            return;
        this._start();
    }

    _start() {
        const apiKey = this._settings.get_string('mistral-api-key');
        if (!apiKey) {
            Main.notify('Murmur', 'Set your Mistral API key in the extension preferences');
            return;
        }

        this._overlay = new MurmurOverlay();
        this._overlay.onCancel = () => this._cancel();
        this._overlay.onStop = () => this._stop();
        this._overlay.setShortcut(parseAccel(this._settings.get_strv(KEYBIND)[0] ?? ''));
        if (!this._overlay.open()) {
            this._overlay.destroy();
            this._overlay = null;
            Main.notify('Murmur', 'Could not open the overlay');
            return;
        }

        this._session = new Session(apiKey, {
            onUpdate: text => this._overlay?.setText(text),
            onComplete: text => this._onComplete(text),
            onError: msg => this._onError(msg),
        });
        this._recording = true;
        this._session.start();
        this._startCountdown();
    }

    _startCountdown() {
        this._deadlineUs = GLib.get_monotonic_time() + MAX_SECONDS * 1000000;
        this._tick();
    }

    _tick() {
        const remaining = Math.max(0, Math.ceil((this._deadlineUs - GLib.get_monotonic_time()) / 1000000));
        this._overlay?.setCountdown(`${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`);
        if (remaining <= 0) {
            this._stop();
            return;
        }
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._tickId = 0;
            this._tick();
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearCountdown() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    _stop() {
        if (!this._session || !this._recording)
            return;
        this._recording = false;
        this._clearCountdown();
        this._overlay?.setStatus('Finishing…');
        this._overlay?.setCountdown('');
        this._session.finalize();
    }

    _cancel() {
        this._clearCountdown();
        this._session?.abort();
        this._session = null;
        this._overlay?.close();
        this._overlay = null;
        this._recording = false;
    }

    _onComplete(finalText) {
        this._clearCountdown();
        this._overlay?.close();
        this._overlay = null;

        const session = this._session;
        if (!session)
            return;
        // Let focus return to the target field after the modal closes, then type.
        this._commitDelayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._commitDelayId = 0;
            session.commit(finalText, () => this._finishSession());
            return GLib.SOURCE_REMOVE;
        });
    }

    _onError(msg) {
        this._clearCountdown();
        this._overlay?.close();
        this._overlay = null;
        this._session?.abort();
        this._session = null;
        this._recording = false;
        Main.notify('Murmur', `Error: ${msg}`);
    }

    _finishSession() {
        this._session = null;
        this._recording = false;
    }
}
