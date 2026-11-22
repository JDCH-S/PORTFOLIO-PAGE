/**
 * The face hologram's geometry builder (ported from the "contour scan" prototype, face-lab proto-a/builder.js).
 *
 *   buildFaceGeometry(input) -> { fil, stub, pts, frame, info, transfer }
 *
 * PURE: plain maps in, typed arrays out. No THREE, no DOM, no module state, a seeded mulberry32 inside. It runs in
 * the hologram Web Worker (hologram.worker.ts) and, as a fallback, on the main thread.
 *
 * input = {
 *   width, height, meta,                       // trimmed meta.json of the face data (public/hologram/meta.json)
 *   world: { scale, cx, cy, cz, camDist },     // crop px -> world mapping (faceWorld() in faceData.ts)
 *   maps: { mask, tone, regions, features, edges, flow }   // byte views (MapView) of the decoded maps
 *   depth: Float32Array,                       // decoded z in crop px (16-bit exact)
 *   tier: 'high' | 'medium' | 'low', seed: 7,
 *   view: { devPerCrop },                      // device px per crop px at the LARGEST size the head is shown (hero)
 *   params: { name: number | string }          // debug overrides (?holo.name= on the site)
 * }
 *
 * Filament output: fil.rec = one 32-byte record per polyline POINT (layout at the packing step below), sized as an
 * RGBA32UI texture of fil.texW x fil.texH texels (2 texels per point), plus fil.index (Uint32, 6 per segment, vertex
 * ids 2i / 2i+1 = the two sides of point i). The shader pulls the record with texelFetch(gl_VertexID >> 1).
 *
 * Stubble output: stub = a one-byte-per-texel darkening texture over the facial hair (see BuildOutput.stub), which the
 * filament shader multiplies into the skin filaments.
 *
 * The port started point for point from the prototype (typed input/output, channel views so maps can be packed in
 * any image layout, precomputed catchlights in meta.catchlights); the finishing and polish passes since then are
 * marked where they changed it.
 *
 * Random numbers: one shared mulberry32 stream (`rng`) for the families that were there from the start, and derived
 * sub-streams (`stream`, `subRng`) for the hair, the back shell, the sweep strands, the stubble texture and the limbal
 * rings, so those can be tuned without moving anything else. Changing how many numbers a feature draws from `rng` shifts every feature
 * generated after it.
 */
export type HoloTier = "high" | "medium" | "low";
export type MapName = "mask" | "tone" | "regions" | "features" | "edges" | "flow";

/** One map as bytes: logical channel c of pixel i is px[stride * i + channels[c]] (0..255). */
export interface MapView {
  px: ArrayLike<number>;
  stride: number;
  channels: number[];
}

export interface FaceMeta {
  width: number;
  height: number;
  head: { cx: number; cy: number; top: number; bottom: number; left: number; right: number };
  depth: { min: number; max: number };
  /** 478 MediaPipe landmarks in crop px ([x, y] or [x, y, z]) */
  landmarks: number[][];
  topology: { lips: [number, number][] };
  /** brightest luminance point near each iris centre (landmarks 468, 473), found by scripts/hologram/pack_maps.py */
  catchlights: [number, number][];
}

export interface FaceWorld {
  scale: number;
  cx: number;
  cy: number;
  cz: number;
  camDist: number;
}

export interface BuildInput {
  width: number;
  height: number;
  meta: FaceMeta;
  world: FaceWorld;
  maps: Partial<Record<MapName, MapView>>;
  depth: Float32Array;
  tier: HoloTier;
  seed?: number;
  view?: { devPerCrop: number };
  params?: Record<string, number | string | undefined>;
}

export interface BuildOutput {
  fil: { count: number; rec: Uint32Array; texW: number; texH: number; index: Uint32Array };
  /**
   * (polish pass) the stubble: a darkening texture over the facial hair, one byte per texel (0 = clear, 255 = a hair),
   * w x h texels covering crop px [x0, x0 + w / k) x [y0, y0 + h / k). Absent with ?holo.stub=0.
   */
  stub?: { w: number; h: number; x0: number; y0: number; k: number; px: Uint8Array };
  pts: { count: number; pos: Float32Array; info: Float32Array; hor: Float32Array };
  frame: { p: number[]; sx: number; sy: number }[];
  info: {
    scanStep: number;
    scanWorld: number;
    merWorld: number;
    cropWorld: number;
    tilt: number;
    devPerCrop: number;
    /** world x of the neck's axis (the neck dust drifts in toward it) */
    neckX: number;
    counts: { scan: number; mer: number; diag: number; strand: number; feat: number; points: number; nodes: number; particles: number };
    bytes: { records: number; texture: number; index: number; perPoint: number };
    ms: Record<string, number>;
  };
  transfer: ArrayBuffer[];
}

interface Eye {
  up: number[];
  lo: number[];
  outer: number;
  inner: number;
  x0: number;
  x1: number;
}

type DirFn = (x: number, y: number, out: number[]) => number[];
type Field = (x: number, y: number) => number;

interface TraceOpts {
  region: Field;
  minRegion: number;
  dsep: number;
  step: number;
  maxLen: number;
  minLen: number;
  follow: number;
  cosStep: number;
  cosCum: number;
  dirFn: DirFn;
  minCoh: number;
  seedSpacing: number;
  Ifn: Field;
  half: number;
  lift: number;
  kind: number;
  keyOff: number;
  /** (polish pass) points where this holds are not stored (the line breaks there) */
  unlit?: (x: number, y: number) => boolean;
}

