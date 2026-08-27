import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {readIntRange} from '../settings.js';

export type Preset = {
    label: string;
    value: number;
};

export type Choice = {
    label: string;
    value: string;
};

// Presets over a plain integer key, so a value set outside the ladder still
// shows up as the closest one.
export function makePresetRow(
    settings: Gio.Settings,
    key: string,
    options: {presets: Preset[]; subtitle: string; title: string},
): Adw.ComboRow {
    const {presets, subtitle, title} = options;
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: new Gtk.StringList({strings: presets.map(preset => preset.label)}),
    });

    const closest = (value: number) => {
        let best = 0;
        presets.forEach((preset, index) => {
            const bestValue = presets[best]?.value ?? 0;
            if (Math.abs(preset.value - value) < Math.abs(bestValue - value))
                best = index;
        });
        return best;
    };
    const sync = () => {
        row.selected = closest(settings.get_int(key));
    };
    sync();

    row.connect('notify::selected', () => {
        const preset = presets[row.selected];
        if (preset)
            settings.set_int(key, preset.value);
    });
    settings.connect(`changed::${key}`, sync);
    return row;
}

export function makeChoiceRow(
    settings: Gio.Settings,
    key: string,
    options: {choices: Choice[]; subtitle: string; title: string},
): Adw.ComboRow {
    const {choices, subtitle, title} = options;
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: new Gtk.StringList({strings: choices.map(choice => choice.label)}),
    });

    const sync = () => {
        const current = settings.get_string(key);
        const index = choices.findIndex(choice => choice.value === current);
        row.selected = index < 0 ? 0 : index;
    };
    sync();

    row.connect('notify::selected', () => {
        const choice = choices[row.selected];
        if (choice)
            settings.set_string(key, choice.value);
    });
    settings.connect(`changed::${key}`, sync);
    return row;
}

export function makeSpinRow(
    settings: Gio.Settings,
    key: string,
    options: {step: number; subtitle: string; title: string},
): Adw.SpinRow {
    const {step, subtitle, title} = options;
    const {lower, upper} = readIntRange(settings, key);
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: step * 4,
        }),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}
