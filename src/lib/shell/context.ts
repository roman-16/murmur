import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gvc from 'gi://Gvc';
import Meta from 'gi://Meta';
import NM from 'gi://NM';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getMixerControl} from 'resource:///org/gnome/shell/ui/status/volume.js';

import {fromAsync} from '../async.js';
import {type Head, logLine} from '../context-log.js';
import {errorMessage} from '../errors.js';
import {appendPrivately} from '../files.js';
import type {Happened, Moment} from '../transcript.js';
import {CLIENT_NAME} from './audio.js';
import {MediaPlayers} from './media.js';

const LEVEL_METERS = ['org.gnome.VolumeControl', 'org.PulseAudio.pavucontrol'];
const TICK_MS = 1000;

export type ContextOptions = {
    audio: Gio.File;
    awaySeconds: number;
    follow: boolean;
    log: Gio.File;
    settleSeconds: number;
    startedUs: number;
};

type How = 'now' | 'settle' | 'silent';

type Change = {id: string; moment: Moment | null; since: number};

type Watched = {begun: boolean; off: Moment | null; pending: Change | null; written: string | null};

type Presence = {off: Moment; on: Moment};

export class ContextWatch {
    readonly #cancellable = new Gio.Cancellable();
    readonly #disconnects: (() => void)[] = [];
    readonly #options: ContextOptions;
    readonly #started: Promise<void>;
    readonly #watched = new Map<string, Watched>();

    #followed: {ids: number[]; window: Meta.Window} | null = null;
    #locked = false;
    #media: MediaPlayers | null = null;
    #queue: Promise<void>;
    #stopped = false;

