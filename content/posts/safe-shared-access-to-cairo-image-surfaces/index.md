---
title: 'GSoC 2018: Safe Shared Access to Cairo Image Surfaces'
date: Mon, 16 Jul 2018 09:53:00 +0000
draft: false
tags:
- gsoc
- librsvg
- rust
- gnome
- planet-gnome
summary: |
  I describe my abstraction for safe shared access to Cairo image surfaces. I then optimize the performance of heavy filter effects by caching whether an image surface is alpha-only to skip unneeded processing. I verify the performance improvement with perf benchmarks.
---

### Introduction

I'm working on librsvg, a GNOME SVG rendering library, to port the SVG filter effects and related infrastructure from C to Rust. Librsvg uses Cairo, a 2D graphics library, for most of its drawing operations. Cairo can draw to a number of different surfaces like XCB and Xlib windows and pixmaps, PDF documents and PostScript files.

### Image Surfaces

Filter effects operate on rasterized bitmaps, so most of them need direct access to pixel data. There's a special Cairo surface type for that: an image surface, backed by a memory buffer. Filters receive their input images in image surfaces, perform the necessary pixel operations and return new image surfaces with the results. In the Rust bindings, image surfaces are represented by the [`ImageSurface`](https://docs.rs/cairo-rs/0.5.0/cairo/struct.ImageSurface.html) struct. It has a `get_data()` method which returns an `ImageSurfaceData`, which in turn acts as a slice into the underlying memory. Since `ImageSurfaceData` gives mutable access to the surface memory, it must ensure there are no other views into the same memory to comply with Rust's ownership rules. This is achieved by checking that the `ImageSurface` reference count is equal to 1 in `get_data()`, which means that no other references to the `ImageSurface` exist. Furthermore, the `ImageSurface` is borrowed mutably for the lifetime of `ImageSurfaceData`. This is needed to prevent cloning the surface after obtaining `ImageSurfaceData` and subsequently drawing on it with a Cairo context while the view into the surface memory still exists. While this scheme does work, it offers only mutable, unique access to the pixel data. In the filter code, it's much more convenient to have multiple references to the input surfaces with read-only memory access. Simply adding a struct similar to `ImageSurfaceData` which provides only a read-only view into the memory does not allow to drop the unique reference constraint, because it's always possible to use the other reference to concurrently mutate the pixel data.

### Shared Image Surface

To work around the constraints, I ended up creating a special wrapper for `ImageSurface`s:

```rust
#[derive(Debug, Clone)]
struct SharedImageSurface {
    surface: ImageSurface,

    data_ptr: NonNull<u8>, // *const.
    width: i32,
    height: i32,
    stride: isize,
}
```

The idea is to wrap a unique `ImageSurface` and provide just read-only access to it, while allowing cloning of `SharedImageSurface` itself. This way there can be multiple `SharedImageSurface`s without compromising soundness because without direct access to the underlying `ImageSurface` it's impossible to mutate it in any way from the outside. Additionally, since we know the surface won't be modified, we can cache some common properties to get rid of extra C calls which can't be easily optimized away. The `SharedImageSurface` constructor ensures the `ImageSurface` it receives is unique:

```rust
impl SharedImageSurface {
    pub fn new(
        surface: ImageSurface,
    ) -> Result<Self, cairo::Status> {
        // get_pixel() assumes ARgb32.
        assert_eq!(
            surface.get_format(),
            cairo::Format::ARgb32
        );

        // Ensure the access is unique.
        let reference_count = unsafe {
            cairo_sys::cairo_surface_get_reference_count(
                surface.to_raw_none(),
            )
        };
        assert_eq!(reference_count, 1);

        // Flush any pending drawing operations before
        // accessing the memory directly.
        surface.flush();
        if surface.status() != cairo::Status::Success {
            return Err(surface.status());
        }

        let data_ptr = NonNull::new(unsafe {
            cairo_sys::cairo_image_surface_get_data(
                surface.to_raw_none(),
            )
        }).unwrap();

        let width = surface.get_width();
        let height = surface.get_height();
        let stride = surface.get_stride() as isize;

        Ok(Self {
            surface,
            data_ptr,
            width,
            height,
            stride,
        })
    }
}
```

And other methods on `SharedImageSurface` provide access to various surface properties, as well as the pixel data:

```rust
impl SharedImageSurface {
    /// Returns the surface width.
    #[inline]
    pub fn width(&self) -> i32 {
        self.width
    }

    /// Returns the surface height.
    #[inline]
    pub fn height(&self) -> i32 {
        self.height
    }

    /// Retrieves the pixel value at the given coordinates.
    #[inline]
    pub fn get_pixel(&self, x: u32, y: u32) -> Pixel {
        assert!(x < self.width as u32);
        assert!(y < self.height as u32);

        let offset =
            y as isize * self.stride + x as isize * 4;
        let ptr = self.data_ptr.as_ptr().offset(offset);

        // According to Cairo documentation, the pixel values
        // for the ARgb32 format should be read using a
        // platform-native u32.
        let value = unsafe { *(ptr as *const u32) };

        Pixel {
            r: ((value >> 16) & 0xFF) as u8,
            g: ((value >> 8) & 0xFF) as u8,
            b: (value & 0xFF) as u8,
            a: ((value >> 24) & 0xFF) as u8,
        }
    }
}
```

