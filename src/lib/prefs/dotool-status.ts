import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {dotoolTiers} from '../dotool.js';

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

export function makeDotoolStatusRow(): Adw.ActionRow {
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

    const show = (status: DotoolStatus) => {
        const {cssClass, iconName, subtitle, title} = describe(status);
        icon.icon_name = iconName;
        for (const state of STATE_CLASSES)
            icon.remove_css_class(state);
        if (cssClass)
            icon.add_css_class(cssClass);
        row.title = title;
        row.subtitle = subtitle;
    };

    let generation = 0;
    const refresh = async () => {
        const current = ++generation;
        show({kind: 'checking'});
        const status = await checkDotool();
        if (current === generation)
            show(status);
    };

    recheck.connect('clicked', () => void refresh());
    void refresh();
    return row;
}

async function checkDotool(): Promise<DotoolStatus> {
    const tiers = dotoolTiers();
    if (tiers.length === 0)
        return {kind: 'notinstalled'};

    for (const bin of tiers) {
        if (await probeTier(bin))
            return {kind: 'active'};
    }
    return await diagnose();
}

// Run a tier with empty input; exit 0 means it is usable.
async function probeTier(bin: string): Promise<boolean> {
    const flags = Gio.SubprocessFlags.STDIN_PIPE |
        Gio.SubprocessFlags.STDOUT_SILENCE |
        Gio.SubprocessFlags.STDERR_SILENCE;

    let process: Gio.Subprocess;
    try {
        process = Gio.Subprocess.new([bin], flags);
    } catch {
        return false;
    }

    // The handler clears the id, so a surviving id means the tier answered in time.
    let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PROBE_TIMEOUT_MS, () => {
        timeoutId = 0;
        try {
            process.force_exit();
        } catch {}
        return GLib.SOURCE_REMOVE;
    });

    try {
        await process.communicate_utf8_async('', null);
        return timeoutId !== 0 && process.get_successful();
    } catch {
        return false;
    } finally {
        if (timeoutId)
            GLib.source_remove(timeoutId);
    }
}

// Every tier failed: tell "in the input group but the session has not picked it
// up yet" (fixable by re-login) apart from genuine gaps.
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
    const gids = new Set<number>();
    try {
        const [ok, contents] = GLib.file_get_contents('/proc/self/status');
        if (!ok)
            return gids;
        for (const raw of new TextDecoder().decode(contents).split('\n')) {
            const line = raw.trim();
            if (line.startsWith('Groups:') || line.startsWith('Gid:')) {
                for (const token of line.split(/\s+/).slice(1))
                    gids.add(Number(token));
            }
        }
    } catch {}
    return gids;
}

async function lookupGroup(gid: number): Promise<{members: string[]; name: string} | null> {
    const getent = GLib.find_program_in_path('getent');
    if (!getent)
        return null;

    const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE;
    try {
        const process = Gio.Subprocess.new([getent, 'group', String(gid)], flags);
        const [stdout] = await process.communicate_utf8_async(null, null);
        const [name, , , members] = stdout.trim().split(':');
        if (!name)
            return null;
        return {members: (members ?? '').split(',').filter(Boolean), name};
    } catch {
        return null;
    }
}

function describe(status: DotoolStatus): RowContent {
    const fallback = _(
        'Murmur is using the virtual keyboard, which types only characters from your current keyboard layout.');

    switch (status.kind) {
        case 'active':
            return {
                cssClass: 'success',
                iconName: 'emblem-ok-symbolic',
                subtitle: _(
                    'Dictation types via dotool: arbitrary Unicode into any app, including terminals.'),
                title: _('dotool is active'),
            };
        case 'checking':
            return {
                cssClass: null,
                iconName: 'content-loading-symbolic',
                subtitle: '',
                title: _('Checking dotool…'),
            };
        case 'relogin': {
            const pending = _('You are in the “%s” group, but this session has not picked it up yet. Log out and back in (or reboot) to finish enabling dotool.');
            return {
                cssClass: 'warning',
                iconName: 'dialog-warning-symbolic',
                subtitle: `${pending.replace('%s', status.group)} ${fallback}`,
                title: _('dotool needs a re-login'),
            };
        }
        default:
            return {
                cssClass: 'error',
                iconName: 'dialog-error-symbolic',
                subtitle: `${unavailableReason(status)} ${fallback}`,
                title: _('dotool is not available'),
            };
    }
}

function unavailableReason(
    status: {group: string; kind: 'notmember'} | {kind: 'notinstalled'} | {kind: 'nouinput'} |
    {kind: 'unreachable'}): string {
    switch (status.kind) {
        case 'notinstalled':
            return _('dotool is not installed. Install it for full-Unicode typing (see the README).');
        case 'notmember':
            return _('You are not in the “%s” group that grants access to /dev/uinput (see the README).')
                .replace('%s', status.group);
        case 'nouinput':
            return _(
                'The uinput device is unavailable (kernel module or udev rule missing; see the README).');
        default:
            return _('dotool is installed but could not be reached (see the README).');
    }
}
