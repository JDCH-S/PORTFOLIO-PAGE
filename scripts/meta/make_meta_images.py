"""
Builds the link-preview image and the app icons from the shipped hologram render.

    python scripts/meta/make_meta_images.py [out_dir]     (Pillow + numpy; default out_dir: src/app)

Inputs (read only):
  public/sphere-static.webp   1200x1200 front capture of the hologram on black (the poster, never the photo)
  src/content/content.ts      profile.name and profile.role
  fonts                       Chakra Petch 600 and Geist Mono 500 (the site's display and mono faces, SIL OFL),
                              fetched once from Google Fonts' versioned URLs into ~/.cache, checked by sha256

Outputs (committed; Next.js picks them up by file convention in src/app):
  opengraph-image.jpg       1200x630 link preview; X / twitter:image inherits it. JPEG to stay well under
                            the ~300 KB that WhatsApp accepts for a preview image
  opengraph-image.alt.txt   its alt text
  favicon.ico               16 / 32 / 48: the gold "JD" monogram (16 px is drawn pixel by pixel)
  icon.png                  192x192 monogram, for the places that want a larger icon
  apple-icon.png            180x180: the gold head on the page colour (iOS home screen / bookmarks)

Deterministic: the same inputs give the same bytes. Rerun after recapturing the poster or changing the name / role.
"""

from __future__ import annotations

import hashlib
import io
import os
import re
import struct
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]

# site tokens (src/app/globals.css, src/components/hologram/config.ts)
BG = (4, 6, 15)  # --bg
GOLD = (255, 178, 63)  # --gold
GOLD_HOT = (255, 236, 200)  # --gold-hot
GOLD_DEEP = (255, 106, 0)  # --gold-deep

FONTS = {
    "display": (
        "ChakraPetch-SemiBold.ttf",
        "https://fonts.gstatic.com/s/chakrapetch/v13/cIflMapbsEk7TDLdtEz1BwkeQI5FQA.ttf",
        "b27ff10e18f96386894f25a9e53a3b7c0244a70556461d2a9a99acb3465299fa",
    ),
    "mono": (
        "GeistMono-Medium.ttf",
        "https://fonts.gstatic.com/s/geistmono/v6/or3yQ6H-1_WfwkMZI_qYPLs1a-t7PU0AbeEPKJ5T.ttf",
        "5c1b7b77c2d6132460f03b60c175adc80da1ebd0b418c785135b1aed27a28b30",
    ),
}


