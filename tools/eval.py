#!/usr/bin/env python3
"""Score the detector against hand-marked photos.

    python3 tools/eval.py [--sheet out.png] [--bias N] [--only NAME]

Reads example_images/truth.json -- corners marked by hand on each photo in
the 520px working frame -- runs SA.detectScreen from the real geom.js under
jsc on every photo it names, and reports how far each detected corner landed
from the marked one. The photos are not in the repo; truth.json lives with
them in example_images/.

--sheet draws every photo with the marked quad (magenta) and the detected
one (cyan) into one contact sheet, which is the fastest way to see *how* a
fit failed rather than just that it did.
"""
import json, math, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from overlay import JSC, LONG_SIDE, read_png, write_png, draw_line  # noqa: E402

IMAGES = os.path.join(ROOT, "example_images")
CACHE = os.path.join(IMAGES, ".cache")


def load(name, rot):
    """Upright working-size pixels, cached. sips ignores HEIC rotation, so
    truth.json says how far to turn each one."""
    os.makedirs(CACHE, exist_ok=True)
    out = os.path.join(CACHE, f"{name.replace(' ', '_')}.r{rot}.png")
    if not os.path.exists(out):
        cmd = ["sips", "-Z", str(LONG_SIDE), "-s", "format", "png"]
        if rot: cmd += ["-r", str(rot)]
        subprocess.run(cmd + [os.path.join(IMAGES, name), "--out", out],
                       check=True, capture_output=True)
    w, h, nch, pix = read_png(out)
    # the same two buffers prepare() in index.html builds
    if nch < 3:
        gray = peak = [pix[i*nch] for i in range(w*h)]
    else:
        gray = [int(pix[i*nch]*0.299 + pix[i*nch+1]*0.587 + pix[i*nch+2]*0.114)
                for i in range(w*h)]
        peak = [max(pix[i*nch], pix[i*nch+1], pix[i*nch+2]) for i in range(w*h)]
    return w, h, nch, pix, gray, peak


def run(cases, bias):
    tmp = tempfile.mkdtemp()
    data = os.path.join(tmp, "cases.json")
    json.dump([{"w": c["w"], "h": c["h"], "g": c["gray"], "m": c["peak"]}
               for c in cases],
              open(data, "w"))
    driver = os.path.join(tmp, "drive.js")
    open(driver, "w").write(f"""
var C = JSON.parse(read({json.dumps(data)}));
var out = C.map(function(c){{
  var t0 = Date.now();
  var thr = Math.max(4, Math.min(251, SA.otsu(c.g) + {bias}));
  var r = SA.detectScreen(c.g, c.w, c.h, thr,
                          {{also: [{{g: c.m, thr: SA.otsu(c.m)}}]}});
  return {{quad: r ? r.quad : null, source: r ? r.source : "none",
           thr: thr, ms: Date.now() - t0}};
}});
print(JSON.stringify(out));
""")
    res = subprocess.run([JSC, "-e", "globalThis.window=globalThis;",
                          os.path.join(ROOT, "geom.js"), driver],
                         capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stdout, res.stderr); sys.exit(1)
    return json.loads(res.stdout.strip().splitlines()[-1])


def sheet(path, cases, results):
    C, cols = LONG_SIDE, 5
    rows = (len(cases) + cols - 1)//cols
    W, H = cols*C, rows*C
    buf = bytearray(W*H*3)
    for n, (c, r) in enumerate(zip(cases, results)):
        w, h, nch, pix = c["w"], c["h"], c["nch"], c["pix"]
        tile = bytearray(w*h*3)
        for i in range(w*h): tile[i*3:i*3+3] = pix[i*nch:i*nch+3]
        for q, col in ((c["truth"], (255, 0, 255)), (r["quad"], (60, 230, 240))):
            if not q: continue
            for i in range(4):
                draw_line(tile, w, h, q[i], q[(i+1) % 4], col, 1)
        ox, oy = (n % cols)*C, (n//cols)*C
        for y in range(h):
            j = ((oy+y)*W + ox)*3
            buf[j:j+w*3] = tile[y*w*3:(y+1)*w*3]
    write_png(path, W, H, buf)


def main():
    args = sys.argv[1:]
    opt = lambda k, d=None: args[args.index(k)+1] if k in args else d
    bias = int(opt("--bias", 0))
    only = opt("--only")
    truth = json.load(open(os.path.join(IMAGES, "truth.json")))
    cases = []
    for name, t in truth.items():
        if name.startswith("_") or (only and only not in name): continue
        if not os.path.exists(os.path.join(IMAGES, name)):
            print(f"skip {name}: not present"); continue
        w, h, nch, pix, gray, peak = load(name, t.get("rot", 0))
        cases.append(dict(name=name, w=w, h=h, nch=nch, pix=pix, gray=gray, peak=peak,
                          truth=t["quad"], unsure=set(t.get("unsure", []))))
    results = run(cases, bias)

    print(f"{'photo':<18}{'source':<11}{'thr':>4}  {'worst':>6} {'mean':>6}"
          f"  {'%diag':>6}  {'ms':>4}  corner errors TL TR BR BL")
    worst_all, n_ok = [], 0
    for c, r in zip(cases, results):
        diag = math.hypot(*[c["truth"][2][i]-c["truth"][0][i] for i in (0, 1)])
        if r["quad"]:
            errs = [math.hypot(r["quad"][i][0]-c["truth"][i][0],
                               r["quad"][i][1]-c["truth"][i][1]) for i in range(4)]
        else:
            errs = [float("inf")]*4
        sure = [e for i, e in enumerate(errs) if i not in c["unsure"]]
        worst, mean = max(sure), sum(sure)/len(sure)
        pct = 100*worst/diag
        worst_all.append(pct)
        n_ok += pct < 2
        es = " ".join(f"{e:5.1f}{'?' if i in c['unsure'] else ' '}"
                      for i, e in enumerate(errs))
        print(f"{c['name'][:-5]:<18}{r['source']:<11}{r['thr']:>4}  {worst:6.1f} "
              f"{mean:6.1f}  {pct:5.1f}%  {r['ms']:>4}  {es}")
    med = sorted(worst_all)[len(worst_all)//2]
    print(f"\n{n_ok}/{len(cases)} within 2% of the diagonal   "
          f"median worst-corner {med:.1f}%   ('?' = unsure corner, not scored)")
    if opt("--sheet"):
        sheet(opt("--sheet"), cases, results)
        print("wrote", opt("--sheet"))


if __name__ == "__main__":
    main()
