import Clutter from 'gi://Clutter';

const TICK_MS = 10;

// Characters the virtual keyboard cannot reach on most layouts, mapped to
// plain-ASCII equivalents. dotool types the originals as they are.
const NORMALIZE = {
    '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'",
    '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u201f': '"',
    '\u00ab': '"', '\u00bb': '"', '\u2039': "'", '\u203a': "'",
    '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-',
    '\u2026': '...',
    '\u00a0': ' ', '\u2009': ' ', '\u200a': ' ', '\u202f': ' ',
};

export function buildDotoolScript(text, pace) {
    const cmds = [
        `keydelay ${pace.delayMs}`,
        `keyhold ${pace.holdMs}`,
        `typedelay ${pace.delayMs}`,
        `typehold ${pace.holdMs}`,
    ];
    text.split('\n').forEach((line, i) => {
        if (i > 0)
            cmds.push('key enter');
        if (line.length > 0)
            cmds.push(`type ${line}`);
    });
    return `${cmds.join('\n')}\n`;
}

export function charToKeyval(ch) {
    if (ch === '\n' || ch === '\r')
        return Clutter.KEY_Return;
    if (ch === '\t')
        return Clutter.KEY_Tab;
    return Clutter.unicode_to_keysym(ch.codePointAt(0));
}

export function normalizeForKeyval(text) {
    let out = '';
    for (const ch of text)
        out += NORMALIZE[ch] ?? ch;
    return out;
}

// Turn a target rate into the pacing each typing engine needs: dotool sleeps
// whole milliseconds per key (hold, then delay), while the virtual keyboard
// emits a batch of characters per timer tick.
export function typingPace(charsPerSecond) {
    const periodMs = 1000 / charsPerSecond;
    const holdMs = Math.min(40, Math.max(1, Math.round(periodMs * 0.4)));
    const tickMs = Math.max(TICK_MS, Math.round(periodMs));
    return {
        charsPerTick: Math.max(1, Math.round((charsPerSecond * tickMs) / 1000)),
        delayMs: Math.max(0, Math.round(periodMs) - holdMs),
        holdMs,
        tickMs,
    };
}
