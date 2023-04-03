#!/usr/bin/gjs -m

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gtk.init();
const loop = GLib.MainLoop.new(null, false);
const win = new Gtk.Window({
    title: "Simple",
    default_width: 640,
    default_height: 360,
});
win.connect('close-request', () => loop.quit());

// Make sure test-image.jpg exists!
// You can grab it from the same folder as this script,
// or bring your own.
const image = Gio.File.new_for_path("test-image.jpg");
const pictures = [0, 1].map(() => new Gtk.Picture({
    file: image,
    can_shrink: false,
}));

const shared_hadj = new Gtk.Adjustment();
const shared_vadj = new Gtk.Adjustment();

const scroll1 = new Gtk.ScrolledWindow({
    child: pictures[0],
    hadjustment: shared_hadj,
    vadjustment: shared_vadj,
});
const scroll2 = new Gtk.ScrolledWindow({
    // This pictures[1] widget has the same size as pictures[0].
    child: pictures[1],
    // Same adjustments as above!
    hadjustment: shared_hadj,
    vadjustment: shared_vadj,
});

const box = new Gtk.Box({ homogeneous: true });
box.append(scroll1);
box.append(scroll2);
win.set_child(box);

win.present();
loop.run();
