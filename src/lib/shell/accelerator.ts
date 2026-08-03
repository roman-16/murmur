import Clutter from 'gi://Clutter';

export type Shortcut = {
    keyval: number;
    label: string;
    mods: number;
};

const MODIFIERS = [
    {label: 'Super', mask: Clutter.ModifierType.MOD4_MASK, pattern: /<(Super|Mod4)>/i},
    {label: 'Ctrl', mask: Clutter.ModifierType.CONTROL_MASK, pattern: /<(Primary|Control|Ctrl)>/i},
    {label: 'Alt', mask: Clutter.ModifierType.MOD1_MASK, pattern: /<(Alt|Mod1)>/i},
    {label: 'Shift', mask: Clutter.ModifierType.SHIFT_MASK, pattern: /<Shift>/i},
];

export const MODIFIER_MASK = MODIFIERS.reduce((mask, modifier) => mask | modifier.mask, 0);

// The shell process has no accelerator parser and must not import Gtk, so parse
// a GSettings accelerator like "<Super>space" into a keyval, modifier mask, and
// display label by hand.
export function parseAccelerator(accelerator: string): Shortcut | null {
    if (!accelerator)
        return null;

    const name = accelerator.slice(accelerator.lastIndexOf('>') + 1);
    const keyval = keyvalFromName(name);
    if (!keyval)
        return null;

    const modifiers = MODIFIERS.filter(modifier => modifier.pattern.test(accelerator));
    return {
        keyval,
        label: [...modifiers.map(modifier => modifier.label), capitalize(name)].join('+'),
        mods: modifiers.reduce((mask, modifier) => mask | modifier.mask, 0),
    };
}

// Clutter exposes keyvals as KEY_* constants only, with no name lookup.
function keyvalFromName(name: string): number | null {
    const keyval = (Clutter as unknown as Record<string, unknown>)[`KEY_${name}`];
    return typeof keyval === 'number' ? keyval : null;
}

function capitalize(name: string): string {
    return name.replace(/^./, character => character.toUpperCase());
}
