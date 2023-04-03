#!/usr/bin/gjs -m

import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gtk.init();
const loop = GLib.MainLoop.new(null, false);
const win = new Gtk.Window({
    title: "Reset Kinetic",
    default_width: 640,
    default_height: 360,
});
win.connect('close-request', () => loop.quit());

// Make sure test-image.jpg exists!
// You can grab it from the same folder as this script,
// or bring your own.
const image = Gio.File.new_for_path("test-image.jpg");

// Our scrolled windows, for stopping their kinetic scrolling.
const scrolledWindows = [];

function stopKineticScrollingExcluding(source) {
    for (const widget of scrolledWindows) {
        if (widget === source)
            continue;

        // There's no special function to stop kinetic scrolling,
        // but disabling and enabling it works fine.
        widget.set_kinetic_scrolling(false);
        widget.set_kinetic_scrolling(true);

        // Fix horizontal touchpad panning after resetting
        // kinetic scrolling.
        widget.queue_allocate();
    }
}

// Box for the scrolled windows.
const box = new Gtk.Box({ homogeneous: true });
win.set_child(box);

const shared_hadj = new Gtk.Adjustment();
const shared_vadj = new Gtk.Adjustment();

function createScrolledWindow() {
    // The scrollable widget.
    const picture = new Gtk.Picture({
        file: image,
        can_shrink: false,
    });

    const scrolledWindow = new Gtk.ScrolledWindow({
        child: picture,
        hadjustment: shared_hadj,
        vadjustment: shared_vadj,
    });
    scrolledWindows.push(scrolledWindow);

    // The scroll controller will catch touchpad pans.
    const scrollController = Gtk.EventControllerScroll.new(
        Gtk.EventControllerScrollFlags.BOTH_AXES,
    );
    scrollController.connect('scroll', (scrollController, _dx, _dy) => {
        const device = scrollController.get_current_event_device();
        if (device?.source === Gdk.InputSource.TOUCHPAD) {
            // A touchpad pan is about to start!
            // Let's stop the kinetic scrolling on other widgets.
            stopKineticScrollingExcluding(scrolledWindow);
        }

        // Let the default scrolling work.
        return false;
    });
    picture.add_controller(scrollController);

    // The drag gesture will catch touchscreen pans.
    const dragGesture = new Gtk.GestureDrag();
    dragGesture.connect('drag-begin', (dragGesture, _x, _y) => {
        const device = dragGesture.get_current_event_device();
        if (device?.source === Gdk.InputSource.TOUCHSCREEN) {
            // A touchscreen pan is about to start!
            // Let's stop the kinetic scrolling on other widgets.
            stopKineticScrollingExcluding(scrolledWindow);
        }

        // We don't want to handle the drag.
        dragGesture.set_state(Gtk.EventSequenceState.DENIED);
    });
    picture.add_controller(dragGesture);

    return scrolledWindow;
}

box.append(createScrolledWindow());
box.append(createScrolledWindow());
box.append(createScrolledWindow());

win.present();
loop.run();
