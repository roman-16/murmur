import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {
    ExtensionPreferences,
    gettext as _
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {makeDotoolStatusRow} from './lib/prefs/dotool-status.js';
import {makeComboRow, makeSpinRow} from './lib/prefs/rows.js';
import {makeShortcutRow} from './lib/prefs/shortcut.js';
import {Key} from './lib/settings.js';

const TYPING_SPEEDS = [50, 100, 250, 500, 1000, 2500];

export default class MurmurPreferences extends ExtensionPreferences {
    override async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        page.add(transcriptionGroup(settings));
        page.add(recordingGroup(window, settings));
        page.add(insertionGroup(settings));
        window.add(page);
    }
}

function transcriptionGroup(settings: Gio.Settings): Adw.PreferencesGroup {
    const group = new Adw.PreferencesGroup({title: _('Transcription')});

    const keyRow = new Adw.PasswordEntryRow({title: _('Mistral API key')});
    settings.bind(Key.apiKey, keyRow, 'text', Gio.SettingsBindFlags.DEFAULT);
    group.add(keyRow);

    group.add(makeComboRow(settings, Key.transcriptionDelayMs, {
        title: _('Transcription delay'),
        subtitle: _('Longer delays give the model more context and better accuracy'),
        choices: [
            {value: 240, label: _('Instant (240 ms)')},
            {value: 500, label: _('Fast (500 ms)')},
            {value: 1000, label: _('Balanced (1 s)')},
            {value: 2400, label: _('Accurate (2.4 s)')},
        ],
    }));
    return group;
}

function recordingGroup(
    window: Adw.PreferencesWindow, settings: Gio.Settings): Adw.PreferencesGroup {
    const group = new Adw.PreferencesGroup({title: _('Recording')});

    group.add(makeShortcutRow(window, settings));
    group.add(makeSpinRow(settings, Key.maxRecordingSeconds, {
        title: _('Maximum recording time'),
        subtitle: _('Seconds after which recording stops on its own'),
        step: 15,
    }));
    group.add(makeSpinRow(settings, Key.silenceSeconds, {
        title: _('Stop after silence'),
        subtitle: _('Seconds of silence that end the recording, or 0 to keep recording'),
        step: 1,
    }));
    return group;
}

function insertionGroup(settings: Gio.Settings): Adw.PreferencesGroup {
    const group = new Adw.PreferencesGroup({title: _('Text insertion')});

    group.add(makeDotoolStatusRow());
    group.add(makeComboRow(settings, Key.typingSpeed, {
        title: _('Typing speed'),
        subtitle: _('Lower this if characters get dropped or reordered'),
        choices: TYPING_SPEEDS.map(value => ({
            value,
            label: _('%d chars/s').replace('%d', String(value)),
        })),
    }));
    return group;
}