Another nice property of wrapping `ImageSurface`s is that it's possible to provide extra utility methods for working with pixel data. Right now we have methods for extracting the alpha channel, resizing the surface, doing linear sRGB to sRGB and vice versa conversions and performing convolutions useful for primitives like Gaussian blur. Pixel iterators I showcased in the previous post were switched to take `SharedImageSurface`s as input. One downside is that any other Cairo APIs that take surfaces as a read-only input need to be wrapped too. Fortunately, so far we needed only the `Context::set_source_surface()` method which allows using the given surface as the pixel source for drawing operations:

```rust
impl SharedImageSurface {
    /// Calls `set_source_surface()` on the given Cairo
    /// context.
    #[inline]
    pub fn set_as_source_surface(
        &self,
        cr: &cairo::Context,
        x: f64,
        y: f64,
    ) {
        cr.set_source_surface(&self.surface, x, y);
    }
}
```

Converting a `SharedImageSurface` back into a regular `ImageSurface` to return it from the filter code does a reference count check too: if it isn't equal to 1, there are other `SharedImageSurface`s pointing at the same `ImageSurface`, which means we cannot simply return the surface as it can be used for modifying the pixel data thus breaking the `SharedImageSurface` invariants. In this case a copy of the surface is created and returned:

```rust
impl SharedImageSurface {
    /// Converts this `SharedImageSurface` back into a Cairo
    /// image surface.
    #[inline]
    pub fn into_image_surface(
        self,
    ) -> Result<ImageSurface, cairo::Status> {
        let reference_count = unsafe {
            cairo_sys::cairo_surface_get_reference_count(
                self.surface.to_raw_none(),
            )
        };

        if reference_count == 1 {
            Ok(self.surface)
        } else {
            // If there are any other references, copy the
            // underlying surface.
            let bounds = IRect {
                x0: 0,
                y0: 0,
                x1: self.width,
                y1: self.height,
            };

            self.copy_surface(bounds)
        }
    }
}
```

### Alpha-Only Optimizations

The most heavy filter primitives are the ones doing image convolutions, mainly the Gaussian blur primitive. A convolution involves computing a weighted sum of pixels within a rectangle for every input pixel. The Gaussian blur primitive is frequently used for creating shadows for other elements. In this case it takes the rasterized element's alpha channel as an input and blurs it. Then the blurred surface is offset a little and drawn below the input surface to create a shadow.

![A yellow circle with a shadow.](temp1.png)

When a convolution is applied to an alpha-only image, there's no need to compute the weighted sum for the other three color channels. However, going through the whole input image to check if it only contains meaningful data in the alpha channel is rather costly. Thankfully, we can avoid that step altogether by caching this property. I added a field into `SharedImageSurface` to indicate whether the current surface is alpha-only, along with a special constructor:

```rust
struct SharedImageSurface {
    /* ... */

    /// Whether this surface contains meaningful data only
    /// in the alpha channel.
    ///
    /// This is used for optimizations, particularly in
    /// `convolve()` to skip processing other channels.
    alpha_only: bool,
}

impl SharedImageSurface {
    pub fn new(
        surface: ImageSurface,
    ) -> Result<Self, cairo::Status> {
        /* ... */

        Ok(Self {
            surface,
            data_ptr,
            width,
            height,
            stride,
            // Default to not alpha only.
            alpha_only: false,
        })
    }

    /// Creates a `SharedImageSurface` from a unique
    /// `ImageSurface` with meaningful data only in the alpha
    /// channel.
    #[inline]
    pub fn new_alpha_only(
        surface: ImageSurface,
    ) -> Result<Self, cairo::Status> {
        let mut rv = Self::new(surface)?;
        rv.alpha_only = true;
        Ok(rv)
    }
}
```

This constructor is used automatically in the `extract_alpha()` method used to separate the alpha channel of the input surface:

```rust
impl SharedImageSurface {
    /// Returns a surface with black background and alpha
    /// channel matching this surface.
    pub fn extract_alpha(
        &self,
        bounds: IRect,
    ) -> Result<SharedImageSurface, cairo::Status> {
        let mut output_surface = ImageSurface::create(
            cairo::Format::ARgb32,
            self.width,
            self.height,
        )?;

        let output_stride =
            output_surface.get_stride() as usize;
        {
            let mut output_data =
                output_surface.get_data().unwrap();

            for (x, y, Pixel { a, .. }) in
                Pixels::new(self, bounds)
            {
                let output_pixel = Pixel {
                    r: 0,
                    g: 0,
                    b: 0,
                    a,
                };

                output_data.set_pixel(
                    output_stride,
                    output_pixel,
                    x,
                    y,
                );
            }
        }

        // The returned surface is alpha-only!
        SharedImageSurface::new_alpha_only(output_surface)
    }
}
```

