import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {
    ExtensionPreferences,
    gettext as _
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {makeDotoolStatusRow} from './lib/prefs/dotool-status.js';
import {makeChoiceRow, makePresetRow, makeSpinRow} from './lib/prefs/rows.js';
import {makeShortcutRow} from './lib/prefs/shortcut.js';
import {Key, readProvider} from './lib/settings.js';
import {PROVIDER_IDS, PROVIDERS, type ProviderId} from './lib/transcription/provider.js';

const TYPING_SPEEDS = [50, 100, 250, 500, 1000, 2500];

export default class MurmurPreferences extends ExtensionPreferences {
    override async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        page.add(transcriptionGroup(settings));
        page.add(geminiGroup(settings));
        page.add(mistralGroup(settings));
        page.add(recordingGroup(window, settings));
        page.add(insertionGroup(settings));
        window.add(page);
    }
}

function transcriptionGroup(settings: Gio.Settings): Adw.PreferencesGroup {
    const group = new Adw.PreferencesGroup({title: _('Transcription')});
    group.add(makeChoiceRow(settings, Key.transcriptionProvider, {
        title: _('Service'),
        subtitle: _('Where Murmur sends your voice while you speak'),
        choices: PROVIDER_IDS.map(id => ({label: PROVIDERS[id].label, value: id})),
    }));
    return group;
}

function geminiGroup(settings: Gio.Settings): Adw.PreferencesGroup {
    const group = providerGroup(settings, 'gemini');
    group.add(apiKeyRow(settings, Key.geminiApiKey));

    const smart = new Adw.SwitchRow({
        title: _('Tidy up what I say'),
        subtitle: _(
            'Drops filler words, resolves spoken corrections, and formats lists and numbers. Off transcribes word for word'),
    });
    settings.bind(Key.geminiSmartTranscription, smart, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(smart);
    return group;
}

function mistralGroup(settings: Gio.Settings): Adw.PreferencesGroup {
    const group = providerGroup(settings, 'mistral');
    group.add(apiKeyRow(settings, Key.mistralApiKey));
    group.add(makePresetRow(settings, Key.transcriptionDelayMs, {
        title: _('Transcription delay'),
        subtitle: _('Longer delays give the model more context and better accuracy'),
        presets: [
            {value: 240, label: _('Instant (240 ms)')},
            {value: 500, label: _('Fast (500 ms)')},
            {value: 1000, label: _('Balanced (1 s)')},
            {value: 2400, label: _('Accurate (2.4 s)')},
        ],
    }));
    return group;
}

// One group per service, and only the chosen one is on screen: a key and a
// knob that belong to a service nobody selected are noise.
function providerGroup(settings: Gio.Settings, id: ProviderId): Adw.PreferencesGroup {
    const {keySource, label} = PROVIDERS[id];
    const group = new Adw.PreferencesGroup({
        description: _('Your key from %s').replace('%s', keySource),
        title: label,
    });

    const sync = () => {
        group.visible = readProvider(settings) === id;
    };
    sync();
    settings.connect(`changed::${Key.transcriptionProvider}`, sync);
    return group;
}

function apiKeyRow(settings: Gio.Settings, key: string): Adw.PasswordEntryRow {
    const row = new Adw.PasswordEntryRow({title: _('API key')});
    settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function recordingGroup(
    window: Adw.PreferencesWindow, settings: Gio.Settings): Adw.PreferencesGroup {
    const group = new Adw.PreferencesGroup({title: _('Recording')});

    group.add(makeShortcutRow(window, settings));

    const panelRow = new Adw.SwitchRow({
        title: _('Show the panel when recording starts'),
        subtitle: _(
            'Turn this off to start with only the recording indicator in the top bar, over nothing. Click the indicator to open the panel'),
    });
    settings.bind(Key.showPanelOnStart, panelRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(panelRow);

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
    group.add(makePresetRow(settings, Key.typingSpeed, {
        title: _('Typing speed'),
        subtitle: _('Lower this if characters get dropped or reordered'),
        presets: TYPING_SPEEDS.map(value => ({
            value,
            label: _('%d chars/s').replace('%d', String(value)),
        })),
    }));
    return group;
}
