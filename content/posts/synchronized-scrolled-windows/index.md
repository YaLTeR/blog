---
title: "Identity v0.5 and Synchronized Scrolled Windows"
date: 2023-04-05T12:46:58-07:00
tags:
- identity
- gnome
- gtk
- planet-gnome
summary: |
  In the new Identity update I added side-by-side comparison for images and videos. To do it, I synchronize together multiple GtkScrolledWindows. However, that's tricky to implement correctly. This post describes the problems and how to solve them.
---

My university studies and work revolve around image- and video-processing algorithms. I frequently need to compare similar but subtly different output videos: to see how various algorithms solving the same problem behave, or to see the progress as I'm tweaking my own algorithm.

In 2020, I made a GNOME app, [Identity](https://flathub.org/apps/details/org.gnome.gitlab.YaLTeR.Identity), to assist me. It plays multiple videos at once in sync, and lets you switch between them like tabs in a browser. This way you can easily examine the differences at any point.

Identity has seen a number of releases since then and grown a number of helpful features, like zooming or viewing media properties. And now, in v0.5, I have implemented a side-by-side comparison mode. All files are arranged in a row or a column, and their zoom and pan positions are synchronized. You can explore different parts of an image or a video and see how they look across all versions that you opened. This is a quite useful comparison mode, and also more obvious for first-time users.

{{< image-figure column.png >}}
Identity comparing an image with three upscaling methods in a column
{{< /image-figure >}}

Under the hood, every image sits inside a [`GtkScrolledWindow`](https://docs.gtk.org/gtk4/class.ScrolledWindow.html), the standard GTK 4 widget that provides scrolling/panning gestures for its child widget, and draws the scroll bars and the overshoot effect.[^1] It's easy to synchronize two or more of these scrolled windows together, but avoiding weird gesture interactions can be tricky. Let's see how to get them to play along.

[^1]: The subtle glow that shows up when you try to scroll past the end of a scrollable widget.

## Synchronizing Positions

Scrolled windows use [`GtkAdjustment`](https://docs.gtk.org/gtk4/class.Adjustment.html)s to monitor the full size of their child widget and to control its current scroll position. Adjustments are objects with properties for the lower and upper bounds (in our case set to 0 and the full child size), the current value (which is the scroll position), and the step and page increments (which set how far arrow keys and PgUp/PgDown scroll the widget). There are two adjustments in every scrolled window: one for horizontal scrolling, and one for vertical scrolling, called `hadjustment` and `vadjustment`.

To synchronize multiple scrolled windows which show widgets *of matching size*, simply use the same two adjustments for all of them. Scrolling one widget will update the adjustments, causing all other widgets to also update their scroll position.

```js
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
```

You can run [the full example](simple.js) with `gjs -m simple.js`:

![GTK window with two synchronized scrolled windows.](simple.png)

Despite being a relatively simple and supported use-case, adjustment sharing actually makes conditions more favorable for an allocation loss bug that had plagued some of the more complex GTK 4 apps like [Sysprof](https://wiki.gnome.org/Apps/Sysprof) or [GNOME Builder](https://wiki.gnome.org/Apps/Builder). When I implemented the initial version of side-by-side comparison in Identity, I started hitting the bug as well, very easily (panning a video while it was finishing and seeking back to the start was usually enough). So, I decided to investigate, and a few hours of [rr](https://rr-project.org/) and intense discussion in `#gtk` later, I managed to [fix](https://gitlab.gnome.org/GNOME/gtk/-/merge_requests/5564) it! Of course, allocation machinery being very complex, this broke some things, but after [a few](https://gitlab.gnome.org/GNOME/gtk/-/merge_requests/5608) [follow-up](https://gitlab.gnome.org/GNOME/gtk/-/merge_requests/5615) fixes by the GTK maintainers, the bug seems to have been at last completely conquered. The fixes are included in GTK 4.10 and should make their way into GTK 4.8.4.

Anyhow, Identity can show and synchronize images *of different size*. Reusing the same adjustments would cause the upper boundaries to mismatch, and things to break. Instead, I keep track of my own, normalized adjustments, which always range from 0&nbsp;to&nbsp;1.[^2] They are bound back and forth with the scrolled window adjustments, so that scrolling will cause an update to the normalized adjustments, and vice versa. In turn, the value of the normalized adjustments are bound together between all open images. This way, zooming into the center of one image will set the values to 0.5, which will scroll all other images into their centers, regardless of their current size.[^3]

Finally, watch out for widgets which can change their size depending on the scroll position, like [`GtkListView`](https://docs.gtk.org/gtk4/class.ListView.html) with variably-sized items. Scrolling to a particular point may cause such a widget to update the upper boundary of the adjustment and recompute the scroll position relative to what it now believes to be its size. This may cause a cascading reaction with the synchronized widgets, and potentially an infinite loop.

[^2]: These normalized adjustments are also responsible for the behavior when resizing the Identity window with zoomed-in images: instead of always expanding to the bottom-left, the images expand around their current scroll position. This is because the normalized adjustments don't change during resizing. So, for example, a value of 0.25 before and after resizing will keep the image scrolled to 25% of its size.

[^3]: This is not the only way to share position between differently sized scrollable widgets, just one that makes sense for Identity's comparison use-case. You could imagine some other use-case where it makes more sense to share the pixel position, rather than the normalized position. It can be implemented using the same idea of two extra adjustments. It'll work fine as long as different widgets don't try to overwrite the upper bound on the same adjustment with different values.

## Fixing Kinetic Scrolling

Scrolled window implements kinetic deceleration for two-finger panning on a touchpad and one-finger panning on a touchscreen---if you swipe your fingers with some speed, the widget will keep scrolling for a bit, until it comes to a halt. At first it may seem that it works fine---you can try it in the simple example above---until you try to pan one widget, and then quickly pan the other widget, while the first one is still decelerating:

{{< video-figure src="broken-scrolling.mp4" >}}
For this demonstration, I used the "Simulate Touchscreen" toggle in the Inspector
{{< /video-figure >}}

Something weird is happening: it's like the widget doesn't let you pan until the deceleration is over. The reason for this issue is that the pan gesture and the kinetic deceleration live in each scrolled window separately. So when you pan one scrolled window, it starts updating the (shared) adjustment value every frame, and if you try to pan another scrolled window in the meantime, the movement gets continuously overwritten by the first scrolled window.

The workaround is to stop kinetic deceleration on all other scrolled windows when starting the pan. It's further complicated by the fact that the pan gestures themselves live inside the scrolled window, and you can't mess with them. Thankfully, you can catch the two-finger touchpad gesture with a `GtkEventControllerScroll` and the one-finger touchscreen gesture with a `GtkGestureDrag`:

```js
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
```

This gives us panning across all widgets with nice kinetic deceleration which doesn't break. Try [the full example](reset-kinetic.js) with `gjs -m reset-kinetic.js`:[^4]

{{< video-figure src="fixed-scrolling.mp4" >}}
Touchpad panning works as expected across all scrolled windows
{{< /video-figure >}}

There are two extra complications about this code, both related to touchscreen panning. First, we stop the kinetic scrolling on all scrolled windows *excluding* the one handling the new event. This is because for some reason resetting the kinetic scrolling like this in the middle of a touchscreen pan prevents it from working (touchpad pans keep working fine).

Second, we queue an allocation on the scrolled windows right after resetting the kinetic scrolling. For whatever reason, resetting the kinetic scrolling causes the scrolled window to stop handling horizontal touchscreen pans altogether (vertical and mixed pans keep working fine). I suspect it's caused by some logic error related to [`check_attach_pan_gesture()`](https://gitlab.gnome.org/GNOME/gtk/-/blob/80ccfd2138a002714add7432d4998dcafd8f01d5/gtk/gtkscrolledwindow.c#L1044). This function is called when toggling the kinetic scrolling, breaking the horizontal touchscreen pans. Thankfully, it's also called [at the end of allocation](https://gitlab.gnome.org/GNOME/gtk/-/blob/80ccfd2138a002714add7432d4998dcafd8f01d5/gtk/gtkscrolledwindow.c#L1724), where it fixes back the touchscreen pans. I haven't investigated this bug further, but it would be nice to get it fixed.

And that's it! The code we've added also comes in useful for implementing custom gestures like zoom or mouse pan. Just remember that when writing custom gestures, you might need to stop the kinetic scrolling on the current scrolled window too, not only on the linked ones.

[^4]: Unfortunately, "Simulate Touchscreen" won't help you see this fix; you'll need a real touchpad or touchscreen. At the moment, the toggle does not change the device types that the gesture code receives, so it doesn't run our workaround code. To test Identity, I've been using the work-in-progress [Mutter SDK branch](https://gitlab.gnome.org/GNOME/mutter/-/merge_requests/1949) which has a compositor-level touchscreen emulation.

## Closing Thoughts

When synchronizing scrolled windows, and just dealing with GTK gesture code in general, make sure to test with different input devices, as each has its own quirks. Be careful when scrollable widgets have different sizes, or can change their size depending on the scroll position.

At a higher level, I think it would be better if the kinetic deceleration lived somewhere around the `GtkAdjustment`s themselves. This way it would also be shared between all synchronized scrolled windows, and the workarounds, along with their oddities, wouldn't be necessary. Something to keep in mind for GTK 5 perhaps.

When discussing a draft of this post with GTK developers and contributors, another potential GTK 5 idea came up. Different scrollable widgets ([`GtkViewport`](https://docs.gtk.org/gtk4/class.Viewport.html), `GtkListView`, [`GtkTextView`](https://docs.gtk.org/gtk4/class.TextView.html), [WebKitGTK](https://webkitgtk.org/)'s web view, [libshumate](https://gnome.pages.gitlab.gnome.org/libshumate/)'s map) have slightly different needs, and [`GtkScrollable`](https://docs.gtk.org/gtk4/iface.Scrollable.html) with `GtkScrolledWindow` can't offer them all a unified interface that would work without compromises or big technical hurdles. (The last two examples don't implement the scrollable interface for these reasons.) So, maybe, instead of `GtkScrolledWindow`, there should be a collection of helpers, and scrollable widgets should show scrollbars and handle scrolling themselves.

With all that said, if you think Identity might be useful to you, download it [from Flathub](https://flathub.org/apps/details/org.gnome.gitlab.YaLTeR.Identity) and give it a try! I'd love to hear your thoughts, ways to contact me are linked at the bottom of this page.

{{< video-figure src="identity-demo.mp4" >}}
Comparing three videos side-by-side in Identity
{{< /video-figure >}}
