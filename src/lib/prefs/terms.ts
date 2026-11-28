import Adw from 'gi://Adw';
import type Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _, ngettext} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {Key, readTerms, termsOf} from '../settings.js';

const PREVIEW = 3;

export function makeTermsRow(window: Adw.PreferencesWindow, settings: Gio.Settings): Adw.ActionRow {
    const row = new Adw.ActionRow({activatable: true, title: _('Names and terms')});
    row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic', valign: Gtk.Align.CENTER}));
    const sync = () => {
        row.subtitle = previewOf(readTerms(settings));
    };
    sync();
    settings.connect(`changed::${Key.namesAndTerms}`, sync);
    row.connect('activated', () => window.push_subpage(termsPage(window, settings)));
    return row;
}

function previewOf(terms: string[]): string {
    if (terms.length === 0)
        return _('Words a transcript should spell your way');
    const shown = terms.slice(0, PREVIEW).join(', ');
    if (terms.length <= PREVIEW)
        return shown;
    return _('%s and %d more').replace('%s', shown).replace('%d', String(terms.length - PREVIEW));
}

function termsPage(window: Adw.PreferencesWindow, settings: Gio.Settings): Adw.NavigationPage {
    const page = new Adw.PreferencesPage({
        description: _('Spelled the way a transcript should spell them. Every dictation, recording and file takes them along'),
    });

    const adding = new Adw.PreferencesGroup();
    const entry = new Adw.EntryRow({show_apply_button: true, title: _('Add a name or term')});
    adding.add(entry);
    page.add(adding);

    const list = new Adw.PreferencesGroup();
    page.add(list);

    let rows: Adw.ActionRow[] = [];
    const rebuild = () => {
        for (const row of rows)
            list.remove(row);
        const terms = readTerms(settings);
        rows = terms.map(term => termRow(window, settings, term));
        for (const row of rows)
            list.add(row);
        list.title = terms.length === 0
            ? ''
            : ngettext('%d name or term', '%d names and terms', terms.length).replace('%d', String(terms.length));
    };
    rebuild();
    const changed = settings.connect(`changed::${Key.namesAndTerms}`, rebuild);
    page.connect('destroy', () => settings.disconnect(changed));

    const title = entry.title;
    entry.connect('changed', () => {
        entry.title = title;
        entry.remove_css_class('error');
    });
    entry.connect('apply', () => {
        const kept = readTerms(settings);
        const added = termsOf(entry.text).filter(term => !kept.includes(term));
        if (added.length === 0) {
            if (entry.text.trim()) {
                entry.title = _('Already in the list');
                entry.add_css_class('error');
            }
            return;
        }
        settings.set_strv(Key.namesAndTerms, [...kept, ...added]);
        entry.text = '';
        // Emptying the field counts as an edit, which would bring the apply
        // button back over nothing; turning it off and on forgets the edit.
        entry.show_apply_button = false;
        entry.show_apply_button = true;
    });

    const view = new Adw.ToolbarView({content: page});
    view.add_top_bar(new Adw.HeaderBar());
    return new Adw.NavigationPage({child: view, title: _('Names and terms')});
}

function termRow(window: Adw.PreferencesWindow, settings: Gio.Settings, term: string): Adw.ActionRow {
    const row = new Adw.ActionRow({title: term, use_markup: false});
    const remove = new Gtk.Button({
        has_frame: false,
        icon_name: 'list-remove-symbolic',
        tooltip_text: _('Remove'),
        valign: Gtk.Align.CENTER,
    });
    remove.connect('clicked', () => {
        const terms = readTerms(settings);
        const index = terms.indexOf(term);
        settings.set_strv(Key.namesAndTerms, terms.filter(other => other !== term));

        const removed = new Adw.Toast({
            button_label: _('Undo'),
            title: _('Removed %s').replace('%s', term),
            use_markup: false,
        });
        removed.connect('button-clicked', () => {
            const now = readTerms(settings);
            if (!now.includes(term))
                settings.set_strv(Key.namesAndTerms, now.toSpliced(Math.min(index, now.length), 0, term));
        });
        window.add_toast(removed);
    });
    row.add_suffix(remove);
    return row;
}
