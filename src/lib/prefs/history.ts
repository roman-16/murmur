import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import type {Dictation, History} from '../history.js';
import {Key} from '../settings.js';

const ENTRY_LINES = 3;
// A write arrives as several events, so the list is rebuilt once they settle.
const SETTLE_MS = 200;

export function makeHistoryPage(
    window: Adw.PreferencesWindow, settings: Gio.Settings, history: History): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
        icon_name: 'document-open-recent-symbolic',
        title: _('History'),
    });

    const group = new Adw.PreferencesGroup({
        description: _('Kept in %s').replace('%s', history.path),
        title: _('Dictation history'),
    });
    const remember = new Adw.SwitchRow({
        title: _('Remember what I dictate'),
        subtitle: _(
            'The text of every dictation is written to that file, in plain text. A field the application reports as a password is never kept'),
    });
    settings.bind(Key.rememberDictations, remember, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(remember);
    page.add(group);

    const list = new Adw.PreferencesGroup();
    page.add(list);

    const rows: Gtk.Widget[] = [];
    const rebuild = () => {
        for (const row of rows)
            list.remove(row);
        rows.length = 0;

        const entries = history.entries();
        if (entries.length === 0) {
            rows.push(add(list, emptyRow(settings)));
            return;
        }
        for (const entry of entries)
            rows.push(add(list, dictationRow(window, entry)));
        rows.push(add(list, clearRow(window, history, entries.length, rebuild)));
    };
    rebuild();

    watch(page, history, rebuild);
    return page;
}

function add<T extends Gtk.Widget>(group: Adw.PreferencesGroup, row: T): T {
    group.add(row);
    return row;
}

function dictationRow(window: Adw.PreferencesWindow, entry: Dictation): Adw.ActionRow {
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
    row.connect('activated', () => copy(window, entry.text));
    return row;
}

function emptyRow(settings: Gio.Settings): Adw.ActionRow {
    const kept = settings.get_boolean(Key.rememberDictations);
    return new Adw.ActionRow({
        subtitle_lines: 0,
        title: kept
            ? _('Nothing yet. What you dictate from now on shows up here.')
            : _('Nothing is being kept. Turn the switch above on to start.'),
        use_markup: false,
    });
}

function clearRow(
    window: Adw.PreferencesWindow, history: History, count: number,
    onCleared: () => void): Adw.ButtonRow {
    const row = new Adw.ButtonRow({title: _('Clear history')});
    row.add_css_class('destructive-action');
    row.connect('activated', () => {
        const dialog = new Adw.AlertDialog({
            body: _('The file is removed. This cannot be undone.'),
            heading: _('Delete all %d dictations?').replace('%d', String(count)),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('delete', _('Delete'));
        dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_dialog: Adw.AlertDialog, response: string) => {
            if (response !== 'delete')
                return;
            history.clear();
            onCleared();
        });
        dialog.present(window);
    });
    return row;
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
    window.add_toast(new Adw.Toast({title: _('Copied to the clipboard')}));
}

// A dictation while this window is open belongs in the list without reopening it.
function watch(page: Adw.PreferencesPage, history: History, rebuild: () => void): void {
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
            rebuild();
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
