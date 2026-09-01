import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const ROLE = 'murmur';

// A recording that can be put out of sight needs somewhere to still be seen,
// which is the problem GNOME already solved for screen recording. Wearing that
// indicator's style class puts Murmur in the same pill, whatever the theme.
export class RecordingIndicator {
    onToggle: (() => void) | null = null;

    readonly #button: PanelMenu.Button;
    readonly #countdown: St.Label;

    constructor() {
        this.#button = new PanelMenu.Button(0, 'Murmur', true);
        this.#button.accessible_role = Atk.Role.PUSH_BUTTON;
        this.#button.add_style_class_name('screen-recording-indicator');

        const box = new St.BoxLayout();
        this.#countdown = new St.Label({text: '', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this.#countdown);
        box.add_child(new St.Icon({icon_name: 'media-record-symbolic'}));
        this.#button.add_child(box);

        // Touch and pointer both, from the one signal that carries them in every
        // shell version Murmur runs in: the gesture the shell itself moved to is
        // GNOME 50 and later.
        this.#button.connect('event', (_actor, event: Clutter.Event) => {
            const type = event.type();
            if (type !== Clutter.EventType.BUTTON_PRESS &&
                type !== Clutter.EventType.TOUCH_BEGIN)
                return Clutter.EVENT_PROPAGATE;
            this.onToggle?.();
            return Clutter.EVENT_STOP;
        });
        this.#button.connect('key-press-event', (_actor, event: Clutter.Event) => {
            const symbol = event.get_key_symbol();
            if (symbol !== Clutter.KEY_Return && symbol !== Clutter.KEY_KP_Enter &&
                symbol !== Clutter.KEY_ISO_Enter && symbol !== Clutter.KEY_space)
                return Clutter.EVENT_PROPAGATE;
            this.onToggle?.();
            return Clutter.EVENT_STOP;
        });

        Main.panel.addToStatusArea(ROLE, this.#button, 0, 'right');
    }

    destroy(): void {
        this.#button.destroy();
    }

    set countdown(text: string) {
        this.#countdown.text = text;
    }
}
