import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {dotoolCandidates} from './lib/dotool.js';

const KEYBIND = 'toggle-recording';
const PROBE_TIMEOUT_MS = 1500;

const MODIFIER_KEYVALS = [
    Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
    Gdk.KEY_Control_L, Gdk.KEY_Control_R,
    Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
    Gdk.KEY_Super_L, Gdk.KEY_Super_R,
    Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
    Gdk.KEY_Hyper_L, Gdk.KEY_Hyper_R,
    Gdk.KEY_ISO_Level3_Shift,
];

const STATE_CLASSES = ['success', 'warning', 'error'];

export default class MurmurPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        page.add(this._makeStatusGroup());

        const group = new Adw.PreferencesGroup({title: _('Murmur')});
        page.add(group);

        const keyRow = new Adw.PasswordEntryRow({title: _('Mistral API key')});
        settings.bind('mistral-api-key', keyRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(keyRow);

        group.add(this._makeShortcutRow(window, settings));

        window.add(page);
    }

    _makeStatusGroup() {
        const group = new Adw.PreferencesGroup();

        this._statusIcon = new Gtk.Image({valign: Gtk.Align.CENTER});
        this._statusRow = new Adw.ActionRow({subtitle_lines: 0});
        this._statusRow.add_prefix(this._statusIcon);

        const recheck = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            valign: Gtk.Align.CENTER,
            has_frame: false,
            tooltip_text: _('Recheck'),
        });
        recheck.connect('clicked', () => this._refreshStatus());
        this._statusRow.add_suffix(recheck);

        group.add(this._statusRow);
        this._refreshStatus();
        return group;
    }

    _refreshStatus() {
        const seq = (this._probeSeq ?? 0) + 1;
        this._probeSeq = seq;
        this._setStatus('checking');

        const candidates = dotoolCandidates();
        if (candidates.length === 0) {
            this._setStatus('red', 'notinstalled');
            return;
        }
        this._probe(candidates, 0, ok => {
            if (this._probeSeq !== seq)
                return;
            if (ok)
                this._setStatus('green');
            else
                this._diagnose(diag => this._probeSeq === seq && this._setStatus(diag.state, diag.reason, diag.group));
        });
    }

    _probe(candidates, i, done) {
        if (i >= candidates.length) {
            done(false);
            return;
        }
        let proc;
        try {
            proc = Gio.Subprocess.new(
                [candidates[i].bin],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch {
            this._probe(candidates, i + 1, done);
            return;
        }
        let timedOut = false;
        const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PROBE_TIMEOUT_MS, () => {
            timedOut = true;
            try {
                proc.force_exit();
            } catch {}
            return GLib.SOURCE_REMOVE;
        });
        proc.communicate_utf8_async('', null, (p, res) => {
            GLib.source_remove(timer);
            let ok = false;
            try {
                p.communicate_utf8_finish(res);
                ok = !timedOut && p.get_successful();
            } catch {}
            if (ok)
                done(true);
            else
                this._probe(candidates, i + 1, done);
        });
    }

    // All dotool tiers failed. Distinguish "installed but the input group isn't
    // active in this session yet" (fixable by re-login) from genuine gaps.
    _diagnose(done) {
        if (!GLib.file_test('/dev/uinput', GLib.FileTest.EXISTS)) {
            done({state: 'red', reason: 'nouinput'});
            return;
        }

        let gid;
        try {
            gid = Gio.File.new_for_path('/dev/uinput')
                .query_info('unix::gid', Gio.FileQueryInfoFlags.NONE, null)
                .get_attribute_uint32('unix::gid');
        } catch {
            done({state: 'red', reason: 'generic'});
            return;
        }

        if (this._sessionGids().has(gid)) {
            done({state: 'red', reason: 'generic'});
            return;
        }

        const getent = GLib.find_program_in_path('getent');
        if (!getent) {
            done({state: 'red', reason: 'generic'});
            return;
        }
        let proc;
        try {
            proc = Gio.Subprocess.new(
                [getent, 'group', String(gid)],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch {
            done({state: 'red', reason: 'generic'});
            return;
        }
        proc.communicate_utf8_async(null, null, (p, res) => {
            let line = '';
            try {
                [, line] = p.communicate_utf8_finish(res);
            } catch {}
            const [name, , , membersField] = line.trim().split(':');
            const members = (membersField ?? '').split(',').filter(Boolean);
            const isMember = members.includes(GLib.get_user_name());
            if (isMember)
                done({state: 'orange', reason: 'relogin', group: name});
            else
                done({state: 'red', reason: 'notmember', group: name});
        });
    }

    _sessionGids() {
        const gids = new Set();
        try {
            const [ok, contents] = GLib.file_get_contents('/proc/self/status');
            if (ok) {
                for (const raw of new TextDecoder().decode(contents).split('\n')) {
                    const line = raw.trim();
                    if (line.startsWith('Groups:') || line.startsWith('Gid:')) {
                        for (const tok of line.split(/\s+/).slice(1))
                            gids.add(Number(tok));
                    }
                }
            }
        } catch {}
        return gids;
    }

    _setStatus(state, reason, group) {
        const grp = group ?? 'input';
        const fallback = _('Murmur is using the virtual keyboard, which types only characters from your current keyboard layout.');
        let icon, title, subtitle, cls;

        switch (state) {
        case 'checking':
            icon = 'content-loading-symbolic';
            title = _('Checking dotool…');
            subtitle = '';
            break;
        case 'green':
            icon = 'emblem-ok-symbolic';
            cls = 'success';
            title = _('dotool is active');
            subtitle = _('Dictation types via dotool: arbitrary Unicode into any app, including terminals.');
            break;
        case 'orange':
            icon = 'dialog-warning-symbolic';
            cls = 'warning';
            title = _('dotool needs a re-login');
            subtitle = `${_('You are in the “%s” group, but this session has not picked it up yet. Log out and back in (or reboot) to finish enabling dotool.').replace('%s', grp)} ${fallback}`;
            break;
        default:
            icon = 'dialog-error-symbolic';
            cls = 'error';
            title = _('dotool is not available');
            subtitle = `${this._redReason(reason, grp)} ${fallback}`;
            break;
        }

        this._statusIcon.icon_name = icon;
        for (const c of STATE_CLASSES)
            this._statusIcon.remove_css_class(c);
        if (cls)
            this._statusIcon.add_css_class(cls);
        this._statusRow.title = title;
        this._statusRow.subtitle = subtitle;
    }

    _redReason(reason, group) {
        switch (reason) {
        case 'notinstalled':
            return _('dotool is not installed. Install it for full-Unicode typing (see the README).');
        case 'nouinput':
            return _('The uinput device is unavailable (kernel module or udev rule missing; see the README).');
        case 'notmember':
            return _('You are not in the “%s” group that grants access to /dev/uinput (see the README).').replace('%s', group);
        default:
            return _('dotool is installed but could not be reached (see the README).');
        }
    }

    _makeShortcutRow(window, settings) {
        const row = new Adw.ActionRow({
            title: _('Recording shortcut'),
            subtitle: _('Opens the overlay, then stops and inserts the transcription'),
        });

        const label = new Gtk.ShortcutLabel({
            valign: Gtk.Align.CENTER,
            disabled_text: _('Disabled'),
        });
        const sync = () => label.set_accelerator(settings.get_strv(KEYBIND)[0] ?? '');
        sync();

        const button = new Gtk.Button({valign: Gtk.Align.CENTER, has_frame: false, child: label});
        button.connect('clicked', () => this._captureShortcut(window, settings, sync));

        row.add_suffix(button);
        row.activatable_widget = button;
        return row;
    }

    _captureShortcut(window, settings, onDone) {
        const dialog = new Adw.Window({
            modal: true,
            transient_for: window,
            hide_on_close: true,
            default_width: 400,
            default_height: 180,
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
            spacing: 12,
        });
        box.append(new Gtk.Label({label: _('Press the new shortcut, Backspace to clear, or Esc to cancel')}));
        dialog.set_content(box);

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_c, keyval, keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask() & ~Gdk.ModifierType.LOCK_MASK;

            if (keyval === Gdk.KEY_Escape && mask === 0) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (MODIFIER_KEYVALS.includes(keyval))
                return Gdk.EVENT_STOP;
            if (mask === 0 && (keyval === Gdk.KEY_BackSpace || keyval === Gdk.KEY_Delete)) {
                settings.set_strv(KEYBIND, []);
                onDone();
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (!Gtk.accelerator_valid(keyval, mask))
                return Gdk.EVENT_STOP;

            settings.set_strv(KEYBIND, [Gtk.accelerator_name(keyval, mask)]);
            onDone();
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.present();
    }
}
