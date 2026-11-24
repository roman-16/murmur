import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {fromAsync, whenCancelled} from '../async.js';
import {errorMessage, isCancelled} from '../errors.js';
import {exists} from '../files.js';
import {Key, readModelSettings, readTerms, writeModelSetting} from '../settings.js';
import type {Engine, EngineState} from '../transcription/engine.js';
import type {
    ModelDescription,
    ModelSetting,
    ModelSettings,
    SettingDescription,
    SettingKind
} from '../transcription/engine-protocol.js';
import {PROVIDERS} from '../transcription/provider.js';
import {showWhileSelected} from './rows.js';

const SPIN_SETTLE_MS = 500;
const SPIN_BOUND = 2 ** 31;

const VARIANT_TYPES: Record<SettingKind, string> = {
    choice: 's',
    integer: 'x',
    number: 'd',
    switch: 'b',
    text: 's',
};

type Apply = (value: ModelSetting | null) => Promise<string | null>;

type Setting = {
    apply: Apply;
    description: SettingDescription;
    saved: ModelSetting | undefined;
    toast: (title: string) => void;
};

export function makeLocalGroup(
    window: Adw.PreferencesWindow, settings: Gio.Settings, engine: Engine): Adw.PreferencesGroup {
    return new LocalGroup(window, settings, engine).group;
}

class LocalGroup {
    readonly group: Adw.PreferencesGroup;

    readonly #choose: Gtk.Button;
    readonly #closing = new Gio.Cancellable();
    readonly #engine: Engine;
    readonly #engineButton: Gtk.Button;
    readonly #engineRow: Adw.ActionRow;
    readonly #modelRow: Adw.ActionRow;
    readonly #settings: Gio.Settings;
    readonly #window: Adw.PreferencesWindow;

    #described: {description: ModelDescription; path: string} | null = null;
    #download: Gio.Cancellable | null = null;
    #engineGeneration = 0;
    #modelGeneration = 0;
    #ready = false;
    #rows: Adw.PreferencesRow[] = [];

