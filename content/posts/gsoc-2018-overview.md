---
title: 'GSoC 2018: Overview'
date: Fri, 10 Aug 2018 13:08:36 +0000
draft: false
tags:
- gsoc
- librsvg
- rust
- gnome
- planet-gnome
summary: |
  An overview of my summer work porting the librsvg filter effects from C to Rust and improving their performance.
---

### Introduction

Throughout the summer I was working on librsvg, a GNOME library for rendering SVG files to Cairo surfaces. This post is an overview of the work I did with relevant links.

### My Results

For the [project](https://viruta.org/librsvg-and-gnome-class-accepting-interns.html) I was to port the SVG filter infrastructure of librsvg from C to Rust, adding all missing filter tests from the SVG test suite along the way. I was also expected to implement abstractions to make the filter implementation more convenient, including Rust iterators over the surface pixels. Here's a list of all merge requests accepted into librsvg as part of my GSoC project:

*   Splitting the existing C filter code into individual files for each filter:
    *   [merge request.](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/54)
*   Porting of the filter infrastructure to Rust, fixing bugs, implementing missing features and adding tests:
    *   [feOffset and some initial infrastructure,](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/64)
    *   filter bounds computation: [1](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/66), [2](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/68),
    *   [feComposite and sRGB color conversion implementation,](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/70)
    *   [pixel iterators implementation and benchmarks, port of the filter node,](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/74)
    *   [feMerge, feMergeNode, port of filter input computation,](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/75)
    *   [feImage, reimplementation of the filter bounds computation,](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/77)
    *   [feBlend, feComponentTransfer, feFlood, remaining filter input implementation,](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/82)
    *   [abstractions for safe shared image access, color-interpolation-filters property support,](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/86)
    *   [feColorMatrix, feConvolveMatrix, pixel rectangle with edge mode iterator implementation,](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/90)
    *   [feMorphology, feDisplacementMap, feGaussianBlur, feTurbulence,](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/93)
    *   [feDiffuseLighting, feSpecularLighting, feTile.](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/94)
*   Improving performance of filters:
    *   [alpha-only surface operation optimizations,](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/97)
    *   [box blur benchmarks and optimized box blur implementation,](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/99)
    *   [sRGB⇔linear sRGB conversion optimization,](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/100)
    *   [optimization and parallelization (with rayon) of the lighting and Gaussian blur filters.](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/105)
*   Miscellaneous fixes:
    *   [enabling debuginfo in release builds,](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/95)
    *   [distcheck fix.](https://gitlab.gnome.org/GNOME/librsvg/merge_requests/101)

Here's a convenient link to see all of these merge requests in GitLab: [https://gitlab.gnome.org/GNOME/librsvg/merge_requests?scope=all&utf8=%E2%9C%93&state=all&author_username=YaLTeR&label_name[]=GSoC%202018](https://gitlab.gnome.org/GNOME/librsvg/merge_requests?scope=all&utf8=%E2%9C%93&state=all&author_username=YaLTeR&label_name[]=GSoC%202018)

All of this code was accepted into the mainline and will appear in the next stable release of librsvg. I also wrote the following blog posts detailing some interesting things I worked on as part of the GSoC project:

*   [GSoC 2018: Filter Infrastructure](/blog/gsoc-2018-filter-infrastructure/) talking about the filter infrastructure, pixel iterators and benchmarking and showing an example of implementing a filter primitive;
*   [GSoC 2018: Safe Shared Access to Cairo Image Surfaces](/blog/gsoc-2018-safe-shared-access-to-cairo-image-surfaces/) showcasing the abstractions for safe shared access to Cairo image surface pixel data and showing how it can enable additional optimizations on the example of the alpha-only optimizations;
*   [GSoC 2018: Parallelizing Filters with Rayon](/blog/gsoc-2018-parallelizing-filters-with-rayon/) covering the parallelization of two computationally-intensive filters using the `rayon` crate.

### Further Work

There are a couple of fixes which still need to be done for filters to be feature-complete:

*   [Fixing filters operating on off-screen nodes.](https://gitlab.gnome.org/GNOME/librsvg/issues/1) Currently all intermediate surfaces are limited to the original SVG view area so anything off-screen is inaccessible to filters even when it should be. This is blocked on some considerable refactoring in the main librsvg node drawing code which is currently underway.
*   [Implementing the filterRes property.](https://gitlab.gnome.org/GNOME/librsvg/issues/306) This property allows to set the pixel resolution for filter operations and is one of the ways of achieving more resolution-independent rendering results. While it can be implemented with the current code as is, it will be much more convenient to account for it while refactoring the code to fix the previous issue.
*   [Implementing the enable-background property.](https://gitlab.gnome.org/GNOME/librsvg/issues/261) The `BackgroundImage` filter input should adhere to this property when picking which nodes to include in the background image, whereas it currently doesn't.