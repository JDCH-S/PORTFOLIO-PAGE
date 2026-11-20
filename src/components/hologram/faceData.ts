/**
 * Loads the shipped face maps (public/hologram, see scripts/hologram/pack_maps.py) into the plain arrays the
 * builder reads. Runs in the hologram worker (OffscreenCanvas) or, where workers cannot decode images, on the main
 * thread with a DOM canvas. Maps are data, not colour: decoded without colour conversion or premultiplication,
 * and the 16-bit depth (R,G) is reassembled on the CPU, never filtered.
 *
 * Canvas readback is the one step a browser may tamper with (Brave's farbling, Safari's and Firefox's fingerprinting
 * protection add noise to getImageData). The packer writes known redundancy (depth B = 0, grey maps R = G = B), so a
 * perturbed decode is detected here: light noise is repaired (channel vote for the grey maps, a median for depth
 * spikes), heavy noise rejects the data (the page then keeps the poster rather than drawing a garbled face).
 */
import type { FaceMeta, FaceWorld, MapName, MapView } from "./builder";
import { HEAD_HEIGHT, HERO_CAM_DIST, PIVOT_DEPTH } from "./config";

export const MAP_FILES = ["depth", "mask", "tone", "edges", "regions", "features", "flow"] as const;
type FileName = (typeof MAP_FILES)[number];
type DataMap = Exclude<FileName, "depth">;
const GREY: readonly DataMap[] = ["mask", "tone", "edges"];

/** one decoded map: grey maps keep one value per pixel (0..255), colour maps their RGBA bytes */
export interface MapData {
  px: Uint8Array | Uint8ClampedArray | Float32Array;
  stride: number;
}

export interface FaceDataset {
  meta: FaceMeta & { files?: Partial<Record<FileName, string>>; scale?: Partial<Record<FileName, number>> };
  width: number;
  height: number;
  maps: Record<DataMap, MapData>;
  depth: Float32Array;
  world: FaceWorld;
  bytes: number;
}

/** crop px -> world units: the head (hair top to neck fade) is HEAD_HEIGHT tall, pivot 30 % into the depth range. */
export function faceWorld(meta: FaceMeta): FaceWorld {
  const { head, depth } = meta;
  return {
    scale: HEAD_HEIGHT / (head.bottom - head.top),
    cx: head.cx,
    cy: head.cy,
    cz: depth.min + PIVOT_DEPTH * (depth.max - depth.min),
    camDist: HERO_CAM_DIST,
  };
}

/** builder views over the decoded maps */
export function mapViews(d: FaceDataset): Partial<Record<MapName, MapView>> {
  const out: Partial<Record<MapName, MapView>> = {};
  for (const n of Object.keys(d.maps) as DataMap[]) {
    const m = d.maps[n];
    out[n] = { px: m.px, stride: m.stride, channels: m.stride === 1 ? [0, 0, 0] : [0, 1, 2] };
  }
  return out;
}

