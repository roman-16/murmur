import Adw from 'gi://Adw';
import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Soup from 'gi://Soup?version=3.0';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {fromAsync} from '../async.js';
import {errorMessage} from '../errors.js';
import {Key} from '../settings.js';

const MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=transcription';
const TIMEOUT_SECONDS = 10;

type Model = {id: string; name: string};

// Which models transcribe is OpenRouter's to know and changes without Murmur,
// so the list is asked for rather than kept here. The setting is the slug
// either way, which leaves a model this list has never heard of reachable
// through gsettings.
export function makeModelRow(settings: Gio.Settings): Adw.ComboRow {
    const row = new Adw.ComboRow({
        subtitle: _('Every model OpenRouter transcribes with'),
        title: _('Model'),
    });

    let ids: string[] = [];
    let offered: Model[] = [];
    let syncing = false;

    const show = () => {
        const saved = settings.get_string(Key.openrouterModel);
        const listed = offered.some(model => model.id === saved)
            ? offered
            : [{id: saved, name: saved}, ...offered];

        syncing = true;
        ids = listed.map(model => model.id);
        row.model = new Gtk.StringList({strings: listed.map(model => model.name)});
        row.selected = Math.max(0, ids.indexOf(saved));
        syncing = false;
    };
    show();

    row.connect('notify::selected', () => {
        const id = ids[row.selected];
        if (!syncing && id)
            settings.set_string(Key.openrouterModel, id);
    });
    settings.connect(`changed::${Key.openrouterModel}`, show);

    fetchModels()
        .then(models => {
            offered = models;
            show();
        })
        .catch(error => {
            console.debug(`murmur: openrouter models: ${errorMessage(error)}`);
            row.subtitle =
                _('openrouter.ai could not be reached, so only the model already set is listed');
        });

    return row;
}

async function fetchModels(): Promise<Model[]> {
    const http = new Soup.Session({timeout: TIMEOUT_SECONDS});
    const message = Soup.Message.new('GET', MODELS_URL);
    const reply = await fromAsync(
        callback => http.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, callback),
        result => http.send_and_read_finish(result));

    const status = message.status_code;
    if (status !== Soup.Status.OK)
        throw new Error(`openrouter.ai answered ${status}`);

    const data = reply.get_data();
    if (!data)
        throw new Error('openrouter.ai answered nothing');

    const answer = JSON.parse(new TextDecoder().decode(data)) as
        {data?: {id?: string; name?: string}[]};
    return (answer.data ?? [])
        .flatMap(model => typeof model.id === 'string'
            ? [{id: model.id, name: model.name ?? model.id}]
            : [])
        .sort((one, other) => one.name.localeCompare(other.name));
}
