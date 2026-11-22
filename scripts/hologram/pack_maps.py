#!/usr/bin/env python3
"""
Packs the face-hologram maps for the site: public/hologram/*.webp + meta.json.

    python scripts/hologram/pack_maps.py <face-data-dir> [out-dir]      # out-dir defaults to public/hologram

<face-data-dir> is the output of the face pipeline (meta.json + depth/mask/tone/edges/regions/features/flow/luma
PNGs). Only DERIVED maps are written; the source photograph is never read or copied. Needs Pillow and numpy.

* Lossless WebP everywhere except flow.png, so every byte the geometry builder reads is the pipeline's own value:
  - depth.webp     R,G = the 16-bit depth split (exact; never resampled), B = 0 (the 8-bit copy is unused; the loader
                   uses it, and R = G = B of the grey maps, to detect a canvas readback perturbed by anti-fingerprinting)
  - mask, edges (grey), regions, features (RGB) as they are
* tone is shipped at HALF resolution (TONE_SCALE, 2x2 box filter) and quantised to TONE_LEVELS grey levels: at full
  resolution it was in practice a clean greyscale portrait (a photo in all but name), while the builder only samples it
  bilinearly at scan points 2.6 to 7.5 crop px apart. The loader upsamples it bilinearly (meta.scale.tone). The render
  was compared against the full-resolution map before choosing this (see docs/BLUEPRINT.md).
* flow.webp is lossy (quality FLOW_Q): it only steers strand directions, the hair field is smoothed (coherence-weighted,
  about 8 px) before use, and it is 47 % uncorrelated noise outside the head that lossless coding would spend
  ~370 KB on. The render was compared against the lossless map before choosing this (see docs/BLUEPRINT.md).
* luma.png is not shipped: the builder only used it to find the catchlight of each eye; that search is done here,
  exactly as the prototype did it, and stored in meta.catchlights.
* meta.json keeps only what the builder reads (sizes, head box, depth range, landmark x/y, lip topology).
* Map file names carry a content hash (depth.<sha8>.webp, listed in meta.files) so they can be served immutable
  (next.config.ts); meta.json keeps its fixed name and is revalidated. Stale maps in out-dir are removed.
"""
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image

FLOW_Q = int(os.environ.get("FLOW_Q", "90"))
TONE_SCALE = int(os.environ.get("TONE_SCALE", "2"))
TONE_LEVELS = int(os.environ.get("TONE_LEVELS", "32"))


