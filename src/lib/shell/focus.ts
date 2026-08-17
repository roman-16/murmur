import type Clutter from 'gi://Clutter';

import {getIBusManager} from 'resource:///org/gnome/shell/misc/ibusManager.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export type Destination = 'clipboard' | 'field';

// Main.inputMethod is the shell's Clutter.InputMethod plus the focus the
// current client has, which the type definitions do not carry.
type InputMethod = Clutter.InputMethod & {currentFocus: Clutter.InputFocus | null};

// Wayland clients announce a focused text field over the text-input protocol,
// which reaches the shell as the input method's focus. X11 clients talk to ibus
// instead, so their fields only show up as panel events.
export class FocusTracker {
    #ibusFocused = false;
    #focusInId = 0;
    #focusOutId = 0;

    constructor() {
        const ibus = getIBusManager();
        this.#focusInId = ibus.connect('focus-in', () => {
            this.#ibusFocused = true;
        });
        this.#focusOutId = ibus.connect('focus-out', () => {
            this.#ibusFocused = false;
        });
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
    }

    // Sample before the overlay opens: a modal grab takes the keyboard away
    // from the client, which ends its text-input focus along with it.
    capture(): Destination {
        const field = focusedInputMethod() || this.#ibusFocused;
        return field ? 'field' : 'clipboard';
    }
}

function focusedInputMethod(): boolean {
    const focus = (Main.inputMethod as InputMethod).currentFocus;
    return focus?.is_focused() ?? false;
}
