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
        this.#button.add_style_class_name('screen-recording-indicator');

        const box = new St.BoxLayout();
        this.#countdown = new St.Label({text: '', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this.#countdown);
        box.add_child(new St.Icon({icon_name: 'media-record-symbolic'}));
        this.#button.add_child(box);

        this.#button.connect('button-press-event', () => {
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
