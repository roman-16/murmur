import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {errorMessage} from '../errors.js';
import type {Dictation, History} from '../history.js';
import {placeOf} from '../recording-files.js';
import {Key} from '../settings.js';
import {makeSpinRow} from './rows.js';

const BATCH = 128;
const ENTRY_LINES = 3;
// A write arrives as several events, so the list is rebuilt once they settle.
const SETTLE_MS = 200;

export function makeHistoryPage(
    window: Adw.PreferencesWindow, settings: Gio.Settings, history: History): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
        icon_name: 'document-open-recent-symbolic',
        name: 'history',
        title: _('History'),
    });
    const list = new DictationList(window, settings, history);

    const keeping = new Adw.PreferencesGroup();
    const remember = new Adw.SwitchRow({
        title: _('Remember what I dictate'),
        subtitle: _('In plain text, in %s. A field the application reports as a password is never kept')
            .replace('%s', placeOf(Gio.File.new_for_path(history.path))),
    });
    settings.bind(Key.rememberDictations, remember, 'active', Gio.SettingsBindFlags.DEFAULT);
    keeping.add(remember);
    const kept = makeSpinRow(settings, Key.keptDictations, {step: 1, title: _('Dictations kept')});
    remember.bind_property('active', kept, 'sensitive', GObject.BindingFlags.SYNC_CREATE);
    keeping.add(kept);
    keeping.add(list.clearRow);
    page.add(keeping);

    const searching = new Adw.PreferencesGroup();
    const search = new Gtk.SearchEntry({placeholder_text: _('Search dictations')});
    search.connect('search-changed', () => list.search(search.text));
    searching.add(search);
    page.add(searching);

    const listed = new Adw.PreferencesGroup();
    listed.add(list.box);
    page.add(listed);

    settings.connect(`changed::${Key.keptDictations}`, () => list.show());
    settings.connect(`changed::${Key.rememberDictations}`, () => list.show());
    void list.reload();
    watch(page, history, () => list.reload());
    return page;
}

class DictationList {
    readonly box = new Gtk.ListBox({css_classes: ['boxed-list'], selection_mode: Gtk.SelectionMode.NONE});
    readonly clearRow = new Adw.ButtonRow({title: _('Clear history…')});

    readonly #history: History;
    readonly #settings: Gio.Settings;
    readonly #window: Adw.PreferencesWindow;

    #entries: Dictation[] = [];
    #generation = 0;
    #matching: Dictation[] = [];
    #more: Adw.ButtonRow | null = null;
    #query = '';
    #shown = 0;