def reduce_grey(a, f, levels):
    """f x f box filter (edges replicated to a multiple of f), then `levels` evenly spaced grey levels over 0..255."""
    a = a.astype(np.float64)
    H, W = a.shape
    ph, pw = (-H) % f, (-W) % f
    a = np.pad(a, ((0, ph), (0, pw)), mode="edge")
    a = a.reshape(a.shape[0] // f, f, a.shape[1] // f, f).mean(axis=(1, 3))
    q = np.round(a / 255 * (levels - 1)) * (255 / (levels - 1))
    return np.clip(np.round(q), 0, 255).astype(np.uint8)


def webp(arr, path, lossless=True, quality=100):
    im = Image.fromarray(np.ascontiguousarray(arr))
    if lossless:
        im.save(path, "WEBP", lossless=True, quality=100, method=6, exact=True)
    else:
        im.save(path, "WEBP", quality=quality, method=6)
    return os.path.getsize(path)


def catchlights(meta, luma_u8):
    """Port of builder.ts findCatchlights(): float32 channel, bilinear in doubles, strict > in row-major order."""
    H, W = luma_u8.shape
    f = (luma_u8.astype(np.float64) / 255).astype(np.float32).ravel().astype(np.float64)

    def bil(x, y):
        xx = 0 if x < 0 else (W - 1 if x > W - 1 else x)
        yy = 0 if y < 0 else (H - 1 if y > H - 1 else y)
        x0, y0 = int(np.floor(xx)), int(np.floor(yy))
        x1 = x0 + 1 if x0 < W - 1 else x0
        y1 = y0 + 1 if y0 < H - 1 else y0
        fx, fy = xx - x0, yy - y0
        i0, i1 = y0 * W, y1 * W
        return (f[i0 + x0] * (1 - fx) + f[i0 + x1] * fx) * (1 - fy) + (f[i1 + x0] * (1 - fx) + f[i1 + x1] * fx) * fy

    out = []
    for c in (468, 473):
        cx, cy = meta["landmarks"][c][0], meta["landmarks"][c][1]
        bx, by, bt = cx, cy, -1.0
        for yy in range(-9, 10):
            for xx in range(-9, 10):
                if xx * xx + yy * yy > 81:
                    continue
                t = bil(cx + xx, cy + yy)
                if t > bt:
                    bt, bx, by = t, cx + xx, cy + yy
        out.append([bx, by])
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    src = sys.argv[1]
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "public", "hologram")
    os.makedirs(out, exist_ok=True)
    meta = json.load(open(os.path.join(src, "meta.json")))
    load = lambda n: np.array(Image.open(os.path.join(src, meta["files"].get(n, n + ".png"))))
    for f in os.listdir(out):
        if f.endswith(".webp"):
            os.remove(os.path.join(out, f))
    sizes = {}
    files = {}

    def emit(n, arr, **kw):
        tmp = os.path.join(out, n + ".tmp.webp")
        webp(arr, tmp, **kw)
        h = hashlib.sha256(open(tmp, "rb").read()).hexdigest()[:8]
        name = f"{n}.{h}.webp"
        os.replace(tmp, os.path.join(out, name))
        files[n] = name
        sizes[name] = os.path.getsize(os.path.join(out, name))
        return os.path.join(out, name)

    d = load("depth")
    rg0 = np.dstack([d[..., 0], d[..., 1], np.zeros_like(d[..., 0])])
    path = emit("depth", rg0)
    # the decoded WebP must give back the exact 16-bit depth
    back = np.array(Image.open(path).convert("RGB"))
    assert np.array_equal(back[..., :2], d[..., :2]), "depth.webp is not exact"
    scale = {}
    for n in ("mask", "tone", "edges", "regions", "features"):
        a = load(n)
        if n == "tone" and TONE_SCALE > 1:
            a = reduce_grey(a if a.ndim == 2 else a[..., 0], TONE_SCALE, TONE_LEVELS)
            scale[n] = TONE_SCALE
        path = emit(n, a)
        b = np.array(Image.open(path).convert("RGB"))
        ref = np.dstack([a] * 3) if a.ndim == 2 else a[..., :3]
        assert np.array_equal(b, ref), n + ".webp is not exact"
    emit("flow", load("flow"), lossless=FLOW_Q >= 101, quality=FLOW_Q)

    lm = [[l[0], l[1]] for l in meta["landmarks"]]
    slim = {
        "width": meta["width"],
        "height": meta["height"],
        "head": meta["head"],
        "depth": {"min": meta["depth"]["min"], "max": meta["depth"]["max"]},
        "landmarks": lm,
        "topology": {"lips": meta["topology"]["lips"]},
        "catchlights": catchlights(meta, load("luma") if load("luma").ndim == 2 else load("luma")[..., 0]),
        "files": files,
    }
    if scale:
        slim["scale"] = scale
    with open(os.path.join(out, "meta.json"), "w") as fh:
        json.dump(slim, fh, separators=(",", ":"))
    sizes["meta.json"] = os.path.getsize(os.path.join(out, "meta.json"))
    total = sum(sizes.values())
    for k, v in sizes.items():
        print(f"{k:16s} {v:8d}")
    print(f"{'total':16s} {total:8d}  ({total / 1024:.0f} KB)")
    print("catchlights", slim["catchlights"])


if __name__ == "__main__":
    main()
