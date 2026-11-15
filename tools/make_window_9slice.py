"""9-slice: stretch ONLY the short straight mid of the border (no curves).
Interior = semi-transparent white.
"""
from PIL import Image
from pathlib import Path

src = Path(r"C:\Users\sanso\.cursor\projects\d-KirafanEdo-Windows-PC\assets\ScreenWindowFrame-1d03d4f5-d346-49d7-8fcf-c1a4a1f58fdc.png")
if not src.exists():
    src = Path(r"C:\Users\sanso\.cursor\projects\d-KirafanEdo-Windows-PC\assets\ScreenWindowFrame-f83455ad-453f-4c3a-83ae-25c135b79154.png")
out_dir = Path(r"d:\유기오프로\KirafanEdo(Windows PC)\KirafanWeb\assets\ui")
out_dir.mkdir(parents=True, exist_ok=True)


def knock_black(im: Image.Image, thr: int = 28) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8 or (r <= thr and g <= thr and b <= thr):
                px[x, y] = (0, 0, 0, 0)
    return im


def runs(xs):
    if not xs:
        return []
    out = []
    s = p = xs[0]
    for x in xs[1:]:
        if x == p + 1:
            p = x
        else:
            out.append((s, p))
            s = p = x
    out.append((s, p))
    return out


def soften_inner_white(im: Image.Image) -> Image.Image:
    """Turn harsh near-white inner rim into soft light-brown (all corners/edges)."""
    im = im.copy()
    px = im.load()
    w, h = im.size
    # target: soft tan line that blends with frame
    tr, tg, tb, ta = (198, 168, 132, 170)
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 40:
                continue
            # bright white / cream highlights (the jagged inner rim)
            if r >= 220 and g >= 210 and b >= 190 and (r + g + b) >= 640:
                # keep a hint of original brightness but lean brown + translucent
                px[x, y] = (tr, tg, tb, ta)
            elif r >= 235 and g >= 225 and b >= 210:
                px[x, y] = (tr, tg, tb, min(a, ta))
    return im


