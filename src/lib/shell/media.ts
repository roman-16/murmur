import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {fromAsync} from '../async.js';
import {errorMessage, isCancelled} from '../errors.js';

const BUS = 'org.freedesktop.DBus';
const PATH = '/org/mpris/MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';
const ROOT = 'org.mpris.MediaPlayer2';
const PREFIX = `${ROOT}.`;

export type Player = {app: string; artist: string | null; playing: boolean; title: string | null};

type Watched = {changedId: number; player: Gio.DBusProxy; root: Gio.DBusProxy};

export class MediaPlayers {
    onChanged: (() => void) | null = null;

    readonly #adding = new Set<string>();
    readonly #cancellable: Gio.Cancellable;
    readonly #watched = new Map<string, Watched>();

    #subscriptionId = 0;

    static async open(cancellable: Gio.Cancellable): Promise<MediaPlayers> {
        const media = new MediaPlayers(cancellable);
        media.#subscriptionId = Gio.DBus.session.signal_subscribe(
            BUS, BUS, 'NameOwnerChanged', '/org/freedesktop/DBus', null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _iface, _signal, parameters) => {
                const [name, , owner] = parameters.deepUnpack() as [string, string, string];
                if (!name.startsWith(PREFIX))
                    return;
                if (owner)
                    void media.#add(name);
                else
                    media.#remove(name);
            });
        const listed = await fromAsync(
            callback => Gio.DBus.session.call(BUS, '/org/freedesktop/DBus', BUS, 'ListNames',
                null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1,
                media.#cancellable, callback),
            result => Gio.DBus.session.call_finish(result));
        const [names] = listed.deepUnpack() as [string[]];
        await Promise.all(names.filter(name => name.startsWith(PREFIX)).map(name => media.#add(name)));
        return media;
    }

    private constructor(cancellable: Gio.Cancellable) {
        this.#cancellable = cancellable;
    }

    get players(): Player[] {
        return [...this.#watched.entries()].map(([name, {player, root}]) => {
            const metadata =
                (player.get_cached_property('Metadata')?.recursiveUnpack() ?? {}) as Record<string, unknown>;
            const identity = root.get_cached_property('Identity')?.unpack();
            const title = metadata['xesam:title'];
            const artists = metadata['xesam:artist'];
            const artist = Array.isArray(artists)
                ? artists.filter(each => typeof each === 'string' && each.trim()).join(', ')
                : '';
            return {
                app: typeof identity === 'string' && identity ? identity : name.slice(PREFIX.length),
                artist: artist || null,
                playing: player.get_cached_property('PlaybackStatus')?.unpack() === 'Playing',
                title: typeof title === 'string' && title.trim() ? title : null,
            };
        });
    }

    destroy(): void {
        this.#cancellable.cancel();
        if (this.#subscriptionId) {
            Gio.DBus.session.signal_unsubscribe(this.#subscriptionId);
            this.#subscriptionId = 0;
        }
        for (const name of this.#watched.keys())
            this.#remove(name);
        this.onChanged = null;
    }

    async #add(name: string): Promise<void> {
        if (this.#watched.has(name) || this.#adding.has(name))
            return;
        this.#adding.add(name);
        try {
            const [root, player] = await Promise.all([ROOT, PLAYER].map(iface => fromAsync(
                callback => Gio.DBusProxy.new(Gio.DBus.session, Gio.DBusProxyFlags.DO_NOT_AUTO_START,
                    null, name, PATH, iface, this.#cancellable, callback),
                result => Gio.DBusProxy.new_finish(result))));
            if (!root || !player || !player.get_name_owner() || this.#cancellable.is_cancelled())
                return;
            const changedId = player.connect('g-properties-changed', () => this.onChanged?.());
            this.#watched.set(name, {changedId, player, root});
            this.onChanged?.();
        } catch (error) {
            if (!isCancelled(error))
                console.debug(`murmur: media player ${name}: ${errorMessage(error)}`);
        } finally {
            this.#adding.delete(name);
        }
    }

    #remove(name: string): void {
        const watched = this.#watched.get(name);
        if (!watched)
            return;
        watched.player.disconnect(watched.changedId);
        this.#watched.delete(name);
        this.onChanged?.();
    }
}
