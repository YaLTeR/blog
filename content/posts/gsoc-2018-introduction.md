---
title: 'GSoC 2018: Introduction'
date: Mon, 30 Apr 2018 18:43:40 +0000
draft: false
tags:
- gsoc
- librsvg
- rust
- gnome
- planet-gnome
summary: |
  I introduce myself and my GSoC 2018 project to port librsvg filter effects from C to Rust.
---

### Hello!

I'm Ivan Molodetskikh, a student of the Moscow State University, and I love Rust. I learned about Rust after a couple of years of mainly programming personal projects in C++ (with a little bit of C#, Java and others here and there). Making my way through writing the first Rust project (what's a better way to get familiar with a language than trying to make something interesting in it?) and trying out various features of the language, I frequently had moments of "This is actually so much better than the C++ alternative!". Multiple times after inspecting a borrow-related error I realized this has bit me in the past in C++ in a form of a hard to find mistake. Borrowing, lifetimes, iterators, enums, `Option` and `Result` in particular are great once you get a feel of how to use them. The Rust community is amazing too with people always being positive and happy to help newcomers. Fast-forward two years, I have a couple of small Rust projects and some contributions and continuing to enjoy the language. So, it should be of no surprise that when I learned about GSoC I started looking for Rust-related projects. I applied to both [Xi](https://github.com/google/xi-editor/) (a novel text editor with a fully async architecture) and [librsvg](https://gitlab.gnome.org/GNOME/librsvg) (a GNOME library for rendering SVG files) and got accepted into librsvg on a project to help with the ongoing effort to port it to Rust, specifically the SVG filter effects.

### The project

Librsvg is a small library for rendering SVG files in the GNOME ecosystem. Its goal is to be a low-footprint library with a minimal API suitable for rendering things like icons and other images that appear on the desktop. Among other things SVG supports the so-called _filter effects_ which generally (but not always) transform existing SVG elements in one way or another. For example, there's a blur effect, an effect that moves its input by a fixed position, and an effect that loads an external raster image. Currently all filter effects in librsvg are implemented entirely in C. Additionally, most of them aren't covered by specification conformance tests. For this project I'm going to be porting the filter infrastructure to Rust, adding all missing tests and making sure everything works correctly. There's a number of things to get done as part of the project. I'll start by separating the existing C filter code from one huge file into multiple small ones, one for each filter. This will make it easier to port filters to Rust one by one later. Next comes the most interesting part, experimenting with Rust abstractions over common filter actions, such as iterating over pixels in various ways, like one by one or using a square window. This has to be fast and ergonomic and support the different filter use cases. Finally, I'll be porting all filter code from C to Rust and adding the missing filter tests along the way to make sure everything works right.

### Conclusion

I'll be posting about my progress on this blog. If you want to contact me, I'm always in #rust on the [GNOME IRC](https://wiki.gnome.org/Community/GettingInTouch/IRC). And if you're into video game speedruns, this summer I'll be at the ESA hanging out and helping to commentate the Half-Life run. 🙂