export function buildFaceGeometry(input: BuildInput): BuildOutput {
  // (fix pass) KEEP THIS FUNCTION'S OWN BODY SMALL. V8 does not optimise a function whose bytecode is over 60 KB
  // (--max-optimized-bytecode-size, 61440): past that every loop written directly in this body (the field loops, the
  // marching squares, the packing) runs unoptimised for the whole build. The polish pass grew the body from 45 KB to
  // 72 KB and the build got 10 to 25 % slower for that reason alone. So the large sections (hair, stubble, back shell)
  // are functions of their own, called once in place: nested functions are compiled and optimised separately and do
  // not count toward this body. Check with: node --print-bytecode --print-bytecode-filter=buildFaceGeometry.
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const tStart = now();
  const prof: Record<string, number> = {};
  let tMark = tStart;
  const mark = (k: string) => { const t = now(); prof[k] = Math.round(t - tMark); tMark = t; };
  const { width: W, height: H, meta, world, depth, tier } = input;
  const params = input.params || {};
  const dbg = (k: string, d: number): number => (params[k] !== undefined && params[k] !== '' && Number.isFinite(+params[k]) ? +(params[k] as number | string) : d);
  const TIERS: Record<HoloTier, { stepMin: number; stepMax: number; scanDx: number; merStep: number; merDy: number; hairStep: number; edge: number; dust: number; neck: number; glint: number }> = {
    high: { stepMin: 2.6, stepMax: 5.0, scanDx: 1.5, merStep: 11, merDy: 2.2, hairStep: 1.7, edge: 600, dust: 900, neck: 520, glint: 560 },
    medium: { stepMin: 3.0, stepMax: 5.5, scanDx: 1.9, merStep: 13, merDy: 2.8, hairStep: 2.1, edge: 400, dust: 600, neck: 360, glint: 380 },
    low: { stepMin: 4.0, stepMax: 7.5, scanDx: 2.5, merStep: 16, merDy: 3.6, hairStep: 2.7, edge: 220, dust: 340, neck: 220, glint: 220 },
  };
  const T = TIERS[tier] || TIERS.high;
  // filament kinds
  const K_SCAN = 0, K_MER = 1, K_HAIR = 2, K_BROW = 3, K_BEARD = 4, K_FEAT = 5, K_EDGE = 6, K_DIAG = 7, K_SHELL = 8;
  const N = W * H;

  // ---------------------------------------------------------------- rng (mulberry32, same as the harness)
  let rs = (dbg('seed', input.seed ?? 7) >>> 0) || 7;
  const rng = () => {
    rs |= 0; rs = (rs + 0x6d2b79f5) | 0;
    let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // (polish pass) independent sub-streams (mulberry32 again) for everything added or rebuilt after the fact (hair, back
  // shell, stubble texture, limbal ring): seeded from the main seed and a constant, they neither read nor advance the
  // shared stream, so tuning one of them never moves another feature
  const SEED0 = rs;
  const stream = (seed: number) => {
    let s = seed | 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const subRng = (salt: number) => stream(SEED0 ^ Math.imul(salt | 0, 0x9e3779b1));

  // ---------------------------------------------------------------- data access (replaces the harness data helpers)
  const chCache: Record<string, Float32Array> = {};
  const BYTE_F = new Float32Array(256);
  for (let v = 0; v < 256; v++) BYTE_F[v] = v / 255;
  function ch(name: MapName, c = 0): Float32Array {
    const key = name + c;
    if (!chCache[key]) {
      const m = input.maps[name];
      if (!m) throw new Error(`hologram builder: map "${name}" missing`);
      const px = m.px, st = m.stride, o = m.channels[c];
      const f = new Float32Array(N);
      // (fix pass) byte maps go through a 256-entry table (the same float32 values, without 7 million divisions)
      if (px instanceof Uint8Array || px instanceof Uint8ClampedArray) for (let i = 0; i < N; i++) f[i] = BYTE_F[px[st * i + o]];
      else for (let i = 0; i < N; i++) f[i] = px[st * i + o] / 255;
      chCache[key] = f;
    }
    return chCache[key];
  }
  function bil(f: ArrayLike<number>, x: number, y: number): number {
    const xx = x < 0 ? 0 : x > W - 1 ? W - 1 : x;
    const yy = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
    const x0 = Math.floor(xx), y0 = Math.floor(yy);
    const x1 = x0 < W - 1 ? x0 + 1 : x0, y1 = y0 < H - 1 ? y0 + 1 : y0;
    const fx = xx - x0, fy = yy - y0;
    const i0 = y0 * W, i1 = y1 * W;
    return (f[i0 + x0] * (1 - fx) + f[i0 + x1] * fx) * (1 - fy) + (f[i1 + x0] * (1 - fx) + f[i1 + x1] * fx) * fy;
  }
  const S = world.scale;
  const invD = world.camDist > 0 ? 1 / world.camDist : 0;
  function toWorld(x: number, y: number, z: number, out: number[]): number[] {
    const Z = (z - world.cz) * S;
    const k = S * (1 - Z * invD);
    out[0] = (x - world.cx) * k; out[1] = (world.cy - y) * k; out[2] = Z;
    return out;
  }
  function flowAt(x: number, y: number, out: number[]): number[] {
    const c = bil(ch('flow', 0), x, y) * 2 - 1, s = bil(ch('flow', 1), x, y) * 2 - 1;
    const th = 0.5 * Math.atan2(s, c);
    out[0] = Math.cos(th); out[1] = Math.sin(th); out[2] = bil(ch('flow', 2), x, y);
    return out;
  }
  const mask = ch('mask'), tone = ch('tone');
  const hairR = ch('regions', 0), skinG = ch('regions', 1), beardB = ch('regions', 2);
  const browF = ch('features', 0), eyeF = ch('features', 1), lipF = ch('features', 2);
  const edges = ch('edges');
  const headTop = meta.head.top, headBot = meta.head.bottom;
  const LMk = meta.landmarks, LM = LMk;
  const chinY = LMk[152][1];
  const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const TS = tier === 'low' ? 1.6 : tier === 'medium' ? 1.25 : 1.0; // spacing scale of the identity strand families

  // ---------------------------------------------------------------- scan spacing from the display size (LOD pass)
  // The slice pitch is chosen at build so the largest display of the head keeps EVERY slice at ~3.1 device px
  // (1440-1920 px wide DPR-1 desktops included); smaller displays drop whole slice ranks at run time (rank in u8.z).
  const devPerCrop = input.view && input.view.devPerCrop > 0 ? input.view.devPerCrop : 0.9;
  const SCAN_PX = dbg('scanpx', 3.1);
  const scanStep = dbg('scanstep', Math.min(T.stepMax, Math.max(T.stepMin, SCAN_PX / devPerCrop)));
  const merStep = T.merStep;

  // ---------------------------------------------------------------- generic helpers
  // separable box blur, 3 passes (~gaussian, sigma ~ 1.1 r), clamped borders. Sliding sums (this runs ~20 times over
  // the grid, so it matters for the build time)
  function blurLine(arr: Float32Array, off: number, len: number, r: number, out: Float32Array) {
    // the window for x is [x - r, x + r], clamped to the line; the sum slides (add x + r + 1, drop x - r)
    const n = 2 * r + 1, end = off + len - 1;
    const first = arr[off], last = arr[end];
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += arr[off + (k < 0 ? 0 : k > len - 1 ? len - 1 : k)];
    const xa = Math.min(r, len), xb = Math.max(xa, len - r - 1);
    let x = 0;
    for (; x < xa; x++) { out[off + x] = acc / n; acc += (x + r + 1 > len - 1 ? last : arr[off + x + r + 1]) - first; }
    for (; x < xb; x++) { out[off + x] = acc / n; acc += arr[off + x + r + 1] - arr[off + x - r]; }
    for (; x < len; x++) { out[off + x] = acc / n; acc += last - arr[off + x - r]; }
  }
  // (fix pass) the vertical pass, all columns at once: the same sliding sums as blurLine down every column (one
  // double-precision running sum per column, updated in the same order, so the result is bit-identical), but walking
  // the grid row by row. Column by column it strode W floats per sample and missed the cache on every one: that pass
  // alone was a third of the cold build.
  const colAcc = new Float64Array(W);
  function blurCols(src: Float32Array, rows: number, r: number, out: Float32Array) {
    const n = 2 * r + 1, last = rows - 1;
    colAcc.fill(0);
    for (let k = -r; k <= r; k++) {
      const q = Math.min(last, Math.max(0, k)) * W;
      for (let x = 0; x < W; x++) colAcc[x] += src[q + x];
    }
    for (let y = 0; y < rows; y++) {
      const o = y * W, qa = Math.min(last, y + r + 1) * W, qs = Math.max(0, y - r) * W;
      for (let x = 0; x < W; x++) {
        out[o + x] = colAcc[x] / n;
        colAcc[x] += src[qa + x] - src[qs + x];
      }
    }
  }
  // (fix pass) a field that is zero outside a band of rows (the eye, brow and lip maps, the hair) is only blurred over
  // that band plus the 3 r rows the three passes can spread it: the rows beyond are zero before and after.
  function boxBlur(src: ArrayLike<number>, r: number): Float32Array<ArrayBuffer> {
    r = Math.min(64, Math.max(1, Math.round(r)));
    const a = new Float32Array(N), b = new Float32Array(N);
    let i0 = 0, i1 = N - 1;
    while (i0 < N && !src[i0]) i0++;
    if (i0 === N) return a;
    while (!src[i1]) i1--;
    const y0 = Math.max(0, Math.floor(i0 / W) - 3 * r - 1), y1 = Math.min(H, Math.floor(i1 / W) + 3 * r + 2);
    if (src instanceof Float32Array) a.set(src.subarray(y0 * W, y1 * W), y0 * W);
    else for (let i = y0 * W, n = y1 * W; i < n; i++) a[i] = src[i];
    const av = a.subarray(y0 * W, y1 * W), bv = b.subarray(y0 * W, y1 * W), rows = y1 - y0;
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < rows; y++) blurLine(av, y * W, W, r, bv);
      blurCols(bv, rows, r, av);
    }
    return a;
  }
  // (polish pass) a blur of the top `rows` rows only, for fields that live in part of the grid (the hair, the ears, the
  // brows): a 3-pass box blur of radius r cut off after `rows` rows is exact, bit for bit, down to 3 (r + 2) rows above
  // the cut (the rows below it read 0)
  const blurRows = (src: Float32Array, r: number, rows: number) => {
    rows = Math.min(H, Math.ceil(rows));
    const a = new Float32Array(N), b = new Float32Array(N);
    a.set(src.subarray(0, rows * W));
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < rows; y++) blurLine(a, y * W, W, r, b);
      blurCols(b, rows, r, a);
    }
    return a;
  };
  function distTo(isSeed: (i: number) => boolean): Float32Array<ArrayBuffer> {
    const d = new Float32Array(N);
    for (let i = 0; i < N; i++) d[i] = isSeed(i) ? 0 : 1e6;
    const D = 1.4142;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) { v = Math.min(v, d[i - W] + 1); if (x > 0) v = Math.min(v, d[i - W - 1] + D); if (x < W - 1) v = Math.min(v, d[i - W + 1] + D); }
      d[i] = v;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let v = d[i];
      if (x < W - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < H - 1) { v = Math.min(v, d[i + W] + 1); if (x < W - 1) v = Math.min(v, d[i + W + 1] + D); if (x > 0) v = Math.min(v, d[i + W - 1] + D); }
      d[i] = v;
    }
    return d;
  }
  const polyCache = new Map<number[], number[][]>();
  function polyY(idx: number[], x: number): number {
    let p = polyCache.get(idx);
    if (!p) { p = idx.map((i) => LMk[i]).sort((a, b) => a[0] - b[0]); polyCache.set(idx, p); }
    if (x <= p[0][0]) return p[0][1];
    for (let k = 1; k < p.length; k++) if (x <= p[k][0]) { const t = (x - p[k - 1][0]) / Math.max(1e-6, p[k][0] - p[k - 1][0]); return p[k - 1][1] + t * (p[k][1] - p[k - 1][1]); }
    return p[p.length - 1][1];
  }

  // ---------------------------------------------------------------- identity helpers (identity pass, unchanged)
  const pupils = ([[468, [469, 470, 471, 472]], [473, [474, 475, 476, 477]]] as [number, number[]][]).map(([c, ring]) => {
    let r = 0;
    for (const i of ring) r += Math.hypot(LMk[i][0] - LMk[c][0], LMk[i][1] - LMk[c][1]);
    r /= ring.length;
    return { x: LMk[c][0], y: LMk[c][1], ir: r, r: dbg('pupil', 0.42) * r };
  });
  const inPupil = (x: number, y: number) => pupils.some((p) => (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) < p.r * p.r * 0.36);
  const pupilK = (x: number, y: number) => {
    let k = 1;
    for (const p of pupils) k *= smooth(p.r * 0.6, p.r * 1.12, Math.hypot(x - p.x, y - p.y));
    return k;
  };
  // (finishing pass) upper / lower lid polylines per eye (image-left eye = subject's right = MediaPipe 'right')
  const EYES: Eye[] = [
    { up: [33, 246, 161, 160, 159, 158, 157, 173, 133], lo: [33, 7, 163, 144, 145, 153, 154, 155, 133], outer: 33, inner: 133 },
    { up: [263, 466, 388, 387, 386, 385, 384, 398, 362], lo: [263, 249, 390, 373, 374, 380, 381, 382, 362], outer: 263, inner: 362 },
  ].map((e) => ({ ...e, x0: Math.min(LMk[e.outer][0], LMk[e.inner][0]), x1: Math.max(LMk[e.outer][0], LMk[e.inner][0]) }));
  const upLid = (e: Eye, x: number) => polyY(e.up, x), loLid = (e: Eye, x: number) => polyY(e.lo, x);
  // dark upper lash line: 0..1 weight of the band just at / under the upper lid (his heavy hooded lids)
  // (polish pass) the band sits where the photo has it: the landmark lid line runs along the LOWER edge of his lash
  // line, the lashes and the lid's shadow lie above it (measured on the photo: darkest 2 to 6 px above the line, the
  // iris and the white already visible on it), so the band is centred LASH_OFF above the line and wider upward
  const LASH_DARK = dbg('lashdark', 0.85), LASH_SIG = dbg('lashsig', 2.0), LASH_OFF = dbg('lashoff', -3.2), LASH_SIGU = dbg('lashsigup', 3.2);
  const lashK = (x: number, y: number) => {
    for (const e of EYES) {
      if (x < e.x0 - 3 || x > e.x1 + 3) continue;
      const span = smooth(e.x0 - 3, e.x0 + 6, x) * smooth(e.x1 + 3, e.x1 - 6, x);
      const d = y - upLid(e, x) - LASH_OFF;
      return LASH_DARK * span * Math.exp(-Math.pow(d / (d < 0 ? LASH_SIGU : LASH_SIG), 2));
    }
    return 0;
  };
  // under-eye: the photo's infra-orbital shadow is lifted toward the cheek tone (the bags aged him)
  // (polish pass) off by default: it is a retouch (the brief: do not beautify), and it left the band 4 to 14 px under the
  // lower lid 1.3 to 1.5x brighter than the photo, flattening his deep-set eyes; without it that band measures within
  // 0.9 to 1.15 of the photo. ?holo.ueyelift=0.6 is the old look.
  {
    const t = ch('tone');
    const LIFT = dbg('ueyelift', 0);
    if (LIFT > 0) for (const e of EYES) {
      for (let x = Math.floor(e.x0 - 12); x <= Math.ceil(e.x1 + 12); x++) {
        const wx = smooth(e.x0 - 12, e.x0 + 4, x) * smooth(e.x1 + 12, e.x1 - 4, x);
        const yl = loLid(e, Math.min(e.x1, Math.max(e.x0, x)));
        for (let y = Math.floor(yl + 1); y < yl + 30; y++) {
          const w = wx * Math.exp(-Math.pow((y - yl - 12) / 8, 2));
          const i = y * W + x;
          t[i] += w * LIFT * Math.max(0, 0.6 - t[i]);
        }
      }
    }
  }
  // (polish pass) the photo's own shading where tone.png flattens it. The filament brightness follows tone^1.18, the
  // photo's luminance goes as tone^2.5 (measured), so every shadow comes out ~1.5x too light; over most of the face that
  // is the intended lift, but in the eye sockets it loses his look (deep-set, hooded eyes, dark irises: the lid band
  // read 2.8x, the irises 1.5x the photo) and under the nose it turns the nostrils into lit skin. In those two zones the
  // shadows are deepened again by a power of the tone relative to the skin tone: measured data, nothing drawn.
  //   tSkin: the mean tone of the bare cheeks
  let tSkin = 0.62;
  {
    let s = 0, q = 0;
    for (let y = Math.round(LMk[145][1] + 22); y < LMk[2][1]; y += 2) for (let x = Math.round(LMk[234][0]); x < LMk[454][0]; x += 2) {
      const i = y * W + x;
      if (skinG[i] > 0.9 && beardB[i] < 0.05 && browF[i] < 0.05 && eyeF[i] < 0.05 && lipF[i] < 0.05) { s += tone[i]; q++; }
    }
    if (q > 200) tSkin = s / q;
  }
  const ORB_DEEP = dbg('orbdeep', 0.7), NOS_DEEP = dbg('nosdeep', 1.2), IRIS_DARK = dbg('irisdark', 0.12);
  // the socket: from just under the brow to a little below the lower lid, the canthi included
  const ORB_Y0 = Math.min(LMk[159][1], LMk[386][1]) - 30, ORB_Y1 = Math.max(LMk[145][1], LMk[374][1]) + 20;
  const orbK = (x: number, y: number) => {
    if (y < ORB_Y0 || y > ORB_Y1) return 0;
    for (const e of EYES) {
      if (x < e.x0 - 18 || x > e.x1 + 18) continue;
      const xc = Math.min(e.x1, Math.max(e.x0, x));
      const yu = upLid(e, xc), yl = loLid(e, xc);
      if (y < yu - 20 || y > yl + 12) return 0;
      return smooth(e.x0 - 18, e.x0 - 4, x) * smooth(e.x1 + 18, e.x1 + 4, x) * smooth(yu - 20, yu - 9, y) * smooth(yl + 12, yl + 3, y);
    }
    return 0;
  };
  // the nostril openings (MediaPipe 79 / 309 sit on them)
  const nosK = (x: number, y: number) => {
    if (Math.abs(y - LMk[79][1]) > 30) return 0;
    let k = 0;
    for (const i of [79, 309]) {
      const dx = (x - LMk[i][0]) / 13, dy = (y - LMk[i][1] - 2) / 9;
      k = Math.max(k, Math.exp(-(dx * dx + dy * dy)));
    }
    return k;
  };
  // the visible iris disc (its top hidden under the lid line + 1 px), a touch darker than its tone: tone.png is shipped at
  // half resolution and blurs the limbus
  const irisK = (x: number, y: number) => {
    for (const p of pupils) {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > p.ir * 1.1) continue;
      const e = EYES.find((q) => p.x > q.x0 && p.x < q.x1) || EYES[0];
      return (1 - smooth(0.84 * p.ir, 1.04 * p.ir, d)) * smooth(upLid(e, x) - 2.5, upLid(e, x) - 0.5, y) * smooth(loLid(e, x) + 1, loLid(e, x) - 1, y);
    }
    return 0;
  };
  // brightness factor of a skin filament at (x, y) with tone t from the three terms
  const deepK = (x: number, y: number, t: number) => {
    const k = ORB_DEEP * orbK(x, y) + NOS_DEEP * nosK(x, y);
    return (k > 0.002 ? Math.pow(Math.min(1, Math.max(0.05, t / tSkin)), k) : 1) * (1 - IRIS_DARK * irisK(x, y));
  };
  // under the jaw: the shadow band between chin and neck is narrowed (lifted toward the neck tone below 6 px under
  // the jaw line), so the neck reads attached to the head instead of a floating mask over a black gap
  {
    const t = ch('tone');
    const JAWL = [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397];
    const LIFT = dbg('jawlift', 0.6);
    for (let x = Math.ceil(LMk[172][0]); x <= Math.floor(LMk[397][0]); x++) {
      const yj = polyY(JAWL, x);
      for (let y = Math.floor(yj + 2); y < yj + 26; y++) {
        const w = smooth(yj + 3, yj + 9, y) * (1 - smooth(yj + 16, yj + 26, y));
        const i = y * W + x;
        t[i] += w * LIFT * Math.max(0, 0.36 - t[i]);
      }
    }
  }
  const SEAM_UP = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308], SEAM_LO = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
  const seamY = (x: number) => 0.5 * (polyY(SEAM_UP, x) + polyY(SEAM_LO, x));
  const mouthL = LMk[61][0], mouthR = LMk[291][0];
  const JAW = [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397];
  // A neck as a set of fields: w (side weight), v (dissolve toward the bottom, 1 above the line y1), k = w * v (the
  // dissolve key the filaments carry; 1 above the jaw line, so nothing above the jaw depends on the neck)
  type NeckFns = { cx: number; y1: (x: number) => number; w: (x: number, y: number) => number; v: (y: number, x: number) => number; k: (x: number, y: number) => number };
  // The neck as first shipped (a slab, a fixed column under the jaw). It is drawn nowhere: it only fixes how many
  // random numbers the beard stubble and the neck dust consume, so the shared rng stream (and with it every stubble
  // tick, network node and glint on the face) stays where it is whatever the visible neck looks like. Never tune it,
  // and keep it out of dbg(): changing it moves detail above the jaw.
  const neckRef: NeckFns = (() => {
    const cx = 318, hw = 124, y0 = chinY + 4, side = 26, sig = 42, hold = 58, soft = 50;
    const y1 = (x: number) => Math.min(y0, polyY(JAW, x) + side) + hold;
    const w = (x: number, y: number) => (y <= polyY(JAW, x) + 1 ? 1 : 1 - smooth(hw - soft, hw + 6, Math.abs(x - cx)));
    const v = (y: number, x: number) => { const yy = y1(x); return y < yy ? 1 : Math.exp(-Math.pow((y - yy) / sig, 2)); };
    return { cx, y1, w, v, k: (x: number, y: number) => w(x, y) * v(y, x) };
  })();
  // The visible neck (the default; ?holo.neck=0 drops it) is the photo's own neck: its outline is the skin mask's
  // under the jaw (scaled by neckws, so it reads ~0.7 of the face width once shaded, as in the photo), it is shaded as
  // a rounded column (neckBright below) and it ends in the T-shirt collar's U, breaking into dashes and dust there.
  // No clothing or shoulders.
  //   neck tables, per row: the mask's 0.5 crossings walking out from the neck axis = left / right edge, read down to
  //   just under the chin, kept from opening out again below the jaw corners and smoothed down the rows;
  //   below that the photo's mask is the segmentation's fade, not the neck, so the sides carry on straight down,
  //   widening a touch (NK_SPREAD px per px) as a real neck does toward its base, instead of closing into a point.
  //   The bottom is the collar line: a U (flat across the throat, rising toward the sides so the corners round off)
  //   whose centre is a little below where the mask fades under the throat.
  const maskS3 = boxBlur(mask, 3); // (shared: the neck's outline here, the ear's rim band below)
  const NK_Y0 = Math.max(0, Math.floor(Math.min(LMk[172][1], LMk[397][1]) - 12));
  const NK_N = H - NK_Y0;
  const nkL = new Float32Array(NK_N), nkR = new Float32Array(NK_N);
  const NK_CX = 0.5 * (LMk[172][0] + LMk[397][0]);
  const NK_SPREAD = dbg('neckspread', 0.12);
  let nkYC = chinY + 80;
  {
    const NK_MB = Math.round(dbg('neckmblur', 3));
    const ms = NK_MB === 3 ? maskS3 : boxBlur(mask, NK_MB);
    const c = Math.round(NK_CX);
    const kW = Math.min(NK_N - 1, Math.max(0, Math.round(chinY + dbg('neckwrow', 6)) - NK_Y0));
    let l = c - 100, r = c + 100;
    for (let k = 0; k <= kW; k++) {
      const o = (NK_Y0 + k) * W;
      if (ms[o + c] >= 0.5) {
        let a = c, b = c;
        while (a > 0 && ms[o + a - 1] >= 0.5) a--;
        while (b < W - 1 && ms[o + b + 1] >= 0.5) b++;
        // sub-pixel crossing
        l = a - (a > 0 ? (ms[o + a] - 0.5) / Math.max(1e-4, ms[o + a] - ms[o + a - 1]) : 0);
        r = b + (b < W - 1 ? (ms[o + b] - 0.5) / Math.max(1e-4, ms[o + b] - ms[o + b + 1]) : 0);
      }
      nkL[k] = l; nkR[k] = r;
    }
    // below the jaw corners the sides only ever close in or run straight on the way down (never a waist that opens
    // out again where the T-shirt collar notches the mask: that read as a pedestal / lampshade); from the chin down
    // they widen by NK_SPREAD alone
    if (dbg('neckmono', 1) > 0.5) {
      const k0 = Math.max(0, Math.min(kW, Math.round(Math.max(LMk[172][1], LMk[397][1]) + 8) - NK_Y0));
      for (let k = k0 + 1; k <= kW; k++) { nkL[k] = Math.max(nkL[k], nkL[k - 1]); nkR[k] = Math.min(nkR[k], nkR[k - 1]); }
      l = nkL[kW]; r = nkR[kW];
    }
    for (let k = kW + 1; k < NK_N; k++) { nkL[k] = l; nkR[k] = r; }
    const er = Math.max(0, Math.round(dbg('neckedgesm', 28)));
    const sm = (src: Float32Array) => {
      const out = new Float32Array(NK_N);
      for (let i = 0; i < NK_N; i++) {
        let s = 0, q = 0;
        for (let j = Math.max(0, i - er); j <= Math.min(NK_N - 1, i + er); j++) { s += src[j]; q++; }
        out[i] = s / q;
      }
      return out;
    };
    nkL.set(sm(nkL)); nkR.set(sm(nkR));
    // width scale about the axis (1 = the mask's 0.5 line; the cylinder shading darkens the rim, so the visible neck
    // is narrower than its outline) and the spread below the chin
    const WS = dbg('neckws', 1.15);
    for (let k = 0; k < NK_N; k++) {
      const m = 0.5 * (nkL[k] + nkR[k]), h = 0.5 * (nkR[k] - nkL[k]) * WS + NK_SPREAD * Math.max(0, k - kW);
      nkL[k] = m - h; nkR[k] = m + h;
    }
    // the collar's centre: where the mask under the throat falls through 0.5, lowered by NK_LOW, kept clear of the
    // end of the mask (no scan filaments are traced where it is ~0)
    let y5 = Math.round(chinY), y0 = Math.round(chinY);
    while (y5 < H - 1 && ms[y5 * W + c] >= 0.5) y5++;
    while (y0 < H - 1 && ms[y0 * W + c] >= 0.1) y0++;
    nkYC = Math.min(y5 + dbg('necklow', 34), y0 - 8);
  }
  const nkRow = (y: number) => Math.min(NK_N - 1, Math.max(0, Math.round(y) - NK_Y0));
  const NK_SOFT = dbg('necksoft', 26), NK_HOLD = dbg('neckhold', 6), NK_SIG = dbg('necksig', 30);
  // (the U's rise NK_U and its power NK_UP: deep enough that the bottom corners visibly round off and fray even at the
  // phone's coarse low-tier scan pitch, instead of a square block with a flat bottom edge; the centre sits a little
  // lower (necklow) so the neck keeps its full width down past the throat, as the photo's collar U does)
  const NK_U = dbg('necku', 120), NK_UP = dbg('neckupow', 2), NK_SIGS = dbg('necksigside', 1);
  const NECK: NeckFns = (() => {
    const kb = nkRow(nkYC);
    const cm = 0.5 * (nkL[kb] + nkR[kb]), ch2 = Math.max(40, 0.5 * (nkR[kb] - nkL[kb]));
    // the dissolve line: the collar's wide U
    const y1 = (x: number) => nkYC - NK_HOLD - NK_U * Math.pow(Math.min(1, Math.abs(x - cm) / ch2), NK_UP);
    const w = (x: number, y: number) => {
      if (y <= polyY(JAW, x) + 1) return 1;
      const k = nkRow(y);
      const m = 0.5 * (nkL[k] + nkR[k]), h = 0.5 * (nkR[k] - nkL[k]);
      return 1 - smooth(h - NK_SOFT, h + 3, Math.abs(x - m));
    };
    // (the dissolve is longer toward the sides, so the U's outer corners fray out instead of ending square)
    const v = (y: number, x: number) => {
      const yy = y1(x);
      if (y < yy) return 1;
      const a = Math.min(1, Math.abs(x - cm) / ch2);
      return Math.exp(-Math.pow((y - yy) / (NK_SIG * (1 + NK_SIGS * a * a)), 2));
    };
    return { cx: cm, y1, w, v, k: (x: number, y: number) => w(x, y) * v(y, x) };
  })();
  // inside the neck the filaments ignore the mask's own fade (the segmentation's, not the neck's end): the neck's
  // dissolve is NECK.k alone. Unchanged above the jaw line.
  const neckMask = (x: number, y: number, mm: number) => (y <= polyY(JAW, x) + 1 ? mm : mm + (1 - mm) * NECK.w(x, y));
  // neck brightness: NECK_LVL of the filament brightness on the lit centre line, shaded like a rounded neck (a cylinder
  // across the photo's own width, NECK_EDGE at the rim), lit by the depth surface's normal (light from the front and a
  // little above: the underside of the jaw turns away a little) and with the photo tone's local contrast raised by
  // NECK_DET. The photo's own top-to-bottom lighting (a dark band under the chin, a lit lower neck) is divided out
  // (NECK_FLAT) and replaced by one profile: a little lift right under the jaw (NECK_LIFT, so the neck joins the beard
  // instead of hanging under a dark band) and a steady fall toward the collar's U (NECK_FADE), so the neck sinks into
  // the dust instead of ending on a lit band. On top: the sternocleidomastoid cords (from below the ears in and down
  // toward the sternal notch, lit on the crest, a soft hollow on the inner side) and a faint larynx highlight.
  const NECK_LVL = dbg('necklvl', 0.72), NECK_EDGE = dbg('neckedge', 0.22), NECK_CYL = dbg('neckcyl', 2);
  const NECK_NRM = dbg('necknrm', 0.45), NECK_LY = dbg('neckly', 0.35), NECK_LX = dbg('necklx', 0.1), NECK_DET = dbg('neckdet', 0.9);
  const NECK_FLAT = dbg('neckflat', 1), NECK_LIFT = dbg('necklift', 0.5), NECK_LIFTL = Math.max(1, dbg('neckliftl', 40));
  const NECK_FADE = dbg('neckfade', 0.6), NECK_FADE0 = dbg('neckfade0', 0), NECK_FADE1 = dbg('neckfade1', 25), NECK_FADEP = dbg('neckfadep', 1.3);
  const nkZ = boxBlur(depth, dbg('necknr', 5)), nkT = boxBlur(tone, dbg('neckdetr', 9));
  const nkLn = Math.hypot(NECK_LX, NECK_LY, 1);
  // the photo tone across the middle half of the neck, per row (smoothed down the rows), and its mean over the neck
  const nkTr = new Float32Array(NK_N);
  let nkTref = 0;
  {
    const raw = new Float32Array(NK_N);
    for (let k = 0; k < NK_N; k++) {
      const m = 0.5 * (nkL[k] + nkR[k]), h = 0.25 * (nkR[k] - nkL[k]);
      let s = 0, q = 0;
      for (let x = Math.round(m - h); x <= Math.round(m + h); x += 2) { s += bil(nkT, x, NK_Y0 + k); q++; }
      raw[k] = s / Math.max(1, q);
    }
    const r = 15;
    for (let i = 0; i < NK_N; i++) {
      let s = 0, q = 0;
      for (let j = Math.max(0, i - r); j <= Math.min(NK_N - 1, i + r); j++) { s += raw[j]; q++; }
      nkTr[i] = s / q;
    }
    const ka = nkRow(chinY), kb = nkRow(nkYC);
    for (let k = ka; k <= kb; k++) nkTref += nkTr[k];
    nkTref /= Math.max(1, kb - ka + 1);
  }
  const SCM_LIT = dbg('neckscmlit', 0.18), SCM_SH = dbg('neckscmsh', 0.5), SCM_W = dbg('neckscmw', 22), SCM_IN = dbg('neckscmin', 30);
  const SCM_X0 = dbg('neckscmx0', 128), SCM_X1 = dbg('neckscmx1', 26), SCM_Y0 = chinY - 60, SCM_Y1 = chinY + dbg('neckscmy1', 100);
  const APPLE = dbg('neckapple', 0.15), APPLE_Y = chinY + dbg('neckappley', 45);
  const neckRelief = (x: number, y: number) => {
    const t = Math.min(1, Math.max(0, (y - SCM_Y0) / (SCM_Y1 - SCM_Y0)));
    const d = Math.abs(x - NECK.cx) - (SCM_X0 + (SCM_X1 - SCM_X0) * t); // > 0 outside the cord's crest
    const along = smooth(SCM_Y0, SCM_Y0 + 40, y) * (1 - smooth(SCM_Y1 - 40, SCM_Y1, y));
    const cord = SCM_LIT * Math.exp(-Math.pow(d / SCM_W, 2)) - SCM_SH * Math.exp(-Math.pow((d + SCM_IN) / (0.8 * SCM_W), 2));
    const apple = APPLE * Math.exp(-Math.pow((x - NECK.cx) / 14, 2) - Math.pow((y - APPLE_Y) / 18, 2));
    return along * cord + apple;
  };
  const neckBright = (x: number, y: number) => {
    const yj = polyY(JAW, x);
    if (y <= yj + 1) return 1;
    const below = smooth(yj + 1, yj + 24, y);
    const k = nkRow(y);
    const m = 0.5 * (nkL[k] + nkR[k]), h = 0.5 * (nkR[k] - nkL[k]);
    const u = Math.min(1, Math.abs(x - m) / (h + 4));
    const cyl = NECK_EDGE + (1 - NECK_EDGE) * Math.pow(1 - u * u, 0.5 * NECK_CYL);
    const zx = 0.5 * (bil(nkZ, x + 2, y) - bil(nkZ, x - 2, y)), zy = 0.5 * (bil(nkZ, x, y + 2) - bil(nkZ, x, y - 2));
    // n ~ (-zx, -zy, 1) in image axes (y down); the light comes from (LX, -LY, 1)
    const lam = Math.max(0, (-zx * NECK_LX + zy * NECK_LY + 1) / (Math.hypot(zx, zy, 1) * nkLn));
    const nrm = 1 - NECK_NRM * (1 - lam);
    const t = bil(tone, x, y), tb = bil(nkT, x, y);
    const det = Math.min(1.6, Math.max(0.5, Math.pow((t + 0.03) / (tb + 0.03), NECK_DET)));
    const flat = Math.min(1.8, Math.max(0.55, Math.pow((nkTref + 0.03) / (nkTr[k] + 0.03), NECK_FLAT)));
    // (the lift is the throat's, under the chin: under the jaw corners the neck stays in the jaw's shadow, or the
    // sides read as two lit posts)
    const lift = 1 + NECK_LIFT * (1 - smooth(yj, yj + NECK_LIFTL, y)) * (1 - u * u);
    const fade = NECK_FADE * Math.pow(smooth(chinY + NECK_FADE0, NECK.y1(x) + NECK_FADE1, y), NECK_FADEP);
    const rel = 1 + neckRelief(x, y);
    return 1 - below * (1 - NECK_LVL * cyl * nrm * det * flat * lift * (1 - fade) * rel);
  };
  // No neck (?holo.neck=0): the head ends at the jaw / beard line. Below the jaw everything dissolves into dashes and
  // gold dots over a short band, keyed on how far a point lies below the jaw line AND how far it sits behind the jaw's
  // own depth: the neck surface just under the chin is far behind it, so it goes first, while the underside of the jaw
  // (seen in turned views) frays out gradually instead of ending in a hard cut. The depth term eases in over CUT_ZR px
  // under the jaw line, so the filament segments that cross the line keep their upper end. Above the line nothing
  // changes.
  const NECK_ON = dbg('neck', 1) > 0.5;
  const CUT_HOLD = dbg('cuthold', 2), CUT_SIG = dbg('cutsig', 28), CUT_Z = dbg('cutz', 0.25), CUT_ZR = Math.max(1, dbg('cutzr', 8));
  const CUT_GLOW = dbg('cutglow', 0.35);
  const jawZ = new Float32Array(W);
  for (let x = 0; x < W; x++) jawZ[x] = bil(depth, x, polyY(JAW, x) - 3);
  const jawZAt = (x: number) => jawZ[Math.min(W - 1, Math.max(0, Math.round(x)))];
  const cutK = (x: number, y: number, z: number) => {
    const yj = polyY(JAW, x);
    if (y <= yj + 1) return 1;
    const s = Math.max(0, y - yj - CUT_HOLD) + CUT_Z * Math.max(0, jawZAt(x) - z) * smooth(yj, yj + CUT_ZR, y);
    return Math.exp(-Math.pow(s / CUT_SIG, 2));
  };
  // brightness under the jaw: the face's own, with a faint glow on the fraying band (gold embers)
  const cutBright = (x: number, y: number, z: number) => {
    if (y <= polyY(JAW, x)) return 1;
    const k = cutK(x, y, z);
    return 1 + CUT_GLOW * 4 * k * (1 - k);
  };
  const EAR_XL = LMk[234][0] - 4, EAR_XR = LMk[454][0] + 4, EAR_Y0 = LMk[468][1] - 70, EAR_Y1 = LMk[172][1] - 20;
  // (finishing pass) the zone between the ear and the cheek (pre-auricular skin, sideburn) is flagged with the ear, so
  // in turned views the filaments bridge from the cheek into the ear instead of leaving a black gap
  const EAR_BR = dbg('earbridge', 26);
  const isEarCore = (x: number, y: number) => y > EAR_Y0 && y < EAR_Y1 && (x < EAR_XL + EAR_BR || x > EAR_XR - EAR_BR) && (bil(skinG, x, y) > 0.35 || bil(hairR, x, y) > 0.35);
  // dilated a few px so the ear's own outline (silhouette rim filament, edge ridges) is flagged too: in turned views
  // the ear stays filaments up to its outer rim instead of floating as a cut slab
  const EARM = (() => {
    const e = new Float32Array(N);
    for (let y = Math.max(0, Math.floor(EAR_Y0)); y < Math.min(H, EAR_Y1); y++) for (let x = 0; x < W; x++) if (isEarCore(x, y)) e[y * W + x] = 1;
    return boxBlur(e, 5);
  })();
  const isEar = (x: number, y: number) => bil(EARM, x, y) > 0.07;
  // (polish pass) the ear's depth for the turned views. The monocular depth falls to 0 on the silhouette within a pixel
  // or two (every slice ended in a hook at the ear's outer rim: a stair-stepped, comb-toothed rear edge at the yaw
  // limit) and ripples over the pre-auricular wall (edge strokes drawn on it smeared into S-shaped scribbles in front
  // of the ear). Inside the ear zone the points are laid on a lightly smoothed depth instead, which near the silhouette
  // is carried out to the rim from a few px inside (a grey dilation), so the ear is a clean plate up to its edge. Only
  // z changes: the front view is a projection along z, so head-on nothing moves.
  // EARE marks that rim band (0..1): there the slice ends all run along the outline, and on a clean plate they stack
  // into a heavy drawn contour when turned, so the shader fades them out with the turn (turn fade, T8 below).
  const EARE = new Float32Array(N);
  const EARZ = (() => {
    const o = new Float32Array(N);
    const RD = Math.round(dbg('earzdil', 5)), RB = Math.min(64, Math.max(1, Math.round(dbg('earzblur', 3)))), RIM_FADE = dbg('earrimfade', 0.85);
    if (dbg('earz', 1) < 0.5) return o;
    const ya = Math.max(0, Math.floor(EAR_Y0) - 12), yb = Math.min(H, Math.ceil(EAR_Y1) + 12);
    const zs = blurRows(depth, RB, yb + 3 * (RB + 2)), mb = maskS3; // (the ear zone's rows only)
    const zone = (i: number) => EARM[i] > 0.02;
    const t = new Float32Array(N);
    for (let y = ya; y < yb; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!zone(i)) continue;
      let m = 0;
      for (let k = Math.max(0, x - RD); k <= Math.min(W - 1, x + RD); k++) { const v = depth[y * W + k]; if (v > m) m = v; }
      t[i] = m;
    }
    for (let y = ya; y < yb; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!zone(i)) continue;
      let m = 0;
      for (let k = Math.max(ya, y - RD); k <= Math.min(yb - 1, y + RD); k++) { const v = zone(k * W + x) ? t[k * W + x] : depth[k * W + x]; if (v > m) m = v; }
      const edge = 1 - smooth(0.55, 0.97, mb[i]);
      EARE[i] = RIM_FADE * smooth(0.07, 0.4, EARM[i]) * (1 - smooth(0.8, 0.99, mb[i]));
      // (eased out over the zone's last rows, so the jaw's rear edge under the lobe has no step where the zone ends)
      o[i] = smooth(0.07, 0.4, EARM[i]) * (1 - smooth(EAR_Y1 - 36, EAR_Y1 - 2, y)) * (zs[i] + edge * Math.max(0, m - zs[i]) - depth[i]);
    }
    return o;
  })();
  const flowC = ch('flow', 0), flowS = ch('flow', 1), flowK = ch('flow', 2);
  const skinSeed = (i: number) => skinG[i] > 0.5 && mask[i] > 0.6 && hairR[i] < 0.3;
  const dHL = distTo(skinSeed);
  const dHair = distTo((i: number) => hairR[i] > 0.5);
  // (polish pass) hair flow. flow.png agrees with the photo's own structure tensor to a few degrees wherever it is
  // coherent, so the strands follow it directly: a coherence-weighted smoothing of the double-angle field (confident
  // pixels fill the incoherent blotches), with the bands along the hair's borders left out (there the field follows the
  // hairline / the silhouette edge instead of the hair, which made strands fan out of the hairline like comb teeth) and
  // filled from the interior. A little of a much wider average keeps the sweep going through larger gaps.
  const dIn = distTo((i: number) => hairR[i] < 0.5);
  const HC = new Float32Array(N), HS = new Float32Array(N);
  // (the last rows with solid hair / with any hair a strand can be traced in; the sideburns end at the jaw corner)
  let HAIR_Y1 = 0;
  for (let i = N - 1; i >= 0 && !HAIR_Y1; i--) if (hairR[i] > 0.5) HAIR_Y1 = Math.floor(i / W) + 2;
  {
    const HB0 = dbg('hborder0', 3), HB1 = dbg('hborder1', 11);
    const wc = new Float32Array(N), ws = new Float32Array(N);
    for (let i = 0, n = Math.min(N, HAIR_Y1 * W); i < n; i++) {
      if (hairR[i] < 0.5) continue;
      const c = flowC[i] * 2 - 1, s = flowS[i] * 2 - 1;
      const l = Math.hypot(c, s);
      if (l < 1e-4) continue;
      const w = (flowK[i] * flowK[i] * smooth(HB0, HB1, dIn[i])) / l;
      wc[i] = c * w; ws[i] = s * w;
    }
    const R1 = Math.min(64, Math.max(1, Math.round(dbg('hsmooth', 8)))), R2 = Math.min(64, Math.max(1, Math.round(dbg('hsmooth2', 26))));
    const yEnd = Math.max(HAIR_Y1, LMk[172][1]);
    const c1 = blurRows(wc, R1, yEnd + 3 * (R1 + 2)), s1 = blurRows(ws, R1, yEnd + 3 * (R1 + 2));
    const c2 = blurRows(wc, R2, yEnd + 3 * (R2 + 2)), s2 = blurRows(ws, R2, yEnd + 3 * (R2 + 2));
    const FAR = dbg('hfar', 0.15);
    for (let i = 0, n = Math.min(N, Math.ceil(yEnd + 3 * (R2 + 2)) * W); i < n; i++) { HC[i] = c1[i] + FAR * c2[i]; HS[i] = s1[i] + FAR * s2[i]; }
  }

  mark('fields');
  // ---------------------------------------------------------------- MATERIAL: the open skin planes (cheeks, forehead)
  // where the wireframe network is allowed to show (meridians brighter, diagonal family, nodes). Zero on and around the
  // identity features (eyes, brows, nose, lips, dense beard), so their tone is untouched.
  const PLANE = new Float32Array(N);
  {
    const eyeS = boxBlur(eyeF, 10), browS = boxBlur(browF, 6), lipS = boxBlur(lipF, 7);
    const yTop = LMk[168][1] - 6, yBase = LMk[2][1] + 10;
    const alarHalf = 0.5 * (LMk[358][0] - LMk[129][0]);
    const noseCx = LMk[4][0];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const sk = Math.min(1, skinG[i] * 1.3) * mask[i] * (1 - Math.min(1, hairR[i] * 1.5));
      if (sk < 0.05) continue;
      const tN = Math.min(1, Math.max(0, (y - yTop) / (yBase - yTop)));
      const hwN = (0.5 + 0.5 * tN) * alarHalf + 8;
      const nose = y > yTop - 10 && y < yBase + 10 ? (1 - smooth(hwN - 6, hwN + 8, Math.abs(x - noseCx))) * smooth(yTop - 10, yTop + 6, y) * (1 - smooth(yBase - 4, yBase + 10, y)) : 0;
      const near = Math.max(Math.min(1, eyeS[i] * 4.5), Math.min(1, browS[i] * 3.0), Math.min(1, lipS[i] * 3.0), nose);
      PLANE[i] = sk * (1 - near) * (1 - 0.7 * Math.min(1, beardB[i] * 1.4)) * (1 - smooth(chinY - 30, chinY + 10, y));
    }
  }

  mark('plane');
  // ---------------------------------------------------------------- horizons (self-occlusion without a depth buffer)
  const HSTEPS = [1.5, 3, 5, 8, 12, 17, 24, 32, 42, 55, 70, 88, 110, 140, 175, 215];
  function horizon(x: number, y: number, z: number, dx: number, dy: number): number {
    let best = -4;
    for (let s = 0; s < HSTEPS.length; s++) {
      const d = HSTEPS[s];
      const xi = Math.round(x + dx * d), yi = Math.round(y + dy * d);
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) break;
      const sl = (depth[yi * W + xi] - z) / d;
      if (sl > best) best = sl;
    }
    return Math.atan(best);
  }

  // ---------------------------------------------------------------- point store
  let cap = 1 << 16;
  let nP = 0;
  let Pp = new Float32Array(cap * 3); // crop x, y, z
  let A = new Float32Array(cap * 4); // intensity, half width (crop px), arc, seed
  let Bk = new Float32Array(cap * 3); // kind, mask (x neck dissolve), intro key
  let G3 = new Float32Array(cap * 3); // gap to the neighbouring slice (crop px vector), scans only
  let R8 = new Uint8Array(cap); // LOD rank
  let E8 = new Uint8Array(cap); // ear flag
  let T8 = new Uint8Array(cap); // (polish pass) turn fade: the share of its light a point gives up when the head is turned
  let brk = new Uint8Array(cap);
  function grow() {
    cap *= 2;
    const gf = (a: Float32Array, n: number) => { const b = new Float32Array(cap * n); b.set(a); return b; };
    const gu = (a: Uint8Array, n: number) => { const b = new Uint8Array(cap * n); b.set(a); return b; };
    Pp = gf(Pp, 3); A = gf(A, 4); Bk = gf(Bk, 3); G3 = gf(G3, 3);
    R8 = gu(R8, 1); E8 = gu(E8, 1); brk = gu(brk, 1); T8 = gu(T8, 1);
  }
  let lineStart = true;
  let lastX = 0, lastY = 0, lastZ = 0, arc = 0, lineSeed = 0;
  function begin(seed: number) { lineStart = true; arc = 0; lineSeed = seed; }
  const neckY0 = chinY - 12;
  const onlyKinds: number[] | null = typeof params.kinds === 'string' ? params.kinds.split(',').map(Number) : null; // debug
  let curRank = 0, curFade = 0, gX = 0, gY = 0, gZ = 0, dissolveMul = 1;
  function pt(x: number, y: number, z: number, I: number, half: number, kind: number, m: number, key: number) {
    if (onlyKinds && !onlyKinds.includes(Math.floor(kind))) return;
    if (nP >= cap) grow();
    const ear = isEar(x, y);
    if (!lineStart) arc += Math.hypot(x - lastX, y - lastY, z - lastZ);
    let nk = 1, mm = m;
    if (y > neckY0 - 140) {
      nk = NECK_ON ? NECK.k(x, y) : cutK(x, y, z);
      // the mask's own neck fade starts ~25 px below the chin: remap it so the filaments stay whole down to the
      // jaw line (the fragment dash dissolve keys on this value); inside the neck the mask's fade is ignored
      if (!(kind >= K_HAIR && kind < K_BROW)) {
        if (y > chinY - 20) mm = Math.min(1, m / 0.62);
        if (NECK_ON) mm = neckMask(x, y, mm);
      }
      if (kind < K_HAIR) I *= NECK_ON ? neckBright(x, y) : cutBright(x, y, z);
    }
    // (polish pass) the ear zone's depth for the turned views goes into the stored point only: the arc length (the
    // dash phase of the dissolves) is still measured on the raw depth, so no dash moves head-on
    // (not the hair strands, kind 2.8: they ride their own smoothed depth, and the correction, which is relative to the
    // raw depth, put its ripples back into them: zig-zag strands above the ear in turned views)
    Pp[nP * 3] = x; Pp[nP * 3 + 1] = y; Pp[nP * 3 + 2] = ear && kind < K_SHELL && !(kind > 2.75 && kind < 2.85) ? z + bil(EARZ, x, y) : z;
    A[nP * 4] = I; A[nP * 4 + 1] = half; A[nP * 4 + 2] = arc; A[nP * 4 + 3] = lineSeed;
    Bk[nP * 3] = kind; Bk[nP * 3 + 1] = mm * nk * dissolveMul; Bk[nP * 3 + 2] = key;
    G3[nP * 3] = gX; G3[nP * 3 + 1] = gY; G3[nP * 3 + 2] = gZ;
    R8[nP] = curRank; E8[nP] = ear ? 1 : 0;
    T8[nP] = ear && kind < K_MER ? Math.round(255 * Math.min(1, bil(EARE, x, y))) : curFade;
    brk[nP] = lineStart ? 1 : 0;
    lineStart = false;
    lastX = x; lastY = y; lastZ = z;
    nP++;
  }

  function end() {
    if (nP > 0 && brk[nP - 1] === 1) nP--;
    lineStart = true;
  }
  const fy = (y: number) => (y - headTop) / (headBot - headTop);
  const toneCurve = (t: number) => Math.pow(Math.max(0, t), 1.18);
  const ctz = (j: number) => { j = Math.abs(j); if (j === 0) return 5; let r = 0; while ((j & 1) === 0 && r < 5) { j >>= 1; r++; } return r; };

  // ---------------------------------------------------------------- hair (polish pass): what the scan needs of it
  // The hair draws from its own random stream (main seed + a constant): tuning it never moves another feature.
  const hrng = stream(((SEED0 ^ 0x68616972) >>> 0) || 7);
  // Soft hairline: the scan slices are not cut at the hair region's border (a hard cap edge with rounded-off temple
  // corners) but carried HL_W px into it at reduced strength, where the photo's own tone decides what shows: skin
  // seen through thin hair at the temples stays, dense hair is dark anyway. Deeper in, the slices carry no light at
  // all (their residual hatch veiled the hair brown).
  const HL_SOFT = dbg('hlsoft', 0.45), HL_W = dbg('hlw', 18), HL_Y = 0.5 * (LMk[468][1] + LMk[473][1]);
  // The sideburns: below the hair region the strip of short hair in front of each ear (facial-hair density in the
  // pre-auricular zone, down to the jaw corner) belongs to the hair. A few strands run down it into the beard, and the
  // bright edge-ridge filament that used to trace it (a light seam where the photo has a dark sideburn) is unlit.
  const SB_Y1 = LMk[172][1] - 6;
  const sideburn = (x: number, y: number) => (y > EAR_Y0 && y < SB_Y1 && (x < EAR_XL + EAR_BR + 10 || x > EAR_XR - EAR_BR - 10) ? bil(beardB, x, y) * smooth(SB_Y1, SB_Y1 - 30, y) : 0);
  // (the hair region's plateau is ~0.93, not 1: the cut is scaled so it reaches 1 there)
  // (and far from any skin, along the outer silhouette, a thin hair coverage already cuts them: no slice stubs there)
  // (below a hair coverage of 0.03, the region map's floor on plain skin, the factor is exactly 1: skin is untouched)
  const hairScanW = (x: number, y: number, hair: number) => {
    if (hair < 0.03) return 1;
    const d = bil(dHL, x, y);
    let w = HL_SOFT + (1.25 - HL_SOFT) * smooth(1, HL_W, d) + 3 * smooth(HL_W, HL_W + 12, d);
    if (w < 1) w += (1 - w) * smooth(HL_Y - 60, HL_Y - 20, y); // (softened along the forehead and the temples only, not at the ears / sideburns)
    return 1 + (w - 1) * smooth(0.03, 0.12, hair);
  };

  // ---------------------------------------------------------------- 1. scan filaments (the dominant family)
  // Contours of y - KT * z = c: planar slices tilted toward the viewer, so from the front they bend over the brow, nose,
  // lips and cheekbones. Line swelling (proto-c): width ~ gap^0.7, brightness ~ gap^0.45 (gap = local slice spacing /
  // nominal), so bunched slices under the nose / jaw neither burn nor go dark.
  const KT = dbg('tilt', 0.27);
  // (polish pass, low tier) on a phone the canvas has ~0.4 px per crop px: the slices are 3 px apart, 2 px wide, and the
  // skin read as bars with dark dashes between them plus a herringbone of diagonals. There the slices are thinned a
  // little more on the open planes, the meridians carry more and the diagonals less (LOW_MESH below), so the skin reads
  // as a regular lat / long net
  const LOW_MESH = tier === 'low';
  const PLANE_THIN = dbg('thin', LOW_MESH ? 1.4 : 1.0);
  // (polish pass) the stubble is a texture of fine dark hairs now (3b below), not the neck's dash dissolve cut into the
  // scan lines (rectangular holes, a brick wall on phones): BEARD_DASH is 0, and the mean darkening is shared between
  // BEARD_CUT and the hairs so each beard zone lands on the photo's beard / cheek luminance
  const BEARD_CUT = dbg('beardcut', -0.25), JAW_DARK = dbg('jawdark', 0.2), BEARD_DASH = dbg('bearddash', 0);
  const jawX0 = LMk[172][0], jawX1 = LMk[397][0];
  // (polish pass) brows: the scan under them at 5 % (the photo's brows are the darkest thing on the face with the hair,
  // 0.08 of the cheek; they read 0.11 with the hatch glowing through). Lip seam: the photo's dark line lies SEAM_OFF
  // above the landmark seam, ~2 px wide, and runs right to the corners (the old shade was centred on the seam, 3.2 px
  // wide, and stopped 12 px short of the corners: a lit seam, a dark top of the lower lip and lit, upturned-looking ends)
  const SCAN_HAIR = dbg('scanhair', 0.94), SCAN_BROW = dbg('scanbrow', 0.95), SEAM_SH = dbg('seamsh', 0.45);
  const SEAM_OFF = dbg('seamoff', -1.7), SEAM_SIG = dbg('seamsig', 2.1), SEAM_END = dbg('seamend', 5);
  {
    // Marching squares on F(x, y) = y - KT * z(x, y) over a g-px grid: complete contours, including where a slice
    // turns back in x (inner canthus, alar crease, socket walls). The old per-column tracer could not follow those and
    // left black holes there (worse with more tilt).
    const s = scanStep;
    const g = T.scanDx;
    const gx0 = meta.head.left - 2, gy0 = Math.max(0, headTop - 6);
    const nx = Math.floor((meta.head.right + 2 - gx0) / g) + 1;
    const ny = Math.floor((Math.min(H - 2, headBot + 2) - gy0) / g) + 1;
    const Fg = new Float32Array(nx * ny), Mg = new Float32Array(nx * ny);
    for (let k = 0; k < ny; k++) for (let i = 0; i < nx; i++) {
      const x = gx0 + i * g, y = gy0 + k * g;
      Fg[k * nx + i] = y - KT * bil(depth, x, y) + 1e-4; // nudge off exact level values
      Mg[k * nx + i] = bil(mask, x, y);
    }
    const jMin = Math.floor((gy0 - KT * meta.depth.max) / s) - 2;
    const NL = Math.ceil((gy0 + ny * g) / s) - jMin + 4;
    // edge crossing points: key = (edgeId * NL + (j - jMin)); edgeId = node * 2 (+0 horizontal to i+1, +1 vertical to k+1)
    const ptOf = new Map<number, [number, number]>();
    const segA: number[] = [], segB: number[] = [], segJ: number[] = [];
    const adj = new Map<number, number[]>();
    const edgePt = (node: number, vert: number, j: number, c: number) => {
      const key = (node * 2 + vert) * NL + (j - jMin);
      if (!ptOf.has(key)) {
        const n2 = vert ? node + nx : node + 1;
        const t = (c - Fg[node]) / (Fg[n2] - Fg[node]);
        const i = node % nx, k = (node - i) / nx;
        ptOf.set(key, [gx0 + (i + (vert ? 0 : t)) * g, gy0 + (k + (vert ? t : 0)) * g]);
      }
      return key;
    };
    const link = (ka: number, kb: number, j: number) => {
      const si = segA.length;
      segA.push(ka); segB.push(kb); segJ.push(j);
      for (const kk of [ka, kb]) { const l = adj.get(kk); if (l) l.push(si); else adj.set(kk, [si]); }
    };
    for (let k = 0; k < ny - 1; k++) for (let i = 0; i < nx - 1; i++) {
      const n00 = k * nx + i, n10 = n00 + 1, n01 = n00 + nx, n11 = n01 + 1;
      if (Math.max(Mg[n00], Mg[n10], Mg[n01], Mg[n11]) <= 0.03) continue;
      const f00 = Fg[n00], f10 = Fg[n10], f01 = Fg[n01], f11 = Fg[n11];
      const lo = Math.min(f00, f10, f01, f11), hi = Math.max(f00, f10, f01, f11);
      const jl = Math.ceil(lo / s - 0.5), jh = Math.floor(hi / s - 0.5);
      for (let j = jl; j <= jh; j++) {
        const c = (j + 0.5) * s;
        const cr: number[] = [];
        if ((f00 - c) * (f10 - c) < 0) cr.push(edgePt(n00, 0, j, c)); // top
        if ((f10 - c) * (f11 - c) < 0) cr.push(edgePt(n10, 1, j, c)); // right
        if ((f01 - c) * (f11 - c) < 0) cr.push(edgePt(n01, 0, j, c)); // bottom
        if ((f00 - c) * (f01 - c) < 0) cr.push(edgePt(n00, 1, j, c)); // left
        if (cr.length === 2) link(cr[0], cr[1], j);
        else if (cr.length === 4) {
          // saddle: pair by the centre value
          const fc = 0.25 * (f00 + f10 + f01 + f11);
          if ((fc - c) * (f00 - c) > 0) { link(cr[0], cr[1], j); link(cr[2], cr[3], j); }
          else { link(cr[0], cr[3], j); link(cr[1], cr[2], j); }
        }
      }
    }
    // chain the segments into polylines
    const used = new Uint8Array(segA.length);
    const chainsOut: { keys: number[]; j: number }[] = [];
    const walk = (si: number, fromKey: number, out: number[]) => {
      let cur = si, from = fromKey;
      for (;;) {
        used[cur] = 1;
        const nxt = segA[cur] === from ? segB[cur] : segA[cur];
        out.push(nxt);
        const l = adj.get(nxt);
        let found = -1;
        if (l) for (const q of l) if (!used[q]) { found = q; break; }
        if (found < 0) return;
        from = nxt; cur = found;
      }
    };
    for (let si = 0; si < segA.length; si++) {
      if (used[si]) continue;
      const fw = [segA[si]];
      walk(si, segA[si], fw);
      // walk backward from segA[si]
      const bw: number[] = [];
      const l = adj.get(segA[si]);
      if (l) for (const q of l) if (!used[q]) { walk(q, segA[si], bw); break; }
      chainsOut.push({ keys: bw.reverse().concat(fw), j: segJ[si] });
    }
    const SW_LO = dbg('swlo', 0.35), SW_HI = dbg('swhi', 1.6);
    const THIN_COMP = dbg('thincomp', 0.45);
    const zAt = (x: number, y: number) => bil(depth, x, y);
    // emit in level order (top to bottom), so the point order is spatially coherent
    chainsOut.sort((p, q) => p.j - q.j);
    for (const chn of chainsOut) {
      curRank = ctz(chn.j);
      begin(rng());
      let open = false, px = 0, py = 0, pz = 0;
      for (const key of chn.keys) {
        const [x, y] = ptOf.get(key) as [number, number];
        const m = bil(mask, x, y);
        const z = zAt(x, y);
        const dist = Math.hypot(x - px, y - py);
        // (finishing pass) the steep pre-auricular wall between cheek and ear is only a few px wide in the front-view
        // grid: inside the ear zone a cliff is bridged (straight 3-D segment) instead of breaking the slice, so in
        // turned views the filaments run from the cheek into the ear without a black gap
        const cliff = open && Math.abs(z - pz) > 5 * dist + 4 && !(dist < 9 && bil(EARM, x, y) > 0.05 && bil(EARM, px, py) > 0.05);
        const pup = inPupil(x, y);
        if (m < 0.05 || cliff || pup) {
          if (open) { end(); begin(rng()); open = false; }
          if (m < 0.05 || pup) continue;
        }
        if (open && dist < 0.35 * g) continue; // near-duplicate corner points
        const zx = (zAt(x + 1, y) - zAt(x - 1, y)) * 0.5, zy = (zAt(x, y + 1) - zAt(x, y - 1)) * 0.5;
        const Fx = -KT * zx, Fy = 1 - KT * zy;
        const dens = Math.max(0.05, Math.hypot(Fx, Fy)); // |grad F|: local slice density vs nominal
        const t = bil(tone, x, y);
        const hair = bil(hairR, x, y);
        const brow = bil(browF, x, y);
        const beard = bil(beardB, x, y);
        let I = Math.pow(Math.max(0, t), 1.18 + 0.7 * hair) * pupilK(x, y);
        I *= 1 - Math.min(1, SCAN_HAIR * hairScanW(x, y, hair) * hair);
        I *= 1 - SCAN_BROW * Math.min(1, brow * 1.3);
        // beard / stubble: the photo's luminance has it near 0.35-0.45 of skin. (polish pass) The darkening is the
        // stubble texture's now (3b): fine dark hairs cut out of these filaments by the shader. The slices themselves
        // are a little BRIGHTER in the beard (BEARD_CUT < 0: the lit skin between the hairs), darker only along the jaw
        // border, and no longer broken into dashes (BEARD_DASH 0 leaves dissolveMul at 1).
        I *= 1 - BEARD_CUT * beard;
        if (x > jawX0 && x < jawX1) I *= 1 - JAW_DARK * Math.min(1, beard * 1.5) * Math.exp(-Math.pow((y - polyY(JAW, x) + 12) / 13, 2));
        I *= (1 - lashK(x, y)) * deepK(x, y, t);
        dissolveMul = 1 - BEARD_DASH * Math.min(1, beard * 1.2) * (1 - bil(lipF, x, y));
        if (x > mouthL - 4 && x < mouthR + 4) I *= 1 - SEAM_SH * Math.exp(-Math.pow((y - seamY(x) - SEAM_OFF) / SEAM_SIG, 2)) * smooth(mouthL - 4, mouthL - 4 + SEAM_END, x) * smooth(mouthR + 4, mouthR + 4 - SEAM_END, x);
        const gap = Math.min(SW_HI, Math.max(SW_LO, 1 / dens));
        I *= Math.pow(gap, 0.45);
        const pl = bil(PLANE, x, y) * PLANE_THIN;
        const wf = (0.16 + 0.62 * t) * (1 - pl) + (0.15 + 0.5 * t) * pl;
        I *= Math.pow((0.16 + 0.62 * t) / wf, THIN_COMP); // (finishing pass) less compensation: darker gaps on the planes, the mesh reads
        const half = Math.min(s * 0.5 * wf * Math.pow(gap, 0.7), 0.45 * s / Math.max(dens, 0.4));
        // vector to the neighbouring slice (along grad F, in image px) and its depth change
        const gl = Math.min(4 * s, s / dens);
        gX = (Fx / dens) * gl; gY = (Fy / dens) * gl; gZ = zx * gX + zy * gY;
        if (gY < 0) { gX = -gX; gY = -gY; gZ = -gZ; }
        const key2 = fy(y) * 0.86 + Math.abs(x - meta.head.cx) / W * 0.12;
        // (polish pass) deep in the hair a slice carries no light: its points are not stored there (the strands get the
        // vertices). Only the drawn line breaks; the walk itself (and what it draws from the random stream) is unchanged.
        if (I <= 0 && hair > 0.5) { if (!lineStart) { const sd = lineSeed; end(); begin(sd); } open = true; px = x; py = y; pz = z; continue; }
        pt(x, y, z, I, half, K_SCAN, m, key2);
        open = true;
        px = x; py = y; pz = z;
      }
      if (open) end();
    }
    curRank = 0; gX = gY = gZ = 0; dissolveMul = 1;
  }
  const nScan = nP;
  mark('scan');

  // ---------------------------------------------------------------- 2. meridians: radial vertical planes over skin
  // brighter on the open cheek / forehead planes (the network reads head-on there), dim over the features. Records the
  // REAL crossings with the scan slices (for the diagonal family and the node glints).
  // (low tier: + MER_LOW on the face only, the neck's meridians stay as they are)
  const MER_G = dbg('gmer', 0.3), MER_PLANE = dbg('gmerplane', LOW_MESH ? 0.32 : 0.24), MER_LOW = LOW_MESH ? dbg('gmerlow', 0.1) : 0;
  // (polish pass) around the mouth the wire network steps back: the diagonals that leave the mouth corners down and out
  // over the bare patches beside the lower lip read as the ends of a smile (the photo's mouth is level and neutral)
  const MESH_MOUTH_MER = dbg('meshmouthmer', 0.35), MESH_MOUTH_DIAG = dbg('meshmouthdiag', 0.8);
  const mouthMesh = (x: number, y: number, k: number) => {
    const yn = LMk[2][1];
    if (y < yn - 6 || y > chinY) return 1;
    const hw = 0.5 * (mouthR - mouthL);
    // (down to the chin only: the neck's lines are not touched)
    return 1 - k * smooth(yn - 6, yn + 14, y) * (1 - smooth(chinY - 16, chinY, y)) * (1 - smooth(hw + 24, hw + 62, Math.abs(x - 0.5 * (mouthL + mouthR))));
  };
  const crossings = new Map<number, [number, number, number]>(); // key m * 4096 + (j + 2048) -> [x, y, z]
  let mCenter = 0;
  {
    const MZ = dbg('mz', -60);
    const ZR = 220;
    const s = merStep;
    const dy = T.merDy;
    const cx = meta.head.cx;
    const half = (meta.head.right - meta.head.left) * 0.5;
    const xrs: number[] = [];
    for (let xr = -half + s * 0.5; xr < half; xr += s) xrs.push(xr);
    let best = 1e9;
    xrs.forEach((xr, k) => { if (Math.abs(xr) < best) { best = Math.abs(xr); mCenter = k; } });
    xrs.forEach((xr, m) => {
      const tp = xr / (ZR - MZ);
      curRank = Math.min(4, ctz(m - mCenter));
      begin(rng());
      let open = false;
      let pz = 0, px = cx + xr, pf = 0;
      for (let y = headTop; y <= headBot; y += dy) {
        let x = open ? px : cx + xr;
        for (let it = 0; it < 4; it++) x = 0.4 * x + 0.6 * (cx + (bil(depth, x, y) - MZ) * tp);
        const res = Math.abs(x - (cx + (bil(depth, x, y) - MZ) * tp));
        const mm = bil(mask, x, y);
        const skin = bil(skinG, x, y) + 0.6 * bil(beardB, x, y);
        const z = bil(depth, x, y);
        const steep = open && (Math.abs(z - pz) > 4.5 * dy || Math.abs(x - px) > 3 * dy);
        const w = Math.min(1, skin * 1.4) * mm;
        const f = (y - KT * z) / scanStep - 0.5;
        if (w < 0.12 || steep || res > 0.8 || inPupil(x, y)) {
          if (open) { end(); begin(rng()); open = false; }
          pz = z; px = x; pf = f;
          continue;
        }
        if (open && Math.floor(f) !== Math.floor(pf)) {
          // the meridian crosses slice level j between the previous sample and this one
          const j = Math.max(Math.floor(f), Math.floor(pf));
          const u = (j - pf) / (f - pf || 1e-6);
          crossings.set(m * 4096 + (j + 2048), [px + (x - px) * u, y - dy + dy * u, pz + (z - pz) * u]);
        }
        const t = bil(tone, x, y);
        const plane = bil(PLANE, x, y);
        const I = (1 - 0.4 * bil(beardB, x, y)) * (1 - lashK(x, y)) * deepK(x, y, t) * mouthMesh(x, y, MESH_MOUTH_MER) * toneCurve(t) * (MER_G + MER_LOW * (1 - smooth(chinY - 16, chinY, y)) + MER_PLANE * plane) * Math.min(1, (w - 0.12) * 3) * (1 - 0.8 * Math.min(1, bil(browF, x, y) * 1.5)) * (1 - 0.6 * bil(eyeF, x, y)) * pupilK(x, y);
        const key = fy(y) * 0.86 + 0.06;
        pt(x, y, z + 0.6, I, 0.32, K_MER, mm, key);
        open = true;
        pz = z; px = x; pf = f;
      }
      if (open) end();
    });
    curRank = 0;
  }
  const nMer = nP - nScan;
  mark('meridians');

  // ---------------------------------------------------------------- 2b. diagonal family (interconnected network)
  // Each diagonal joins REAL meridian x slice crossings C(m, j) -> C(m +- 1, j + n) outward from the midline, sampled
  // on the surface between them: with the slices and meridians it triangulates the cheek and forehead planes into a
  // wireframe mesh (chevrons that open downward, mirror-symmetric). Only on the open planes, very dim.
  const DIAG_G = dbg('gdiag', LOW_MESH ? 0.2 : 0.4);
  const nodes: number[] = []; // crossings on the open planes: [x, y, z, plane]
  {
    const nRow = Math.max(3, Math.round((merStep * dbg('diagrow', 1.8)) / scanStep));
    const get = (m: number, j: number) => crossings.get(m * 4096 + (j + 2048));
    const done = new Set<number>();
    const keys = [...crossings.keys()].sort((a, b) => Math.abs(Math.floor(a / 4096) - mCenter) - Math.abs(Math.floor(b / 4096) - mCenter));
    for (const side of [1, -1]) {
      done.clear();
      for (const kk of keys) {
        const m0 = Math.floor(kk / 4096), j0 = (kk % 4096) - 2048;
        if (((j0 % nRow) + nRow) % nRow !== 0) continue;
        if ((m0 - mCenter) * side < 0) continue;
        if (done.has(kk)) continue;
        // walk outward along the chain
        let m = m0, j = j0, c0 = get(m, j) as [number, number, number];
        done.add(kk);
        begin(rng());
        let open = false;
        for (;;) {
          const m1 = m + side, j1 = j + nRow;
          const c1 = get(m1, j1);
          if (!c1) break;
          done.add(m1 * 4096 + (j1 + 2048));
          const segL = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
          const ns = Math.max(2, Math.ceil(segL / 2.2));
          for (let q = open ? 1 : 0; q <= ns; q++) {
            const u = q / ns;
            const x = c0[0] + (c1[0] - c0[0]) * u, y = c0[1] + (c1[1] - c0[1]) * u;
            const pl = bil(PLANE, x, y);
            if (pl < 0.12) { if (open) { end(); begin(rng()); open = false; } continue; }
            const t = bil(tone, x, y);
            const z = bil(depth, x, y);
            pt(x, y, z + 0.8, DIAG_G * mouthMesh(x, y, MESH_MOUTH_DIAG) * toneCurve(t) * Math.min(1, (pl - 0.12) * 2.5), 0.26, K_DIAG, bil(mask, x, y), fy(y) * 0.86 + 0.07);
            open = true;
          }
          m = m1; j = j1; c0 = c1;
        }
        if (open) end();
      }
    }
    // network nodes: crossings of the three families on the open planes
    for (const [kk, c] of crossings) {
      const j = (kk % 4096) - 2048;
      if (((j % nRow) + nRow) % nRow !== 0) continue;
      const pl = bil(PLANE, c[0], c[1]);
      if (pl > 0.45 && bil(eyeF, c[0], c[1]) < 0.05) nodes.push(c[0], c[1], c[2], pl);
    }
  }
  const nDiag = nP - nScan - nMer;
  mark('diagonals');

  // ---------------------------------------------------------------- 3. strands (hair, brows, beard) - identity pass
  let stub: BuildOutput['stub'];
  const fo = [0, 0, 0];
  function trace(x0: number, y0: number, maxSteps: number, step: number, accept: (x: number, y: number) => boolean, kind: number, Ifn: Field, half: number, lift: number, keyOff: number) {
    const xs: number[] = [], ys: number[] = [];
    for (const dir of [1, -1]) {
      let x = x0, y = y0;
      flowAt(x, y, fo);
      let tx = fo[0] * dir, ty = fo[1] * dir;
      const t0x = tx, t0y = ty;
      const seg: number[] = [];
      for (let i = 0; i < maxSteps; i++) {
        flowAt(x, y, fo);
        let fx = fo[0], fy2 = fo[1];
        if (fx * tx + fy2 * ty < 0) { fx = -fx; fy2 = -fy2; }
        const c = Math.min(1, fo[2] * 1.6 + 0.15);
        const cosA = fx * tx + fy2 * ty;
        if (cosA < 0.55 && fo[2] > 0.3) break;
        const nx = tx * (1 - c * 0.6) + fx * c * 0.6;
        const ny = ty * (1 - c * 0.6) + fy2 * c * 0.6;
        const l = Math.hypot(nx, ny) || 1;
        tx = nx / l; ty = ny / l;
        if (tx * t0x + ty * t0y < 0.15) break;
        x += tx * step; y += ty * step;
        if (!accept(x, y)) break;
        seg.push(x, y);
      }
      if (dir === 1) { for (let i = seg.length - 2; i >= 0; i -= 2) { xs.push(seg[i]); ys.push(seg[i + 1]); } xs.push(x0); ys.push(y0); }
      else for (let i = 0; i < seg.length; i += 2) { xs.push(seg[i]); ys.push(seg[i + 1]); }
    }
    if (xs.length < 3) return 0;
    begin(rng());
    const n = xs.length;
    for (let i = 0; i < n; i++) {
      const x = xs[i], y = ys[i];
      const m = bil(mask, x, y);
      const taper = Math.min(1, Math.min(i, n - 1 - i) / 3 + 0.25);
      pt(x, y, bil(depth, x, y) + lift, Ifn(x, y) * taper, half * (0.55 + 0.45 * taper), kind, m, fy(y) * 0.86 + keyOff);
    }
    end();
    return n;
  }
  const occ = new Int32Array(N).fill(-1);
  let sid = 0;
  function stamp(x: number, y: number, rad: number, id: number) {
    const r = Math.ceil(rad), x0 = Math.round(x), y0 = Math.round(y);
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      if (i * i + j * j > rad * rad) continue;
      const xx = x0 + i, yy = y0 + j;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) occ[yy * W + xx] = id;
    }
  }
  const hd = [0, 0, 0];
  const flowDir: DirFn = (x, y, out) => flowAt(x, y, out);
  function traceEven(o: TraceOpts) {
    const seeds: number[] = [];
    for (let y = 0; y < H; y += o.seedSpacing) for (let x = 0; x < W; x += o.seedSpacing) {
      const sx = x + rng() * o.seedSpacing, sy = y + rng() * o.seedSpacing;
      if (o.region(sx, sy) > o.minRegion) seeds.push(sx, sy);
    }
    const n = seeds.length >> 1;
    const ord = new Uint32Array(n);
    for (let i = 0; i < n; i++) ord[i] = i;
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = ord[i]; ord[i] = ord[j]; ord[j] = t; }
    let made = 0;
    for (let q = 0; q < n; q++) {
      const sx = seeds[ord[q] * 2], sy = seeds[ord[q] * 2 + 1];
      if (occ[Math.round(sy) * W + Math.round(sx)] >= 0) continue;
      if (o.dirFn(sx, sy, hd)[2] < o.minCoh) continue;
      const id = sid++;
      const lenMax = o.maxLen * (0.55 + 0.45 * rng());
      const line: number[][] = [[sx, sy]];
      for (const sg of [1, -1]) {
        o.dirFn(sx, sy, hd);
        let dx = hd[0] * sg, dy = hd[1] * sg;
        const t0x = dx, t0y = dy;
        let x = sx, y = sy, L = 0, low = 0;
        const out: number[][] = [];
        while (L < lenMax * 0.5) {
          o.dirFn(x, y, hd);
          let tx = hd[0], ty = hd[1];
          if (tx * dx + ty * dy < 0) { tx = -tx; ty = -ty; }
          if (tx * dx + ty * dy < o.cosStep) break;
          if (hd[2] < o.minCoh * 0.4 && ++low > 3) break;
          tx = tx * o.follow + dx * (1 - o.follow); ty = ty * o.follow + dy * (1 - o.follow);
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl; ty /= tl;
          if (tx * t0x + ty * t0y < o.cosCum) break;
          const nx = x + tx * o.step, ny = y + ty * o.step;
          if (o.region(nx, ny) < o.minRegion * 0.7) break;
          const xi = Math.round(nx), yi = Math.round(ny);
          if (xi < 0 || yi < 0 || xi >= W || yi >= H) break;
          const oc = occ[yi * W + xi];
          if (oc >= 0 && oc !== id) break;
          x = nx; y = ny; dx = tx; dy = ty; L += o.step;
          out.push([x, y]);
        }
        if (sg === 1) line.push(...out); else line.unshift(...out.reverse());
      }
      if ((line.length - 1) * o.step < o.minLen) continue;
      for (const p of line) stamp(p[0], p[1], o.dsep * 0.5, id);
      const sd = rng();
      begin(sd);
      const nl = line.length;
      for (let i = 0; i < nl; i++) {
        const [x, y] = line[i];
        if (o.unlit && o.unlit(x, y)) { if (!lineStart) { end(); begin(sd); } continue; }
        const taper = 0.12 + 0.88 * Math.min(1, Math.sin((Math.PI * i) / (nl - 1)) * 1.8);
        pt(x, y, bil(depth, x, y) + o.lift, o.Ifn(x, y) * taper, o.half * (0.55 + 0.45 * taper), o.kind, bil(mask, x, y), fy(y) * 0.86 + o.keyOff);
      }
      end();
      made++;
    }
    return made;
  }
  // (polish pass) with scanbrow 0.95: brows at 1.03 of the photo's brow / cheek luminance (were 1.38); the low tier
  // traces fewer strands, so each carries a little more
  const BROW_G = dbg('gbrow', tier === 'low' ? 0.27 : 0.2);
  traceEven({
    region: (x, y) => bil(browF, x, y), minRegion: 0.3, dsep: 1.25 * TS, step: 1.0, maxLen: 26, minLen: 5, follow: 0.6,
    cosStep: 0.75, cosCum: 0.87, dirFn: flowDir, minCoh: 0, seedSpacing: 1.5,
    Ifn: (x, y) => BROW_G * (0.12 + Math.pow(bil(tone, x, y), 1.3)) * Math.min(1, bil(browF, x, y) * 1.6),
    half: 0.3, lift: 2.0, kind: K_BROW + 0.6, keyOff: 0.0,
  });
  mark('brows');
  // ---------------------------------------------------------------- hair (polish pass)
  // His hair is near-black, sleek and swept back. On black that is drawn as FEW thin filaments with black between
  // them: long strands along the photo's flow, sparse and dim in the dark body, closer and bright only in the photo's
  // sheen bands, plus one thin contour that keeps the silhouette readable. (Before: a dense mat of dim deep-amber
  // strands over a residual scan hatch, which read as a mid-brown mass.)
  // (the back shell's tone: read just inside the silhouette above ear level, so only those rows are blurred)
  const HT_SH = Math.min(64, Math.max(1, Math.round(dbg('htoneblur', 4))));
  const toneHS = blurRows(tone, HT_SH, EAR_Y1 + 3 * (HT_SH + 2));
  const hairRegion = (x: number, y: number) => {
    const m = bil(mask, x, y);
    return m < 0.05 ? 0 : (Math.max(bil(hairR, x, y), Math.min(0.9, 1.5 * sideburn(x, y))) / m) * Math.min(1, m * 2) * (1 - bil(browF, x, y));
  };
  const hairS = boxBlur(hairR, 4);
  // (what the turned-view sweep strands of section 3c need of the hair block: its strand depth and its sheen)
  let hairZS: Float32Array | null = null, hairZY = 0;
  let hairSheen: Field = () => 0;
  (() => { // (own function: see the note on V8's optimisation limit at the top of buildFaceGeometry)
    const HAIR_G0 = dbg('ghair', 0.34), HAIR_P = dbg('hexp', 2.1);
    // hair-only tone (a normalised blur over the solid hair: no skin tone bleeding in at the hairline)
    const hm = new Float32Array(N), ht = new Float32Array(N);
    for (let i = 0, n = Math.min(N, HAIR_Y1 * W); i < n; i++) { const w = smooth(0.55, 0.9, hairR[i]) * mask[i]; hm[i] = w; ht[i] = w * tone[i]; }
    const HT_R = Math.min(64, Math.max(1, Math.round(dbg('htoner', 3)))), HT_ROWS = Math.min(H, HAIR_Y1 + 3 * (HT_R + 2));
    const hmT = blurRows(hm, HT_R, HT_ROWS), toneN = blurRows(ht, HT_R, HT_ROWS);
    for (let i = 0, n = HT_ROWS * W; i < n; i++) toneN[i] = hmT[i] > 0.02 ? toneN[i] / hmT[i] : 0; // (no solid hair near: body level, e.g. down the sideburns)
    // Strand depth. The monocular depth ripples under the hair: strands laid on it squiggle in turned views, and
    // strands laid on a blurred copy sink into the ripples and are hidden by them (the horizons are the raw relief's).
    // So a strand rides the ripples' crests: the local maximum of the depth (Z_ENV px around a point, then along the
    // strand), smoothed along the strand.
    const Z_ENV = Math.round(dbg('hzenv', 3)), Z_WIN = dbg('hzwin', 20), Z_SM = dbg('hzsmooth', 24), Z_LIFT = dbg('hzlift', 3);
    const zH = new Float32Array(depth); // (a typed-array copy; Float32Array.from walks the iterator, ~40 ms here)
    if (Z_ENV > 0) {
      const tmp = new Float32Array(N);
      let hy0 = H, hy1 = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x += 4) if (hairR[y * W + x] > 0.3) { if (y < hy0) hy0 = y; hy1 = y; }
      hy0 = Math.max(0, hy0 - 4); hy1 = Math.min(H - 1, hy1 + 4);
      // (a (2 Z_ENV + 1)^2 maximum, rows then columns)
      for (let y = hy0; y <= hy1; y++) {
        const r = y * W;
        for (let x = 0; x < W; x++) {
          const k1 = Math.min(W - 1, x + Z_ENV);
          let m = depth[r + Math.max(0, x - Z_ENV)];
          for (let k = Math.max(0, x - Z_ENV) + 1; k <= k1; k++) { const v = depth[r + k]; if (v > m) m = v; }
          tmp[r + x] = m > 0 ? m : 0;
        }
      }
      for (let y = hy0; y <= hy1; y++) {
        const ka = Math.max(hy0, y - Z_ENV), kb = Math.min(hy1, y + Z_ENV), r = y * W;
        for (let x = 0; x < W; x++) zH[r + x] = tmp[ka * W + x];
        for (let k = ka + 1; k <= kb; k++) {
          const q = k * W;
          for (let x = 0; x < W; x++) { const v = tmp[q + x]; if (v > zH[r + x]) zH[r + x] = v; }
        }
      }
    }
    // (integration pass) the relief's steepness under the hair, from a smoothed copy of that depth: where the surface is
    // a wall seen edge-on (the sides of the head, the top behind the quiff) the turned views get their own strands
    // (the sweep, section 3c), and the strands traced here, which cross those at an angle and kink over the depth steps
    // near the silhouette, hand over to them with the turn (turn fade, up to STEEP_FADE of their light)
    const SW_R = Math.min(8, Math.max(1, Math.round(dbg('swblur', 6)))), zsRows = Math.min(H, HAIR_Y1 + 30);
    const zS = blurRows(zH, SW_R, zsRows);
    hairZS = zS; hairZY = zsRows - 3 * (SW_R + 2) - 2; // (down to that row the row-limited blur is exact)
    const STEEP_FADE = dbg('hsteepfade', 0.85), STEEP0 = dbg('hsteep0', 1.6), STEEP1 = dbg('hsteep1', 3.2);
    const steepAt = (x: number, y: number) => (y < hairZY ? Math.hypot(bil(zS, x + 1.5, y) - bil(zS, x - 1.5, y), bil(zS, x, y + 1.5) - bil(zS, x, y - 1.5)) / 3 : 0);
    // sheen 0..1 from the hair's own tone range (dark body .. brightest highlight)
    const T_LO = dbg('htlo', 0.17), T_HI = dbg('hthi', 0.5), BODY = dbg('hbody', 0.08);
    const sheenAt = (x: number, y: number) => Math.min(1, Math.max(0, (bil(toneN, x, y) - T_LO) / (T_HI - T_LO)));
    hairSheen = sheenAt;
    // strand spacing: the closest spacing d0 keeps ~HPX device px between strands at the largest size the head is shown
    // (so they stay discrete filaments on a DPR-1 desktop and a phone instead of merging into a tone or beating into
    // moire rings); the dark body is SPARSE times sparser. Width follows d0, so the hair's mean tone is the same on
    // every display.
    const D_REF = 1.9;
    const d0 = Math.max(dbg('hdsep', D_REF) * TS, dbg('hpx', tier === 'low' ? 3.1 : 2.5) / devPerCrop);
    // (the body's spacing is also bounded in crop px: on a small display it must not thin out to stray scribbles)
    const SPARSE = Math.max(1, Math.min(dbg('hsparse', 3.0), (dbg('hbodymax', 6.0) * TS) / d0)), COMP = dbg('hcomp', 0.55);
    const spK = (sh: number) => SPARSE + (1 - SPARSE) * smooth(0.12, 0.7, sh);
    // (low tier = phones: a DPR <= 1.25 canvas without supersampling, where a minimum-width strand at an angle breaks
    // into dashes; there the strands are drawn ~1 device px half-wide and proportionally dimmer)
    const HALF0 = dbg('hhalf', 0.38) * (d0 / D_REF);
    // (fix pass: 0.8 px, was 0.95, and a dimmer outline on this tier: on the phone the hair read as thick line-art waves)
    const HALF = Math.max(HALF0, tier === 'low' ? dbg('hminpx', 0.8) / devPerCrop : 0), WCOMP = HALF0 / HALF;
    const HAIR_G = HAIR_G0 * WCOMP;
    const RIMB = dbg('hrimb', 0.1) * WCOMP, CAP = dbg('hcap', 1.2), HLF = dbg('hlfade', 0.5), ROOT = dbg('hroot', 0.12);
    const step = T.hairStep * dbg('hstepk', 1.4);
    const hf = [0, 0];
    const dirAt = (x: number, y: number, px: number, py: number) => {
      const th = 0.5 * Math.atan2(bil(HS, x, y), bil(HC, x, y));
      hf[0] = Math.cos(th); hf[1] = Math.sin(th);
      if (hf[0] * px + hf[1] * py < 0) { hf[0] = -hf[0]; hf[1] = -hf[1]; }
    };
    const occS = new Uint8Array(N), occG = new Uint8Array(N);
    const stampU = (o: Uint8Array, x: number, y: number, rad: number) => {
      const r = Math.ceil(rad), x0 = Math.round(x), y0 = Math.round(y), r2 = rad * rad;
      for (let j = -r; j <= r; j++) {
        const yy = y0 + j;
        if (yy < 0 || yy >= H) continue;
        for (let i = -r; i <= r; i++) {
          const xx = x0 + i;
          if (i * i + j * j <= r2 && xx >= 0 && xx < W) o[yy * W + xx] = 1;
        }
      }
    };
    const lines: { p: number[]; rank: number }[] = [];
    const stampLine = (p: number[], sc: number) => {
      for (let k = 0; k < p.length; k += 2) {
        const d = d0 * sc * spK(sheenAt(p[k], p[k + 1]));
        stampU(occS, p[k], p[k + 1], 0.85 * d); stampU(occG, p[k], p[k + 1], 0.5 * d);
      }
    };
    // evenly spaced streamlines, coarse to fine: the first passes lay long primary strands at 4x / 2x the spacing, the
    // last fills between them (no tufts of short strands ending together, no voids)
    const PASSES = [[4, 70, dbg('hlen', 520)], [2, 40, 380], [1, dbg('hmin', 14), 260]];
    let bx0 = W, bx1 = 0, by0 = H, by1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hairR[y * W + x] > 0.3) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    for (let ps = 0; ps < PASSES.length; ps++) {
      const [sc, minLen, maxLen] = PASSES[ps];
      occS.fill(0); occG.fill(0);
      for (const ln of lines) stampLine(ln.p, sc);
      const gs = Math.max(1.5, 0.6 * d0 * sc);
      const seeds: number[] = [];
      for (let y = by0; y <= by1; y += gs) for (let x = bx0; x <= bx1; x += gs) {
        const sx = x + hrng() * gs, sy = y + hrng() * gs;
        if (hairRegion(sx, sy) > 0.45) seeds.push(sx, sy);
      }
      const n = seeds.length >> 1;
      const ord = new Uint32Array(n);
      for (let i = 0; i < n; i++) ord[i] = i;
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(hrng() * (i + 1)); const t = ord[i]; ord[i] = ord[j]; ord[j] = t; }
      for (let q = 0; q < n; q++) {
        const sx = seeds[ord[q] * 2], sy = seeds[ord[q] * 2 + 1];
        if (occS[Math.round(sy) * W + Math.round(sx)]) continue;
        const p: number[] = [sx, sy];
        for (const sg of [1, -1]) {
          dirAt(sx, sy, 1, 0);
          let dx = hf[0] * sg, dy = hf[1] * sg;
          let x = sx, y = sy, L = 0;
          const out: number[] = [];
          while (L < maxLen * 0.5) {
            // midpoint step
            dirAt(x, y, dx, dy);
            const ax = hf[0], ay = hf[1];
            dirAt(x + ax * step * 0.5, y + ay * step * 0.5, ax, ay);
            if (hf[0] * dx + hf[1] * dy < 0.82) break; // a whorl / the parting: the strand ends there
            const nx = x + hf[0] * step, ny = y + hf[1] * step;
            const xi = Math.round(nx), yi = Math.round(ny);
            if (xi < 0 || yi < 0 || xi >= W || yi >= H) break;
            if (occG[yi * W + xi] || hairRegion(nx, ny) < ROOT) break; // (strands run out into the thin hair of the hairline and taper there)
            dx = hf[0]; dy = hf[1]; x = nx; y = ny; L += step;
            out.push(x, y);
          }
          if (sg === 1) for (let k = 0; k < out.length; k++) p.push(out[k]);
          else { const rv: number[] = []; for (let k = out.length - 2; k >= 0; k -= 2) rv.push(out[k], out[k + 1]); p.unshift(...rv); }
        }
        if ((p.length / 2 - 1) * step < minLen) continue;
        stampLine(p, sc);
        lines.push({ p, rank: ps });
      }
    }
    // emit: brightness = sheen ^ HAIR_P over a faint body level, per-strand gain (streaky highlights), a rim light on
    // the strands along the outer silhouette (the dark side mass keeps its weight), faded at the hairline; depth
    // smoothed along the strand
    const zs: number[] = [], zr: number[] = [], zp: number[] = [];
    const zk = Math.max(1, Math.round(Z_WIN / step));
    // (the smoothing: three box passes of zb samples each way, about a Gaussian of Z_SM px along the strand)
    const zq = Z_SM / step, zb = Math.max(0, Math.round((Math.sqrt(1 + 4 * zq * zq) - 1) / 2));
    for (const ln of lines) {
      const p = ln.p, n = p.length >> 1;
      const gsn = 0.55 + 0.9 * Math.pow(hrng(), 1.6);
      zs.length = n; zr.length = n;
      for (let i = 0; i < n; i++) zr[i] = bil(zH, p[i * 2], p[i * 2 + 1]);
      for (let i = 0; i < n; i++) { let m = zr[i]; for (let k = Math.max(0, i - zk); k <= Math.min(n - 1, i + zk); k++) if (zr[k] > m) m = zr[k]; zs[i] = m; }
      zp.length = n + 1; zp[0] = 0;
      for (let pass = 0; pass < 3 && zb > 0; pass++) {
        for (let i = 0; i < n; i++) zp[i + 1] = zp[i] + zs[i];
        const z0 = zs[0], z1 = zs[n - 1]; // (past its ends a strand keeps its end value)
        for (let i = 0; i < n; i++) {
          const lo = i - zb, hi = i + zb;
          zs[i] = (zp[Math.min(n, hi + 1)] - zp[Math.max(0, lo)] + (lo < 0 ? -lo * z0 : 0) + (hi > n - 1 ? (hi - n + 1) * z1 : 0)) / (2 * zb + 1);
        }
      }
      curRank = ln.rank;
      begin(hrng());
      for (let i = 0; i < n; i++) {
        const x = p[i * 2], y = p[i * 2 + 1];
        const sh = sheenAt(x, y);
        const taper = smooth(0, 1, Math.min(i, n - 1 - i) * step / 16);
        const rimW = (1 - smooth(2, 10, bil(dIn, x, y))) * smooth(12, 26, bil(dHL, x, y));
        const hl = HLF + (1 - HLF) * smooth(2, 16, bil(dHL, x, y));
        let I = HAIR_G * (BODY + (1 - BODY) * Math.pow(sh, HAIR_P)) * Math.pow(spK(sh), COMP) * gsn * hl;
        // (mask slot = 1: the matte's soft edge must not break the outermost strands into dissolve dashes; they fade)
        I = Math.min(CAP, I + RIMB * rimW * gsn) * (0.1 + 0.9 * taper) * smooth(0.1, 0.5, bil(mask, x, y));
        curFade = Math.round(255 * STEEP_FADE * smooth(STEEP0, STEEP1, steepAt(x, y)));
        pt(x, y, zs[i] + Z_LIFT, I, HALF * (0.6 + 0.4 * taper), K_HAIR + 0.8, 1, fy(y) * 0.86 + 0.01);
      }
      end();
    }
    curRank = 0; curFade = 0;
    // the hair's outline: ONE thin contour on the matte's 0.5 level, from the top of the head down both sides to where
    // the hair ends at the ears (it carries the hairstyle's silhouette now that the hair is dark). Followed along the
    // level's tangent with a Newton step back onto it, on a smoother matte than the old rim tracer used (that one
    // wobbled and doubled along the temples). It lies in the silhouette plane, so it only means something front-on: the
    // shader fades it out as the head turns (kind 2.9), where it would hang behind the hair like a loose wire.
    {
      const OUT_G = dbg('hrim', tier === 'low' ? 0.08 : 0.11) * WCOMP;
      const mO = blurRows(mask, Math.min(64, Math.max(1, Math.round(dbg('hrimblur', 4)))), chinY - 60), hO = hairS;
      const og = [0, 0];
      const grad = (x: number, y: number) => { og[0] = (bil(mO, x + 1, y) - bil(mO, x - 1, y)) * 0.5; og[1] = (bil(mO, x, y + 1) - bil(mO, x, y - 1)) * 0.5; return og[0] * og[0] + og[1] * og[1]; };
      const cx0 = meta.head.cx;
      let yTop = -1;
      for (let y = 1; y < H; y++) { const a = bil(mO, cx0, y - 1), b = bil(mO, cx0, y); if (b >= 0.5) { yTop = y - (b - 0.5) / Math.max(1e-6, b - a); break; } }
      const OSTEP = 2;
      if (yTop > 0) for (const sg of [-1, 1]) {
        const P: number[] = [];
        let x = cx0, y = yTop, dx = sg, dy = 0;
        for (let it = 0; it < 1500; it++) {
          let g2 = grad(x, y);
          if (g2 < 1e-9) break;
          const gl = Math.sqrt(g2);
          let tx = -og[1] / gl, ty = og[0] / gl;
          if (tx * dx + ty * dy < 0) { tx = -tx; ty = -ty; }
          x += tx * OSTEP; y += ty * OSTEP;
          for (let k = 0; k < 2; k++) {
            g2 = grad(x, y);
            if (g2 < 1e-9) break;
            const e = Math.max(-0.2, Math.min(0.2, bil(mO, x, y) - 0.5));
            x -= (e * og[0]) / Math.max(g2, 0.004); y -= (e * og[1]) / Math.max(g2, 0.004);
          }
          if (x < 2 || x > W - 3 || y < 2 || y > chinY - 90) break;
          // the hair's coverage a few px inside the outline
          g2 = grad(x, y);
          const gi = Math.sqrt(g2) || 1;
          const ix = x + (og[0] / gi) * 5, iy = y + (og[1] / gi) * 5;
          const hc = bil(hO, ix, iy);
          if (hc < 0.15) break;
          P.push(x, y, hc, sheenAt(ix + (og[0] / gi) * 3, iy + (og[1] / gi) * 3));
          dx = tx; dy = ty;
        }
        const n = P.length >> 2;
        if (n < 8) continue;
        begin(hrng());
        for (let i = 0; i < n; i++) {
          const px = P[i * 4], py = P[i * 4 + 1];
          const tp = sg === -1 || i > 0 ? smooth(0, 1, Math.min(n - 1 - i, 12) / 12) : 1;
          const I = OUT_G * smooth(0.15, 0.5, P[i * 4 + 2]) * (0.7 + 0.6 * P[i * 4 + 3]) * (0.15 + 0.85 * tp);
          pt(px, py, bil(depth, px, py) + 1.0, I, HALF * 0.9, K_HAIR + 0.9, 1, fy(py) * 0.86); // (kind 2.9: the shader fades it out when the head turns)
        }
        end();
      }
    }
  })();
  mark('hair');
  {
    const mS = boxBlur(mask, 2);
    const RIM_G = dbg('grim', 0.14);
    const rimDir: DirFn = (x, y, out) => {
      const gx = bil(mS, x + 1, y) - bil(mS, x - 1, y), gy = bil(mS, x, y + 1) - bil(mS, x, y - 1);
      const g = Math.hypot(gx, gy) || 1;
      out[0] = -gy / g; out[1] = gx / g; out[2] = 1;
      return out;
    };
    traceEven({
      region: (x, y) => (y > chinY - 90 ? 0 : 1 - Math.abs(bil(mS, x, y) - 0.5) * 4), minRegion: 0.75, dsep: 7, step: 1.5, maxLen: 400, minLen: 12, follow: 0.6,
      cosStep: 0.6, cosCum: -2, dirFn: rimDir, minCoh: 0, seedSpacing: 3,
      unlit: (x, y) => bil(hairS, x, y) > 0.2, // (polish pass) not along the hair: its outline is the contour above (traced as before, not stored there)
      Ifn: (x, y) => { const hy = Math.min(1, bil(hairS, x, y) * 2.5); return RIM_G * (0.45 + 0.55 * hy) * (0.6 + 0.6 * bil(tone, x, y)) * (isEar(x, y) ? 1.6 : 1); }, // the ear's outline closes the ear when turned
      half: 0.3, lift: 1.0, kind: K_HAIR + 0.4, keyOff: 0.0,
    });
  }
  const browSoft = boxBlur(browF, 3); // (the stubble texture's brow fringe and the edge strokes' keep-out)
  (() => { // (own function: see the note on V8's optimisation limit at the top of buildFaceGeometry)
    const midX = (LMk[164][0] + LMk[152][0]) * 0.5;
    const halfW = (LMk[454][0] - LMk[234][0]) * 0.5;
    const lipTop = LMk[0][1], lipBot = LMk[17][1];
    const st = dbg('sdsep', 1.7) * TS;
    const tickLen = dbg('slen', 4.2);
    const SG = dbg('gstub', 0.3);
    // (polish pass) the lit ticks are thinned to a sparse sprinkle of glints (TICK_KEEP of them, at TICK_G): the stubble
    // itself is the hair texture below. The loop still walks every tick and draws the same random numbers (which ticks
    // are shown is decided by a counter, not the stream), so nothing generated after it moves.
    const TICK_KEEP = dbg('stubtickkeep', 0.3), TICK_G = dbg('stubtickg', 0.6);
    let tickN = 0;
    // (fix pass: outside the facial hair's rows a cell only draws its two random numbers, as it always did)
    let bRow0 = 0, bRow1 = H - 1;
    { let i = 0; while (i < N && !beardB[i]) i++; bRow0 = Math.floor(i / W) - 1; i = N - 1; while (i > 0 && !beardB[i]) i--; bRow1 = Math.floor(i / W) + 1; }
    for (let gy = 0; gy < H; gy += st) for (let gx = 0; gx < W; gx += st) {
      const sx = gx + rng() * st, sy = gy + rng() * st;
      if (sy < bRow0 || sy > bRow1) continue;
      const b = bil(beardB, sx, sy) * (1 - bil(lipF, sx, sy));
      if (b < 0.2 || rng() > b * 1.25) continue;
      const m = bil(mask, sx, sy);
      if (m < 0.1 || neckRef.k(sx, sy) < 0.05) continue;
      const u = (sx - midX) / halfW;
      let ang = sy < lipTop ? u * 1.6 : sy < lipBot ? u * 0.9 : u * 0.35;
      ang += (rng() - 0.5) * 0.7;
      const ddx = Math.sin(ang), ddy = Math.cos(ang);
      const L = tickLen * (0.6 + 0.6 * rng()) * (0.7 + 0.3 * b);
      const ax = sx - ddx * L * 0.5, ay = sy - ddy * L * 0.5, bx = sx + ddx * L * 0.5, by = sy + ddy * L * 0.5;
      const za = bil(depth, ax, ay), zb = bil(depth, bx, by), zc = bil(depth, sx, sy);
      if (Math.abs(zb - za) > 2.2 * L + 1) continue;
      const tn = bil(tone, sx, sy) * m;
      const ed = bil(edges, sx, sy);
      const I = SG * Math.pow(tn, 1.2) * (0.55 + 0.9 * ed) * Math.min(1, b * 1.6) * Math.min(1, m * 1.3) * (1 - 0.6 * smooth(chinY, chinY + 50, sy));
      if (I < 0.004) continue;
      const key = fy(sy) * 0.86;
      begin(rng());
      if ((tickN++ * 0.6180339887) % 1 >= TICK_KEEP) continue;
      pt(ax, ay, za + 1.0, I * TICK_G * 0.3, 0.16, K_BEARD, m, key);
      pt(sx, sy, zc + 1.0, I * TICK_G, 0.22, K_BEARD, m, key);
      pt(bx, by, zb + 1.0, I * TICK_G * 0.3, 0.16, K_BEARD, m, key);
      end();
    }
    mark('ticks');
    // ---------------------------------------------------------------- 3b. stubble texture (polish pass)
    // His beard is short dense stubble: fine dark hairs, 5 to 9 px long in the photo, pointing down and outward, with
    // skin showing between them. Light cannot draw a dark hair, so the hairs are a DARKENING texture (one byte per texel,
    // STUB_RES texels per crop px over the facial-hair box) that the shader multiplies into every skin filament; its
    // mip chain turns the hairs into their mean tone as the head gets small (no blocks, no shimmer on phones).
    // Where: the facial-hair density of regions.png (cheek line, moustache, soul patch, the bare patches beside the lower
    // lip stay bare), denser where the photo's tone is darker (jaw line). Direction: the fan the ticks use, pulled toward
    // the photo's own strand orientation (flow.png) where that is coherent. Own random sub-stream.
    if (dbg('stub', 1) > 0.5) {
      const sr = subRng(0x57b1);
      const K = Math.min(4, Math.max(1, dbg('stubres', Math.min(3, Math.max(1.6, devPerCrop * 1.3)))));
      let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
      const BR_H = dbg('browhair', 0.7);
      let browY1 = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const br = BR_H > 0 && browF[i] > 0.1;
        if (br && y > browY1) browY1 = y;
        if (beardB[i] > 0.1 || br) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      }
      if (bx1 > bx0 && by1 > by0) {
        const PAD = 14;
        bx0 = Math.max(0, bx0 - PAD); by0 = Math.max(0, by0 - PAD); bx1 = Math.min(W - 1, bx1 + PAD); by1 = Math.min(H - 1, by1 + PAD);
        const tw = Math.ceil((bx1 - bx0) * K), th = Math.ceil((by1 - by0) * K);
        const tr = new Float32Array(tw * th).fill(1); // transmittance
        const sp = dbg('stubsp', 2.0), SD = dbg('stubdens', 0.54), SL = dbg('stublen', 5.5), SW = dbg('stubw', 0.42), SA = dbg('stuba', 0.9), SFLOW = dbg('stubflow', 0.6);
        const toneS = boxBlur(tone, 5);
        const fl = [0, 0, 0];
        // one hair: an anti-aliased tapered segment from (ax, ay) along (ddx, ddy), L long, half width hw (texels),
        // multiplied into the transmittance; sym tapers both ends (brow hairs), otherwise root -> tip
        const stroke = (ax: number, ay: number, ddx: number, ddy: number, L: number, hw: number, al: number, sym: boolean) => {
          const ex = ax + ddx * L, ey = ay + ddy * L;
          const x0 = Math.max(0, Math.floor(Math.min(ax, ex) - hw - 1)), x1 = Math.min(tw - 1, Math.ceil(Math.max(ax, ex) + hw + 1));
          const y0 = Math.max(0, Math.floor(Math.min(ay, ey) - hw - 1)), y1 = Math.min(th - 1, Math.ceil(Math.max(ay, ey) + hw + 1));
          for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
            const px = tx + 0.5 - ax, py = ty + 0.5 - ay;
            const tt = Math.min(1, Math.max(0, (px * ddx + py * ddy) / L));
            const qx = px - ddx * tt * L, qy = py - ddy * tt * L;
            const cov = hw * (1 - 0.55 * (sym ? Math.abs(2 * tt - 1) : tt)) - Math.sqrt(qx * qx + qy * qy) + 0.5;
            if (cov > 0) tr[ty * tw + tx] *= 1 - al * Math.min(1, cov);
          }
        };
        for (let gy = by0; gy < by1; gy += sp) for (let gx = bx0; gx < bx1; gx += sp) {
          const sx = gx + sr() * sp, sy = gy + sr() * sp;
          const r1 = sr(), r2 = sr(), r3 = sr(), r4 = sr();
          const b = bil(beardB, sx, sy) * (1 - bil(lipF, sx, sy)) * Math.min(1, bil(mask, sx, sy) * 1.5);
          if (b < 0.12) continue;
          // darker tone = denser stubble (0.35x on the light patch under the lower lip .. 1.6x along the jaw)
          const dk = smooth(0.5, 0.32, bil(toneS, sx, sy));
          if (r1 > SD * Math.min(1, b * 1.15) * (0.35 + 1.25 * dk)) continue;
          const u = (sx - midX) / halfW;
          // fan: steep under the nose, shallower on the cheeks, nearly straight down on the chin (blended, no steps)
          const fan = 1.6 + (0.7 - 1.6) * smooth(lipTop - 14, lipTop + 10, sy) + (0.35 - 0.7) * smooth(lipBot - 6, lipBot + 26, sy);
          let ang = u * fan;
          flowAt(sx, sy, fl);
          if (fl[2] > 0.2) {
            // flow orientation as an angle from straight down, in the half-turn nearest the fan's
            let fa = Math.atan2(fl[0], fl[1]);
            while (fa - ang > Math.PI / 2) fa -= Math.PI;
            while (fa - ang < -Math.PI / 2) fa += Math.PI;
            ang += (fa - ang) * SFLOW * Math.min(1, (fl[2] - 0.2) * 2.5) * (Math.abs(fa - ang) < 0.9 ? 1 : 0);
          }
          ang += (r4 - 0.5) * 0.9;
          const ddx = Math.sin(ang), ddy = Math.cos(ang);
          const L = SL * (0.55 + 0.9 * r2) * (0.65 + 0.35 * b) * K, hw = SW * (0.75 + 0.5 * r3) * K, al = SA * Math.min(1, b * 1.6);
          // root (thicker) -> tip, in texels
          stroke((sx - bx0) * K - ddx * L * 0.4, (sy - by0) * K - ddy * L * 0.4, ddx, ddy, L, hw, al, false);
        }
        // brows: the mask's edge is a clean outline, his brows are not (hairs cross it; the inner end of his left brow
        // stands upright). Hair strokes along the photo's own strand direction on the brow's FRINGE, and only where the
        // photo is darker than skin there, so no hair is invented on bare skin
        if (BR_H > 0) {
          const brS = browSoft;
          const bsp = 1.7;
          for (let gy = by0; gy < Math.min(by1, browY1 + 10); gy += bsp) for (let gx = bx0; gx < bx1; gx += bsp) {
            const sx = gx + sr() * bsp, sy = gy + sr() * bsp;
            const r1 = sr(), r2 = sr(), r3 = sr();
            const bs = bil(brS, sx, sy);
            if (bs < 0.05 || bs > 0.9) continue;
            const dk = smooth(tSkin * 0.94, tSkin * 0.64, bil(tone, sx, sy));
            if (r1 > BR_H * smooth(0.05, 0.3, bs) * dk) continue;
            flowAt(sx, sy, fl);
            const coh = Math.min(1, fl[2] * 2.5);
            let ddx = fl[0] * coh + (1 - coh), ddy = fl[1] * coh;
            const dl = Math.hypot(ddx, ddy) || 1;
            ddx /= dl; ddy /= dl;
            const L = (4.5 + 4 * r2) * K;
            stroke((sx - bx0) * K - ddx * L * 0.5, (sy - by0) * K - ddy * L * 0.5, ddx, ddy, L, 0.36 * (0.8 + 0.4 * r3) * K, 0.85 * dk, true);
          }
        }
        const px = new Uint8Array(tw * th);
        // (a 1-texel clear border, so clamped lookups outside the box read 0)
        for (let ty = 1; ty < th - 1; ty++) for (let tx = 1; tx < tw - 1; tx++) px[ty * tw + tx] = Math.round((1 - tr[ty * tw + tx]) * 255);
        stub = { w: tw, h: th, x0: bx0, y0: by0, k: K, px };
      }
    }
  })();
  mark('stubble');
  // ---------------------------------------------------------------- 3c. back-of-head shell (finishing pass)
  // The data is a front half-shell. For turned views a low-density shell continues the head behind the silhouette
  // plane. Each point stores its outward normal in the gap slot; the shader shows only the front-facing part and only
  // when the head is turned (it never draws over the face head-on).
  // (polish pass) The first shell was nested sagittal arcs plus latitude rings: turned, the rings showed as a ladder of
  // dashes down to the jaw and the arcs piled up on the limb as a bright outline (a hood). Now it is hair: long strands
  // that leave the silhouette straight back and are combed down toward the nape, on a surface that follows the head's
  // own outline and closes in under the occiput; they thin out toward the back and end raggedly at about the top of the ear
  // (fix pass: 25 px higher than before; run on to the lobe and curled there, they read as longer hair than his).
  // (integration pass) Plus the sweep strands (end of this section), which coat the steep sides and top of the front
  // relief for the turned views and run on over this surface.
  (() => { // (own function: see the note on V8's optimisation limit at the top of buildFaceGeometry)
    // (0.3: no brighter than the dim body of the hair it continues; at 0.5, tuned against the old brown hair, the strands
    // behind the ear outshone the side hair and read as a lock of long hair)
    const SH_G = dbg('gshell', 0.3);
    const yc = 0.5 * (LMk[234][1] + LMk[454][1]);
    const C0 = dbg('shelldepth', 190);
    const cx = meta.head.cx;
    // the shell's own random stream (main seed + a constant): tuning it moves nothing else
    const srng = stream(((SEED0 ^ 0x5368656c) >>> 0) || 7);
    // The surface: a chart (X, Y) on the unit disc about the ear-level centre (X to the image right, Y down). The disc's
    // rim is the head's own outline in the silhouette plane (z = 0): above ear level the mask's outermost edge along
    // each ray (smoothed, so the ears do not dent it), below it an ellipse that closes in to the nape (SH_NAPE px under
    // ear level). Depth is an ellipsoid's, z = -C0 sqrt(1 - rho^2).
    const SH_NAPE = dbg('shellnape', 185);
    const NA = 360, DEG = Math.PI / 180;
    let Rr = new Float32Array(NA);
    for (let k = 180; k <= 360; k++) {
      const c = Math.cos(k * DEG), s = Math.sin(k * DEG);
      let r = 0;
      for (let d = 30; d < 560; d++) {
        const x = cx + c * d, y = yc + s * d;
        if (x < 1 || y < 1 || x > W - 2 || y > H - 2) break;
        if (bil(mask, x, y) > 0.5) r = d;
      }
      Rr[k % NA] = Math.max(60, r);
    }
    for (let k = 1; k < 180; k++) {
      const c = Math.cos(k * DEG), s = Math.sin(k * DEG);
      const re = Rr[0] + (Rr[180] - Rr[0]) * 0.5 * (1 - c);
      Rr[k] = 1 / Math.hypot(c / re, s / SH_NAPE);
    }
    for (let pass = 0; pass < 2; pass++) {
      const o = new Float32Array(NA), r = Math.max(0, Math.round(dbg('shellrimsm', 7)));
      for (let k = 0; k < NA; k++) {
        let s = 0;
        for (let j = -r; j <= r; j++) s += Rr[(k + j + NA) % NA];
        o[k] = s / (2 * r + 1);
      }
      Rr = o;
    }
    const rimR = (ph: number) => {
      const f = ((ph / DEG) % NA + NA) % NA, k = Math.floor(f), t = f - k;
      return Rr[k] * (1 - t) + Rr[(k + 1) % NA] * t;
    };
    const sp = [0, 0, 0, 0, 0, 0];
    const surf = (X: number, Y: number) => {
      const rho2 = Math.min(1, X * X + Y * Y);
      const R = rimR(Math.atan2(Y, X));
      const z = -C0 * Math.sqrt(1 - rho2);
      // outward normal of (r / R)^2 + (z / C0)^2 = 1 (the outline's own slope is left out: it only steers the fade)
      const nx = X / R, ny = Y / R, nz = z / (C0 * C0);
      const l = Math.hypot(nx, ny, nz) || 1;
      sp[0] = cx + R * X; sp[1] = yc + R * Y; sp[2] = z; sp[3] = nx / l; sp[4] = ny / l; sp[5] = nz / l;
      return sp;
    };
    // Strands: chart lines from a rim point toward the nape on its own side (a pole low on the back, jittered per
    // strand), slightly bowed. Near the rim the surface falls away steeply, so a strand leaves the silhouette heading
    // back (the swept-back hair carried on) and turns down behind the ear toward the nape. Like the hair in front they
    // are few, thin and mostly dim, with the odd brighter sheen filament; each fades in from where it starts and ends at
    // its own length, so the coverage stays even where the lines converge and the nape hairline is ragged.
    const SEP = dbg('shellsep', 5.5) * TS, PSTEP = dbg('shellpstep', 4.5), SH_HALF = dbg('shellhalf', 0.34);
    const POLE_X = dbg('shellpolex', 0.25), POLE_Y = dbg('shellpole', 0.55), LOW = dbg('shelllow', 6) * DEG;
    const SH_BACK = dbg('shellback', 0.5), SH_CONV = dbg('shellconv', 0.45), SH_SHEEN = dbg('shellsheen', 0.14), SH_SHEENG = dbg('shellsheeng', 2.0);
    const yLow = EAR_Y1 + dbg('shellylow', -70);
    let acc = srng() * SEP;
    const dA = 0.25 * DEG;
    for (let ph = Math.PI - LOW; ph <= 2 * Math.PI + LOW; ph += dA) {
      acc += rimR(ph) * dA;
      if (acc < SEP) continue;
      acc -= SEP * (0.5 + srng());
      const sx = Math.cos(ph), sy = Math.sin(ph);
      const px = POLE_X * sx + (srng() - 0.5) * 0.5, py = POLE_Y + (srng() - 0.5) * 0.44;
      const t0 = srng() < 0.5 ? 0 : srng() * 0.5;
      const t1 = Math.min(0.97, t0 + 0.34 + 0.6 * srng());
      const bow = (srng() - 0.5) * 0.22;
      const gain = (0.35 + 0.75 * srng()) * (srng() < SH_SHEEN ? SH_SHEENG : 1);
      const seed = srng();
      // the hair's own tone just inside the silhouette where the strand leaves it
      const tn = bil(toneHS, Math.min(W - 2, Math.max(1, cx + rimR(ph) * 0.92 * sx)), Math.min(EAR_Y1 - 2, Math.max(headTop + 4, yc + rimR(ph) * 0.92 * sy)));
      const I0 = SH_G * 0.36 * gain * Math.min(1.5, Math.max(0.6, tn / 0.2));
      const dxl = px - sx, dyl = py - sy, ll = Math.hypot(dxl, dyl) || 1;
      begin(seed);
      let lx = 0, ly = 0, lz = 0, first = true;
      const NT = 360, i1 = Math.round(t1 * NT);
      for (let i = Math.round(t0 * NT); i <= i1; i++) {
        const t = i / NT;
        const b = bow * Math.sin(Math.PI * t);
        const q = surf(sx + dxl * t - (dyl / ll) * b, sy + dyl * t + (dxl / ll) * b);
        const x = q[0], y = q[1], z = q[2];
        if (y > yLow) break;
        if (!first && Math.hypot(x - lx, y - ly, z - lz) < PSTEP && i < i1) continue;
        const u = (t - t0) / (t1 - t0);
        const taper = smooth(0, 0.22, u + (t0 > 0 ? 0 : 0.06)) * (1 - smooth(0.6, 1, u)) * (1 - smooth(yLow - 40, yLow, y));
        const back = (1 - SH_BACK * smooth(0.15, 1, -z / C0)) * (1 - SH_CONV * t);
        gX = q[3] * 15; gY = q[4] * 15; gZ = q[5] * 15;
        pt(x, y, z, I0 * back * taper, SH_HALF * (0.6 + 0.4 * taper), K_SHELL + 0.4, 1, fy(Math.max(headTop, y)) * 0.86 + 0.02);
        first = false; lx = x; ly = y; lz = z;
      }
      end();
    }
    // ---- sweep strands (integration pass). Head-on most of his hair is seen edge-on: the sides of the head and the
    // top behind the quiff are steep walls of the relief, a few px wide in the photo and several times that in depth.
    // The hair strands above are spaced in the photo's plane, so on those walls they are far apart: turned to the yaw
    // limit the hair between temple and crown was an empty black gap with a few loose threads, and the head lost its
    // volume. The sweep strands fill the walls for the turned views only: lines of steepest descent of the (smoothed)
    // strand depth, i.e. hair combed straight back from where the surface turns away from the front down to the
    // silhouette plane, evenly spaced ACROSS the slope (which is not foreshortened) and stepped evenly in 3D. Each one
    // that reaches the silhouette runs on over the back shell toward the nape pole, so the side of the head and its
    // back are one coat. They are shell filaments (kind 8.4, outward normal in the gap slot): the shader shows them
    // only when the head is turned and only where they face the viewer, so the front view is untouched. Dim like the
    // hair's body, brighter where the photo has sheen. Own random stream.
    if (hairZS && dbg('sweep', 1) > 0.5) {
      const wrng = stream(((SEED0 ^ 0x73776570) >>> 0) || 7);
      // (the gain carries the tier's spacing scale: fewer strands on the smaller tiers, the same mean tone)
      const SW_G = dbg('swg', 0.3) * TS, SW_BODY = dbg('swbody', 0.16), SW_SEP = dbg('swsep', 5) * TS, SW_STEP = dbg('swstep', 6) * Math.sqrt(TS);
      const G_ON = dbg('swsteep', 1.0), G_OFF = 0.5 * G_ON, SW_TAIL = dbg('swtail', 0.5), SW_DOWN = dbg('swdown', 0.1);
      const zS = hairZS, yMax = hairZY;
      const hairW: Field = (x, y) => bil(hairS, x, y);
      const gd = [0, 0];
      const grad = (x: number, y: number) => { gd[0] = (bil(zS, x + 1.5, y) - bil(zS, x - 1.5, y)) / 3; gd[1] = (bil(zS, x, y + 1.5) - bil(zS, x, y - 1.5)) / 3; return Math.hypot(gd[0], gd[1]); };
      const occ2 = new Uint8Array(N);
      const stamp2 = (x: number, y: number, rad: number) => {
        const r = Math.ceil(rad), x0 = Math.round(x), y0 = Math.round(y), r2 = rad * rad;
        for (let j = -r; j <= r; j++) {
          const yy = y0 + j;
          if (yy < 0 || yy >= H) continue;
          for (let i = -r; i <= r; i++) { const xx = x0 + i; if (i * i + j * j <= r2 && xx >= 0 && xx < W) occ2[yy * W + xx] = 1; }
        }
      };
      let bx0 = W, bx1 = 0, by0 = H, by1 = 0;
      for (let y = 0; y < yMax; y += 2) for (let x = 0; x < W; x += 2) if (hairR[y * W + x] > 0.5) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      const gs = Math.max(1.5, 0.6 * SW_SEP);
      const seeds: number[] = [];
      for (let y = by0; y <= by1; y += gs) for (let x = bx0; x <= bx1; x += gs) {
        const sx = x + wrng() * gs, sy = y + wrng() * gs;
        if (sy < yMax && hairW(sx, sy) > 0.5 && grad(sx, sy) > G_ON) seeds.push(sx, sy);
      }
      const ns = seeds.length >> 1;
      const ord = new Uint32Array(ns);
      for (let i = 0; i < ns; i++) ord[i] = i;
      for (let i = ns - 1; i > 0; i--) { const j = Math.floor(wrng() * (i + 1)); const t = ord[i]; ord[i] = ord[j]; ord[j] = t; }
      // one side of a strand from its seed: sg = +1 uphill (toward the front, until the surface faces the viewer or the
      // hair ends), -1 downhill (back, to the silhouette). Returns 1 when the downhill end left the head (the rim).
      const walk = (sx: number, sy: number, sg: number, out: number[]) => {
        let x = sx, y = sy, dx = 0, dy = 0, flat = 0;
        for (let it = 0; it < 400; it++) {
          const g = grad(x, y);
          if (g < 1e-4) return sg < 0 ? 1 : 0;
          // (downhill a little of "down the image" is mixed in: swept back and slightly down, as hair lies)
          let tx = (sg * gd[0]) / g, ty = (sg * gd[1]) / g + (sg < 0 ? SW_DOWN : -SW_DOWN) * (y > yc ? 0 : 1);
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl; ty /= tl;
          if (it > 0) { if (tx * dx + ty * dy < 0.3) return 0; tx = 0.6 * tx + 0.4 * dx; ty = 0.6 * ty + 0.4 * dy; const l2 = Math.hypot(tx, ty) || 1; tx /= l2; ty /= l2; }
          const st = SW_STEP / Math.sqrt(1 + g * g);
          const nx = x + tx * st, ny = y + ty * st;
          if (nx < 2 || ny < 2 || nx > W - 3 || ny > yMax) return 0;
          if (sg < 0 && bil(mask, nx, ny) < 0.5) return 1;
          if (occ2[Math.round(ny) * W + Math.round(nx)]) return 0;
          if (sg > 0) {
            if (hairW(nx, ny) < 0.3) return 0;
            if (g < G_OFF && ++flat * st > 14) return 0; // (it runs a little way onto the part that faces the front, fading)
          } else if (hairW(nx, ny) < 0.12 && bil(mask, nx, ny) > 0.8) return 0; // (downhill into the ear / the face: not hair)
          x = nx; y = ny; dx = tx; dy = ty;
          out.push(x, y);
        }
        return 0;
      };
      const up: number[] = [], dn: number[] = [], P: number[] = [], Z: number[] = [], ZP: number[] = [];
      for (let q = 0; q < ns; q++) {
        const sx = seeds[ord[q] * 2], sy = seeds[ord[q] * 2 + 1];
        if (occ2[Math.round(sy) * W + Math.round(sx)]) continue;
        up.length = 0; dn.length = 0;
        walk(sx, sy, 1, up);
        const rimHit = walk(sx, sy, -1, dn);
        // front (uphill end) -> seed -> back
        P.length = 0;
        for (let k = up.length - 2; k >= 0; k -= 2) P.push(up[k], up[k + 1]);
        P.push(sx, sy);
        for (let k = 0; k < dn.length; k++) P.push(dn[k]);
        const n = P.length >> 1;
        if (n < 5) continue;
        for (let k = 0; k < n; k++) stamp2(P[k * 2], P[k * 2 + 1], 0.5 * SW_SEP);
        // depth: the smoothed strand depth, eased to the silhouette plane (z = 0) at a rim end, smoothed along the strand
        Z.length = n;
        for (let k = 0; k < n; k++) Z[k] = bil(zS, P[k * 2], P[k * 2 + 1]);
        if (rimHit) Z[n - 1] = 0;
        ZP.length = n;
        for (let pass = 0; pass < 2; pass++) {
          for (let k = 0; k < n; k++) ZP[k] = Z[k];
          for (let k = 1; k < n - 1; k++) Z[k] = 0.25 * ZP[k - 1] + 0.5 * ZP[k] + 0.25 * ZP[k + 1];
        }
        const gain = (0.35 + 1.0 * Math.pow(wrng(), 1.5)) * (wrng() < SH_SHEEN ? SH_SHEENG : 1);
        // (ragged: a strand comes in over a random stretch of its front part, so the coat has no drawn front edge)
        const k0 = wrng() * 0.45 * (n - 1), kf = 4 + 0.25 * n * wrng();
        const tail = rimHit ? SW_TAIL * (0.35 + 0.65 * wrng()) : 0, bow = (wrng() - 0.5) * 0.2;
        begin(wrng());
        for (let k = 0; k < n; k++) {
          const x = P[k * 2], y = P[k * 2 + 1];
          const g = grad(x, y);
          const nl = Math.sqrt(1 + g * g);
          gX = (-gd[0] / nl) * 15; gY = (-gd[1] / nl) * 15; gZ = (1 / nl) * 15;
          const tp = smooth(0, 1, (k - k0 + 0.5) / kf) * (rimHit ? 1 : smooth(0, 1, (n - 0.5 - k) / 5));
          if (tp <= 0) continue;
          const I = SW_G * (SW_BODY + (1 - SW_BODY) * Math.pow(hairSheen(x, y), 1.5)) * gain * tp * smooth(0.05, 0.35, hairW(x, y));
          pt(x, y, Z[k] + 2, I, SH_HALF * (0.6 + 0.4 * tp), K_SHELL + 0.4, 1, fy(Math.max(headTop, y)) * 0.86 + 0.02);
        }
        if (rimHit && tail > 0.02) {
          // on over the back shell from the rim point nearest the strand's end, toward the pole on its own side
          const ex = P[n * 2 - 2], ey = P[n * 2 - 1];
          const ph = Math.atan2(ey - yc, ex - cx), cs = Math.cos(ph), sn = Math.sin(ph);
          const px = POLE_X * cs, py = POLE_Y, dxl = px - cs, dyl = py - sn, ll = Math.hypot(dxl, dyl) || 1;
          const tn = bil(toneHS, Math.min(W - 2, Math.max(1, cx + rimR(ph) * 0.92 * cs)), Math.min(EAR_Y1 - 2, Math.max(headTop + 4, yc + rimR(ph) * 0.92 * sn)));
          const I0 = SW_G * SW_BODY * gain * Math.min(1.5, Math.max(0.6, tn / 0.2));
          const NT = 240, i1 = Math.round(tail * NT);
          let lx = ex, ly = ey, lz = 0;
          for (let i = 1; i <= i1; i++) {
            const t = i / NT, b = bow * Math.sin(Math.PI * Math.min(1, t / tail));
            const sq = surf(cs + dxl * t - (dyl / ll) * b, sn + dyl * t + (dxl / ll) * b);
            // (the chart's rim is the smoothed outline: the first steps ease from the strand's own end onto it)
            const e = 1 - smooth(0, 0.08, t);
            const x = sq[0] + (ex - (cx + rimR(ph) * cs)) * e, y = sq[1] + (ey - (yc + rimR(ph) * sn)) * e, z = sq[2];
            if (y > yLow) break;
            if (Math.hypot(x - lx, y - ly, z - lz) < PSTEP && i < i1) continue;
            const tp = (1 - smooth(0.5, 1, t / tail)) * (1 - smooth(yLow - 40, yLow, y));
            gX = sq[3] * 15; gY = sq[4] * 15; gZ = sq[5] * 15;
            pt(x, y, z, I0 * (1 - SH_BACK * smooth(0.15, 1, -z / C0)) * tp, SH_HALF * (0.6 + 0.4 * tp), K_SHELL + 0.4, 1, fy(Math.max(headTop, y)) * 0.86 + 0.02);
            lx = x; ly = y; lz = z;
          }
        }
        end();
      }
    }
    gX = gY = gZ = 0;
  })();
  const nStr = nP - nScan - nMer - nDiag;
  mark('strands');

  // ---------------------------------------------------------------- 4. feature filaments (identity pass, unchanged)
  function chains(pairs: [number, number][]) {
    const adj = new Map<number, number[]>();
    const nb = (v: number): number[] => {
      let l = adj.get(v);
      if (!l) { l = []; adj.set(v, l); }
      return l;
    };
    for (const [a, b] of pairs) {
      nb(a).push(b);
      nb(b).push(a);
    }
    const seen = new Set<number>();
    const out: { idx: number[]; closed: boolean }[] = [];
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      let s0 = start;
      const comp: number[] = [];
      const stack = [start];
      const cs = new Set([start]);
      while (stack.length) { const v = stack.pop() as number; comp.push(v); for (const w of nb(v)) if (!cs.has(w)) { cs.add(w); stack.push(w); } }
      for (const v of comp) if (nb(v).length === 1) { s0 = v; break; }
      const chain = [s0];
      seen.add(s0);
      let prev = -1, cur = s0;
      for (;;) {
        const nx = nb(cur).find((w) => w !== prev && !seen.has(w));
        if (nx === undefined) break;
        chain.push(nx); seen.add(nx); prev = cur; cur = nx;
      }
      const closed = nb(s0).length === 2 && nb(cur).includes(s0) && chain.length > 2;
      out.push({ idx: chain, closed });
    }
    return out;
  }
  function catmull(ptsXY: number[][], closed: boolean, sub: number): number[][] {
    const n = ptsXY.length;
    const out: number[][] = [];
    const get = (i: number) => (closed ? ptsXY[(i + n) % n] : ptsXY[Math.max(0, Math.min(n - 1, i))]);
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      for (let k = 0; k < sub; k++) {
        const t = k / sub, t2 = t * t, t3 = t2 * t;
        const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    if (closed) out.push(out[0]); else out.push(ptsXY[n - 1]);
    return out;
  }
  function featureLine(xy: number[][], Ifn: (x: number, y: number, i: number) => number, half: number, lift: number, kindFn?: Field) {
    begin(rng());
    for (let i = 0; i < xy.length; i++) {
      const [x, y] = xy[i];
      const I = Ifn(x, y, i);
      if (I < 0) { end(); begin(rng()); continue; }
      pt(x, y, bil(depth, x, y) + lift, I, half, kindFn ? kindFn(x, y) : K_FEAT, bil(mask, x, y), fy(y) * 0.86 + 0.08);
    }
    end();
  }
  const topo = meta.topology;
  // (finishing pass) hooded eyes: the upper lash line is a DARK band (no filament; the scan is darkened there by
  // lashK), with a dim lid-fold filament a little above it; the lower lid is a faint line between the canthi; the iris
  // is a dim limbal ring hidden under the upper lid (no round, staring outlined eye)
  // (polish pass) the fold filament moves up onto the strip of lid the photo shows lit between the lash line and the
  // crease (7 px above the lid line; at 3 px it drew a bright line through his dark lashes). The limbal ring is redrawn
  // on its own sub-stream: clipped where the photo's lid really ends, fading under it instead of stopping dead in two
  // brackets.
  const LID_FOLD = dbg('lidfold', 0.1), FOLD_OFF = dbg('foldoff', 7.0), LASH_LO = dbg('lashlo', 0.1), IRIS_G = dbg('iris', 0.13);
  for (const e of EYES) {
    const w = e.x1 - e.x0;
    const up: number[][] = [], lo: number[][] = [];
    for (let k = 0; k <= 48; k++) {
      const x = e.x0 + (k / 48) * w;
      up.push([x, upLid(e, x) - FOLD_OFF * Math.sin(Math.PI * k / 48) ** 0.5]);
      lo.push([x, loLid(e, x)]);
    }
    const outerLeft = LMk[e.outer][0] < LMk[e.inner][0];
    featureLine(up, (x) => {
      const u = (x - e.x0) / w, uo = outerLeft ? u : 1 - u; // 0 at the outer canthus
      return LID_FOLD * smooth(0.06, 0.3, uo) * smooth(0.0, 0.2, 1 - uo);
    }, 0.4, 1.5, () => K_FEAT + 0.3);
    featureLine(lo, (x) => {
      const u = (x - e.x0) / w;
      return LASH_LO * smooth(0.04, 0.22, u) * smooth(0.04, 0.22, 1 - u);
    }, 0.36, 1.5, () => K_FEAT + 0.3);
  }
  for (const [c, ring] of [[468, [469, 470, 471, 472]], [473, [474, 475, 476, 477]]] as [number, number[]][]) {
    const cx = LM[c][0], cy = LM[c][1];
    const e = EYES.find((q) => cx > q.x0 && cx < q.x1) || EYES[0];
    let r = 0;
    for (const i of ring) r += Math.hypot(LM[i][0] - cx, LM[i][1] - cy);
    r /= 4;
    const sr = subRng(0x1215 + c);
    begin(sr());
    const NS = 72;
    for (let k = 0; k <= NS; k++) {
      const a = (k / NS) * Math.PI * 2;
      const x = cx + Math.cos(a) * r * 0.98, y = cy + Math.sin(a) * r * 0.98;
      // (fix pass) only below the lid line: drawn up to 2.6 px above it, its upper arc showed inside the dark lash band
      // and closed the ring into a lit circle (a rounder, outlined iris; the photo's lid covers the top of his)
      const vis = smooth(upLid(e, x) + dbg('irislid0', 0.2), upLid(e, x) + dbg('irislid1', 2.0), y) * smooth(loLid(e, x) + 1.4, loLid(e, x) - 0.6, y);
      if (vis < 0.02) { end(); begin(sr()); continue; }
      pt(x, y, bil(depth, x, y) + 2.5, IRIS_G * vis, 0.3, K_FEAT, 1, fy(y) * 0.86 + 0.09);
    }
    end();
  }
  for (const [bx, by] of meta.catchlights) {
    begin(rng());
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      pt(bx + Math.cos(a) * 1.4, by + Math.sin(a) * 1.1, bil(depth, bx, by) + 3, 0.55, 0.5, K_FEAT, 1, fy(by) * 0.86 + 0.09);
    }
    end();
  }
  // (polish pass) the photo's upper-lip border is soft against the moustache and its seam is the darkest line of the
  // mouth: the bright outline above (0.3) and the bright filament ON the seam (0.26) drew a hard-edged, lit, faintly
  // smiling mouth, most of all at small sizes. Both stay as a hint of a contour only.
  const LIP_UP = dbg('lipup', 0.11), LIP_LO = dbg('liplo', 0.08), LIP_SEAM = dbg('lipseam', 0.06);
  for (const chn of chains(topo.lips)) {
    const xy = catmull(chn.idx.map((i) => [LM[i][0], LM[i][1]]), chn.closed, 4);
    let area = 0;
    for (let i = 0; i < chn.idx.length; i++) {
      const a = LM[chn.idx[i]], b = LM[chn.idx[(i + 1) % chn.idx.length]];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const inner = Math.abs(area) < 3000;
    const yl = LM[61][1], yr = LM[291][1], xl = LM[61][0], xr = LM[291][0];
    featureLine(xy, (x, y) => {
      const e = Math.min(x - xl, xr - x) / Math.max(1, xr - xl);
      if (inner) return e < 0.03 ? -1 : LIP_SEAM * smooth(0.03, 0.2, e);
      const yc = yl + ((x - xl) / Math.max(1, xr - xl)) * (yr - yl);
      if (y < yc - 1) return LIP_UP * (0.35 + 0.65 * smooth(0.0, 0.2, e));
      if (e < 0.04) return -1;
      return LIP_LO * smooth(0.04, 0.24, e);
    }, inner ? 0.34 : 0.32, 1.2);
  }
  {
    const eyeSpans = [[33, 133], [362, 263]].map(([a, b], k) => ({ x0: Math.min(LM[a][0], LM[b][0]), x1: Math.max(LM[a][0], LM[b][0]), y: 0.5 * (LM[a][1] + LM[b][1]), outerLeft: k === 0 }));
    const lipSoft = boxBlur(lipF, 6);
    const eyeClip = (x: number, y: number) => {
      for (const e of eyeSpans) {
        if (y < e.y - 34 || y > e.y + 10) continue;
        const outerL = e.outerLeft, up = y < e.y - 4;
        const lo = e.x0 + (up ? 3 : -2) + (up && outerL ? 7 : 0), hi = e.x1 - (up ? 3 : -2) - (up && !outerL ? 7 : 0);
        if (x > e.x0 - 45 && x < e.x1 + 45 && (x < lo || x > hi)) return true;
      }
      return false;
    };
    const acc = (x: number, y: number) => bil(edges, x, y) > 0.28 && bil(mask, x, y) > 0.5 && bil(hairR, x, y) < 0.35 && bil(eyeF, x, y) < 0.2 && bil(browSoft, x, y) < 0.06 && bil(dHair, x, y) > 5 && bil(lipSoft, x, y) < 0.04 && !eyeClip(x, y);
    const EDGE_NOS = dbg('edgenos', 0.9), EDGE_ORB = dbg('edgeorb', 0.5);
    let made = 0, tries = 0;
    while (made < T.edge && tries < T.edge * 40) {
      tries++;
      const x = meta.head.left + rng() * (meta.head.right - meta.head.left);
      const y = headTop + rng() * (headBot - headTop);
      const e = bil(edges, x, y);
      if (e < 0.42 || bil(hairR, x, y) > 0.3 || bil(beardB, x, y) > 0.55 || bil(mask, x, y) < 0.6 || bil(eyeF, x, y) > 0.2 || !acc(x, y)) continue;
      // (polish pass) edge strokes are lit lines: dimmed where the photo's edge is a SHADOW (the nostril openings, which
      // they outlined as two bright loops, and the lid crease / socket) and unlit down the sideburns (hair, not skin)
      const n = trace(x, y, 10, 1.3, acc, K_EDGE, (xx, yy) => (0.06 + 0.3 * bil(edges, xx, yy) * (0.4 + 0.6 * bil(tone, xx, yy))) * (1 - EDGE_NOS * nosK(xx, yy)) * (1 - EDGE_ORB * orbK(xx, yy)) * (1 - smooth(0.05, 0.2, sideburn(xx, yy))), 0.3, 1.4, 0.05);
      if (n) made++;
    }
  }
  const nFeat = nP - nScan - nMer - nDiag - nStr;
  mark('features');

  // ---------------------------------------------------------------- pack the filaments (32 bytes per point)
  // One record of 8 uint32 words per point, uploaded as 2 RGBA32UI texels (vertex pulling, point = gl_VertexID >> 1):
  //   w0 x | y (int16 snorm of world / 1.25)      w1 z (int16) | intro key (uint16)
  //   w2 tangent xyz (int8 snorm) | kind * 20     w3 horizons +x, -x, up, down (int8 snorm of angle / 1.6)
  //   w4 gap-to-next-slice xyz (int8 snorm of world / 0.04) | mask * 127 (+128 ear)
  //   w5 intensity / 4 | half width crop px / 16 (uint16 unorm)   w6 arc mod 4096 / 4096 | seed   w7 LOD rank | turn fade << 8
  const TEXW = 2048;
  const texH = Math.max(1, Math.ceil((nP * 2) / TEXW));
  const rec = new Uint32Array(TEXW * texH * 4);
  let nSeg = 0;
  for (let i = 1; i < nP; i++) if (!brk[i]) nSeg++;
  const index = new Uint32Array(nSeg * 6);
  {
    const s16 = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 32767) & 0xffff;
    const s8 = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 127) & 0xff;
    const u16 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 65535);
    const w0 = [0, 0, 0], w1 = [0, 0, 0], w2 = [0, 0, 0], wg = [0, 0, 0];
    let ii = 0;
    for (let i = 0; i < nP; i++) {
      const x = Pp[i * 3], y = Pp[i * 3 + 1], z = Pp[i * 3 + 2];
      toWorld(x, y, z, w1);
      const hasPrev = !brk[i], hasNext = i + 1 < nP && !brk[i + 1];
      if (hasPrev) toWorld(Pp[i * 3 - 3], Pp[i * 3 - 2], Pp[i * 3 - 1], w0); else { w0[0] = w1[0]; w0[1] = w1[1]; w0[2] = w1[2]; }
      if (hasNext) toWorld(Pp[i * 3 + 3], Pp[i * 3 + 4], Pp[i * 3 + 5], w2); else { w2[0] = w1[0]; w2[1] = w1[1]; w2[2] = w1[2]; }
      let tx = w2[0] - w0[0], ty = w2[1] - w0[1], tz = w2[2] - w0[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      let gx = 0, gy = 0, gz = 0;
      if (G3[i * 3] !== 0 || G3[i * 3 + 1] !== 0 || G3[i * 3 + 2] !== 0) {
        toWorld(x + G3[i * 3], y + G3[i * 3 + 1], z + G3[i * 3 + 2], wg);
        gx = (wg[0] - w1[0]) / 0.04; gy = (wg[1] - w1[1]) / 0.04; gz = (wg[2] - w1[2]) / 0.04;
      }
      const kind = Math.round(Bk[i * 3] * 20) & 0xff;
      const mEar = (Math.round(Math.max(0, Math.min(1, Bk[i * 3 + 1])) * 127) + (E8[i] ? 128 : 0)) & 0xff;
      const o = i * 8;
      rec[o] = (s16(w1[0] / 1.25) | (s16(w1[1] / 1.25) << 16)) >>> 0;
      rec[o + 1] = (s16(w1[2] / 1.25) | (u16(Bk[i * 3 + 2]) << 16)) >>> 0;
      rec[o + 2] = (s8(tx) | (s8(ty) << 8) | (s8(tz) << 16) | (kind << 24)) >>> 0;
      // (fix pass: not for the back shell and the sweep strands, kind 8.x: the shader decides their visibility from the
      // normal in the gap slot and never reads this word; they were a fifth to a third of the horizon marches)
      rec[o + 3] = kind >= 150 ? 0 : (s8(horizon(x, y, z, 1, 0) / 1.6) | (s8(horizon(x, y, z, -1, 0) / 1.6) << 8) | (s8(horizon(x, y, z, 0, -1) / 1.6) << 16) | (s8(horizon(x, y, z, 0, 1) / 1.6) << 24)) >>> 0;
      rec[o + 4] = (s8(gx) | (s8(gy) << 8) | (s8(gz) << 16) | (mEar << 24)) >>> 0;
      rec[o + 5] = (u16(A[i * 4] / 4) | (u16(A[i * 4 + 1] / 16) << 16)) >>> 0;
      rec[o + 6] = (u16((A[i * 4 + 2] % 4096) / 4096) | (u16(A[i * 4 + 3]) << 16)) >>> 0;
      rec[o + 7] = (R8[i] | (T8[i] << 8)) >>> 0;
      if (hasPrev) {
        const a = (i - 1) * 2, b = i * 2;
        index[ii++] = a; index[ii++] = a + 1; index[ii++] = b;
        index[ii++] = a + 1; index[ii++] = b + 1; index[ii++] = b;
      }
    }
  }

  mark('pack');
  // ---------------------------------------------------------------- particles: dust, neck dissolve, network nodes
  const nDust = T.dust, nNeck = T.neck, nGlint = T.glint;
  const NPt = nDust + nNeck + nGlint;
  const ppos = new Float32Array(NPt * 3);
  const pinfo = new Float32Array(NPt * 4); // kind, seed, seed2, brightness
  const phor = new Float32Array(NPt * 4);
  let neckX = 0;
  {
    let k = 0;
    const w = [0, 0, 0];
    for (let i = 0; i < nDust; i++, k++) {
      const u = rng() * 2 - 1;
      const a = rng() * Math.PI * 2;
      const r = 0.55 + 0.43 * Math.cbrt(rng());
      const s = Math.sqrt(1 - u * u);
      ppos.set([r * s * Math.cos(a), r * u, r * s * Math.sin(a) * 0.8], k * 3);
      pinfo.set([0, rng(), rng(), 0.6 + 0.4 * rng()], k * 4);
      phor.set([-2, -2, -2, -2], k * 4);
    }
    // neck dust along the visible neck's dissolve line: dimmer than the filaments, and only a share of it shown (the
    // rest is parked as kind 9, never drawn), so the neck does not end in a dense glitter cluster. The stream is
    // then rewound and advanced exactly as the reference neck's loop draws it (emit = false), so the network nodes and
    // glints after it stay put whatever the visible neck looks like.
    const DUST_W = dbg('neckdustw', 2), DUST_KEEP = dbg('neckdustkeep', 0.65), DUST_I = dbg('neckdusti', 0.7);
    type DustShape = Pick<NeckFns, 'y1' | 'w' | 'v'>;
    // the band the dust is drawn from: centre offset below shape.y1 and its half width (crop px), and its depth
    let bandC = 30, bandW = 30;
    let dustZ = (x: number, y: number) => bil(depth, x, y) + 2;
    const neckDust = (shape: DustShape, emit: boolean, wPow: number) => {
      let made = 0, tries = 0;
      while (made < nNeck && tries < nNeck * 200) {
        tries++;
        const x = meta.head.left + rng() * (meta.head.right - meta.head.left);
        const y1 = shape.y1(x);
        const y = y1 - 10 + rng() * 90;
        const m = bil(mask, x, y);
        // (the visible neck's dust stays under the jaw line, where its fields are 1, and, like its filaments, ignores
        // the mask's own fade)
        const wgt = emit && y <= polyY(JAW, x) + 4 ? 0 : Math.pow(shape.w(x, y), wPow) * (emit ? 1 : Math.min(1, m * 2.5)) * Math.pow(1 - shape.v(y, x), 0.6) * Math.exp(-Math.pow((y - y1 - bandC) / bandW, 2));
        if (rng() > wgt) continue;
        made++;
        if (!emit) { rng(); rng(); continue; }
        const z = dustZ(x, y);
        toWorld(x, y, z, w);
        ppos.set(w, k * 3);
        pinfo.set([rng() < DUST_KEEP ? 1 : 9, rng(), rng(), DUST_I * (0.4 + 0.6 * bil(tone, x, y))], k * 4);
        phor.set([horizon(x, y, z, 1, 0), horizon(x, y, z, -1, 0), horizon(x, y, z, 0, -1), horizon(x, y, z, 0, 1)], k * 4);
        k++;
      }
    };
    const rs0 = rs;
    if (NECK_ON) neckDust(NECK, true, DUST_W); // > 1 keeps the dust inside the neck's outline (not a wider skirt)
    else {
      // no neck: embers shed from the jaw's underside, along the jaw line between the jaw corners, at the jaw's own
      // depth (not the neck surface far behind it), so they hang under the chin in turned views too. Most of it sits
      // under the chin, where the jaw is lowest (on the steep jaw sides it read as dandruff), but its very centre is
      // thinned (CUT_DUST_MID) so it does not read as crumbs falling out of the beard.
      const jx0 = LMk[172][0], jx1 = LMk[397][0], jcx = LMk[152][0], jhw = 0.5 * (jx1 - jx0) * dbg('cutdustx', 0.8);
      const jfl = dbg('cutdustside', 0.3), jmid = dbg('cutdustmid', 0.5), jmidw = dbg('cutdustmidw', 30), jzb = dbg('cutdustz', 12);
      const cutDust: DustShape = {
        y1: (x) => polyY(JAW, x) + CUT_HOLD,
        w: (x) => smooth(jx0 - 4, jx0 + 22, x) * smooth(jx1 + 4, jx1 - 22, x) * (jfl + (1 - jfl) * Math.exp(-Math.pow((x - jcx) / jhw, 2))) * (1 - jmid * Math.exp(-Math.pow((x - jcx) / jmidw, 2))),
        v: (y, x) => { const d = y - polyY(JAW, x) - CUT_HOLD; return d < 0 ? 1 : Math.exp(-Math.pow(d / CUT_SIG, 2)); },
      };
      bandC = dbg('cutdustc', 5); bandW = dbg('cutdustw', 18);
      dustZ = (x, y) => Math.max(bil(depth, x, y), jawZAt(x) - jzb) + 2;
      neckDust(cutDust, true, 1);
      bandC = 30; bandW = 30;
      dustZ = (x, y) => bil(depth, x, y) + 2;
    }
    rs = rs0;
    neckDust(neckRef, false, 1);
    // the neck's axis in world x: the shader draws the falling dust in toward it (no neck: the chin)
    const axX = NECK_ON ? NECK.cx : LMk[152][0], axY = NECK_ON ? NECK.y1(NECK.cx) : chinY;
    neckX = toWorld(axX, axY, bil(depth, axX, axY) + 2, w)[0];
    // network nodes at REAL crossings of slices, meridians and diagonals on the open planes (never on the eyes):
    // a steady faint node, ~4 % hubs a little brighter, and rare short flashes
    const nn = nodes.length >> 2;
    const ord = new Uint32Array(nn);
    for (let i = 0; i < nn; i++) ord[i] = i;
    for (let i = nn - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = ord[i]; ord[i] = ord[j]; ord[j] = t; }
    for (let q = 0; q < Math.min(nn, nGlint); q++, k++) {
      const c = ord[q] * 4;
      const x = nodes[c], y = nodes[c + 1], z = nodes[c + 2] + 1.2;
      toWorld(x, y, z, w);
      ppos.set(w, k * 3);
      const hub = rng() < 0.04 ? 1 : 0;
      pinfo.set([2 + 0.5 * hub, rng(), rng(), (0.3 + 0.7 * bil(tone, x, y)) * Math.min(1, nodes[c + 3] * 1.4)], k * 4);
      phor.set([horizon(x, y, z, 1, 0), horizon(x, y, z, -1, 0), horizon(x, y, z, 0, -1), horizon(x, y, z, 0, 1)], k * 4);
    }
    for (; k < NPt; k++) pinfo.set([9, 0, 0, 0], k * 4);
  }

  mark('particles');
  // ---------------------------------------------------------------- biometric frame corners (world)
  const frame: { p: number[]; sx: number; sy: number }[] = [];
  {
    const y0 = LM[10][1] - 40, y1 = LM[152][1] + 18, x0 = LM[234][0] - 16, x1 = LM[454][0] + 16;
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      const p = toWorld(x, y, 120, [0, 0, 0]);
      frame.push({ p, sx, sy });
    }
  }

  const tEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const fil = { count: nP, rec, texW: TEXW, texH, index };
  const pts = { count: NPt, pos: ppos, info: pinfo, hor: phor };
  return {
    fil,
    stub,
    pts,
    frame,
    info: {
      scanStep, scanWorld: scanStep * S, merWorld: merStep * S, cropWorld: S, tilt: KT, devPerCrop, neckX,
      counts: { scan: nScan, mer: nMer, diag: nDiag, strand: nStr, feat: nFeat, points: nP, nodes: nodes.length >> 2, particles: NPt },
      bytes: { records: nP * 32, texture: rec.byteLength, index: index.byteLength, perPoint: +((rec.byteLength + index.byteLength + nP * 2) / Math.max(1, nP)).toFixed(1) },
      ms: { ...prof, total: Math.round(tEnd - tStart) },
    },
    transfer: [rec.buffer, index.buffer, ppos.buffer, pinfo.buffer, phor.buffer, ...(stub ? [stub.px.buffer as ArrayBuffer] : [])],
  };
}
