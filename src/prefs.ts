import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {
    ExtensionPreferences,
    gettext as _
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {History} from './lib/history.js';
import {makeDotoolStatusRow} from './lib/prefs/dotool-status.js';
import {makeRecordingFolderRow} from './lib/prefs/folder.js';
import {makeHistoryPage} from './lib/prefs/history.js';
import {makeLocalGroup} from './lib/prefs/local.js';
import {makeModelRow} from './lib/prefs/model.js';
import {makeChoiceRow, makePresetRow, makeSpinRow, showWhileSelected} from './lib/prefs/rows.js';
import {makeShortcutRow} from './lib/prefs/shortcut.js';
import {makeTermsRow} from './lib/prefs/terms.js';
import {makeTranscribeFileRow} from './lib/prefs/transcribe.js';
import {Key, readIntRange, readProvider} from './lib/settings.js';
import {Engine} from './lib/transcription/engine.js';
import {PROVIDER_IDS, PROVIDERS, type ProviderId} from './lib/transcription/provider.js';

const TYPING_SPEEDS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

export default class MurmurPreferences extends ExtensionPreferences {
    override async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
        const settings = this.getSettings();
        const engine = new Engine(this);

        const transcription = new Adw.PreferencesPage({
            icon_name: 'insert-text-symbolic',
            name: 'transcription',
            title: _('Transcription'),
        });
        transcription.add(serviceGroup(window, settings));
        transcription.add(makeLocalGroup(window, settings, engine));
        transcription.add(mistralGroup(settings));
        transcription.add(openrouterGroup(settings));
        transcription.add(xaiGroup(settings));

        const dictation = new Adw.PreferencesPage({
            icon_name: 'audio-input-microphone-symbolic',
            name: 'dictation',
            title: _('Dictation'),
        });
        dictation.add(dictationGroup(window, settings));
        dictation.add(insertionGroup(window, settings));

        const recording = new Adw.PreferencesPage({
            icon_name: 'media-record-symbolic',
            name: 'recording',
            title: _('Recording'),
        });
        recording.add(recordingGroup(window, settings));
        recording.add(transcribeFileGroup(window, settings, engine));

        window.add(transcription);
        window.add(dictation);
        window.add(recording);
        window.add(makeHistoryPage(window, settings, new History(this.uuid)));
        window.search_enabled = true;
    }
}

function serviceGroup(window: Adw.PreferencesWindow, settings: Gio.Settings): Adw.PreferencesGroup {
    const group = new Adw.PreferencesGroup();
    group.add(makeChoiceRow(settings, Key.transcriptionProvider, {
        title: _('Service'),
        choices: PROVIDER_IDS
            .map(id => ({label: PROVIDERS[id].label, value: id}))
            .sort((first, second) => first.label.localeCompare(second.label)),
    }));
    group.add(makeTermsRow(window, settings));
    return group;
}

function mistralGroup(settings: Gio.Settings): Adw.PreferencesGroup {
    const group = providerGroup(settings, 'mistral');
    group.add(apiKeyRow(settings, Key.mistralApiKey));
    return group;
}

function openrouterGroup(settings: Gio.Settings): Adw.PreferencesGroup {
    const group = providerGroup(settings, 'openrouter');
    group.add(apiKeyRow(settings, Key.openrouterApiKey));
    group.add(makeModelRow(settings));
    return group;
}

function xaiGroup(settings: Gio.Settings): Adw.PreferencesGroup {
    const group = providerGroup(settings, 'xai');
    group.add(apiKeyRow(settings, Key.xaiApiKey));
    return group;
}

function providerGroup(settings: Gio.Settings, id: ProviderId): Adw.PreferencesGroup {
    const {keySource, label} = PROVIDERS[id];
    const group = new Adw.PreferencesGroup({
        description: keySource ? _('Your key from %s').replace('%s', keySource) : null,
        title: label,
    });
    showWhileSelected(group, settings, id);
    return group;
}

function apiKeyRow(settings: Gio.Settings, key: string): Adw.PasswordEntryRow {
    const row = new Adw.PasswordEntryRow({title: _('API key')});
    settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function dictationGroup(
    window: Adw.PreferencesWindow, settings: Gio.Settings): Adw.PreferencesGroup {
    const group = new Adw.PreferencesGroup();

    group.add(makeShortcutRow(window, settings, Key.toggleDictation, {
        title: _('Dictation shortcut'),
        subtitle: _('Opens the dictation panel, then stops and inserts the transcription'),
    }));

    const panelRow = new Adw.SwitchRow({
        title: _('Show the panel when a dictation starts'),
        subtitle: _('Off, a dictation starts as the indicator in the top bar'),
    });
    settings.bind(Key.showPanelOnStart, panelRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(panelRow);

    group.add(maxDictationRow(settings));
    group.add(makeSpinRow(settings, Key.silenceSeconds, {
        title: _('Stop after silence'),
        subtitle: _('Seconds of silence that end a dictation, or 0 to keep listening'),
        step: 1,
    }));
    return group;
}

function maxDictationRow(settings: Gio.Settings): Adw.SpinRow {
    const row = makeSpinRow(settings, Key.maxDictationSeconds, {
        title: _('Maximum dictation time'),
        step: 15,
    });

    const sync = () => {
        const {dictationSeconds, vendor} = PROVIDERS[readProvider(settings)];
        row.adjustment.upper =
            dictationSeconds ?? readIntRange(settings, Key.maxDictationSeconds).upper;
        row.subtitle = dictationSeconds === undefined
            ? _('Seconds after which a dictation stops on its own')
            : _('Seconds after which a dictation stops on its own, at most %d minutes with %s')
                .replace('%d', String(Math.floor(dictationSeconds / 60)))
                .replace('%s', vendor);
    };
    sync();

    settings.connect(`changed::${Key.transcriptionProvider}`, sync);
    return row;
}

function recordingGroup(window: Adw.PreferencesWindow, settings: Gio.Settings): Adw.PreferencesGroup {
    const group = new Adw.PreferencesGroup();
    group.add(makeShortcutRow(window, settings, Key.toggleRecording, {
        title: _('Recording shortcut'),
        subtitle: _('Records everything you hear and say, then transcribes it'),
    }));
    group.add(makeRecordingFolderRow(window, settings));
    group.add(makeSpinRow(settings, Key.recordingPieceMinutes, {
        title: _('Piece length'),
        subtitle: _('Minutes of a recording transcribed at a time, or 0 for all of it at once'),
        step: 1,
    }));

    const contextRow = new Adw.SwitchRow({
        title: _('Note what is on screen and playing'),
        subtitle: _('Window titles and what played go into the transcript, never to the service'),
    });
    settings.bind(Key.recordContext, contextRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(contextRow);
    return group;
}

function transcribeFileGroup(
    window: Adw.PreferencesWindow, settings: Gio.Settings, engine: Engine): Adw.PreferencesGroup {
    const group = new Adw.PreferencesGroup();
    group.add(makeTranscribeFileRow(window, settings, engine));
    return group;
}

function insertionGroup(window: Adw.PreferencesWindow, settings: Gio.Settings): Adw.PreferencesGroup {
    const group = new Adw.PreferencesGroup({title: _('Text insertion')});

    group.add(makeDotoolStatusRow(window));
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
