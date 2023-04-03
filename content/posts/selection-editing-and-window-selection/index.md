---
title: 'GSoC 2021: Selection Editing and Window Selection'
date: Thu, 15 Jul 2021 12:39:43 +0000
draft: false
tags:
- gsoc
- gnome-shell
- screenshot-ui
- gnome
- planet-gnome
summary: |
  I show my progress on the GNOME Shell screenshot UI: the new area selection draggable corner handles, an improved opening animation, window selection, X11 support.
---

This summer I'm implementing a [new screenshot UI](/blog/gsoc-2021-gnome-shell-screenshot-ui/) for GNOME Shell. In this post I'll show my progress over the past two weeks.

{{< image-figure image-2.png >}}
The new screenshot UI in the area selection mode
{{< /image-figure >}}

I spent the most time adding the four corner handles that allow you to adjust the selection. GNOME Shell's drag-and-drop classes were mostly sufficient, save for a few minor things. In particular, I ended up extending the `_Draggable` class with a `drag-motion` signal emitted every time the dragged actor's position changes. I used this signal to update the selection rectangle coordinates so it responds to dragging in real-time without any lag, just as one would expect. Some careful handling was also required to allow dragging the handle past selection edges, so for example it's possible to grab the top-left handle and move it to the right and to the bottom, making it a bottom-right handle.

{{< video-figure screenshot-ui-selection-dragging.webm >}}
Editing the selection by dragging the corner handles
{{< /video-figure >}}

I've also implemented a nicer animation when opening the screenshot UI. Now the screen instantly freezes when you press the Print Screen button and the screenshot UI fades in, without the awkward screenshot blend. Here's a side-by-side comparison to the previous behavior:

{{< video-figure screenshot-ui-blend.webm >}}
Comparison of the old and new opening animation, slowed down 2×
{{< /video-figure >}}

Additionally, I fixed X11 support for the new screenshot capturing. Whereas on Wayland the contents of the screen are readily available because GNOME Shell is responsible for all screen compositing, on X11 that's not always the case: full-screen windows get unredirected, which means they bypass the compositing and go straight through the X server to the monitor. To capture a screenshot, then, GNOME Shell first needs to disable unredirection for one frame and paint the stage.

This X11 capturing works just as well as on Wayland, including the ability to capture transient windows such as tooltips—a long-requested feature. However, certain right-click menus on X11 grab the input and prevent the screenshot UI hotkey (and other hotkeys such as Super to enter the Overview) from working. This has been a long-standing limitation of the X11 session; unfortunately, these menus cannot be captured on X11. On Wayland this is not a problem as GNOME Shell handles all input itself, so windows cannot block its hotkeys.

Finally, over the past few days I've been working on window selection. Similarly to full-screen screenshots, every window's contents are captured immediately as you open the screenshot UI, allowing you to pick the right window at your own pace. To capture the window contents I use Robert Mader's [implementation](https://gitlab.gnome.org/GNOME/mutter/-/merge_requests/1893), which I invoke for all windows from the current workspace when the screenshot UI is opening. I arrange these window snapshots in a grid similar to the Overview and let the user pick the right window.

{{< video-figure screenshot-ui-window-selection.webm >}}
Window selection in action
{{< /video-figure >}}

As usual, the design is nowhere near finished or designer-approved. Consider it an instance of my "programmer art". 😁

My goal was to re-use as much of the Overview window layout code as possible. I ended up making my own copy of the `WorkspaceLayout` class (I was able to strip it down considerably because the original class has to deal with windows disappearing, re-appearing and changing size, whereas the screenshot UI window snapshots never change) and directly re-using the rest of the machinery. I also made my own widget compatible with `WindowPreview`, which exports the few functions used by the layout code, once again considerably simplified thanks to not having to deal with the ever changing real windows.

The next step is to put more work into the window selection to make sure it handles all the different setups and edge cases right: the current implementation is essentially the first working draft that only supports the primary monitor. Then I'll need to add the ability to pick the monitor in the screen selection mode and make sure it works fine with different setups too. I also want to figure out capturing screenshots with a visible cursor, which is currently notably missing from the screenshot UI. After that I'll tackle the screen recording half.

Also, unrelated to the screenshot UI, I'm happy to announce that [my merge request](https://gitlab.gnome.org/GNOME/mutter/-/merge_requests/1762) for reducing input latency in Mutter has finally been merged and should be included in Mutter 41.alpha.

That's it for this post, see you in the next update!