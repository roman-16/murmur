import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// dotool tiers to try, best first. dotoolc talks to a running dotoold; the
// one-shot dotool opens /dev/uinput itself. Both fail before emitting any input
// when unavailable (dotoolc errors when no daemon reads the pipe; dotool opens
// uinput at startup), so callers can try them in order and fall through safely.
export function dotoolCandidates() {
    const candidates = [];
    const dotoolc = GLib.find_program_in_path('dotoolc');
    if (dotoolc)
        candidates.push({bin: dotoolc, mode: 'daemon'});
    const dotool = GLib.find_program_in_path('dotool');
    if (dotool)
        candidates.push({bin: dotool, mode: 'oneshot'});
    return candidates;
}

// dotool turns text into keycodes and must assume the same layout the
// compositor decodes them with, or it defaults to "us" and mistypes on every
// other layout. Return the active GNOME xkb source as dotool env assignments.
export function dotoolLayoutEnv() {
    try {
        const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.input-sources'});
        const sources = settings.get_value('sources').deep_unpack();
        if (sources.length === 0)
            return [];
        const current = settings.get_uint('current');
        const [type, id] = sources[current < sources.length ? current : 0];
        if (type !== 'xkb')
            return [];
        const [layout, variant] = id.split('+');
        if (!layout)
            return [];
        const env = [['DOTOOL_XKB_LAYOUT', layout]];
        if (variant)
            env.push(['DOTOOL_XKB_VARIANT', variant]);
        return env;
    } catch {
        return [];
    }
}