async function decode(url: string): Promise<{ w: number; h: number; px: Uint8ClampedArray; bytes: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`hologram data: ${url} -> HTTP ${res.status}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const w = bmp.width;
  const h = bmp.height;
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (typeof OffscreenCanvas !== "undefined") {
    ctx = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
  } else {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    ctx = c.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
  }
  if (!ctx) throw new Error("hologram data: no 2d context to decode the maps");
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  // every map is opaque, so the canvas's premultiplied store loses nothing
  return { w, h, px: ctx.getImageData(0, 0, w, h).data, bytes: blob.size };
}

/** grey map RGBA -> one byte per pixel; a channel that disagrees with the other two is outvoted (median of three) */
function greyOf(px: Uint8ClampedArray, n: number, bad: { count: number }): Uint8Array {
  const g = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = px[4 * i], gg = px[4 * i + 1], b = px[4 * i + 2];
    if (r === gg && gg === b) {
      g[i] = r;
    } else {
      bad.count++;
      g[i] = Math.max(Math.min(r, gg), Math.min(Math.max(r, gg), b));
    }
  }
  return g;
}

/** bilinear upsample of a reduced-resolution grey map (box-filtered by the packer) to the crop size, values 0..255 */
function upsample(src: Uint8Array, sw: number, sh: number, W: number, H: number, f: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const yy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5));
    const y0 = Math.floor(yy), y1 = Math.min(sh - 1, y0 + 1), fy = yy - y0;
    for (let x = 0; x < W; x++) {
      const xx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5));
      const x0 = Math.floor(xx), x1 = Math.min(sw - 1, x0 + 1), fx = xx - x0;
      const a = src[y0 * sw + x0] * (1 - fx) + src[y0 * sw + x1] * fx;
      const b = src[y1 * sw + x0] * (1 - fx) + src[y1 * sw + x1] * fx;
      out[y * W + x] = a * (1 - fy) + b * fy;
    }
  }
  return out;
}

/** raw 16-bit depth: replace isolated spikes (a perturbed high byte = +-256) with the 3x3 median */
function despike(raw: Uint16Array, W: number, H: number): number {
  const src = raw.slice();
  const win = new Array<number>(9);
  let fixed = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) win[k++] = src[(y + dy) * W + x + dx];
      win.sort((a, b) => a - b);
      const med = win[4];
      const i = y * W + x;
      // a real edge has neighbours on both levels; a spike is alone (median far from it, and from both of its row neighbours)
      if (Math.abs(src[i] - med) >= 128 && Math.abs(src[i] - src[i - 1]) >= 128 && Math.abs(src[i] - src[i + 1]) >= 128) {
        raw[i] = med;
        fixed++;
      }
    }
  }
  return fixed;
}

/** base: absolute URL of the data directory, with a trailing slash */
export async function loadFaceData(base: string): Promise<FaceDataset> {
  const metaRes = await fetch(base + "meta.json");
  if (!metaRes.ok) throw new Error(`hologram data: meta.json -> HTTP ${metaRes.status}`);
  const metaText = await metaRes.text();
  const meta = JSON.parse(metaText) as FaceDataset["meta"];
  const W = meta.width;
  const H = meta.height;
  const N = W * H;
  const decoded = await Promise.all(MAP_FILES.map((n) => decode(base + (meta.files?.[n] ?? `${n}.webp`))));
  let bytes = metaText.length;
  const bad = { count: 0 };
  let checked = 0;
  const maps = {} as Record<DataMap, MapData>;
  let depthPx: Uint8ClampedArray | null = null;
  MAP_FILES.forEach((n, i) => {
    const m = decoded[i];
    bytes += m.bytes;
    // maps may be shipped at a reduced resolution (meta.scale[n] = crop px per map px), e.g. the tone map
    const f = meta.scale?.[n] ?? 1;
    if (m.w !== Math.ceil(W / f) || m.h !== Math.ceil(H / f)) throw new Error(`hologram data: ${n} is ${m.w}x${m.h}, expected ${Math.ceil(W / f)}x${Math.ceil(H / f)}`);
    if (n === "depth") {
      depthPx = m.px;
      return;
    }
    if (GREY.includes(n)) {
      const g = greyOf(m.px, m.w * m.h, bad);
      checked += m.w * m.h;
      maps[n] = f === 1 ? { px: g, stride: 1 } : { px: upsample(g, m.w, m.h, W, H, f), stride: 1 };
    } else {
      if (f !== 1) throw new Error(`hologram data: ${n} cannot be shipped at a reduced resolution`);
      maps[n] = { px: m.px, stride: 4 };
    }
  });
  const dpx = depthPx as unknown as Uint8ClampedArray;
  const raw = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    raw[i] = dpx[4 * i] * 256 + dpx[4 * i + 1];
    if (dpx[4 * i + 2] !== 0) bad.count++;
  }
  checked += N;
  if (bad.count > 0) {
    const frac = bad.count / checked;
    // a few perturbed pixels are repairable; a randomised readback is not (draw nothing rather than a garbled face)
    if (frac > 0.02) throw new Error(`hologram data: canvas readback is perturbed (${(frac * 100).toFixed(1)} % of pixels), not drawing from it`);
    const fixed = despike(raw, W, H);
    console.warn(`[hologram] canvas readback was perturbed (${bad.count} pixels, anti-fingerprinting?): repaired, ${fixed} depth spikes removed`);
  }
  const depth = new Float32Array(N);
  const k = (meta.depth.max - meta.depth.min) / 65535;
  for (let i = 0; i < N; i++) depth[i] = meta.depth.min + raw[i] * k;
  return { meta, width: W, height: H, maps, depth, world: faceWorld(meta), bytes };
}

/** the transferable buffers of a dataset (main-thread decode handing its maps to the worker) */
export function datasetTransfer(d: FaceDataset): ArrayBuffer[] {
  return [d.depth.buffer as ArrayBuffer, ...Object.values(d.maps).map((m) => m.px.buffer as ArrayBuffer)];
}