def font(key: str, size: int) -> ImageFont.FreeTypeFont:
    name, url, sha = FONTS[key]
    path = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "portfolio-meta-fonts" / name
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != sha:
        data = urllib.request.urlopen(url, timeout=30).read()
        if hashlib.sha256(data).hexdigest() != sha:
            sys.exit(f"font {name}: unexpected sha256 from {url}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return ImageFont.truetype(str(path), size)


def profile_field(field: str) -> str:
    src = (ROOT / "src" / "content" / "content.ts").read_text()
    block = re.search(r"export const profile[^=]*=\s*\{(.*?)\n\};", src, re.S)
    m = block and re.search(rf'\n\s*{field}:\s*"([^"]*)"', block.group(1))
    if not m:
        sys.exit(f"profile.{field} not found in src/content/content.ts")
    return m.group(1)


def f01(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("RGB"), dtype=np.float64) / 255.0


def u8(a: np.ndarray) -> Image.Image:
    return Image.fromarray(np.round(np.clip(a, 0.0, 1.0) * 255.0).astype(np.uint8))


def flat(w: int, h: int, rgb) -> np.ndarray:
    return np.ones((h, w, 3)) * (np.asarray(rgb) / 255.0)


def screen(base: np.ndarray, top: np.ndarray) -> np.ndarray:
    """The site lays the hologram over the page with mix-blend-mode: screen."""
    return 1.0 - (1.0 - base) * (1.0 - top)


def tint(base: np.ndarray, mask: np.ndarray, rgb, amount: float = 1.0) -> np.ndarray:
    """Paint rgb over base through a 0..1 coverage mask."""
    m = np.clip(mask * amount, 0.0, 1.0)[..., None]
    return base + (np.asarray(rgb) / 255.0 - base) * m


def draw_tracked(d: ImageDraw.ImageDraw, x: float, y: float, text: str, f: ImageFont.FreeTypeFont, tracking: float) -> float:
    """Text with CSS letter-spacing (in em), keeping the font's kerning. Returns the right edge."""
    for i, ch in enumerate(text):
        d.text((x, y), ch, font=f, fill=255)
        if i < len(text) - 1:
            pair = f.getlength(text[i : i + 2])  # advance of ch including its kerning with the next glyph
            x += pair - f.getlength(text[i + 1]) + tracking * f.size
    return x + f.getlength(text[-1])


# ---------------------------------------------------------------- link preview


def make_og(head: Image.Image, name: str, role: str) -> Image.Image:
    W, H = 1200, 630
    img = flat(W, H, BG)

    # The head, large and right of centre: the face stays inside the centre square, so a square
    # thumbnail (WhatsApp, some chat apps) still shows it. Hair top ~y 215, chin ~845 in the poster.
    scale, cx, cy = 0.74, 790, 322
    side = round(1200 * scale)
    h = f01(head.resize((side, side), Image.LANCZOS))
    layer = np.zeros((H, W, 3))
    x0, y0 = cx - side // 2, cy - side // 2
    sx, sy = max(0, -x0), max(0, -y0)
    dx, dy = max(0, x0), max(0, y0)
    w, hh = min(side - sx, W - dx), min(side - sy, H - dy)
    layer[dy : dy + hh, dx : dx + w] = h[sy : sy + hh, sx : sx + w]
    # fade the left arc of the orbit under the text column, and the neck's dust into the bottom edge
    fade_x = np.clip((np.arange(W) - 400) / 220.0, 0, 1) ** 1.5
    fade_y = np.clip((H - np.arange(H)) / 80.0, 0, 1)
    layer *= fade_y[:, None, None] * fade_x[None, :, None]
    img = screen(img, layer)

    # Name in Chakra Petch 600, upper case, 0.06em (the site header), on two lines; role in Geist Mono,
    # upper case, 0.18em (the site's .label). Drawn at 2x and filtered down.
    S = 2
    mask_name = Image.new("L", (W * S, H * S), 0)
    mask_role = Image.new("L", (W * S, H * S), 0)
    words = name.upper().split()
    lines = [" ".join(words[:-1]), words[-1]] if len(words) > 1 else words
    left, top, lead = 72, 196, 86
    dn = ImageDraw.Draw(mask_name)
    for i, line in enumerate(lines):
        draw_tracked(dn, left * S, (top + i * lead) * S, line, font("display", 78 * S), 0.06)
    rule_y = top + len(lines) * lead + 34
    dn.rectangle([left * S, rule_y * S, (left + 56) * S - 1, rule_y * S + S - 1], fill=255)  # hairline, like the HUD's
    # 32 px: still about 8 px tall on a 300 px wide card
    draw_tracked(ImageDraw.Draw(mask_role), left * S, (rule_y + 24) * S, role.upper(), font("mono", 32 * S), 0.16)
    mask_name = mask_name.resize((W, H), Image.LANCZOS)
    mask_role = mask_role.resize((W, H), Image.LANCZOS)

    # a faint amber glow under the name, so the gold reads as lit rather than printed
    glow = np.asarray(mask_name.filter(ImageFilter.GaussianBlur(16)), dtype=np.float64) / 255.0
    img = tint(img, glow, GOLD_DEEP, 0.28)
    img = tint(img, np.asarray(mask_name, dtype=np.float64) / 255.0, GOLD_HOT)
    img = tint(img, np.asarray(mask_role, dtype=np.float64) / 255.0, GOLD)

    # HUD corner brackets (components/hud/Brackets), thin and dim
    out = u8(img)
    d = ImageDraw.Draw(out, "RGBA")
    m, L, col = 28, 26, GOLD + (100,)
    for x, y, ux, uy in [(m, m, 1, 1), (W - 1 - m, m, -1, 1), (m, H - 1 - m, 1, -1), (W - 1 - m, H - 1 - m, -1, -1)]:
        d.line([(x, y), (x + ux * L, y)], fill=col)
        d.line([(x, y + uy), (x, y + uy * L)], fill=col)
    return out


# ---------------------------------------------------------------- icons

# 16 px: drawn by hand on the pixel grid (a font hinted at 11 px leaves half-lit rows). Chakra Petch's
# square J and D with chamfered corners, 2 px stems. '#' lit, '+' half-lit chamfer, '.' background.
MONO_16 = [
    "................",
    "................",
    "................",
    "................",
    "....##.######+..",
    "....##.#######..",
    "....##.##...##..",
    "....##.##...##..",
    "....##.##...##..",
    ".##.##.##...##..",
    ".##.##.##...##..",
    ".+####.#######..",
    "..+##+.######+..",
    "................",
    "................",
    "................",
]


def monogram(px: int, initials: str) -> Image.Image:
    """Gold-hot initials with an amber glow on the page colour."""
    if px == 16 and initials == "JD":
        mask = np.array([[{"#": 1.0, "+": 0.45, ".": 0.0}[c] for c in row] for row in MONO_16])
        return u8(tint(flat(16, 16, BG), mask, GOLD_HOT))
    # 32 / 48: the font at the target size so FreeType hints the stems; larger: drawn at 4x and filtered down
    S = 1 if px <= 48 else 4
    size = {32: 21, 48: 31}.get(px, round(px * 0.62))
    f = font("display", size * S)
    m = Image.new("L", (px * S, px * S), 0)
    d = ImageDraw.Draw(m)
    l, t, r, b = d.textbbox((0, 0), initials, font=f)
    d.text((round((px * S - (r - l)) / 2 - l), round((px * S - (b - t)) / 2 - t)), initials, font=f, fill=255)
    if S > 1:
        m = m.resize((px, px), Image.LANCZOS)
    glow = np.asarray(m.filter(ImageFilter.GaussianBlur(max(0.8, px * 0.06))), dtype=np.float64) / 255.0
    img = tint(flat(px, px, BG), glow, GOLD_DEEP, 0.8)
    return u8(tint(img, np.asarray(m, dtype=np.float64) / 255.0, GOLD_HOT))


def head_icon(head: Image.Image, px: int) -> Image.Image:
    """The gold head, hair to chin, on the page colour (iOS rounds the corners: they hold only dark hair and neck)."""
    crop = head.crop((240, 175, 960, 895)).resize((px, px), Image.LANCZOS)
    return u8(screen(flat(px, px, BG), f01(crop)))


def write_ico(path: Path, images: list[Image.Image]) -> None:
    """ICO with one PNG-compressed entry per size (Pillow's ICO writer resamples from one image)."""
    blobs = []
    for im in images:
        buf = io.BytesIO()
        im.convert("RGBA").save(buf, "PNG", optimize=True)  # PNG entries in an ICO are expected as 32-bit RGBA
        blobs.append(buf.getvalue())
    out = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    for im, blob in zip(images, blobs):
        w, h = im.size
        out += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    path.write_bytes(out + b"".join(blobs))


def main() -> None:
    name, role = profile_field("name"), profile_field("role")
    head = Image.open(ROOT / "public" / "sphere-static.webp").convert("RGB")
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "src" / "app"
    out.mkdir(parents=True, exist_ok=True)

    make_og(head, name, role).save(out / "opengraph-image.jpg", quality=90, subsampling=0, optimize=True)
    (out / "opengraph-image.alt.txt").write_text(f"{name}, {role}: his portrait as a hologram of fine gold light filaments")

    initials = "".join(w[0] for w in name.split())[:2].upper()
    write_ico(out / "favicon.ico", [monogram(px, initials) for px in (16, 32, 48)])
    monogram(192, initials).save(out / "icon.png", optimize=True)
    head_icon(head, 180).save(out / "apple-icon.png", optimize=True)


if __name__ == "__main__":
    main()
