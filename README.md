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
| Silent digital zoom crop | up to 100% | Flagged from EXIF when tagged; don't pinch-zoom |
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
   by rotating calipers over their convex hull.
6. Refine that rectangle into a **quadrilateral**: assign each boundary point to
   its nearest side, fit a total-least-squares line per side, intersect adjacent
   pairs. A keystoned screen still has straight edges — only the rectangle
   assumption fails, not the straightness one. Declines and keeps the rectangle
   whenever the result isn't clearly better.
7. Scale back to native resolution.

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
exif.js      JPEG APP1 -> TIFF -> IFD0 -> Exif sub-IFD. Pure, fully tested.
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
saved per-device calibration  >  EXIF  >  saved fallback  >  no reading
```

The fallback is a value you supplied and chose to keep, for files that carry no
focal length. It is labelled *your saved default*, never *from EXIF* — the
provenance of that number is the difference between a measurement and a guess,
and the readout says which one you have.

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

The `accept="image/jpeg"` on the file input is the other half of red herring 1 —
it makes iOS transcode HEIC on the way in, so the focal-length tag survives. The
*accept any format* link is the escape hatch for desktop PNG screenshots.

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
- [ ] Detect digital zoom when the camera *doesn't* tag it — comparing
      `PixelXDimension` against the sensor's native modes would catch it.
- [ ] Optional: sub-pixel edge refinement (fit an intensity ramp across each
      edge rather than taking the threshold crossing). Probably below the
      focal-length error floor, so low priority.

---

## Reference angles

| Standard | Horizontal subtense |
|---|---|
| SMPTE EG-18 minimum | 36° |
| THX recommended | 40° |
| Typical home 4K guidance | 30–40° |
