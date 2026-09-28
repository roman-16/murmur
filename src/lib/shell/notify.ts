import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

export type Action = {label: string; run: () => void};

export type Message = {
    actions?: Action[];
    body?: string;
    title: string;
};

let source: MessageTray.Source | null = null;

// A message that offers something to do stays in the tray until it is done;
// one that only informs goes once it has been read.
export function notify(message: Message): void {
    const actions = message.actions ?? [];
    const notification = new MessageTray.Notification({
        body: message.body ?? null,
        isTransient: actions.length === 0,
        source: murmur(),
        title: message.title,
    });
    for (const action of actions)
        notification.addAction(action.label, action.run);
    murmur().addNotification(notification);
}

export function withdrawAll(): void {
    source?.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
    source = null;
}

// The tray drops a source once its last notification is gone, so there is one
// for as long as Murmur has something to say and a new one after that.
function murmur(): MessageTray.Source {
    if (source)
        return source;
    const created = new MessageTray.Source({
        iconName: 'audio-input-microphone-symbolic',
        title: 'Murmur',
    });
    created.connect('destroy', () => {
        if (source === created)
            source = null;
    });
    Main.messageTray.add(created);
    source = created;
    return created;
}
