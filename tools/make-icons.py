#!/usr/bin/env python3
"""Regenerate the PWA icons. Run from the repo root: python3 tools/make-icons.py

Pure stdlib -- zlib and struct are all a PNG needs -- so the project keeps its
no-toolchain property. The icons are committed; this only exists so the shapes
can be adjusted later without redrawing them by hand.

The glyph is the measurement itself: a screen rectangle at 2.39:1, two rays
converging on the viewer's eye, and the subtended angle marked between them.
"""
import math
import struct
import zlib

BG     = (0x17, 0x18, 0x1A)
CYAN   = (0x3F, 0xA9, 0xB4)
INK    = (0xED, 0xEA, 0xE3)
YELLOW = (0xC9, 0xB2, 0x33)

SS = 3          # supersampling factor, for antialiasing

# --- glyph geometry, in unit coordinates with y down -------------------------
SCREEN_X0, SCREEN_X1 = 0.16, 0.84
SCREEN_Y0 = 0.19
SCREEN_Y1 = SCREEN_Y0 + (SCREEN_X1 - SCREEN_X0) / 2.39
EYE = (0.5, 0.87)
RAY_W = 0.026
ARC_R = 0.17
ARC_W = 0.022


def dist_to_segment(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / L2))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def sample(x, y):
    """Colour at unit coordinate (x, y). Painted back to front."""
    c = BG

    # angle marker between the two rays
    ex, ey = EYE
    a_left = math.atan2(SCREEN_Y1 - ey, SCREEN_X0 - ex)
    a_right = math.atan2(SCREEN_Y1 - ey, SCREEN_X1 - ex)
    r = math.hypot(x - ex, y - ey)
    if abs(r - ARC_R) <= ARC_W / 2:
        a = math.atan2(y - ey, x - ex)
        if a_left <= a <= a_right:
            c = YELLOW

    # the two sight lines, eye to the screen's lower corners
    if (dist_to_segment(x, y, ex, ey, SCREEN_X0, SCREEN_Y1) <= RAY_W / 2 or
            dist_to_segment(x, y, ex, ey, SCREEN_X1, SCREEN_Y1) <= RAY_W / 2):
        c = INK

    # the eye itself
    if math.hypot(x - ex, y - ey) <= 0.035:
        c = INK

    # the screen, on top
    if SCREEN_X0 <= x <= SCREEN_X1 and SCREEN_Y0 <= y <= SCREEN_Y1:
        c = CYAN

    return c


def render(size, content_scale=1.0):
    """Supersample the glyph down to `size`. content_scale < 1 insets the
    drawing for maskable icons, whose outer ~20% can be cropped away."""
    n = size * SS
    rows = []
    inv = 1.0 / content_scale
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = 0
            for sy in range(SS):
                for sx in range(SS):
                    u = (px * SS + sx + 0.5) / n
                    v = (py * SS + sy + 0.5) / n
                    # inset about the center
                    u = 0.5 + (u - 0.5) * inv
                    v = 0.5 + (v - 0.5) * inv
                    c = BG if not (0 <= u <= 1 and 0 <= v <= 1) else sample(u, v)
                    r += c[0]; g += c[1]; b += c[2]
            k = SS * SS
            row += bytes((r // k, g // k, b // k))
        rows.append(bytes(row))
    return rows


def write_png(path, rows):
    size = len(rows)
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    print(f"{path}  {size}x{size}  {len(png)} bytes")


if __name__ == "__main__":
    for size, name, scale in [
        (192, "icon-192.png", 1.0),
        (512, "icon-512.png", 1.0),
        (512, "icon-maskable-512.png", 0.78),   # safe zone for adaptive masks
        (180, "apple-touch-icon.png", 1.0),
    ]:
        write_png(name, render(size, scale))