    constructor(window: Adw.PreferencesWindow, settings: Gio.Settings, engine: Engine) {
        this.#engine = engine;
        this.#settings = settings;
        this.#window = window;

        this.group = new Adw.PreferencesGroup({title: PROVIDERS.local.label});
        this.#engineRow = new Adw.ActionRow({subtitle_lines: 0, title: _('Engine')});
        this.#engineButton = new Gtk.Button({valign: Gtk.Align.CENTER, visible: false});
        this.#engineRow.add_suffix(this.#engineButton);
        this.#modelRow = new Adw.ActionRow({subtitle_lines: 0, title: _('Model')});
        this.#choose = new Gtk.Button({
            has_frame: false,
            icon_name: 'document-open-symbolic',
            valign: Gtk.Align.CENTER,
        });
        this.#modelRow.add_suffix(this.#choose);
        this.#modelRow.activatable_widget = this.#choose;
        this.group.add(this.#engineRow);
        this.group.add(this.#modelRow);

        this.#engineButton.connect('clicked', () => {
            if (this.#download)
                this.#download.cancel();
            else
                void this.#install();
        });
        this.#choose.connect('clicked', () => void this.#chooseModel());
        settings.connect(`changed::${Key.localModel}`, () => void this.#showModel());
        window.connect('close-request', () => {
            this.#closing.cancel();
            return false;
        });
        this.group.connect('destroy', () => this.#closing.cancel());
        showWhileSelected(this.group, settings, 'local', () => void this.#showEngine(null));
    }

    async #showEngine(failure: string | null): Promise<void> {
        const generation = ++this.#engineGeneration;
        this.#ready = false;
        this.#engineButton.visible = false;
        this.#engineRow.subtitle = _('Checking…');
        try {
            const state = await this.#engine.state();
            if (generation !== this.#engineGeneration)
                return;
            if (state.kind === 'ready') {
                const {device, version} = await this.#engine.status(this.#closing);
                if (generation !== this.#engineGeneration)
                    return;
                const where = device ? _('on the %s').replace('%s', device) : _('on the processor');
                this.#engineRow.subtitle = (state.packaged
                    ? _('transcribe.cpp %s from the Nix package, %s')
                    : _('transcribe.cpp %s, %s'))
                    .replace('%s', version)
                    .replace('%s', where);
                this.#ready = true;
            } else {
                await this.#offer(state, failure, generation);
            }
        } catch (error) {
            if (isCancelled(error) || generation !== this.#engineGeneration)
                return;
            this.#engineRow.subtitle = errorMessage(error);
        }
        void this.#showModel();
    }

    async #offer(state: Exclude<EngineState, {kind: 'ready'}>, failure: string | null,
        generation: number): Promise<void> {
        if (state.kind === 'no-python') {
            this.#engineRow.subtitle = _('Needs Python 3.9 or later, which isn\'t installed');
            return;
        }
        const [plan, version] = await Promise.all(
            [this.#engine.plan(this.#closing), this.#engine.version()]);
        if (generation !== this.#engineGeneration)
            return;
        const size = GLib.format_size(plan.bytes);
        this.#engineRow.subtitle = failure ?? (state.kind === 'outdated'
            ? _('transcribe.cpp %s replaces the one installed, %s')
            : _('transcribe.cpp %s and two helper models, %s'))
            .replace('%s', version)
            .replace('%s', size);
        this.#engineButton.label = _('Download');
        this.#engineButton.visible = true;
    }

    async #install(): Promise<void> {
        const download = new Gio.Cancellable();
        const release = whenCancelled(this.#closing, () => download.cancel());
        this.#download = download;
        this.#engineGeneration++;
        this.#engineButton.label = _('Cancel');
        this.#engineRow.subtitle = _('Downloading…');
        let failure: string | null = null;
        try {
            await this.#engine.install(({done, total}) => {
                this.#engineRow.subtitle = _('Downloading… %s of %s')
                    .replace('%s', GLib.format_size(done))
                    .replace('%s', GLib.format_size(total));
            }, download);
        } catch (error) {
            if (!isCancelled(error))
                failure = errorMessage(error);
        } finally {
            release();
            this.#download = null;
        }
        if (!this.#closing.is_cancelled())
            await this.#showEngine(failure);
    }

    async #showModel(): Promise<void> {
        const generation = ++this.#modelGeneration;
        this.#clearRows();
        this.#choose.sensitive = this.#ready;
        this.#choose.tooltip_text = this.#ready
            ? _('Choose a model file')
            : _('Needs the engine');
        const path = this.#settings.get_string(Key.localModel);
        if (!path) {
            this.#modelRow.subtitle =
                _('Choose a speech model in GGUF format, from huggingface.co/handy-computer for instance');
            return;
        }
        const name = GLib.path_get_basename(path);
        if (!await exists(Gio.File.new_for_path(path))) {
            if (generation === this.#modelGeneration)
                this.#modelRow.subtitle = _('%s is gone').replace('%s', path);
            return;
        }
        if (generation !== this.#modelGeneration)
            return;
        if (!this.#ready) {
            this.#modelRow.subtitle = name;
            return;
        }

        this.#modelRow.subtitle = `${name}\n${_('Checking…')}`;
        const described = this.#described;
        this.#described = null;
        let description: ModelDescription;
        try {
            description = described?.path === path
                ? described.description
                : await this.#engine.describe(this.#request(path, this.#saved(path)), this.#closing);
        } catch (error) {
            if (!isCancelled(error) && generation === this.#modelGeneration)
                this.#modelRow.subtitle = `${name}\n${errorMessage(error)}`;
            return;
        }
        if (generation !== this.#modelGeneration)
            return;
        this.#modelRow.subtitle = [name, summaryOf(description), description.problem]
            .filter(line => line)
            .join('\n');
        this.#addRows(path, description);
    }

    async #chooseModel(): Promise<void> {
        const filter = new Gtk.FileFilter({name: _('Speech models')});
        filter.add_suffix('gguf');
        const filters = new Gio.ListStore({item_type: Gtk.FileFilter.$gtype});
        filters.append(filter);
        const current = this.#settings.get_string(Key.localModel);
        const folder = current ? Gio.File.new_for_path(current).get_parent() : null;
        const dialog = new Gtk.FileDialog({
            default_filter: filter,
            filters,
            initial_folder: folder?.query_exists(null) ? folder : null,
            title: _('Choose a model file'),
        });
        let file: Gio.File | null;
        try {
            file = await fromAsync(
                callback => dialog.open(this.#window, null, callback),
                result => dialog.open_finish(result));
        } catch (error) {
            if (!(error instanceof GLib.Error && error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)))
                console.error(`murmur: choose a model: ${errorMessage(error)}`);
            return;
        }
        const path = file?.get_path();
        if (!path) {
            this.#toast(_('Only a file on this computer can be the model'));
            return;
        }

        this.#modelGeneration++;
        this.#clearRows();
        this.#choose.sensitive = false;
        this.#modelRow.subtitle = `${GLib.path_get_basename(path)}\n${_('Checking…')}`;
        try {
            const description =
                await this.#engine.describe(this.#request(path, this.#saved(path)), this.#closing);
            this.#described = {description, path};
            if (path === current)
                void this.#showModel();
            else
                this.#settings.set_string(Key.localModel, path);
        } catch (error) {
            if (isCancelled(error))
                return;
            this.#toast(errorMessage(error));
            void this.#showModel();
        }
    }

    #addRows(path: string, description: ModelDescription): void {
        const saved = this.#saved(path);
        const setting = (described: SettingDescription): Setting => ({
            apply: value => this.#apply(path, described, value),
            description: described,
            saved: saved[described.name],
            toast: title => this.#toast(title),
        });

        const own = description.settings.filter(described => described.name.includes('.'));
        const shared = description.settings.filter(described => !described.name.includes('.'));
        const rows = new Map(shared.map(described => [described.name, rowOf(setting(described))]));
        for (const row of rows.values())
            this.#addRow(row);

        const live = rows.get('live');
        const settle = rows.get('settle');
        if (live instanceof Adw.SwitchRow && settle) {
            const sync = () => {
                settle.visible = live.active;
            };
            sync();
            live.connect('notify::active', sync);
        }

        if (own.length === 0)
            return;
        const expander = new Adw.ExpanderRow({title: _('Model settings')});
        for (const described of own)
            expander.add_row(rowOf(setting(described)));
        this.#addRow(expander);
    }

    #addRow(row: Adw.PreferencesRow): void {
        this.group.add(row);
        this.#rows.push(row);
    }

    #clearRows(): void {
        for (const row of this.#rows)
            this.group.remove(row);
        this.#rows = [];
    }

    async #apply(
        path: string, described: SettingDescription, value: ModelSetting | null): Promise<string | null> {
        const candidate = {...this.#saved(path)};
        if (value === null)
            delete candidate[described.name];
        else
            candidate[described.name] = value;
        try {
            await this.#engine.probe(this.#request(path, candidate), this.#closing);
        } catch (error) {
            return isCancelled(error) ? null : errorMessage(error);
        }
        writeModelSetting(this.#settings, path, described.name,
            value === null ? null : new GLib.Variant(VARIANT_TYPES[described.kind], value));
        return null;
    }

    #saved(path: string): ModelSettings {
        return readModelSettings(this.#settings, path);
    }

    #request(path: string, settings: ModelSettings) {
        return {model: path, settings, terms: readTerms(this.#settings)};
    }

    #toast(title: string): void {
        this.#window.add_toast(new Adw.Toast({title, use_markup: false}));
    }
}

function summaryOf(description: ModelDescription): string {
    const {languages} = description;
    return [
        languages.length === 1 ? languageName(languages[0] ?? '') : null,
        languages.length > 1 ? _('%d languages').replace('%d', String(languages.length)) : null,
        description.streams ? _('Streams') : null,
        description.terms ? null : _('Ignores names and terms'),
    ].filter(part => part).join('. ');
}

function languageName(code: string): string {
    try {
        return new Intl.DisplayNames([], {type: 'language'}).of(code) ?? code;
    } catch {
        return code;
    }
}

function titleOf(name: string): string {
    switch (name) {
        case 'itn':
            return _('Numbers as digits');
        case 'language':
            return _('Language');
        case 'live':
            return _('Words as you speak');
        case 'pnc':
            return _('Punctuation');
        case 'settle':
            return _('Wait for settled words');
    }
    const field = (name.split('.').at(-1) ?? name).replaceAll('_', ' ');
    return field.charAt(0).toUpperCase() + field.slice(1);
}

function subtitleOf(setting: Setting): string {
    const {description, saved} = setting;
    const own = description.name.includes('.');
    return [
        description.name === 'settle' ? _('Holds words back until the model stops revising them') : null,
        own && saved === undefined ? _('Automatic') : null,
        own && description.live ? _('Only while words appear as you speak') : null,
    ].filter(line => line).join('\n');
}

function rowOf(setting: Setting): Adw.PreferencesRow {
    switch (setting.description.kind) {
        case 'choice':
            return choiceRow(setting);
        case 'integer':
        case 'number':
            return spinRow(setting);
        case 'switch':
            return switchRow(setting);
        case 'text':
            return textRow(setting);
    }
}

function choiceRow(setting: Setting): Adw.ComboRow {
    const {description} = setting;
    const choices = [
        {label: _('Automatic'), value: ''},
        ...description.choices
            .map(choice => ({label: choiceLabel(description.name, choice), value: choice}))
            .sort((first, second) => first.label.localeCompare(second.label)),
    ];
    const row = new Adw.ComboRow({
        model: new Gtk.StringList({strings: choices.map(choice => choice.label)}),
        subtitle: subtitleOf(setting),
        title: titleOf(description.name),
    });
    const indexOf = (value: ModelSetting | undefined) =>
        Math.max(0, choices.findIndex(choice => choice.value === (value ?? '')));
    let saved = setting.saved;
    let syncing = true;
    row.selected = indexOf(saved);
    syncing = false;
    row.connect('notify::selected', async () => {
        if (syncing)
            return;
        const value = choices[row.selected]?.value ?? '';
        const refusal = await setting.apply(value === '' ? null : value);
        if (refusal) {
            syncing = true;
            row.selected = indexOf(saved);
            syncing = false;
            row.subtitle = refusal;
            return;
        }
        saved = value === '' ? undefined : value;
        row.subtitle = subtitleOf({...setting, saved});
    });
    return row;
}

function choiceLabel(name: string, choice: string): string {
    if (name === 'language')
        return languageName(choice);
    if (choice === 'on')
        return _('On');
    if (choice === 'off')
        return _('Off');
    return choice;
}

function switchRow(setting: Setting): Adw.SwitchRow {
    const {description} = setting;
    const fallback = description.default === true;
    const row = new Adw.SwitchRow({
        active: typeof setting.saved === 'boolean' ? setting.saved : fallback,
        subtitle: subtitleOf(setting),
        title: titleOf(description.name),
    });
    let saved = setting.saved;
    let syncing = false;
    row.connect('notify::active', async () => {
        if (syncing)
            return;
        const value = row.active === fallback ? null : row.active;
        const refusal = await setting.apply(value);
        if (refusal) {
            syncing = true;
            row.active = typeof saved === 'boolean' ? saved : fallback;
            syncing = false;
            row.subtitle = refusal;
            return;
        }
        saved = value ?? undefined;
        row.subtitle = subtitleOf({...setting, saved});
    });
    return row;
}

function spinRow(setting: Setting): Adw.SpinRow {
    const {description} = setting;
    const fallback = typeof description.default === 'number' ? description.default : 0;
    const whole = description.kind === 'integer';
    const row = new Adw.SpinRow({
        adjustment: new Gtk.Adjustment({
            lower: -SPIN_BOUND,
            page_increment: whole ? 10 : 1,
            step_increment: whole ? 1 : 0.1,
            upper: SPIN_BOUND - 1,
        }),
        digits: whole ? 0 : 2,
        subtitle: subtitleOf(setting),
        title: titleOf(description.name),
    });
    const reset = new Gtk.Button({
        has_frame: false,
        icon_name: 'edit-undo-symbolic',
        tooltip_text: _('Reset to automatic'),
        valign: Gtk.Align.CENTER,
    });
    row.add_suffix(reset);

    let saved = setting.saved;
    let syncing = false;
    let settleId = 0;
    const show = (value: number) => {
        syncing = true;
        row.value = value;
        syncing = false;
        reset.visible = saved !== undefined;
    };
    show(typeof saved === 'number' ? saved : fallback);

    const apply = async (value: number | null) => {
        row.subtitle = _('Checking…');
        const refusal = await setting.apply(value);
        if (refusal) {
            show(typeof saved === 'number' ? saved : fallback);
            row.subtitle = refusal;
            return;
        }
        saved = value ?? undefined;
        show(value ?? fallback);
        row.subtitle = subtitleOf({...setting, saved});
    };
    const clearSettle = () => {
        if (!settleId)
            return;
        GLib.source_remove(settleId);
        settleId = 0;
    };

    row.connect('notify::value', () => {
        if (syncing)
            return;
        clearSettle();
        settleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SPIN_SETTLE_MS, () => {
            settleId = 0;
            void apply(row.value);
            return GLib.SOURCE_REMOVE;
        });
    });
    reset.connect('clicked', () => {
        clearSettle();
        void apply(null);
    });
    row.connect('destroy', clearSettle);
    return row;
}

function textRow(setting: Setting): Adw.EntryRow {
    const {description} = setting;
    const fallback = typeof description.default === 'string' ? description.default : '';
    const row = new Adw.EntryRow({
        show_apply_button: true,
        text: typeof setting.saved === 'string' ? setting.saved : fallback,
        title: titleOf(description.name),
        tooltip_text: subtitleOf(setting),
    });
    let saved = setting.saved;
    row.connect('apply', async () => {
        const value = row.text === fallback ? null : row.text;
        const refusal = await setting.apply(value);
        if (refusal) {
            row.text = typeof saved === 'string' ? saved : fallback;
            setting.toast(refusal);
            return;
        }
        saved = value ?? undefined;
        row.tooltip_text = subtitleOf({...setting, saved});
    });
    return row;
}
