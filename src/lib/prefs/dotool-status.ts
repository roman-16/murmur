import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {fromAsync} from '../async.js';
import {dotoolTiers} from '../dotool.js';
import {errorMessage} from '../errors.js';

const GUIDE = 'https://github.com/roman-16/murmur/blob/main/docs/text-insertion.md#dotool';
const PROBE_FLAGS = Gio.SubprocessFlags.STDIN_PIPE |
    Gio.SubprocessFlags.STDOUT_SILENCE |
    Gio.SubprocessFlags.STDERR_SILENCE;
const PROBE_TIMEOUT_MS = 1500;
const STATE_CLASSES = ['error', 'success', 'warning'];

type DotoolStatus =
    | {group: string; kind: 'notmember'}
    | {group: string; kind: 'relogin'}
    | {kind: 'active'}
    | {kind: 'checking'}
    | {kind: 'notinstalled'}
    | {kind: 'nouinput'}
    | {kind: 'unreachable'};

type RowContent = {
    cssClass: string | null;
    iconName: string;
    subtitle: string;
    title: string;
};

export function makeDotoolStatusRow(window: Adw.PreferencesWindow): Adw.ActionRow {
    const icon = new Gtk.Image({valign: Gtk.Align.CENTER});
    const row = new Adw.ActionRow({subtitle_lines: 0});
    row.add_prefix(icon);

    const recheck = new Gtk.Button({
        icon_name: 'view-refresh-symbolic',
        valign: Gtk.Align.CENTER,
        has_frame: false,
        tooltip_text: _('Recheck'),
    });
    row.add_suffix(recheck);

    const help = new Gtk.Button({
        has_frame: false,
        icon_name: 'help-browser-symbolic',
        tooltip_text: _('How to set up dotool'),
        valign: Gtk.Align.CENTER,
    });
    help.connect('clicked', () => void openGuide(window));
    row.add_suffix(help);

    const show = (status: DotoolStatus) => {
        const {cssClass, iconName, subtitle, title} = describe(status);
        icon.icon_name = iconName;
        for (const state of STATE_CLASSES)
            icon.remove_css_class(state);
        if (cssClass)
            icon.add_css_class(cssClass);
        row.title = title;
        row.subtitle = subtitle;
        recheck.visible = status.kind !== 'active';
        help.visible = status.kind !== 'active' && status.kind !== 'checking';
    };

    let generation = 0;
    let probe: Gio.Subprocess | null = null;
    let probeTimeoutId = 0;

    const clearProbeTimeout = () => {
        if (!probeTimeoutId)
            return;
        GLib.source_remove(probeTimeoutId);
        probeTimeoutId = 0;
    };

    const endProbe = () => {
        clearProbeTimeout();
        probe?.force_exit();
        probe = null;
    };

    const answers = async (bin: string): Promise<boolean> => {
        endProbe();
        let process: Gio.Subprocess;
        try {
            process = Gio.Subprocess.new([bin], PROBE_FLAGS);
        } catch {
            return false;
        }
        probe = process;
        clearProbeTimeout();
        probeTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PROBE_TIMEOUT_MS, () => {
            probeTimeoutId = 0;
            process.force_exit();
            return GLib.SOURCE_REMOVE;
        });

        try {
            await fromAsync(
                callback => process.communicate_utf8_async('', null, callback),
                result => process.communicate_utf8_finish(result));
            return process.get_successful();
        } catch {
            return false;
        } finally {
            if (probe === process)
                endProbe();
        }
    };

    const refresh = async () => {
        const current = ++generation;
        show({kind: 'checking'});
        const status = await checkDotool(answers, () => current !== generation);
        if (status && current === generation)
            show(status);
    };

    recheck.connect('clicked', () => void refresh());
    row.connect('destroy', () => {
        generation++;
        endProbe();
    });
    void refresh();
    return row;
}

async function checkDotool(
    answers: (bin: string) => Promise<boolean>,
    superseded: () => boolean): Promise<DotoolStatus | null> {
    const tiers = dotoolTiers();
    if (tiers.length === 0)
        return {kind: 'notinstalled'};

    for (const bin of tiers) {
        if (superseded())
            return null;
        if (await answers(bin))
            return {kind: 'active'};
    }
    return superseded() ? null : await diagnose();
}

