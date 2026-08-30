# Screen Sextant

Measure the angular subtense of a cinema screen from a single phone photo.
No tape measure, no rangefinder, no knowing the screen dimensions.

**Status:** working. No build step, no dependencies, installable offline.

---

## Quick start

**[jazzlw.github.io/screen-sextant](https://jazzlw.github.io/screen-sextant/)** — or open `index.html` locally. Photograph the screen
from your seat, feed it in. The tool finds the lit rectangle and reports how
wide it sits in your field of view.

Works offline as a local file. Installing to a phone home screen needs
`https://` — see [Deployment](#deployment).

Run the tests with `./run-tests.sh`, or open `tests.html` in a browser.

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

### Two numbers, both called "angular subtense"

They are not the same, and conflating them was a real bug here.

**Head-on equivalent** — take this seat's distance from the screen centre and
slide it round onto the centreline: what would it read there?

```
θ = 2·atan(W_real / 2D)          D = distance to the screen centre
```

This strips out two separate distortions at once — where you happened to aim
the camera, and how far off the screen's centreline you're sitting. It is what
SMPTE EG-18 and THX define their targets against, so it is the primary readout
and the one plotted on the meter.

For a fronto-parallel screen the magnification is uniform, so `W_real/D` is
just `w_px/f_px` and no real-world scale is needed:

```
θ = 2·atan(w_px / 2·f_px)
```

Note **distance to the screen centre**, not perpendicular distance to the
screen plane. Sliding sideways along an arc of constant radius keeps you the
same distance from the screen while bringing you closer to the plane its
surface lies in; dividing by the perpendicular distance would make the number
climb as you moved sideways, which is nonsense. The two agree on the
centreline, which is why the distinction stayed invisible until keystone.

**As-seen** — the true angle between the edge rays from where you actually sat:

```
θ = atan((x₂ − c) / f_px) − atan((x₁ − c) / f_px)
```

A flat object viewed off-axis genuinely subtends less. By the concavity of
`atan` this is always ≤ head-on, with equality when the screen is centered.

**The arctangents are differenced, not scaled.** Angular size is linear in
tangent space, not pixel space. The naive `pixels × degrees_per_pixel` shortcut
inflates by 1.8% for a screen filling a third of the frame and 12.9% at 94%.

The two figures agree whenever the photo is aimed at the screen center, which
is the normal case. When they diverge past 1% the tool says so and reports the
off-axis angle, escalating to a reshoot prompt past 3%.

### Distance

Exact pinhole similar triangles:

```
D = W_real × f_px / w_px
```

Correct wherever the screen sits in the frame. The half-angle form
`D = (W/2)/tan(θ/2)` is only equivalent for a screen centered on the optical
axis and overreads otherwise — 4% at 600 px off center.

### Error budget

| Source | Magnitude | Mitigation |
|---|---|---|
| EXIF `f₃₅` is a rounded nominal value | 1–2% | Self-calibrate (below) |
| Missing `f₃₅` | unbounded | *No reading is given* — angles scale directly with it, so a guess would be a confident wrong answer. Supply it once and save it as a fallback |
| Digital zoom | *none, on a spec-compliant camera* | `f₃₅` describes the recorded image, so it already accounts for the zoom — measured below. Costs sharpness, not accuracy |
| Residual barrel distortion, ultrawide | ~1% off-axis | Keep target near center |
| Off-centreline seat (keystone) | 13% on aspect at 20° | *corrected* — rectified, not assumed away |
| Camera roll | 8% on vertical at 2° | *corrected* — fitted, not assumed away |
| Focus-distance breathing | negligible at 20 m | — |

**Self-calibration** gets you under 1%: photograph a known length at a
laser-ranged distance, solve `f_px = pixels × D / L`, back out the implied
`f₃₅ = 36 · f_px / max(W,H)`, and type that into the field. Press *save for
this camera* and it persists in `localStorage`, keyed by EXIF make/model and
capture resolution — the lens is fixed per model, but the pixel pitch changes
with resolution, so both belong in the key.

---

## Detection

1. Downscale to 520 px on the long side.
2. Convert to luminance (Rec. 601 weights).
3. Otsu threshold on the 256-bin histogram, plus a user bias slider.
4. Iterative flood fill (4-connected) over the above-threshold mask; keep the
   largest component.
5. Collect that component's boundary pixels and fit a **minimum-area rectangle**
   by rotating calipers over their convex hull. This is only a starting guess.
6. Refine that rectangle into a **quadrilateral**: assign each boundary point to
   its nearest side, fit a total-least-squares line per side, intersect adjacent
   pairs. A keystoned screen still has straight edges — only the rectangle
   assumption fails, not the straightness one. Declines and keeps the rectangle
   whenever the result isn't clearly better.
7. **Snap each side onto the strongest edge in the image**, which is what
   actually locates the screen — see below. Falls back to step 6, then to the
   rectangle, if no convincing edge is there.
8. Scale back to native resolution.

In a dark auditorium the lit rectangle separates cleanly and this lands first
try. Four corner handles and four edge-midpoint handles for when it doesn't.

### Why a rotated rectangle

The detector used to return an axis-aligned bounding box, which circumscribes
any rolled rectangle rather than fitting it. Hand-held in the dark that is
routinely 1–3° of roll:

| Roll | Horizontal | Vertical | 2.39:1 reads as |
|---|---|---|---|
| 1° | +0.7% | +4.2% | 2.31 |
| 2° | +1.4% | +8.3% | 2.24 |
| 3° | +2.1% | +12.4% | 2.17 |

That was the largest term in the budget and it wasn't in the table. It also
never averages out over repeat shots — circumscribing only ever adds.

A minimum-area rectangle always has one side collinear with a hull edge, so
testing every hull edge is exhaustive rather than a search. Because `w` and `h`
then measure along the screen's own axes, every reported angle is roll-corrected
without any new trigonometry.

### Keystone

Everything above assumes the screen is fronto-parallel. Sit off the centreline
and that breaks: the near edge images larger than the far one, the aspect ratio
comes out wrong, and the distance is wrong with it.

With `f_px` known and four corners marked, the fix is exact and closed form.
Two vanishing points give the 3D directions of the screen's edges; their cross
product is the plane normal; back-projecting each corner ray onto that plane
recovers the rectangle up to one overall scale — which is all the angles need,
since they depend only on ratios.

Measured cost of ignoring it:

| Off centreline | Aspect ratio | Distance |
|---|---|---|
| 10° | −5.4% | +1.4% |
| 20° | −13.0% | +5.7% |
| 30° | −22.5% | +13.9% |
| 40° | −33.4% | +27.6% |

A rectangle's two edge directions must be perpendicular, and how far off they
land is reported as **skew**. It rises if the corners are misplaced *or* if
`f₃₅` is wrong, and cannot distinguish those — so it says both. It has one
blind spot worth knowing: under pure yaw, with one pair of edges still parallel
in the image, symmetry pins the skew to zero for any focal length. It only
bites when both pairs converge.

### Where auto-detection fails, measured

Otsu plus largest-connected-component assumes the screen is the only bright
thing in a dark room. In a living room it isn't. Measured on a real photo of a
wall-mounted screen (520×390 working size, the detector's own downscale):

```
screen interior : p1=46  p5=64  p25=131  p50=170
surrounding wall: p50=40 p75=48  p95=64   p99=159
```

The screen's 5th percentile and the wall's 95th are **the same number**. The
distributions overlap, so no threshold separates them:

| threshold | screen lost | wall leaked |
|---|---|---|
| 48 | 1.6% | 23.9% |
| 64 *(best possible)* | 5.0% | 4.7% |
| 104 *(Otsu's choice)* | 18.8% | 1.4% |
| 136 | 26.4% | 1.2% |

Otsu lands at 104 because the histogram is dominated by the dark room, and
there loses nearly a fifth of the screen — wherever the picture itself is dark.
Turning the threshold down trades that for wall spill, lit by the screen. This
is why the slider doesn't rescue it: **it is not an exposure problem.** Three
things break the assumption at once — the screen's own content spans the full
range down into the wall's, the wall is lit by the screen, and other bright
objects compete.

The consequence is that the mask's boundary is partly *picture content* rather
than the screen's edge, and 22% of the boundary points were interior hole
edges. `refineQuad` fitted lines to those and reported them as screen edges,
turning a serviceable rectangle into a confidently wrong quad:

| | before | after |
|---|---|---|
| aspect | 0.355 | 0.601 |
| obliquity | 50.1° | 5.1° |
| skew | 12.78° | 0.00° |

Two changes. Each side now takes only the *outer silhouette* within its
nearest-side assignment, so hole boundaries cannot pull a side inward. And
`fitLine` returns its RMS residual, which is the check that matters: a side
whose points scatter is not an edge, and the refinement is refused rather than
believed. The minimum-area rectangle then stands, which on this photo is within
about 2% of the truth.

### Snapping to the edge instead of the lit area

The mask can only ever find the *lit* region. The screen's edge is a luminance
discontinuity, though, and that survives whatever is being shown — on the photo
above the step at one edge was 150 → 59 across two pixels, in a region the mask
had already given up on. So `snapQuad` walks perpendicular to each side of the
initial rectangle and fits a line to where the step actually is.

Two things about it are not obvious, and both were found by measurement rather
than reasoning:

**Take the outermost significant step, not the strongest.** Where the picture
is dark at an edge, the biggest step along that normal is lit-picture to
dark-picture, sitting well *inside* the screen. The boundary is the smaller
step from dark picture to wall.

**But outermost alone fails too.** On the same photo's top edge, "outermost"
found a bookshelf 30 px beyond the screen for the left third of the side. What
separates the screen's edge from both impostors is that it runs the *whole
length* of the side — so every significant step is collected as a candidate,
and the chosen line is the outermost one that most samples agree on. That is a
small consensus search over a narrow fan of slopes, the seed side having
already fixed the angle to within a few degrees.

It runs three passes with shrinking search radii. That is not an optimisation:
one pass must pick a single radius, and it needs a large one to reach an edge
the mask fell 30 px short of, but a small one to avoid latching onto the
furniture. Successive passes get the reach of the first and the precision of
the last.

Measured against edges read directly off the photo:

| | worst corner error | aspect | obliquity |
|---|---|---|---|
| minimum-area rectangle | 32.0 px | 0.601 | 5.1° |
| after snapping | **9.6 px** | 0.421 | 32.7° |

Three of the four corners land within 2.3 px. And the snapped quad is
**identical at every threshold**, which the mask fit is not — the slider stops
mattering, because the answer no longer comes from the mask.

Roughly 16 ms at the 520 px working size, so it re-runs live under the
threshold slider.

### Looking at a fit

```
python3 tools/overlay.py photo.jpg out.png [bias]
```

Draws the mask, the rectangle (yellow) and the snapped quad (cyan) over the
photo. The geometry comes from the real `geom.js` run under `jsc`, so what you
see is what the app computes. Judging a fit by eye catches things no assertion
was written for.

**It detects the projected image, not the physical screen.** With masking closed
on a scope feature you'll read 2.39:1 — which is the honest answer for what
you're actually watching. The nearest-standard-ratio readout is a useful sanity
check: if it says 1.85 and you're watching a Villeneuve film, the box is wrong.

---

## Architecture

Four files, no build step, no dependencies.

```
geom.js      pure geometry -- pinhole model, rotated rect, convex hull,
             rotating calipers, single-view rectification. No DOM, no
             state, fully tested.
exif.js      JPEG APP1 -> TIFF -> IFD0 -> Exif sub-IFD, plus the
             diagnostics probe.html renders. Pure, fully tested.
lenses.js    nominal focal lengths by lens type, each with a tolerance.
             Data, not measurement -- see Focal-length precedence.
index.html   design tokens, markup, and one IIFE of glue: detection,
             canvas rendering, handle editing, the calibration store.
probe.html   diagnostics: dumps every tag a file carries, and which
             file-input configuration produced it.
sw.js        cache-first precache so it launches in a dead zone.
```

Classic scripts rather than ES modules, because modules over `file://` hit CORS
and the "just open the file" path matters.

**Two canvases.** An offscreen one holds pixels at native resolution and is
never touched after load. The visible one is redrawn from it each frame with the
overlay composited on top. CSS handles display scaling, so every coordinate in
the code stays in image pixels — conversion happens only at the pointer
boundary in `toImg()`.

State is a handful of module-level globals (`img`, `W`, `H`, `f35`, `quad`).

### Tests

```
./run-tests.sh          headless, via the jsc that ships inside macOS
tests.html              the same assertions, in a browser
probe.html              what a real file on a real device actually contains
```

`tests.js` covers `geom.js` and `exif.js` directly: synthesize a screen of known
size at a known distance, project it through a known focal length, and check the
tool recovers the inputs. EXIF is tested against headers built in the test
itself, both endiannesses, rather than binary fixtures.

`smoke.js` covers the glue. It extracts the inline script from `index.html` and
runs it against a shimmed DOM, so `update()`, `detect()`, the handles and the
calibration store are exercised without a browser or a photo. That extraction is
the fragile part — if it starts failing to find the script, check the regex
before assuming the app broke.

A limitation we've measured but not fixed is reported as `known` rather than
asserted, so it never goes green and never fails the run.

---

## Diagnosing a missing focal length

`probe.html` exists because "no focal length" has three unrelated causes that
look identical from the readout, and guessing between them wasted time:

1. **Not a JPEG.** iOS handed over the original HEIC without transcoding. The
   tag is probably in the file, but the parser is JPEG-only, so it's unreachable.
2. **JPEG with no Exif APP1 at all.** The metadata was never written, or was
   stripped in whatever path produced the file. Unrecoverable in the page.
3. **Exif present, `0xA405` absent.** The camera wrote metadata but not the 35mm
   equivalent. If `FocalLength` (`0x920A`) survived, the equivalent can be
   reconstructed from it plus a per-device crop factor.

The probe reports the container, every JPEG marker segment, every IFD entry
named and typed, and a summary of just the tags this tool uses. It offers the
same file input under four configurations — camera vs library, `image/jpeg` vs
`image/*` — because those two variables are the whole experiment: run all four
on the same scene and the failing combination identifies itself.

### Focal-length precedence

```
per-lens calibration  >  EXIF  >  calibration for a named lens  >  lens preset  >  no reading
```

Every angle is directly proportional to `f₃₅`, so where that number came from
matters as much as its value. Each source carries a tolerance, and when it is
large enough to matter the primary reading prints as a range rather than a
point:

| Source | Tolerance | Reads as |
|---|---|---|
| Calibrated against a known length | 0.5% | `38.4°` |
| EXIF | 2% | `38.4°` |
| Calibrated against a lens you named | 0.5% | `38.4°`, with the lens named |
| Lens preset | 4–6% | `38.4° ±1.6°` |
| Typed by hand | your call | `38.4°` |

**A preset is a guess you confirmed, so it never prints like a measurement.**
It is labelled *assumed lens*, the assumed lens is named in full next to the
reading, and the note says plainly that picking the wrong lens is an error the
band does not cover — because it isn't a tolerance, it's a different lens.

### Why the calibration key includes the lens

A phone carries several lenses — roughly 13, 24, 48, 77 and 120 mm equivalent
on a recent iPhone — and **they all shoot the same pixel dimensions.** A key of
make/model/resolution would therefore apply an ultra-wide calibration to a
telephoto shot and label the result *calibrated*: a 3× error wearing a badge of
confidence. The lens goes in the key, identified by `LensModel` or by the raw
`FocalLength` tag.

The corollary is that a file which identifies no lens cannot be calibrated
against **the file** — there is nothing trustworthy to key on. It can still be
calibrated against a lens the *user* names, which is a claim they can check,
and the reading then discloses that lens every time it is used. A stripped
in-page capture therefore stays fully usable: name the lens once, measure once,
and the 0.5% calibrated tolerance applies from then on.

Which lens you used and what value you measured are **separate facts**, and the
UI keeps them separate. Typing a number changes where the number came from
without erasing which lens it was measured on — collapsing the two would make
the combination impossible to express, which is precisely what a
metadata-stripped file needs.

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

The `accept="image/jpeg"` on the file input was meant as the other half of red
herring 1 — the theory being that naming a concrete type makes iOS transcode
HEIC on the way in so the focal length survives. Measured on an iPhone 16 Pro,
`accept` makes no observable difference either way; see below. It is kept
because it costs nothing and may matter on other versions, with the *accept any
format* link as the escape hatch for desktop PNG screenshots.

---

## Digital zoom is not the error I assumed

The error budget used to lead with *"silent digital zoom crop, up to 100%"*, on
the reasoning that a crop shrinks the field of view while the focal-length tag
still describes the whole lens. Measured on an iPhone 16 Pro, that is wrong —
the same scene, same lens, same output resolution:

| | 1× | pinch-zoomed |
|---|---|---|
| `FocalLength` | 6.765 mm | 6.765 mm |
| `FocalLengthIn35mmFilm` | 24 | **45** |
| `DigitalZoomRatio` | *absent* | 1.3125 |
| `LensModel` | identical | identical |
| Resolution | 5712×4284 | 5712×4284 |

`FocalLengthIn35mmFilm` is defined as the equivalent focal length *for the
recorded image*, and iOS honours that: it rises to 45 while the physical
`FocalLength` stays put. The arithmetic checks out exactly —

```
24 / 6.765 = 3.548   the iPhone 16 Pro's physical sensor crop factor
45 / 6.765 = 6.652   apparent crop of the delivered frame
6.652 / 3.548 = 1.875   total zoom
1.875 / 1.3125 = 1.42857 = 10/7   the lossless sensor-crop portion
```

so `DigitalZoomRatio` is the *upscaled* remainder, and the total zoom is
already in `f₃₅`. **The geometry is unaffected.** What zoom costs is sharpness:
an upscaled frame has softer screen edges, so the edge fit is less precise.
The banner says that instead of the old, false claim that every angle was
overstated.

`cropFactor()` was documented as unable to detect zoom because "a crop leaves
both tags untouched". The opposite is true — it rises from 3.55× to 6.65×,
precisely because `f₃₅` tracks the delivered frame while `FocalLength` does not.

### Why calibrations are stored as a ratio

The two shots above share a `LensModel`, a `FocalLength` and a resolution — so
they share a device key. An absolute calibration saved on the 1× shot would be
re-applied to the zoomed one and be wrong by 1.875×.

So a per-camera calibration is stored as **a ratio against the camera's own
reported `f₃₅`**, not as an absolute millimetre value. The ratio is the lens's
systematic error; because `f₃₅` scales with zoom, the ratio stays correct at
every zoom level. Calibrate once at 1×, and a 2× shot is still right.

The lens-preset case stores absolute millimetres instead, since there is no
reported `f₃₅` to correct and therefore nothing to scale against.

---

## In-page camera capture strips the metadata

Measured, iOS 26.5.2 on an iPhone 16 Pro, all four combinations of
`accept` × `capture`:

| | In-page camera button | Camera app → library |
|---|---|---|
| Exif APP1 | 140 bytes | 8504 bytes |
| Make / Model | absent | `Apple` / `iPhone 16 Pro` |
| FocalLength | absent | 6.765 mm |
| FocalLengthIn35mmFilm | absent | 24 |
| LensModel | absent | `iPhone 16 Pro back triple camera 6.765mm f/1.78` |
| Resolution | 4032×3024 | 5712×4284 |
| Segment order | `JFIF, Exif, Photoshop 3.0, ICC` | `JFIF, Exif, MPF, ICC, AROT` |

Taking the photo through the file picker's own camera button returns a
**re-encoded** JPEG — note the `Photoshop 3.0` resource block, the
`ColorSpace: Uncalibrated`, and the drop from 24 MP to 12 MP. What survives is
exactly what is needed to *display* the image: orientation, resolution, pixel
dimensions. What is gone is exactly what identifies the camera. That reads as a
deliberate privacy profile rather than a dropped tag.

The `accept` and `capture` attributes make no difference. The variable is which
option you pick in the iOS sheet, which the page cannot control or observe.

So the app recognises the signature instead — Exif present, camera identity
absent — and names both the cause and the fix rather than saying "no focal
length" and leaving the user to guess. `strippedByCapture()` requires *all* of
Make, Model, LensModel and both focal lengths to be missing while the Exif
block itself survived; any one of them present rules it out.

---

## Deployment

GitHub Pages, served from the repo root on `main`.

Every path is relative (`./sw.js`, `start_url: "./"`, `scope: "./"`) because a
project page lives under `/screen-sextant/`. An absolute `/` would resolve to
the user root and 404 — and the failure is silent: the install prompt simply
never appears.

**Bump `CACHE` in `sw.js` on every deploy.** The worker is cache-first, which is
the right trade for a tool used where there is no signal, but it means a deploy
is invisible until the version string changes.

To regenerate icons after editing the glyph: `python3 tools/make-icons.py`.

---

## Known limitations

- EXIF parser is JPEG-only. HEIC still *displays* (WebKit delegates to the
  system HEVC decoder) but its metadata lives in an ISOBMFF box structure this
  doesn't parse, so the focal length must be entered by hand. Falls back to
  26 mm — typical iPhone main camera — flagged yellow.
- No lens-distortion model. Fine for the main camera, degrades on ultrawide.
- Assumes optical center at image center. True enough for phones.
- Single frame only. No averaging across a burst.
- Optical centre assumed at the image centre. True to well under a pixel of
  consequence on phones, but an assumption rather than a measurement.
- `skew` is blind to focal-length error under pure yaw (see Keystone above).

---

## Next steps

- [ ] Recognize known device models from EXIF `Make`/`Model` and ship a
      calibration table, so the first shot on a common phone is already
      sub-1% without a manual calibration pass.
- [ ] Confirm on a non-Apple camera that `f₃₅` accounts for zoom the way the
      spec requires. iOS does; a vendor that doesn't would reintroduce the
      error the budget used to claim, and nothing in a single file
      distinguishes the two cases.
- [ ] Move Otsu and the connected-component pass into `geom.js`. They are pure
      functions over a luminance buffer, but they live in `index.html`, so
      `tools/overlay.py` reimplements them and the two can drift.
- [ ] Collect a few more photos with a measured reference and turn them into a
      regression set. One photo drove every tuning decision in `snapQuad`,
      which is one photo too few.

---

## Reference angles

| Standard | Horizontal subtense |
|---|---|
| SMPTE EG-18 minimum | 36° |
| THX recommended | 40° |
| Typical home 4K guidance | 30–40° |