    constructor(window: Adw.PreferencesWindow, settings: Gio.Settings, history: History) {
        this.#history = history;
        this.#settings = settings;
        this.#window = window;
        this.clearRow.connect('activated', () => this.#confirmClear());
    }

    async reload(): Promise<void> {
        const current = ++this.#generation;
        const entries = await this.#history.newestFirst();
        if (current !== this.#generation)
            return;
        this.#entries = entries;
        this.show();
    }

    search(query: string): void {
        this.#query = query;
        this.#shown = 0;
        this.show();
    }

    show(): void {
        const query = this.#query.toLocaleLowerCase();
        const kept = this.#entries.slice(0, this.#settings.get_int(Key.keptDictations));
        this.#matching = query ? kept.filter(entry => entry.text.toLocaleLowerCase().includes(query)) : kept;
        this.clearRow.sensitive = this.#entries.length > 0;

        const count = Math.max(this.#shown, BATCH);
        this.box.remove_all();
        this.#more = null;
        this.#shown = 0;
        if (this.#matching.length === 0) {
            this.box.append(this.#emptyRow());
            return;
        }
        this.#showUpTo(count);
    }

    #showUpTo(count: number): void {
        if (this.#more) {
            this.box.remove(this.#more);
            this.#more = null;
        }
        for (const entry of this.#matching.slice(this.#shown, count))
            this.box.append(this.#row(entry));
        this.#shown = Math.min(count, this.#matching.length);
        if (this.#shown >= this.#matching.length)
            return;

        const more = new Adw.ButtonRow({title: _('Show older dictations')});
        more.connect('activated', () => this.#showUpTo(this.#shown + BATCH));
        this.box.append(more);
        this.#more = more;
    }

    #row(entry: Dictation): Adw.ActionRow {
        const row = new Adw.ActionRow({
            activatable: true,
            subtitle: when(entry.at),
            title: entry.text,
            title_lines: ENTRY_LINES,
            // A transcription is text, not markup: "R&D" is two words and an
            // ampersand, and a row that parses it would drop half the sentence.
            use_markup: false,
        });
        row.add_suffix(new Gtk.Image({
            icon_name: 'edit-copy-symbolic',
            valign: Gtk.Align.CENTER,
        }));
        const remove = new Gtk.Button({
            has_frame: false,
            icon_name: 'user-trash-symbolic',
            tooltip_text: _('Delete'),
            valign: Gtk.Align.CENTER,
        });
        remove.connect('clicked', () => void this.#forget(entry, row));
        row.add_suffix(remove);
        row.connect('activated', () => copy(this.#window, entry.text));
        return row;
    }

    #emptyRow(): Adw.ActionRow {
        if (this.#query)
            return new Adw.ActionRow({title: _('No dictations match')});
        return new Adw.ActionRow({
            subtitle_lines: 0,
            title: this.#settings.get_boolean(Key.rememberDictations)
                ? _('Nothing yet. What you dictate from now on shows up here.')
                : _('Nothing is being kept. Turn the switch above on to start.'),
            use_markup: false,
        });
    }

    async #forget(entry: Dictation, row: Adw.ActionRow): Promise<void> {
        this.#entries = this.#entries.filter(other => other !== entry);
        this.#matching = this.#matching.filter(other => other !== entry);
        this.#shown--;
        this.box.remove(row);
        if (this.#matching.length === 0)
            this.show();

        try {
            await this.#history.forget(entry);
        } catch (error) {
            toast(this.#window, errorMessage(error));
            void this.reload();
            return;
        }
        const deleted = new Adw.Toast({button_label: _('Undo'), title: _('Dictation deleted')});
        deleted.connect('button-clicked', () => {
            this.#history.restore(entry).catch(error => toast(this.#window, errorMessage(error)));
        });
        this.#window.add_toast(deleted);
    }

    #confirmClear(): void {
        const dialog = new Adw.AlertDialog({
            body: _('The file is removed. This cannot be undone.'),
            heading: _('Delete all %d dictations?').replace('%d', String(this.#entries.length)),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('delete', _('Delete'));
        dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_dialog: Adw.AlertDialog, response: string) => {
            if (response !== 'delete')
                return;
            void this.#history.clear()
                .catch(error => console.error(`murmur: history: ${errorMessage(error)}`))
                .then(() => this.reload());
        });
        dialog.present(this.#window);
    }
}

// Typing it back is not on offer: this window holds the keyboard, so the
// keystrokes would land in it rather than in the field the words belong in.
function copy(window: Adw.PreferencesWindow, text: string): void {
    const value = new GObject.Value();
    value.init(GObject.TYPE_STRING);
    value.set_string(text);

    const clipboard = Gdk.Display.get_default()?.get_clipboard();
    if (!clipboard)
        return;
    clipboard.set_content(Gdk.ContentProvider.new_for_value(value));
    toast(window, _('Copied to the clipboard'));
}

function toast(window: Adw.PreferencesWindow, title: string): void {
    window.add_toast(new Adw.Toast({title, use_markup: false}));
}

function watch(page: Adw.PreferencesPage, history: History, reload: () => Promise<void>): void {
    const monitor = history.monitor();
    let settleId = 0;

    const clearSettle = () => {
        if (!settleId)
            return;
        GLib.source_remove(settleId);
        settleId = 0;
    };

    monitor.connect('changed', () => {
        clearSettle();
        settleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
            settleId = 0;
            void reload();
            return GLib.SOURCE_REMOVE;
        });
    });

    page.connect('destroy', () => {
        clearSettle();
        monitor.cancel();
    });
}

function when(at: string): string {
    const spoken: GLib.DateTime | null = GLib.DateTime.new_from_iso8601(at, null);
    const local = spoken?.to_local();
    if (!local)
        return '';

    const now = GLib.DateTime.new_now_local();
    const time = local.format('%H:%M') ?? '';
    if (sameDay(local, now))
        return _('Today %s').replace('%s', time);

    const yesterday = now.add_days(-1);
    if (yesterday && sameDay(local, yesterday))
        return _('Yesterday %s').replace('%s', time);
    return local.format('%d.%m.%Y %H:%M') ?? '';
}

function sameDay(one: GLib.DateTime, other: GLib.DateTime): boolean {
    return one.get_year() === other.get_year() &&
        one.get_day_of_year() === other.get_day_of_year();
}
