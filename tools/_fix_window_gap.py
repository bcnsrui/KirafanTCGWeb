"""Fill the transparent gap between ScreenWindow9's gold frame and center fill.

That gap is part of border-image-slice:148; under FHD scale it reads as a 1px hairline
between the brown/gold frame and the panel background.
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "assets" / "ui"
SRC = ROOT / "ScreenWindow9.png"
FILL = (255, 255, 255, 97)  # same as existing center fill
SLICE = 148


def read_png(path: Path):
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    i = 8
    idat = b""
    w = h = None
    while i < len(data):
        ln = int.from_bytes(data[i : i + 4], "big")
        i += 4
        typ = data[i : i + 4]
        i += 4
        chunk = data[i : i + ln]
        i += ln + 4
        if typ == b"IHDR":
            w, h = struct.unpack(">II", chunk[:8])
        elif typ == b"IDAT":
            idat += chunk
        elif typ == b"IEND":
            break
    raw = zlib.decompress(idat)
    bpp, stride = 4, w * 4
    rows: list[bytearray] = []
    prev = bytearray(stride)
    o = 0
    for _ in range(h):
        filt = raw[o]
        o += 1
        row = bytearray(raw[o : o + stride])
        o += stride
        if filt == 1:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + left) & 255
        elif filt == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
        elif filt == 4:

            def paeth(a, b, c):
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                if pa <= pb and pa <= pc:
                    return a
                if pb <= pc:
                    return b
                return c

            for x in range(stride):
                a = row[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + paeth(a, b, c)) & 255
        rows.append(row)
        prev = bytearray(row)
    return w, h, rows


def write_png(path: Path, w: int, h: int, rows: list[bytearray]) -> None:
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    comp = zlib.compress(raw, 9)

    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", comp)
        + chunk(b"IEND", b"")
    )


def is_frame(r: int, g: int, b: int, a: int) -> bool:
    # Opaque brown/gold frame (not the semi-transparent white center)
    return a > 200 and not (r > 240 and g > 240 and b > 240)


def fill_gap(rows: list[bytearray], w: int, h: int) -> int:
    changed = 0

    def set_fill(x: int, y: int) -> None:
        nonlocal changed
        i = x * 4
        a = rows[y][i + 3]
        if a >= 50:
            return
        rows[y][i : i + 4] = bytes(FILL)
        changed += 1

    # Left band: inward of innermost frame pixel → center
    for y in range(h):
        inner = None
        for x in range(SLICE):
            r, g, b, a = rows[y][x * 4 : x * 4 + 4]
            if is_frame(r, g, b, a):
                inner = x
        if inner is not None:
            for x in range(inner + 1, SLICE):
                set_fill(x, y)

    # Right band
    for y in range(h):
        inner = None
        for x in range(w - 1, w - SLICE - 1, -1):
            r, g, b, a = rows[y][x * 4 : x * 4 + 4]
            if is_frame(r, g, b, a):
                inner = x
        if inner is not None:
            for x in range(w - SLICE, inner):
                set_fill(x, y)

    # Top band
    for x in range(w):
        inner = None
        for y in range(SLICE):
            r, g, b, a = rows[y][x * 4 : x * 4 + 4]
            if is_frame(r, g, b, a):
                inner = y
        if inner is not None:
            for y in range(inner + 1, SLICE):
                set_fill(x, y)

    # Bottom band
    for x in range(w):
        inner = None
        for y in range(h - 1, h - SLICE - 1, -1):
            r, g, b, a = rows[y][x * 4 : x * 4 + 4]
            if is_frame(r, g, b, a):
                inner = y
        if inner is not None:
            for y in range(h - SLICE, inner):
                set_fill(x, y)

    return changed


def main() -> None:
    w, h, rows = read_png(SRC)
    n = fill_gap(rows, w, h)
    write_png(SRC, w, h, rows)
    # verify mid-left gap is no longer empty
    y = h // 2
    sample = [tuple(rows[y][x * 4 : x * 4 + 4]) for x in (60, 80, 100, 120, 140, 148)]
    print(f"filled {n} gap pixels")
    print("mid samples x=60,80,100,120,140,148:", sample)


if __name__ == "__main__":
    main()
