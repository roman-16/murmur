// A real client for the probe to focus, since an extension runs inside the
// compositor and cannot produce a window of its own.
imports.gi.versions.Gtk = '4.0';

const {Gtk} = imports.gi;

const application = new Gtk.Application({application_id: 'local.murmur.ProbeWindow'});

application.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({
        application,
        title: 'Probe window',
        default_width: 420,
        default_height: 260,
    });
    const entry = new Gtk.Entry({placeholder_text: 'a text field in another window'});
    window.set_child(entry);
    window.present();
    // Focused explicitly: the probe needs this window to be reporting a text
    // field to the compositor, which is what having the caret in it means.
    entry.grab_focus();
});

application.run([]);
