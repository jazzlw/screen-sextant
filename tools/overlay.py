#!/usr/bin/env python3
"""Draw what the detector found on top of a photo, so a fit can be judged by
eye instead of by number.

    python3 tools/overlay.py photo.jpg [out.png]

The geometry comes from the real geom.js, run under the jsc that ships inside
macOS, so what you see is what the app computes. Only the mask stage --
downscale, luminance, Otsu, largest connected component -- is reimplemented
here; it mirrors detect() in index.html.

Yellow  the minimum-area rectangle fitted to the mask
Cyan    after snapQuad refines each side onto the strongest edge
Red     the mask itself, dimmed, so you can see what the threshold gave
"""
import json, os, struct, subprocess, sys, tempfile, zlib

JSC = ("/System/Library/Frameworks/JavaScriptCore.framework/"
       "Versions/A/Helpers/jsc")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LONG_SIDE = 520          # detect()'s working size
SCALE = 2                # upscale the output so thin lines stay visible


# ---------------------------------------------------------------- PNG codec --
def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', "not a PNG"
    p, idat, w, h, ct = 8, b'', None, None, None
    while p < len(d):
        ln = struct.unpack('>I', d[p:p+4])[0]
        typ, data = d[p+4:p+8], d[p+8:p+8+ln]
        if typ == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', data[:10])
            assert bd == 8, "only 8-bit PNGs"
        elif typ == b'IDAT':
            idat += data
        elif typ == b'IEND':
            break
        p += 12 + ln
    raw = zlib.decompress(idat)
    nch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    stride, out, prev, pos = w*nch, bytearray(w*nch*h), bytearray(w*nch), 0
    for y in range(h):
        f = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos+stride]); pos += stride
        if f == 1:
            for i in range(nch, stride): line[i] = (line[i]+line[i-nch]) & 255
        elif f == 2:
            for i in range(stride): line[i] = (line[i]+prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i-nch] if i >= nch else 0
                line[i] = (line[i] + ((a+prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i-nch] if i >= nch else 0
                b, c = prev[i], (prev[i-nch] if i >= nch else 0)
                pa, pb, pc = abs(b-c), abs(a-c), abs(a+b-2*c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i]+pr) & 255
        out[y*stride:(y+1)*stride] = line
        prev = line
    return w, h, nch, bytes(out)


def write_png(path, w, h, rgb):
    raw = b''.join(b'\x00' + bytes(rgb[y*w*3:(y+1)*w*3]) for y in range(h))
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag+data) & 0xFFFFFFFF))
    open(path, 'wb').write(
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(bytes(raw), 6))
        + chunk(b'IEND', b''))


# ------------------------------------------------------------ the mask stage --
def mask_stage(w, h, gray, bias=0):
    """Otsu + largest 4-connected component; mirrors detect() in index.html."""
    hist = [0]*256
    for v in gray: hist[v] += 1
    n = w*h
    total = sum(t*hist[t] for t in range(256))
    sumB = wB = 0; best = 0.0; otsu = 128
    for t in range(256):
        wB += hist[t]
        if not wB: continue
        wF = n - wB
        if not wF: break
        sumB += t*hist[t]
        v = wB*wF*((sumB/wB) - ((total-sumB)/wF))**2
        if v > best: best, otsu = v, t
    thr = max(4, min(251, otsu + bias))

    lab = [-1]*n
    best_id, best_area = -1, 0
    cid = 0
    for s in range(n):
        if gray[s] <= thr or lab[s] != -1: continue
        stack, area = [s], 0
        lab[s] = cid
        while stack:
            p = stack.pop(); area += 1
            px, py = p % w, p // w
            for q, ok in ((p-1, px > 0), (p+1, px < w-1),
                          (p-w, py > 0), (p+w, py < h-1)):
                if ok and gray[q] > thr and lab[q] == -1:
                    lab[q] = cid; stack.append(q)
        if area > best_area: best_area, best_id = area, cid
        cid += 1
    pts = []
    for i in range(n):
        if lab[i] != best_id: continue
        x, y = i % w, i // w
        if (x == 0 or y == 0 or x == w-1 or y == h-1 or
                lab[i-1] != best_id or lab[i+1] != best_id or
                lab[i-w] != best_id or lab[i+w] != best_id):
            pts.append([x+0.5, y+0.5])
    return thr, otsu, lab, best_id, pts


