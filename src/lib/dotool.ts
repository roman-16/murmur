import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// dotool tiers to try, best first. dotoolc talks to a running dotoold; the
// one-shot dotool opens /dev/uinput itself. Both fail before emitting any input
// when unavailable (dotoolc errors when no daemon reads the pipe, dotool opens
// uinput at startup), so callers can try them in order and fall through safely.
export function dotoolTiers(): string[] {
    return ['dotoolc', 'dotool']
        .map(program => GLib.find_program_in_path(program))
        .filter((path): path is string => path !== null);
}

// dotool turns text into keycodes and must assume the same layout the
// compositor decodes them with, or it defaults to "us" and mistypes on every
// other layout. Return the active GNOME xkb source as dotool env assignments.
export function dotoolLayoutEnv(): [string, string][] {
    const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.input-sources'});
    const sources = settings.get_value('sources').deep_unpack() as [string, string][];
    const source = sources[settings.get_uint('current')] ?? sources[0];
    if (!source)
        return [];

    const [type, id] = source;
    if (type !== 'xkb')
        return [];

    const [layout, variant] = id.split('+');
    if (!layout)
        return [];

    const env: [string, string][] = [['DOTOOL_XKB_LAYOUT', layout]];
    if (variant)
        env.push(['DOTOOL_XKB_VARIANT', variant]);
    return env;
}
