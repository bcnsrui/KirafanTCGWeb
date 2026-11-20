"""Remove the 1px darker rim on CommonButton assets (shows as a hairline under FHD scale)."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "assets" / "ui"
FILL = (255, 253, 231)  # cream body of CommonButton.png


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
        i += ln
        i += 4
        if typ == b"IHDR":
            w, h = struct.unpack(">II", chunk[:8])
        elif typ == b"IDAT":
            idat += chunk
        elif typ == b"IEND":
            break
    raw = zlib.decompress(idat)
    bpp = 4
    stride = w * bpp
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


def fix(path: Path, fill: tuple[int, int, int]) -> None:
    w, h, rows = read_png(path)
    changed = 0
    for y in range(h):
        for x in range(w):
            i = x * 4
            r, g, b, a = rows[y][i : i + 4]
            if a < 200:
                if a == 0:
                    rows[y][i : i + 3] = bytes(fill)
                continue
            # Darker-than-fill rim next to transparent or fill
            if r >= 248 and g >= 248 and b >= 220:
                continue
            rim = False
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-2, 0), (2, 0), (0, -2), (0, 2)):
                xx, yy = x + dx, y + dy
                if not (0 <= xx < w and 0 <= yy < h):
                    continue
                aa = rows[yy][xx * 4 + 3]
                rr, gg, bb = rows[yy][xx * 4 : xx * 4 + 3]
                if aa < 128 or (rr >= 250 and gg >= 250 and bb >= 220):
                    rim = True
                    break
            if rim:
                rows[y][i : i + 3] = bytes(fill)
                changed += 1
    write_png(path, w, h, rows)
    print(f"{path.name}: recolored {changed} rim pixels → {fill}")


def main() -> None:
    # Normal button: cream body
    fix(ROOT / "CommonButton.png", FILL)
    # Pressed: keep a slightly dimmer body, only strip the outer hairline
    w, h, rows = read_png(ROOT / "CommonButtonPush.png")
    # sample center before fix from vercel copy already restored
    cx = w // 2
    cy = h // 2
    body = tuple(rows[cy][cx * 4 : cx * 4 + 3])
    print(f"CommonButtonPush center before rim pass: {body}")
    fix(ROOT / "CommonButtonPush.png", body if body[0] > 200 else FILL)


if __name__ == "__main__":
    main()
