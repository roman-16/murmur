import type Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';

import {getIBusManager} from 'resource:///org/gnome/shell/misc/ibusManager.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {sleep} from '../async.js';

const FOCUS_POLL_MS = 50;
const FOCUS_WAIT_MS = 600;

export type Destination = 'clipboard' | 'field';

export type Target = {
    destination: Destination;
    inputFocus: Clutter.InputFocus | null;
};

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
    capture(): Target {
        const inputFocus = currentInputFocus();
        const field = inputFocus !== null || this.#ibusFocused;
        return {destination: field ? 'field' : 'clipboard', inputFocus};
    }
}

// The client takes its text-input focus back once the overlay is gone, a
// handful of frames after the close animation starts.
export async function awaitInputFocus(
    focus: Clutter.InputFocus, cancellable: Gio.Cancellable): Promise<boolean> {
    for (let waited = 0; waited < FOCUS_WAIT_MS; waited += FOCUS_POLL_MS) {
        if (currentInputFocus() === focus)
            return true;
        await sleep(FOCUS_POLL_MS, cancellable);
        if (cancellable.is_cancelled())
            return false;
    }
    return currentInputFocus() === focus;
}

// Hands the whole transcription to the client through the input method, the way
// the on-screen keyboard commits its keys: no synthesized keystrokes, so any
// Unicode arrives at once and the keyboard layout is irrelevant.
export function commitText(text: string, focus: Clutter.InputFocus): boolean {
    if (currentInputFocus() !== focus)
        return false;
    inputMethod().commit(text);
    return true;
}

function inputMethod(): InputMethod {
    return Main.inputMethod as InputMethod;
}

function currentInputFocus(): Clutter.InputFocus | null {
    const focus = inputMethod().currentFocus;
    return focus?.is_focused() ? focus : null;
}
