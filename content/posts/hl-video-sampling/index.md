---
title: "Motion Blur for Half-Life Video Recording with Vulkan"
date: 2023-04-05T23:06:02-07:00
draft: true
---

THIS IS A DRAFT

[Half-Life] is an award-winning first-person shooter from 1998.
One of many things setting it apart is a fluid player movement system.
You can gradually build up speed in the air by turning the camera left or right while holding the matching movement direction, and you can jump as soon as you hit the ground to avoid losing speed due to friction.

These techniques, called strafing and bunny-hopping, unlocked a whole new dimension to the game, and spawned a big community of mappers and players.
There are hundreds of custom maps with challenging obstacles designed to test one's strafing skills, and thousands of players competing to finish them as fast as possible.

The main hubs for these maps and records are [Xtreme-Jumps] and [Cosy-Climbing].
They are centered around Counter-Strike 1.6, which has similar movement mechanics to Half-Life, but paced slower with a jump-speed limit and some tweaks to the acceleration.
Since both games run on the same GoldSource engine, all maps are also playable in Half-Life, which gives them a unique challenge of trying to maneuver around the map while building up as much speed as possible.

People generally record their runs to in-game demo files.
They are very lightweight as they only contain the dynamic game state, making them easy to store and share.
Players can then capture demos to videos.
There are YouTube channels uploading videos of the best, or notable runs and edits, like [one of the aforementioned Xtreme-Jumps](https://www.youtube.com/@XtremeJumps).

Since this gameplay style is focused on movement, it has been customary to use motion blur for video recordings.
When done right, it can make the video look smoother and nicer to watch; [here's an edit](https://www.youtube.com/watch?v=FRZKSkfOjwQ) (volume warning) recorded with motion blur for example.
Though, ultimately, motion blur is a subjective preference, and plenty of people will tell you how it is completely unwatchable.
Part of this, I suspect, comes from frequent cases of motion blur done *wrong*.
I shudder at the vision of someone dropping a 60 frames-per-second (FPS) video into a 30 FPS Vegas project and leaving frame blending on its default enabled setting.

[Xtreme-Jumps]: https://xtreme-jumps.eu
[Cosy-Climbing]: https://cosy-climbing.net
[Half-Life]: https://store.steampowered.com/app/70/HalfLife/

## How Motion Blur Works

The simplest way to get motion blur is to capture the video at a higher FPS, then blend together multiple frames for every output video frame.
With a closed-source game engine there's not much else you can do, actually.
Thankfully, demos play back smoothly at any FPS, regardless of the FPS the player had when running, so this approach lends itself well to Half-Life.

Let's explore how several frames combine together into the final frame.
This interactive widget shows the final frame at the top, and a set of sixty consecutive sub-frames, or samples, below.
{{< inline-html >}}<span class="green"><strong>Green</strong></span>{{</ inline-html >}} outlines show which of the samples are blended together to form the final frame.
Even though motion blur is best experienced in motion, this still-frame demo should make it clear how it works under the hood.

{{< script sampling.js >}}
{{< html sampling.html >}}

There are two sliders which correspond to two of the most important parameters for controlling the motion blur.
The top one controls the video capturing FPS, usually called "samples per second" or SPS for short in the context of frame blending.
A {{< inline-html >}}<a href="#" onclick="setLowSPS(); return false;">low SPS value</a>{{</ inline-html >}} will produce clearly visible copies of the same objects, making it easy to tell the individual frames that went into the final composite.
A {{< inline-html >}}<a href="#" onclick="setHighSPS(); return false;">high SPS value</a>{{</ inline-html >}} on the other hand will make the composite smooth with no clear boundaries.

The bottom slider controls how much of the 

[In the previous post](/blog/fast-half-life-video-recording-with-vulkan/#specialized-recording-tools) about my Half-Life-specific video recording tool, I wrote about how these kinds of tools can capture video much faster than real-time.
As it turns out, for good motion blur this becomes *extremely important*.
When the player (and hence the world in the camera frame) is moving fast, you need a lot of sub-frames, or samples, to blend together a smooth-looking frame without obvious edges.

This means recording the video at a very high FPS.
For Half-Life movement-oriented maps, you want to go up to at least around 3600 FPS to get a decent result regardless of what's happening on the screen.
If you can only capture the video at 60 real-time FPS, it will take you *sixty times longer* to capture the demo at 3600 FPS compared to its real-time duration.
That is, *an hour* of recording per every minute of the demo.
Basically, you really want your recording to go as fast as your computer allows, without being limited to real-time.

This problem was one of the main drivers for me to explore and make my own Half-Life video recording tools, first [hl-capture], then [bxt-rs].
The widely-used HLAE tool, which has been around for many years, unfortunately had extremely slow recording speed at the time, making it unreasonable to use high FPS for motion blur.
This is why so many of the older videos have clearly visible frame blending artifacts.

Let's see how the process is implemented in bxt-rs.

[hl-capture]: https://github.com/YaLTeR/hl-capture
[bxt-rs]: https://github.com/YaLTeR/bxt-rs

## Frame Blending in bxt-rs

Frame blending is really just pixel-wise weighted averaging of multiple images.
If you know anything about how GPUs work, you can immediately see that this is the *perfect* task to do on a GPU: a ton of mutually-independent computations that can be done in parallel.
Better still, the input images are *already* on the GPU: the game has just rendered them.
This means that we can avoid the costly data transfers between the GPU video memory and the main memory, making the whole process practically instantaneous.

In bxt-rs I [share](/blog/fast-half-life-video-recording-with-vulkan/#sharing-memory-with-opengl) a texture between OpenGL (which [copies](/blog/fast-half-life-video-recording-with-vulkan/#capturing-a-frame) the rendered frame from the game into it) and Vulkan.
The Vulkan part then [converts](/blog/fast-half-life-video-recording-with-vulkan/#color-conversion) the pixel values from the RGB format to YUV 4:2:0, downloads those bytes into the main memory, and [hands them over](/blog/fast-half-life-video-recording-with-vulkan/#video-encoding) to FFmpeg for video encoding.

The frame blending step will live in Vulkan, between receiving a new frame from OpenGL and pixel format conversion.
We only need to output and encode the final blended frame, so intermediate frames can stay in RGB.

We don't actually need all sixty or so frames at once in video memory in the common case.
We can allocate one buffer for the output frame (the *sampling buffer*), then accumulate the intermediate frames into it one by one as they come in.

I chose the R16G16B16 format for the sampling buffer.
It lets us average up to 256 arbitrary frames with no precision loss due to quantization, and an even higher count for reasonable looking frames, but even 256 is more than enough.
By default bxt-rs records at 7200 FPS, which means up to 120 frames with an output FPS of 60, or up to 240 frames with an output FPS of 30---both below 256.

```rust
let create_info = vk::ImageCreateInfo {
    format: vk::Format::R16G16B16A16_UNORM,
    usage:
        // For updating during the sampling stage.
        | vk::ImageUsageFlags::STORAGE
        // For clearing.
        | vk::ImageUsageFlags::TRANSFER_DST
        // For reading during YUV conversion.
        | vk::ImageUsageFlags::SAMPLED,
    // ...
};
let image_sample = device.create_image(&create_info, None)?;
```
