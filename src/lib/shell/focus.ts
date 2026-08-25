import type Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';

import {getIBusManager} from 'resource:///org/gnome/shell/misc/ibusManager.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export type Destination =
    | {app: string; kind: 'field'}
    | {kind: 'clipboard'};

// Main.inputMethod is the shell's Clutter.InputMethod plus the focus the
// current client has, which the type definitions do not carry.
type InputMethod = Clutter.InputMethod & {currentFocus: Clutter.InputFocus | null};

// Wayland clients announce a focused text field over the text-input protocol,
// which reaches the shell as the input method's focus. X11 clients talk to ibus
// instead, so their fields only show up as panel events.
export class FocusTracker {
    onChanged: (() => void) | null = null;

    #cursorId = 0;
    #focusInId = 0;
    #focusOutId = 0;
    #focusWindowId = 0;
    #ibusFocused = false;

    constructor() {
        const ibus = getIBusManager();
        const changed = () => this.onChanged?.();

        this.#focusInId = ibus.connect('focus-in', () => {
            this.#ibusFocused = true;
            changed();
        });
        this.#focusOutId = ibus.connect('focus-out', () => {
            this.#ibusFocused = false;
            changed();
        });
        // A field taking focus inside the window that already has it reaches the
        // shell as a new cursor position and nothing else.
        this.#cursorId = Main.inputMethod.connect('cursor-location-changed', changed);
        this.#focusWindowId = global.display.connect('notify::focus-window', changed);
    }

    destroy(): void {
        const ibus = getIBusManager();
        if (this.#focusInId) {
            ibus.disconnect(this.#focusInId);
            this.#focusInId = 0;
        }
        if (this.#focusOutId) {
            ibus.disconnect(this.#focusOutId);
            this.#focusOutId = 0;
        }
        if (this.#cursorId) {
            Main.inputMethod.disconnect(this.#cursorId);
            this.#cursorId = 0;
        }
        if (this.#focusWindowId) {
            global.display.disconnect(this.#focusWindowId);
            this.#focusWindowId = 0;
        }
    }

    // Read when it matters rather than remembered from the start: the panel
    // never takes a client's text-input focus away, so this stays true for the
    // whole recording however much the user clicks around.
    current(): Destination {
        const field = focusedInputMethod() || this.#ibusFocused;
        return field ? {app: focusedApp(), kind: 'field'} : {kind: 'clipboard'};
    }
}

function focusedApp(): string {
    const window = global.display.focus_window;
    if (!window)
        return '';
    return Shell.WindowTracker.get_default().get_window_app(window)?.get_name() ?? '';
}

function focusedInputMethod(): boolean {
    const focus = (Main.inputMethod as InputMethod).currentFocus;
    return focus?.is_focused() ?? false;
}