# ------------------------------------------------------------------ drawing --
def draw_line(buf, w, h, a, b, colour, width=2):
    steps = int(max(abs(b[0]-a[0]), abs(b[1]-a[1]))*2) + 1
    for i in range(steps+1):
        t = i/steps
        x, y = a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t
        for oy in range(-width, width+1):
            for ox in range(-width, width+1):
                if ox*ox + oy*oy > width*width: continue
                px, py = int(x)+ox, int(y)+oy
                if 0 <= px < w and 0 <= py < h:
                    j = (py*w+px)*3
                    buf[j:j+3] = bytes(colour)


def draw_quad(buf, w, h, quad, colour, width=2, dot=5):
    q = [(p[0]*SCALE, p[1]*SCALE) for p in quad]
    for i in range(4):
        draw_line(buf, w, h, q[i], q[(i+1) % 4], colour, width)
    for p in q:
        draw_line(buf, w, h, p, p, colour, dot)


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else \
        os.path.splitext(os.path.basename(src))[0] + "-overlay.png"
    bias = int(sys.argv[3]) if len(sys.argv) > 3 else 0

    tmp = tempfile.mkdtemp()
    small = os.path.join(tmp, "small.png")
    subprocess.run(["sips", "-Z", str(LONG_SIDE), "--setProperty", "format",
                    "png", "--out", small, src],
                   check=True, capture_output=True)
    w, h, nch, pix = read_png(small)
    gray = bytearray(w*h)
    for i in range(w*h):
        j = i*nch
        gray[i] = (int(pix[j]*0.299 + pix[j+1]*0.587 + pix[j+2]*0.114)
                   if nch >= 3 else pix[j])

    thr, otsu, lab, best_id, pts = mask_stage(w, h, gray, bias)
    print(f"{w}x{h}  Otsu={otsu}  threshold={thr} (bias {bias:+d})  "
          f"{len(pts)} boundary points")

    json.dump({"w": w, "h": h, "g": list(gray)}, open(os.path.join(tmp, "g.json"), "w"))
    json.dump(pts, open(os.path.join(tmp, "p.json"), "w"))
    driver = os.path.join(tmp, "drive.js")
    open(driver, "w").write(f"""
var G = JSON.parse(read({json.dumps(os.path.join(tmp,'g.json'))}));
var pts = JSON.parse(read({json.dumps(os.path.join(tmp,'p.json'))}));
var r = SA.minAreaRect(pts);
var out = {{rect: r ? SA.corners(r) : null, snap: null, rectInfo: null}};
if (r) {{
  out.rectInfo = {{w: r.w, h: r.h, roll: SA.deg(r.t)}};
  out.snap = SA.snapQuad(G.g, G.w, G.h, r);
}}
print(JSON.stringify(out));
""")
    res = subprocess.run([JSC, "-e", "globalThis.window=globalThis;",
                          os.path.join(ROOT, "geom.js"), driver],
                         capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stdout, res.stderr); sys.exit(1)
    got = json.loads(res.stdout.strip().splitlines()[-1])

    W2, H2 = w*SCALE, h*SCALE
    buf = bytearray(W2*H2*3)
    for y in range(H2):
        for x in range(W2):
            sx, sy = x//SCALE, y//SCALE
            j, k = (y*W2+x)*3, (sy*w+sx)*nch
            if nch >= 3: buf[j:j+3] = pix[k:k+3]
            else: buf[j] = buf[j+1] = buf[j+2] = pix[k]
    # tint the mask so the threshold's contribution is visible
    for i in range(w*h):
        if lab[i] != best_id: continue
        sx, sy = i % w, i // w
        for oy in range(SCALE):
            for ox in range(SCALE):
                j = ((sy*SCALE+oy)*W2 + sx*SCALE+ox)*3
                buf[j] = min(255, buf[j] + 60)

    if got["rect"]: draw_quad(buf, W2, H2, got["rect"], (255, 210, 40), 2)
    if got["snap"]: draw_quad(buf, W2, H2, got["snap"], (60, 230, 240), 2)

    write_png(out, W2, H2, buf)
    ri = got.get("rectInfo")
    if ri:
        print(f"rect {ri['w']:.1f}x{ri['h']:.1f} roll {ri['roll']:.1f}deg   "
              f"snapQuad {'accepted' if got['snap'] else 'declined'}")
    print(f"wrote {out}  ({W2}x{H2})")


if __name__ == "__main__":
    main()