Finally, the pixel processing methods check the alpha-only flag to reduce the number of operations or skip unneeded processing altogether:

```rust
impl SharedImageSurface {
    /// Returns a surface with pre-multiplication of color
    /// values undone.
    pub fn unpremultiply(
        &self,
        bounds: IRect,
    ) -> Result<SharedImageSurface, cairo::Status> {
        // Unpremultiplication doesn't affect the alpha
        // channel.
        if self.alpha_only {
            return Ok(self.clone());
        }

        let mut output_surface = ImageSurface::create(
            cairo::Format::ARgb32,
            self.width,
            self.height,
        )?;

        let stride = output_surface.get_stride() as usize;
        {
            let mut data =
                output_surface.get_data().unwrap();

            for (x, y, pixel) in Pixels::new(self, bounds) {
                data.set_pixel(
                    stride,
                    pixel.unpremultiply(),
                    x,
                    y,
                );
            }
        }

        SharedImageSurface::new(output_surface)
    }

    /// Performs a convolution.
    pub fn convolve(
        &self,
        bounds: IRect,
        target: (i32, i32),
        kernel: &Matrix<f64>,
        edge_mode: EdgeMode,
    ) -> Result<SharedImageSurface, cairo::Status> {
        assert!(kernel.rows() >= 1);
        assert!(kernel.cols() >= 1);

        let mut output_surface = ImageSurface::create(
            cairo::Format::ARgb32,
            self.width,
            self.height,
        )?;

        let output_stride =
            output_surface.get_stride() as usize;
        {
            let mut output_data =
                output_surface.get_data().unwrap();

            if self.alpha_only {
                // Perform a convolution, taking a weighted
                // sum of only the alpha channel.
            } else {
                // Perform a convolution, taking a weighted
                // sum of all four color channels.
            }
        }

        if self.alpha_only {
            SharedImageSurface::new_alpha_only(
                output_surface,
            )
        } else {
            SharedImageSurface::new(output_surface)
        }
    }
}
```

### Validating Performance

The main motivating example for the optimizations is this old [mobile phone SVG file](https://gitlab.gnome.org/GNOME/librsvg/uploads/ce1fa987a882568bd30d1e48c143f5da/mobile_phone_01.svg) from a [9-year-old issue on performance](https://gitlab.gnome.org/GNOME/librsvg/issues/22) which takes about 40 seconds to render on my desktop PC:

![An old mobile phone.](mobile_phone_012.png)

To measure the performance impact, I built librsvg in release mode with debug info before doing alpha-only optimizations and used the `perf` tool:

```
perf record --call-graph=dwarf ./rsvg-convert -o /dev/null mobile_phone_01.svg
```

I then used the awesome [FlameGraph](https://github.com/brendangregg/FlameGraph) tool to create a nice visualization of the data (click and open in a browser for an interactive SVG):

[![A flame graph of the rendering performance.](temp2.png)](https://gitlab.gnome.org/GNOME/librsvg/uploads/87b5531a6a8ad2477bfed196466cc055/perf.svg)

The large two-part column in the middle happens to be the Gaussian blur, taking up 50.63% of the total rendering time for the mobile phone. Turns out the blur operates on `SourceAlpha`, which contains just the alpha channel of the rasterized element the filter is applied to. After adding the alpha-only optimizations to convolution and other parts of the code like linear sRGB ⇔ sRGB conversion, the rendering time dropped from 40 seconds to 29 seconds, and the performance graph now looks like this:

[![A flame graph of the rendering performance.](temp3.png)](https://gitlab.gnome.org/GNOME/librsvg/uploads/4baad9b6beb115b4ba3170b6b38c25f3/perf3.svg)

The percentage of time taken by Gaussian blur dropped from 50.63% to 36.98%. You can also see a slight drop in the narrow column to the left of the Gaussian blur part: that's the sRGB linearizations which became no-ops on those input images that were alpha-only.

### Conclusion

The project is coming along very well. I've just came back from GUADEC where I really pushed the filter rustification during the hacking days, porting all of the remaining filters from C to Rust. Now that all filters are in Rust and thoroughly tested, I'm looking at improving the performance, starting with the alpha-only optimization described in this post. Also since all SVG nodes are now in Rust (the filter primitives were the last ones), I was able to clean up the remaining C interop code for nodes! It's great to see the intermediate FFI code gradually disappear as the entire subsystems get completely ported to Rust.