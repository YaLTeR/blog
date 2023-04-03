---
title: 'GSoC 2021: Overview'
date: Sat, 21 Aug 2021 11:14:09 +0000
draft: false
tags:
- gsoc
- gnome-shell
- screenshot-ui
- gnome
- planet-gnome
summary: |
  An overview of my summer work to implement a new screenshot UI into GNOME Shell, and demo of the screencast functionality.
---

Over the summer I worked on implementing the new screenshot UI for GNOME Shell [as part of Google Summer of Code 2021](https://summerofcode.withgoogle.com/projects/#5187703877926912). This post is an overview of the work I did and work still left to do.

The project was about adding a dedicated UI to GNOME Shell for taking screenshots and recording screencasts. The idea was to unify related functionality in a discoverable and easy to use interface, while also improving on several aspects of existing screenshot and screencast tools.

Over the summer, I implemented most of the functionality:

*   Capturing screen and window snapshots immediately, letting the user choose what to save later.
*   Area selection, which can be resized and dragged after the first selection.
*   Screen selection.
*   Window selection presenting an Overview-like view.
*   Mouse cursor capturing which can be toggled on and off inside the UI.
*   Area and screen video recording.
*   Correct handling of HiDPI and mixed DPI setups.

I opened several merge requests:

*   [The main GNOME Shell merge request with the screenshot UI.](https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/1954)
*   [A Mutter merge request adding a function to snapshot the screen into a GPU texture.](https://gitlab.gnome.org/GNOME/mutter/-/merge_requests/1899)
*   [A Mutter merge request adding a function to get the scale of the cursor texture](https://gitlab.gnome.org/GNOME/mutter/-/merge_requests/1967), required for correct mixed DPI handling.

I expect that Mutter merge requests won't require many further changes before merging. The screenshot UI however still has some work that I will do past GSoC, detailed in the main merge request. This work includes adding window selection support for screen recording, ensuring all functionality is keyboard- and touch-accessible, and working with the designers to polish the final result. GNOME 41 is already past the UI freeze, but GNOME 42 seems to me like a realistic target for finishing and landing the screenshot UI.

For the purposes of GSoC, I additionally made two frozen snapshots of work done over the GSoC period that I will not update further: three commits [in this mutter tag](https://gitlab.gnome.org/YaLTeR/mutter/-/commits/gsoc-2021) and 16 commits [in this gnome-shell tag](https://gitlab.gnome.org/YaLTeR/gnome-shell/-/commits/gsoc-2021).

I also wrote several blog posts about my work on the screenshot UI:

*   [GSoC 2021: GNOME Shell Screenshot UI](/blog/gsoc-2021-gnome-shell-screenshot-ui/), an introduction post showing the panel and the initial implementation of area and screen selection.
*   [GSoC 2021: Selection Editing and Window Selection](/blog/gsoc-2021-selection-editing-and-window-selection/), a post showcasing handles for resizing the area selection, a better animation for opening the UI and window selection implementation.
*   [GSoC 2021: Screenshots with Pointer](/blog/gsoc-2021-screenshots-with-pointer/), a post that details how I implemented showing mouse cursor on the screenshots and explains the challenges arising from mixed DPI.

Additionally, I [gave a short presentation](https://www.youtube.com/watch?v=DjmL5YbcPEQ&t=8002s) of my work at GUADEC, GNOME's annual conference.

Over the course of this GSoC project I learned a lot about GNOME Shell's UI internals which will help me with GNOME Shell contributions in the future. I enjoyed working on an awesome upgrade to taking screenshots and screencasts in GNOME. For me participating in the GNOME community is a fantastic experience and I highly recommend everyone to come hang out and contribute.

I would like to once again thank my mentor Jonas Dreßler for answering my questions, as well as Tobias Bernard, Allan Day and Jakub Steiner for providing design feedback.

{{< video-figure screenshot-ui-screen-recording.webm >}}
Screen recording in the new screenshot UI
{{< /video-figure >}}