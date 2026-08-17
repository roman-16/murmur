import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {fromAsync} from '../async.js';
import {dotoolLayoutEnv, dotoolTiers} from '../dotool.js';
import {isCancelled} from '../errors.js';

const TICK_MS = 10;

// Characters the virtual keyboard cannot reach on most layouts, mapped to
// plain-ASCII equivalents. dotool types the originals as they are.
const NORMALIZE = new Map<string, string>([
    ...mapTo('\u2018\u2019\u201a\u201b\u2039\u203a', "'"),
    ...mapTo('\u201c\u201d\u201e\u201f\u00ab\u00bb', '"'),
    ...mapTo('\u2013\u2014\u2015\u2212', '-'),
    ...mapTo('\u00a0\u2009\u200a\u202f', ' '),
    ['\u2026', '...'],
]);

function mapTo(characters: string, replacement: string): [string, string][] {
    return [...characters].map(character => [character, replacement]);
}

export type Pace = {
    charsPerTick: number;
    delayMs: number;
    holdMs: number;
    tickMs: number;
};

// Turn a target rate into the pacing each typing engine needs: dotool sleeps
// whole milliseconds per key (hold, then delay), while the virtual keyboard
// emits a batch of characters per timer tick.
export function typingPace(charsPerSecond: number): Pace {
    const periodMs = 1000 / charsPerSecond;
    // dotool counts a hold in whole milliseconds, so above a thousand characters
    // a second the only way left to go faster is not to hold at all.
    const holdMs = periodMs < 1
        ? 0
        : Math.min(40, Math.max(1, Math.round(periodMs * 0.4)));
    const tickMs = Math.max(TICK_MS, Math.round(periodMs));
    return {
        charsPerTick: Math.max(1, Math.round((charsPerSecond * tickMs) / 1000)),
        delayMs: Math.max(0, Math.round(periodMs) - holdMs),
        holdMs,
        tickMs,
    };
}

// Try each dotool tier, then the virtual keyboard. A tier that is unavailable
// fails before emitting input, so falling through never double-types.
export async function insertText(
    text: string, pace: Pace, cancellable: Gio.Cancellable): Promise<void> {
    const script = dotoolScript(text, pace);
    const env = dotoolLayoutEnv();

    for (const bin of dotoolTiers()) {
        if (await typeWithDotool(bin, script, env, cancellable))
            return;
    }
    await typeWithVirtualKeyboard(text, pace, cancellable);
}

export function dotoolScript(text: string, pace: Pace): string {
    const commands = [
        `keydelay ${pace.delayMs}`,
        `keyhold ${pace.holdMs}`,
        `typedelay ${pace.delayMs}`,
        `typehold ${pace.holdMs}`,
    ];
    text.split('\n').forEach((line, index) => {
        if (index > 0)
            commands.push('key enter');
        if (line.length > 0)
            commands.push(`type ${line}`);
    });
    return `${commands.join('\n')}\n`;
}

export function normalizeForKeyval(text: string): string {
    let normalized = '';
    for (const character of text)
        normalized += NORMALIZE.get(character) ?? character;
    return normalized;
}

export function charToKeyval(character: string): number {
    if (character === '\n' || character === '\r')
        return Clutter.KEY_Return;
    if (character === '\t')
        return Clutter.KEY_Tab;
    return Clutter.unicode_to_keysym(character.codePointAt(0) ?? 0);
}

async function typeWithDotool(
    bin: string, script: string, env: [string, string][],
    cancellable: Gio.Cancellable): Promise<boolean> {
    let process: Gio.Subprocess;
    try {
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        for (const [name, value] of env)
            launcher.setenv(name, value, true);
        process = launcher.spawnv([bin]);
    } catch (error) {
        console.error(`murmur: ${bin} spawn failed: ${error}`);
        return false;
    }

    try {
        await fromAsync(
            callback => process.communicate_utf8_async(script, cancellable, callback),
            result => process.communicate_utf8_finish(result));
        return process.get_successful();
    } catch (error) {
        if (isCancelled(error))
            throw error;
        return false;
    }
}

// The virtual keyboard can only produce characters on the active layout, so it
// is the fallback for when no dotool tier is usable.
function typeWithVirtualKeyboard(
    text: string, pace: Pace, cancellable: Gio.Cancellable): Promise<void> {
    const seat = Clutter.get_default_backend().get_default_seat();
    const device = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const characters = [...normalizeForKeyval(text)];
    let index = 0;

    return new Promise(resolve => {
        let cancelledId = 0;
        let sourceId = 0;

        const finish = () => {
            if (sourceId) {
                GLib.source_remove(sourceId);
                sourceId = 0;
            }
            if (cancelledId) {
                cancellable.disconnect(cancelledId);
                cancelledId = 0;
            }
            resolve();
        };

        sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, pace.tickMs, () => {
            for (let typed = 0; typed < pace.charsPerTick && index < characters.length; typed++) {
                const keyval = charToKeyval(characters[index++] ?? '');
                if (!keyval)
                    continue;
                const time = GLib.get_monotonic_time();
                device.notify_keyval(time, keyval, Clutter.KeyState.PRESSED);
                device.notify_keyval(time, keyval, Clutter.KeyState.RELEASED);
            }
            if (index < characters.length)
                return GLib.SOURCE_CONTINUE;

            sourceId = 0;
            finish();
            return GLib.SOURCE_REMOVE;
        });
        cancelledId = cancellable.connect(finish);
    });
}
