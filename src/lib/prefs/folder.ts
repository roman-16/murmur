import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {fromAsync} from '../async.js';
import {errorMessage} from '../errors.js';
import {defaultRecordingFolder, recordingFolder, recordingPlace} from '../recording-files.js';
import {Key} from '../settings.js';

export function makeRecordingFolderRow(
    window: Adw.PreferencesWindow, settings: Gio.Settings): Adw.ActionRow {
    const row = new Adw.ActionRow({title: _('Recordings folder')});

    const reset = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        valign: Gtk.Align.CENTER,
        has_frame: false,
        tooltip_text: _('Back to %s').replace('%s', defaultRecordingFolder(settings)),
    });
    const choose = new Gtk.Button({
        icon_name: 'folder-open-symbolic',
        valign: Gtk.Align.CENTER,
        has_frame: false,
        tooltip_text: _('Choose a folder'),
    });
    row.add_suffix(reset);
    row.add_suffix(choose);
    row.activatable_widget = choose;

    const sync = () => {
        row.subtitle = recordingPlace(settings);
        reset.visible = settings.get_user_value(Key.recordingFolder) !== null;
    };
    sync();
    settings.connect(`changed::${Key.recordingFolder}`, sync);

    choose.connect('clicked', () => void chooseFolder(window, settings));
    reset.connect('clicked', () => settings.reset(Key.recordingFolder));
    return row;
}

async function chooseFolder(window: Adw.PreferencesWindow, settings: Gio.Settings): Promise<void> {
    const current = recordingFolder(settings);
    const dialog = new Gtk.FileDialog({
        title: _('Recordings folder'),
        initial_folder: current.query_exists(null) ? current : null,
    });
    try {
        const folder = await fromAsync(
            callback => dialog.select_folder(window, null, callback),
            result => dialog.select_folder_finish(result));
        const path = folder.get_path();
        if (path)
            settings.set_string(Key.recordingFolder, path);
    } catch (error) {
        if (error instanceof GLib.Error && error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED))
            return;
        console.error(`murmur: recordings folder: ${errorMessage(error)}`);
    }
}