    constructor(options: ContextOptions) {
        this.#options = options;
        this.#started = this.#start().catch(error =>
            console.error(`murmur: recording context: ${errorMessage(error)}`));
        this.#queue = this.#started;
    }

    set locked(locked: boolean) {
        if (locked === this.#locked)
            return;
        this.#locked = locked;
        this.#append({at: this.#now(), kind: 'lock', on: locked});
    }

    async stop(): Promise<void> {
        if (!this.#stopped) {
            this.#stopped = true;
            this.#cancellable.cancel();
            this.#unfollow();
            for (const disconnect of this.#disconnects.splice(0))
                disconnect();
            this.#media?.destroy();
            this.#media = null;
        }
        await this.#started;
        await this.#queue;
    }

    async #start(): Promise<void> {
        const {audio, follow, log} = this.#options;
        const [media, network] = await Promise.all([
            follow ? MediaPlayers.open(this.#cancellable).catch(() => null) : null,
            follow ? openNetwork(this.#cancellable) : null,
        ]);
        if (this.#stopped) {
            media?.destroy();
            return;
        }
        this.#media = media;

        const mixer = getMixerControl();
        const ready = mixer.get_state() === Gvc.MixerControlState.READY;
        const head: Head = {
            audio: audio.get_path() ?? '',
            computer: GLib.get_host_name(),
            microphone: ready ? descriptionOf(mixer.get_default_source()) : null,
            network: network ? networkName(network) : null,
            output: ready ? descriptionOf(mixer.get_default_sink()) : null,
        };
        await appendPrivately(log, logLine(head));
        if (this.#stopped)
            return;

        this.#observe('microphone', {device: head.microphone, kind: 'microphone'}, 'silent');
        this.#observe('output', {device: head.output, kind: 'output'}, 'silent');
        if (network) {
            this.#observe('network', {kind: 'network', name: head.network}, 'silent');
            this.#watchNetwork(network);
        }
        if (follow) {
            this.#watchWindows();
            this.#watchCamera();
            this.#watchSharing();
            this.#watchIdle();
        }
        this.#watchSound(mixer);

        const tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
            this.#tick();
            return GLib.SOURCE_CONTINUE;
        });
        this.#disconnects.push(() => GLib.source_remove(tickId));
    }

    #watchSound(mixer: Gvc.MixerControl): void {
        const sync = () => this.#syncSound(mixer, 'settle');
        const ids = [
            mixer.connect('default-sink-changed', sync),
            mixer.connect('default-source-changed', sync),
            mixer.connect('state-changed', sync),
            mixer.connect('stream-added', sync),
            mixer.connect('stream-changed', sync),
            mixer.connect('stream-removed', sync),
        ];
        this.#disconnects.push(() => ids.forEach(id => mixer.disconnect(id)));
        if (this.#media)
            this.#media.onChanged = sync;
        this.#syncSound(mixer, 'now');
    }

    #syncSound(mixer: Gvc.MixerControl, how: How): void {
        if (mixer.get_state() !== Gvc.MixerControlState.READY)
            return;
        this.#observe('microphone',
            {device: descriptionOf(mixer.get_default_source()), kind: 'microphone'}, how);
        this.#observe('output', {device: descriptionOf(mixer.get_default_sink()), kind: 'output'}, how);
        if (!this.#options.follow)
            return;

        const players = this.#media?.players ?? [];
        const playing = new Map<string, Presence>();
        for (const player of players.filter(each => each.playing)) {
            playing.set(player.app.toLowerCase(), {
                off: {app: player.app, kind: 'stopped'},
                on: {app: player.app, artist: player.artist, kind: 'playing', title: player.title},
            });
        }
        for (const stream of mixer.get_sink_inputs()) {
            const app = appOf(stream);
            if (!app || stream.is_event_stream || players.some(player => sameApp(player.app, app)))
                continue;
            playing.set(app.toLowerCase(), {
                off: {app, kind: 'stopped'},
                on: {app, artist: null, kind: 'playing', title: null},
            });
        }
        this.#present('playing', playing, how);

        const calls = new Map<string, Presence>();
        for (const stream of mixer.get_source_outputs()) {
            const app = appOf(stream);
            if (!app || LEVEL_METERS.includes(stream.get_application_id() ?? ''))
                continue;
            calls.set(app.toLowerCase(), {
                off: {app, kind: 'call', on: false},
                on: {app, kind: 'call', on: true},
            });
        }
        this.#present('call', calls, how);
    }

    #present(prefix: string, present: Map<string, Presence>, how: How): void {
        for (const [name, {off, on}] of present) {
            this.#observe(`${prefix}:${name}`, on, how);
            const watched = this.#watched.get(`${prefix}:${name}`);
            if (watched)
                watched.off = off;
        }
        for (const [key, watched] of this.#watched) {
            if (key.startsWith(`${prefix}:`) && !present.has(key.slice(prefix.length + 1)))
                this.#observe(key, watched.off, how);
        }
    }

    #watchWindows(): void {
        const at = this.#now();
        for (const window of global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null))
            this.#append({...windowMoment('open', window), at});
        const id = global.display.connect('notify::focus-window', () => this.#syncFocus('settle'));
        this.#disconnects.push(() => global.display.disconnect(id));
        this.#syncFocus('now');
    }

    #syncFocus(how: How): void {
        const window = global.display.focus_window;
        if (window !== this.#followed?.window) {
            this.#unfollow();
            if (window)
                this.#follow(window);
        }
        this.#observe('focus', window ? windowMoment('focused', window) : null, how);
    }

    #follow(window: Meta.Window): void {
        const ids = [
            window.connect('notify::title', () => this.#syncFocus('settle')),
            window.connect('unmanaged', () => this.#unfollow()),
        ];
        this.#followed = {ids, window};
    }

    #unfollow(): void {
        const followed = this.#followed;
        this.#followed = null;
        followed?.ids.forEach(id => followed.window.disconnect(id));
    }

    #watchCamera(): void {
        const camera = new Shell.CameraMonitor();
        const sync = (how: How) =>
            this.#observe('camera', {kind: 'camera', on: camera.cameras_in_use}, how);
        const id = camera.connect('notify::cameras-in-use', () => sync('settle'));
        this.#disconnects.push(() => camera.disconnect(id));
        sync('now');
    }

    // Mutter's remote access controller announces a share once, as it starts,
    // and offers no list of those running, so a share that began before the
    // recording is known only to the shell's own indicator.
    #watchSharing(): void {
        const indicator = Main.panel.statusArea['screenSharing'];
        if (!(indicator instanceof Clutter.Actor))
            return;
        const sync = (how: How) =>
            this.#observe('sharing', {kind: 'sharing', on: indicator.visible}, how);
        const id = indicator.connect('notify::visible', () => sync('settle'));
        this.#disconnects.push(() => indicator.disconnect(id));
        sync('now');
    }

    #watchIdle(): void {
        const monitor = global.backend.get_core_idle_monitor();
        const {awaySeconds} = this.#options;
        let activeId = 0;
        const idleId = monitor.add_idle_watch(awaySeconds * 1000, () => {
            this.#append({at: Math.max(0, this.#now() - awaySeconds), kind: 'away', seconds: awaySeconds});
            if (activeId)
                return;
            activeId = monitor.add_user_active_watch(() => {
                activeId = 0;
                this.#append({at: this.#now(), kind: 'back'});
            });
        });
        this.#disconnects.push(() => {
            monitor.remove_watch(idleId);
            if (activeId)
                monitor.remove_watch(activeId);
        });
    }

    #watchNetwork(client: NM.Client): void {
        const sync = () => this.#observe('network', {kind: 'network', name: networkName(client)}, 'settle');
        const ids = [
            client.connect('active-connection-added', sync),
            client.connect('active-connection-removed', sync),
            client.connect('notify::primary-connection', sync),
        ];
        this.#disconnects.push(() => ids.forEach(id => client.disconnect(id)));
    }

    #observe(key: string, moment: Moment | null, how: How = 'settle'): void {
        const watched = this.#watched.get(key) ?? {begun: false, off: null, pending: null, written: null};
        this.#watched.set(key, watched);
        const change = {id: JSON.stringify(moment), moment, since: this.#now()};
        if (how !== 'settle') {
            this.#settle(watched, change, how === 'silent');
            return;
        }
        if (watched.written === change.id)
            watched.pending = null;
        else if (watched.pending?.id !== change.id)
            watched.pending = change;
    }

    #settle(watched: Watched, change: Change, silent: boolean): void {
        watched.pending = null;
        if (watched.written === change.id)
            return;
        watched.written = change.id;
        const {moment} = change;
        if (!moment)
            return;
        const ending = isEnding(moment);
        const shown = !silent && (!ending || watched.begun);
        watched.begun = !ending;
        if (shown)
            this.#append({...moment, at: change.since});
    }

    #tick(): void {
        const now = this.#now();
        for (const watched of this.#watched.values()) {
            const {pending} = watched;
            if (pending && now - pending.since >= this.#options.settleSeconds)
                this.#settle(watched, pending, false);
        }
    }

    #append(happened: Happened): void {
        if (this.#stopped)
            return;
        const {log} = this.#options;
        this.#queue = this.#queue
            .then(() => appendPrivately(log, logLine(happened)))
            .catch(error => console.error(`murmur: recording context: ${errorMessage(error)}`));
    }

    #now(): number {
        return Math.max(0, Math.round((GLib.get_monotonic_time() - this.#options.startedUs) / 100000) / 10);
    }
}

function isEnding(moment: Moment): boolean {
    switch (moment.kind) {
        case 'call':
        case 'camera':
        case 'sharing':
            return !moment.on;
        case 'stopped':
            return true;
        default:
            return false;
    }
}

function windowMoment(kind: 'focused' | 'open', window: Meta.Window): Moment {
    const app = Shell.WindowTracker.get_default().get_window_app(window)?.get_name() ||
        window.get_wm_class() || '';
    return {app, kind, title: window.get_title() ?? ''};
}

function appOf(stream: Gvc.MixerStream): string | null {
    if (stream.is_virtual || isMurmurs(stream))
        return null;
    return stream.get_name() || stream.get_application_id() || null;
}

function isMurmurs(stream: Gvc.MixerStream): boolean {
    return stream.get_description() === CLIENT_NAME;
}

function sameApp(first: string, second: string): boolean {
    const [one, other] = [first.toLowerCase(), second.toLowerCase()];
    return one.includes(other) || other.includes(one);
}

function descriptionOf(stream: Gvc.MixerStream | null): string | null {
    return stream?.get_description() || null;
}

async function openNetwork(cancellable: Gio.Cancellable): Promise<NM.Client | null> {
    try {
        return await fromAsync(
            callback => NM.Client.new_async(cancellable, callback),
            result => NM.Client.new_finish(result));
    } catch {
        return null;
    }
}

function networkName(client: NM.Client): string | null {
    const primary = client.get_primary_connection();
    const names = primary && !primary.get_vpn() && primary.get_id() ? [primary.get_id()] : [];
    const vpns = client.get_active_connections()
        .filter(connection => connection.get_vpn() && connection.get_id())
        .map(connection => `VPN ${connection.get_id()}`);
    return [...names, ...vpns].join(', ') || null;
}
