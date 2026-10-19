import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {fromAsync} from '../async.js';
import {errorMessage} from '../errors.js';
import {BUS_NAME, INTERFACE, OBJECT_PATH} from '../murmur-bus.js';
import {recordingFolder, recordingOf} from '../recording-files.js';
import {Key, readProvider, readProviderConfig} from '../settings.js';
import {PROVIDER_IDS, PROVIDERS, type ProviderId} from '../transcription/provider.js';

const UNREACHABLE = [
    Gio.DBusError.NAME_HAS_NO_OWNER,
    Gio.DBusError.SERVICE_UNKNOWN,
    Gio.DBusError.UNKNOWN_INTERFACE,
    Gio.DBusError.UNKNOWN_METHOD,
    Gio.DBusError.UNKNOWN_OBJECT,
];

export function makeTranscribeFileRow(
    window: Adw.PreferencesWindow, settings: Gio.Settings): Adw.ActionRow {
    const row = new Adw.ActionRow({title: _('Transcribe a file')});
    const services = new Gtk.DropDown({
        tooltip_text: _('The service that transcribes it'),
        valign: Gtk.Align.CENTER,
    });
    const choose = new Gtk.Button({
        has_frame: false,
        icon_name: 'document-open-symbolic',
        tooltip_text: _('Choose an audio file'),
        valign: Gtk.Align.CENTER,
    });
    row.add_suffix(services);
    row.add_suffix(choose);
    row.activatable_widget = choose;

    let keyed: ProviderId[] = [];
    const select = (id: ProviderId) => {
        const index = keyed.indexOf(id);
        if (index >= 0)
            services.selected = index;
    };
    const sync = () => {
        const current = keyedServices(settings);
        if (current.join() === keyed.join())
            return;
        const previous = keyed[services.selected];
        keyed = current;
        services.model = new Gtk.StringList({strings: keyed.map(id => PROVIDERS[id].label)});
        select(readProvider(settings));
        if (previous)
            select(previous);

        const ready = keyed.length > 0;
        services.visible = ready;
        choose.sensitive = ready;
        row.subtitle = ready
            ? _('Any audio, or a recording again. The transcript goes beside it.')
            : _('Add an API key above first');
    };
    sync();
    settings.connect('changed', sync);
    settings.connect(`changed::${Key.transcriptionProvider}`, () => select(readProvider(settings)));

    choose.connect('clicked', () => {
        const service = keyed[services.selected];
        if (service)
            void transcribe(window, settings, service);
    });
    return row;
}

function keyedServices(settings: Gio.Settings): ProviderId[] {
    return PROVIDER_IDS
        .filter(id => readProviderConfig(settings, id).apiKey)
        .sort((first, second) => PROVIDERS[first].label.localeCompare(PROVIDERS[second].label));
}

async function transcribe(
    window: Adw.PreferencesWindow, settings: Gio.Settings, service: ProviderId): Promise<void> {
    const audio = await chooseAudio(window, settings);
    if (!audio)
        return;
    const path = audio.get_path();
    if (!path) {
        toast(window, _('Only files on this computer can be transcribed'));
        return;
    }
    const {transcript} = recordingOf(audio);
    if (transcript.query_exists(null) && !await replaces(window, transcript, service))
        return;

    try {
        await fromAsync(
            callback => Gio.DBus.session.call(BUS_NAME, OBJECT_PATH, INTERFACE, 'Transcribe',
                new GLib.Variant('(ss)', [path, service]), null, Gio.DBusCallFlags.NONE, -1, null,
                callback),
            result => Gio.DBus.session.call_finish(result));
    } catch (error) {
        toast(window, refusal(error));
    }
}

async function chooseAudio(
    window: Adw.PreferencesWindow, settings: Gio.Settings): Promise<Gio.File | null> {
    const audio = new Gtk.FileFilter({name: _('Audio')});
    audio.add_mime_type('audio/*');
    const filters = new Gio.ListStore({item_type: Gtk.FileFilter.$gtype});
    filters.append(audio);
    const folder = recordingFolder(settings);
    const dialog = new Gtk.FileDialog({
        default_filter: audio,
        filters,
        initial_folder: folder.query_exists(null) ? folder : null,
        title: _('Transcribe a file'),
    });
    try {
        return await fromAsync(
            callback => dialog.open(window, null, callback),
            result => dialog.open_finish(result));
    } catch (error) {
        if (!(error instanceof GLib.Error && error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)))
            console.error(`murmur: transcribe a file: ${errorMessage(error)}`);
        return null;
    }
}

async function replaces(
    window: Adw.PreferencesWindow, transcript: Gio.File, service: ProviderId): Promise<boolean> {
    const dialog = new Adw.AlertDialog({
        body: _('%s transcribes the audio again. The transcript beside it is replaced once the new one is done.')
            .replace('%s', PROVIDERS[service].label),
        close_response: 'cancel',
        heading: _('Replace %s?').replace('%s', transcript.get_basename() ?? ''),
    });
    dialog.add_response('cancel', _('Cancel'));
    dialog.add_response('replace', _('Replace'));
    dialog.set_response_appearance('replace', Adw.ResponseAppearance.DESTRUCTIVE);
    const response = await fromAsync(
        callback => dialog.choose(window, null, callback),
        result => dialog.choose_finish(result));
    return response === 'replace';
}

function refusal(error: unknown): string {
    if (!(error instanceof GLib.Error))
        return errorMessage(error);
    if (UNREACHABLE.some(code => error.matches(Gio.DBusError, code)))
        return _('Murmur isn\'t running - turn it on in Extensions');
    Gio.DBusError.strip_remote_error(error);
    return error.message;
}

function toast(window: Adw.PreferencesWindow, title: string): void {
    window.add_toast(new Adw.Toast({title, use_markup: false}));
}
