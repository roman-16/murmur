import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import type Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {Key, readAccelerator} from '../settings.js';

const MODIFIER_KEYVALS = [
    Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
    Gdk.KEY_Control_L, Gdk.KEY_Control_R,
    Gdk.KEY_Hyper_L, Gdk.KEY_Hyper_R,
    Gdk.KEY_ISO_Level3_Shift,
    Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
    Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
    Gdk.KEY_Super_L, Gdk.KEY_Super_R,
];

export function makeShortcutRow(
    window: Adw.PreferencesWindow, settings: Gio.Settings): Adw.ActionRow {
    const row = new Adw.ActionRow({
        title: _('Recording shortcut'),
        subtitle: _('Opens the recording panel, then stops and inserts the transcription'),
    });

    const label = new Gtk.ShortcutLabel({
        valign: Gtk.Align.CENTER,
        disabled_text: _('Disabled'),
    });
    const sync = () => label.set_accelerator(readAccelerator(settings));
    sync();

    const button = new Gtk.Button({valign: Gtk.Align.CENTER, has_frame: false, child: label});
    button.connect('clicked', () => captureShortcut(window, settings, sync));

    row.add_suffix(button);
    row.activatable_widget = button;
    return row;
}

function captureShortcut(
    window: Adw.PreferencesWindow, settings: Gio.Settings, onDone: () => void): void {
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
    box.append(new Gtk.Label({
        label: _('Press the new shortcut, Backspace to clear, or Esc to cancel'),
    }));
    dialog.set_content(box);

    const controller = new Gtk.EventControllerKey();
    controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
        const mask = state & Gtk.accelerator_get_default_mod_mask() & ~Gdk.ModifierType.LOCK_MASK;

        if (keyval === Gdk.KEY_Escape && mask === 0) {
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        if (MODIFIER_KEYVALS.includes(keyval))
            return Gdk.EVENT_STOP;

        if (mask === 0 && (keyval === Gdk.KEY_BackSpace || keyval === Gdk.KEY_Delete)) {
            settings.set_strv(Key.toggleRecording, []);
            onDone();
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        if (!Gtk.accelerator_valid(keyval, mask))
            return Gdk.EVENT_STOP;

        settings.set_strv(Key.toggleRecording, [Gtk.accelerator_name(keyval, mask)]);
        onDone();
        dialog.close();
        return Gdk.EVENT_STOP;
    });
    dialog.add_controller(controller);
    dialog.present();
}
