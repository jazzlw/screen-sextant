# screen_angle_size

Measure the angular subtense of a cinema screen from a single phone photo.
No tape measure, no rangefinder, no knowing the screen dimensions.

**Status:** working. Single file, zero dependencies, no build step.

---

## Quick start

Open `index.html` in a browser. Photograph the screen from your seat, feed it in.
The tool finds the lit rectangle and reports how wide it sits in your field of view.

Works offline as a local file. To install on an iPhone home screen it must be
served over `https://` — see [Next steps](#next-steps).

---

## Why this exists

The obvious method is `θ = 2·atan(W / 2D)` — measure the screen width, measure
your distance, done. Fine at home, useless in a theater where you can't reach
the screen and don't know the throw distance.

The camera solves for both at once. A photo already encodes the angular
relationship; you just need the focal length to decode it.

Off-the-shelf apps don't cover this. The surveying apps (Theodolite et al.) give
you a calibrated reticle to eyeball against. The free "protractor" camera apps
measure the angle *between two lines in the image plane*, which is a different
quantity entirely.

---

## Method

Treat the phone as a rectilinear pinhole camera — approximately true after the
built-in distortion correction Apple and Google apply.

Focal length in pixels, from the EXIF 35mm-equivalent focal length:

```
f_px = max(W_px, H_px) × f₃₅ / 36
```

Using `max(W,H)` rather than `W` makes this orientation-agnostic: the 36 mm
dimension of a 35mm frame always corresponds to the long side of the image.

Horizontal subtense between two pixel columns, with optical center `c`:

```
θ = atan((x₂ − c) / f_px) − atan((x₁ − c) / f_px)
```

**The arctangents are differenced, not scaled.** Angular size is linear in
tangent space, not pixel space. The naive `pixels × degrees_per_pixel` shortcut
inflates by several percent for a target filling much of a wide-angle frame.

Diagonal uses the true angle between corner rays:

```
v = (x − c_x, y − c_y, f_px)
θ_d = acos( v₁·v₂ / (|v₁||v₂|) )
```

Aspect ratio is just the pixel ratio of the box — the screen is planar, so
perspective preserves it as long as you're roughly square-on.

### Error budget

| Source | Magnitude | Mitigation |
|---|---|---|
| EXIF `f₃₅` is a rounded nominal value | 1–2% | Self-calibrate (below) |
| Residual barrel distortion, ultrawide | ~1% off-axis | Keep target near center |
| Silent digital zoom crop | up to 100% | Don't pinch-zoom |
| Off-axis seat (keystone) | small, cosine-ish | Sit near centerline |
| Focus-distance breathing | negligible at 20 m | — |

**Self-calibration** gets you under 1%: photograph a known length at a
laser-ranged distance, solve `f_px = pixels × D / L`, back out the implied
`f₃₅ = 36 · f_px / max(W,H)`, and type that into the field. Good forever for
that lens at that resolution.

---

## Detection

1. Downscale to 520 px on the long side.
2. Convert to luminance (Rec. 601 weights).
3. Otsu threshold on the 256-bin histogram, plus a user bias slider.
4. Iterative flood fill (4-connected) over the above-threshold mask; keep the
   largest component.
5. Bounding box, scaled back to native resolution.

In a dark auditorium the lit rectangle separates cleanly and this lands first
try. Eight drag handles (4 corners, 4 edge midpoints) for when it doesn't.

**It detects the projected image, not the physical screen.** With masking closed
on a scope feature you'll read 2.39:1 — which is the honest answer for what
you're actually watching. The nearest-standard-ratio readout is a useful sanity
check: if it says 1.85 and you're watching a Villeneuve film, the box is wrong.

---

## Architecture

One HTML file, ~480 lines, three blocks: `<style>` with design tokens as CSS
custom properties, the markup, one IIFE of vanilla JS.

```
<style>            design tokens, instrument-panel layout
<body>             intake → canvas stage → readout → controls
<script>           IIFE
  exif35()         JPEG APP1 → TIFF header → IFD0 → Exif sub-IFD → tag 0xA405
                   handles both endiannesses, ~40 lines
  detect()         Otsu + largest connected component
  fpx() angles()   the pinhole math
  draw()           renders overlay from the offscreen canvas
  handles()        8 drag targets
  pointer events   nearest-within-slop hit test
  decode()         the decode ladder (see below)
  update()         single redraw entry point; everything calls this
```

**Two canvases.** An offscreen one holds pixels at native resolution and is
never touched after load. The visible one is redrawn from it each frame with the
overlay composited on top. CSS handles display scaling, so every coordinate in
the code stays in image pixels — conversion happens only at the pointer
boundary in `toImg()`.

State is a handful of module-level globals (`img`, `W`, `H`, `f35`, `box`).

---

## The decode ladder

Worth documenting because it cost three wrong fixes.

Loading the image originally went: `FileReader` → `ArrayBuffer` → `new Blob([buf])`
→ `createObjectURL` → `<img src>`. It failed with a bare "didn't decode" error.

Two red herrings along the way:

1. **Blamed HEIC.** Real issue, wrong one here — iOS transcodes to JPEG only when
   the file input's `accept` attribute names a concrete type like `image/jpeg`;
   with the `image/*` wildcard you get the original HEIC. But that wasn't the
   failure.
2. **Blamed the typeless Blob.** `new Blob([buf])` with no `{type}` produces an
   empty MIME type, and WebKit won't content-sniff a typeless blob URL. A real
   bug, fixed by using the `File` directly — but still not the failure.

**Actual cause:** sandboxed iframes commonly restrict `img-src`, so a `blob:`
URL is refused before the decoder sees any bytes. Format-independent — it failed
on a plain JPEG identically.

**Fix:** `createImageBitmap(file)` decodes the File object with no URL fetch at
all, so there's nothing for CSP to intercept. Now the first rung of a ladder:

```
createImageBitmap  →  data: URL  →  blob: URL  →  report all three failed
```

Plus a diagnostic line reporting dimensions, MIME type, and which rung won.

**Lesson:** an error handler that can't distinguish "bad input" from "blocked
transport" will confidently blame the input. Both wrong fixes came from
trusting my own error message.

---

## Known limitations

- EXIF parser is JPEG-only. HEIC still *displays* (WebKit delegates to the
  system HEVC decoder) but you lose the focal length and must enter it manually.
  Falls back to 26 mm — typical iPhone main camera — flagged yellow.
- No lens-distortion model. Fine for the main camera, degrades on ultrawide.
- Assumes optical center at image center. True enough for phones.
- Single frame only. No averaging across a burst.

---

## Next steps

- [ ] **PWA packaging** — manifest + service worker (cache-first), icon,
      standalone display mode. Theaters are cellular dead zones, so a plain
      bookmark may hang on launch trying to fetch. This is the main blocker for
      real home-screen use.
- [ ] Host it — Netlify Drop is fastest, Vercel if you want it alongside
      existing projects. `https://` is required for Add to Home Screen.
- [ ] Store a per-device calibrated `f₃₅` in `localStorage` so it persists.
- [ ] Recognize known device models from EXIF `Make`/`Model` and apply a
      calibration table.
- [ ] Optional: sub-pixel edge refinement (fit an intensity ramp across each
      edge rather than taking the threshold crossing). Probably below the
      focal-length error floor, so low priority.
- [ ] Handle the off-axis case properly — detect keystone from the quad and
      correct, instead of assuming a square-on rectangle.

---

## Reference angles

| Standard | Horizontal subtense |
|---|---|
| SMPTE EG-18 minimum | 36° |
| THX recommended | 40° |
| Typical home 4K guidance | 30–40° |
