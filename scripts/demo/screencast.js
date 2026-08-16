import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

const POLL_US = 200000;
const TIMEOUT_S = 60;

// GNOME's screencast service ties a recording to the D-Bus connection that
// asked for it, stops it when that connection goes away and refuses a stop from
// any other, so start, take and stop all happen here.
const [path, doneFile] = System.programArgs;
if (!path || !doneFile) {
    printerr('usage: screencast.js PATH DONE_FILE');
    System.exit(2);
}

const framerate = Number(GLib.getenv('DEMO_FRAMERATE') || 30);
const pipeline = GLib.getenv('DEMO_PIPELINE');

let proxy;
try {
    proxy = Gio.DBusProxy.new_for_bus_sync(
        Gio.BusType.SESSION,
        Gio.DBusProxyFlags.NONE,
        null,
        'org.gnome.Shell.Screencast',
        '/org/gnome/Shell/Screencast',
        'org.gnome.Shell.Screencast',
        null);
} catch (error) {
    printerr(`the screencast service is unreachable: ${error}`);
    System.exit(1);
}

// The service picks the container to match the pipeline and answers with the
// name it settled on, which is the only reliable way to know what was written.
function attempt(options) {
    try {
        const [ok, filename] = proxy.call_sync(
            'Screencast',
            new GLib.Variant('(sa{sv})', [path, options]),
            Gio.DBusCallFlags.NONE,
            -1,
            null).deepUnpack();
        if (ok)
            GLib.file_set_contents(`${path}.path`, filename);
        return ok;
    } catch {
        return false;
    }
}

// GNOME's own pipelines trade quality for a recording that keeps up with a
// whole desktop; this one has ten seconds of a mostly still screen to encode,
// so it asks for a far lower quantizer and falls back if that is refused.
function start() {
    const common = {
        'draw-cursor': GLib.Variant.new_boolean(false),
        'framerate': GLib.Variant.new_int32(framerate),
    };
    const variants = pipeline
        ? [{...common, 'pipeline': GLib.Variant.new_string(pipeline)}, common]
        : [common];

    // The service reports the screen as off-screen until the nested session has
    // finished laying its monitor out, so ask until it agrees. A pipeline it
    // will not build never becomes buildable, so that one is given a handful of
    // tries and the fallback gets the rest: waiting the whole budget on it
    // would cost the take its opening seconds.
    const budgets = variants.length > 1 ? [6, 40] : [40];
    for (const [index, options] of variants.entries()) {
        for (let tries = 0; tries < budgets[index]; tries++) {
            if (attempt(options)) {
                print(index === 0 && pipeline
                    ? 'recording with the quality pipeline'
                    : 'recording with the default pipeline');
                return true;
            }
            GLib.usleep(POLL_US);
        }
    }
    return false;
}

if (!start()) {
    printerr('the screencast service refused to start the recording');
    printerr('it needs the GStreamer plugins gnome-shell records with, vp8 and pipewire');
    System.exit(1);
}

// The driver waits for this before it performs, so the take always opens on the
// same frame however long the service took to agree.
GLib.file_set_contents(`${path}.recording`, '');

const deadline = GLib.get_monotonic_time() + TIMEOUT_S * 1000000;
while (!GLib.file_test(doneFile, GLib.FileTest.EXISTS)) {
    if (GLib.get_monotonic_time() > deadline) {
        printerr('the take did not finish in time');
        break;
    }
    GLib.usleep(POLL_US);
}

proxy.call_sync('StopScreencast', null, Gio.DBusCallFlags.NONE, -1, null);
