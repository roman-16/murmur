const MODIFIERS = [
    {label: 'Super', pattern: /<(Super|Mod4)>/i},
    {label: 'Ctrl', pattern: /<(Primary|Control|Ctrl)>/i},
    {label: 'Alt', pattern: /<(Alt|Mod1)>/i},
    {label: 'Shift', pattern: /<Shift>/i},
];

// The shell process has no accelerator parser and must not import Gtk, so a
// GSettings accelerator like "<Super>space" becomes "Super+Space" by hand.
export function acceleratorLabel(accelerator: string): string {
    const name = accelerator.slice(accelerator.lastIndexOf('>') + 1);
    if (!name)
        return '';

    const modifiers = MODIFIERS
        .filter(modifier => modifier.pattern.test(accelerator))
        .map(modifier => modifier.label);
    return [...modifiers, capitalize(name)].join('+');
}

function capitalize(name: string): string {
    return name.replace(/^./, character => character.toUpperCase());
}