def find_top_straight(rpx, rw, rh):
    best = None
    for y in range(rh // 3):
        xs = [x for x in range(rw) if rpx[x, y][3] > 40]
        rs = runs(xs)
        if len(rs) < 3:
            continue
        mid = rs[len(rs) // 2]
        length = mid[1] - mid[0] + 1
        if 8 <= length <= 24:
            y0 = y1 = y
            x0, x1 = mid
            for yy in range(y + 1, rh // 3):
                xs2 = [x for x in range(rw) if rpx[x, yy][3] > 40]
                rs2 = runs(xs2)
                if len(rs2) != 3:
                    break
                m2 = rs2[1]
                if abs(m2[0] - x0) > 2 or abs(m2[1] - x1) > 2:
                    break
                y1 = yy
                x0 = max(x0, m2[0])
                x1 = min(x1, m2[1])
            if y1 - y0 + 1 >= 2 and x1 - x0 + 1 >= 6:
                # shrink ends so we don't include curve lead-in
                inset = max(1, (x1 - x0) // 6)
                x0 += inset
                x1 -= inset
                score = (x1 - x0 + 1) * (y1 - y0 + 1)
                if best is None or score > best[0]:
                    best = (score, x0, y0, x1, y1)
    return best


def main():
    raw = knock_black(Image.open(src))
    rpx = raw.load()
    rw, rh = raw.size
    found = find_top_straight(rpx, rw, rh)
    if not found:
        raise SystemExit("no straight segment")
    _, sx0, sy0, sx1, sy1 = found
    print("straight cols/rows", sx0, sy0, sx1, sy1)

    # Corner size: everything left of straight (keep curves in corners only)
    cs_raw = sx0
    # Edge profile: ONE column from the center of the straight segment, full height of corner band
    # so thickness matches corners, but the column itself is from the flat mid (no curve)
    col = (sx0 + sx1) // 2

    scale = 4
    im = raw.resize((rw * scale, rh * scale), Image.Resampling.NEAREST)
    w, h = im.size
    cs = cs_raw * scale

    tl = soften_inner_white(im.crop((0, 0, cs, cs)))
    tr = soften_inner_white(im.crop((w - cs, 0, w, cs)))
    bl = soften_inner_white(im.crop((0, h - cs, cs, h)))
    br = soften_inner_white(im.crop((w - cs, h - cs, w, h)))

    # Single-column profile from straight mid (outer top through flat band only)
    # Height = cs so it fills the border-image edge cell; below the real border pixels stay transparent
    profile = Image.new("RGBA", (1, cs), (0, 0, 0, 0))
    # Copy rows 0..cs-1 from column `col` in scaled image — BUT only until curve starts.
    # Curve starts after sy1; below that in the corner band may be empty/inner. Copy only 0..(sy1+1)*scale
    max_y = min(cs, (sy1 + 1) * scale)
    src_col = col * scale
    pp = profile.load()
    ip = im.load()
    for y in range(max_y):
        pp[0, y] = ip[src_col, y]

    # Also include a few neighboring straight columns averaged? Prefer 2-3 cols of pure straight, then stretch.
    strip_x0 = sx0 * scale
    strip_x1 = (sx1 + 1) * scale
    strip = soften_inner_white(im.crop((strip_x0, 0, strip_x1, max_y)))
    # Verify strip is only straight: already from mid run

    mid = max(80, cs * 2)
    top_edge = strip.resize((mid, max_y), Image.Resampling.NEAREST)
    # Pad into cs-tall cell
    top_cell = Image.new("RGBA", (mid, cs), (0, 0, 0, 0))
    top_cell.paste(top_edge, (0, 0), top_edge)

    bot_cell = Image.new("RGBA", (mid, cs), (0, 0, 0, 0))
    bot_s = top_edge.transpose(Image.FLIP_TOP_BOTTOM)
    bot_cell.paste(bot_s, (0, cs - bot_s.height), bot_s)

    left_cell = Image.new("RGBA", (cs, mid), (0, 0, 0, 0))
    left_s = top_edge.transpose(Image.ROTATE_90)  # (max_y, mid)
    left_cell.paste(left_s, (0, 0), left_s)

    right_cell = Image.new("RGBA", (cs, mid), (0, 0, 0, 0))
    right_s = left_s.transpose(Image.FLIP_LEFT_RIGHT)
    right_cell.paste(right_s, (cs - right_s.width, 0), right_s)

    sheet_w = cs + mid + cs
    sheet_h = cs + mid + cs
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    # Center fill used by deck-page (border-image fill); other pages ignore fill via CSS
    fill = Image.new("RGBA", (mid, mid), (255, 255, 255, 97))
    sheet.paste(fill, (cs, cs), fill)
    sheet.paste(top_cell, (cs, 0), top_cell)
    sheet.paste(bot_cell, (cs, sheet_h - cs), bot_cell)
    sheet.paste(left_cell, (0, cs), left_cell)
    sheet.paste(right_cell, (sheet_w - cs, cs), right_cell)
    sheet.paste(tl, (0, 0), tl)
    sheet.paste(tr, (sheet_w - cs, 0), tr)
    sheet.paste(bl, (0, sheet_h - cs), bl)
    sheet.paste(br, (sheet_w - cs, sheet_h - cs), br)

    out = out_dir / "ScreenWindow9.png"
    sheet.save(out, "PNG")
    strip.resize((strip.width * 6, strip.height * 6), Image.Resampling.NEAREST).save(
        out_dir / "ScreenWindowEdge.png", "PNG"
    )
    tl.save(out_dir / "ScreenWindowCorner.png", "PNG")
    print("saved", out, sheet.size, "cs", cs, "strip", strip.size, "max_y", max_y)


if __name__ == "__main__":
    main()