async function diagnose(): Promise<DotoolStatus> {
    if (!GLib.file_test('/dev/uinput', GLib.FileTest.EXISTS))
        return {kind: 'nouinput'};

    const gid = uinputGid();
    if (gid === null || sessionGids().has(gid))
        return {kind: 'unreachable'};

    const group = await lookupGroup(gid);
    if (!group)
        return {kind: 'unreachable'};

    return group.members.includes(GLib.get_user_name())
        ? {group: group.name, kind: 'relogin'}
        : {group: group.name, kind: 'notmember'};
}

function uinputGid(): number | null {
    try {
        return Gio.File.new_for_path('/dev/uinput')
            .query_info('unix::gid', Gio.FileQueryInfoFlags.NONE, null)
            .get_attribute_uint32('unix::gid');
    } catch {
        return null;
    }
}

function sessionGids(): Set<number> {
    const [, contents] = GLib.file_get_contents('/proc/self/status');
    const gids = new Set<number>();
    for (const raw of new TextDecoder().decode(contents).split('\n')) {
        const line = raw.trim();
        if (line.startsWith('Groups:') || line.startsWith('Gid:')) {
            for (const token of line.split(/\s+/).slice(1))
                gids.add(Number(token));
        }
    }
    return gids;
}

async function lookupGroup(gid: number): Promise<{members: string[]; name: string} | null> {
    const getent = GLib.find_program_in_path('getent');
    if (!getent)
        return null;

    const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE;
    try {
        const process = Gio.Subprocess.new([getent, 'group', String(gid)], flags);
        const [, stdout] = await fromAsync(
            callback => process.communicate_utf8_async(null, null, callback),
            result => process.communicate_utf8_finish(result));
        const [name, , , members] = stdout.trim().split(':');
        if (!name)
            return null;
        return {members: (members ?? '').split(',').filter(Boolean), name};
    } catch {
        return null;
    }
}

function describe(status: DotoolStatus): RowContent {
    const fallback = _('The virtual keyboard types only characters from your keyboard layout.');

    switch (status.kind) {
        case 'active':
            return {
                cssClass: 'success',
                iconName: 'object-select-symbolic',
                subtitle: '',
                title: _('Typing with dotool'),
            };
        case 'checking':
            return {
                cssClass: null,
                iconName: 'content-loading-symbolic',
                subtitle: '',
                title: _('Checking dotool…'),
            };
        case 'relogin':
            return {
                cssClass: 'warning',
                iconName: 'dialog-warning-symbolic',
                subtitle: `${_('Log out and back in to let this session use the “%s” group.').replace('%s', status.group)} ${fallback}`,
                title: _('Typing with the virtual keyboard'),
            };
        default:
            return {
                cssClass: 'error',
                iconName: 'dialog-error-symbolic',
                subtitle: `${unavailableReason(status)} ${fallback}`,
                title: _('Typing with the virtual keyboard'),
            };
    }
}

function unavailableReason(
    status: {group: string; kind: 'notmember'} | {kind: 'notinstalled'} | {kind: 'nouinput'} |
    {kind: 'unreachable'}): string {
    switch (status.kind) {
        case 'notinstalled':
            return _('dotool is not installed.');
        case 'notmember':
            return _('You are not in the “%s” group, which may use /dev/uinput.').replace('%s', status.group);
        case 'nouinput':
            return _('/dev/uinput is missing.');
        default:
            return _('dotool is installed but does not answer.');
    }
}

async function openGuide(window: Adw.PreferencesWindow): Promise<void> {
    const launcher = new Gtk.UriLauncher({uri: GUIDE});
    try {
        await fromAsync(
            callback => launcher.launch(window, null, callback),
            result => launcher.launch_finish(result));
    } catch (error) {
        if (!(error instanceof GLib.Error && error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)))
            console.error(`murmur: dotool guide: ${errorMessage(error)}`);
    }
}
