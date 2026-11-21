/**
 * The face hologram's geometry builder (ported from the "contour scan" prototype, face-lab proto-a/builder.js).
 *
 *   buildFaceGeometry(input) -> { fil, pts, frame, info, transfer }
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
 * The algorithm is unchanged from the prototype (the port is checked point for point against it); the only
 * additions are typed input/output, channel views (so maps can be packed in any image layout) and precomputed
 * catchlight positions (meta.catchlights), which let the site skip downloading the luminance map.
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
}

export function buildFaceGeometry(input: BuildInput): BuildOutput {
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

  // ---------------------------------------------------------------- data access (replaces the harness data helpers)
  const chCache: Record<string, Float32Array> = {};
  function ch(name: MapName, c = 0): Float32Array {
    const key = name + c;
    if (!chCache[key]) {
      const m = input.maps[name];
      if (!m) throw new Error(`hologram builder: map "${name}" missing`);
      const px = m.px, st = m.stride, o = m.channels[c];
      const f = new Float32Array(N);
      for (let i = 0; i < N; i++) f[i] = px[st * i + o] / 255;
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
  // separable box blur, 3 passes (~gaussian, sigma ~ 1.1 r), clamped borders. Branch-free sliding sums over a padded
  // line buffer (this runs ~14 times over the full grid, so it matters for the build time)
  const padBuf = new Float32Array(Math.max(W, H) + 2 * 64 + 2);
  function blurLine(arr: Float32Array, off: number, stride: number, len: number, r: number, out: Float32Array) {
    const n = 2 * r + 1;
    for (let k = 0; k < r + 1; k++) padBuf[k] = arr[off];
    for (let k = 0; k < len; k++) padBuf[r + 1 + k] = arr[off + k * stride];
    const last = arr[off + (len - 1) * stride];
    for (let k = 0; k < r + 1; k++) padBuf[r + 1 + len + k] = last;
    let acc = 0;
    for (let k = 1; k <= 2 * r + 1; k++) acc += padBuf[k];
    // padBuf[j] holds x = j - r - 1; window for x is [x - r, x + r] = padBuf[x + 1 .. x + 2r + 1]
    for (let x = 0; x < len; x++) {
      out[off + x * stride] = acc / n;
      acc += padBuf[x + 2 * r + 2] - padBuf[x + 1];
    }
  }
  function boxBlur(src: ArrayLike<number>, r: number): Float32Array<ArrayBuffer> {
    r = Math.min(64, Math.max(1, Math.round(r)));
    const a = Float32Array.from(src), b = new Float32Array(N);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < H; y++) blurLine(a, y * W, 1, W, r, b);
      for (let x = 0; x < W; x++) blurLine(b, x, W, H, r, a);
    }
    return a;
  }
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
  const LASH_DARK = dbg('lashdark', 0.85), LASH_SIG = dbg('lashsig', 2.0);
  const lashK = (x: number, y: number) => {
    for (const e of EYES) {
      if (x < e.x0 - 3 || x > e.x1 + 3) continue;
      const span = smooth(e.x0 - 3, e.x0 + 6, x) * smooth(e.x1 + 3, e.x1 - 6, x);
      const d = y - upLid(e, x);
      return LASH_DARK * span * Math.exp(-Math.pow((d - 0.6) / LASH_SIG, 2));
    }
    return 0;
  };
  // under-eye: the photo's infra-orbital shadow is lifted toward the cheek tone (the bags aged him)
  {
    const t = ch('tone');
    const LIFT = dbg('ueyelift', 0.6);
    for (const e of EYES) {
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
  // The neck: a short, slim column under the jaw that dissolves before any shoulders. Its shape is a small set of
  // knobs: hw (half width at mid-neck), soft (width of the side ramp of the dissolve), flare/flareL (extra half width
  // right under the jaw line, easing out over flareL px: the column curves out into the jaw instead of meeting it at a
  // right angle), u (how much earlier the sides end than the centre: a U-shaped bottom instead of a flat cut), spread
  // (extra half width gained on the way down to the dissolve: a real neck widens a little toward the shoulders, so the
  // column must not narrow into a funnel / goatee point as it fades).
  type NeckShape = { cx: number; hw: number; y0: number; side: number; sig: number; hold: number; soft: number; flare: number; flareL: number; u: number; spread: number };
  const mkNeck = (s: NeckShape) => {
    const start = (x: number) => Math.min(s.y0, polyY(JAW, x) + s.side);
    const hwAt = (x: number, y: number) => {
      let hw = s.hw;
      if (s.flare > 0) hw += s.flare * (1 - smooth(0, s.flareL, y - polyY(JAW, x)));
      if (s.spread > 0) hw += s.spread * smooth(0, s.hold + s.sig, y - start(x));
      return hw;
    };
    // the line where the dissolve starts (U-shaped when u > 0)
    const y1 = (x: number) => start(x) + s.hold - s.u * Math.min(1, ((x - s.cx) / s.hw) ** 2);
    const w = (x: number, y: number) => {
      if (y <= polyY(JAW, x) + 1) return 1;
      const hw = hwAt(x, y);
      return 1 - smooth(hw - s.soft, hw + 6, Math.abs(x - s.cx));
    };
    const v = (y: number, x: number) => { const y0 = y1(x); return y < y0 ? 1 : Math.exp(-Math.pow((y - y0) / s.sig, 2)); };
    return { cx: s.cx, start, hwAt, y1, w, v, k: (x: number, y: number) => w(x, y) * v(y, x) };
  };
  // The neck as first shipped (a slab nearly as wide as the jaw). It is drawn nowhere: it only fixes how many random
  // numbers the beard stubble and the neck dust consume, so the shared rng stream (and with it every stubble tick,
  // network node and glint on the face) stays where it is whatever the visible neck looks like. Never tune it, and
  // keep it out of dbg(): changing it moves detail above the jaw.
  const NECK_REF: NeckShape = { cx: 318, hw: 124, y0: chinY + 4, side: 26, sig: 42, hold: 58, soft: 50, flare: 0, flareL: 1, u: 0, spread: 0 };
  const neckRef = mkNeck(NECK_REF);
  // the visible neck: ~0.4 of the face width (the photo's neck runs into the T-shirt collar and trapezius, so copying
  // its mask gave a pillar), soft sides, a short fillet into the jaw, near-parallel sides that widen a touch on the way
  // down (a strong U or flare made it narrow into a funnel / goatee point), a gentle U-shaped dissolve
  const NECK = mkNeck({
    cx: dbg('neckcx', NECK_REF.cx), hw: dbg('neckhw', 100), y0: chinY + dbg('collar', 4), side: dbg('neckside', NECK_REF.side),
    sig: dbg('necksig', 34), hold: dbg('neckhold', 55), soft: dbg('necksoft', 60),
    flare: dbg('neckflare', 6), flareL: Math.max(1, dbg('neckflarel', 25)), u: dbg('necku', 35),
    spread: dbg('neckspread', 10),
  });
  const NECK_DIM = dbg('neckdim', 0.35), NECK_EDGE = dbg('neckedge', 0.28), NECK_CYL = dbg('neckcyl', 2), NECK_FADE = dbg('neckfade', 0.3);
  // neck brightness: below the jaw the neck is ~65 % of the face's filament brightness on its centre line
  const neckBright = (x: number, y: number) => {
    const s0 = NECK.start(x);
    const below = smooth(s0 - 6, s0 + 34, y);
    // shaded like a cylinder: a bright centre ridge falling off toward the sides (NECK_EDGE at the rim), so the
    // column reads round instead of an evenly lit slab with two cut edges
    const u = Math.min(1, Math.abs(x - NECK.cx) / (NECK.hwAt(x, y) + 4));
    const cyl = NECK_EDGE + (1 - NECK_EDGE) * Math.pow(1 - u * u, 0.5 * NECK_CYL);
    // and it fades on the way down, so it recedes into the dissolve instead of ending as a lit slab
    const fade = NECK_FADE > 0 ? NECK_FADE * smooth(s0, NECK.y1(x) + 20, y) : 0;
    return 1 - below * (1 - (1 - NECK_DIM) * cyl * (1 - fade));
  };
  const neckK = NECK.k;
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
  const flowC = ch('flow', 0), flowS = ch('flow', 1), flowK = ch('flow', 2);
  const skinSeed = (i: number) => skinG[i] > 0.5 && mask[i] > 0.6 && hairR[i] < 0.3;
  const dHL = distTo(skinSeed);
  const dHair = distTo((i: number) => hairR[i] > 0.5);
  const HC = new Float32Array(N), HS = new Float32Array(N), HK = new Float32Array(N);
  {
    const zs = boxBlur(depth, 5);
    let RC = new Float32Array(N), RS = new Float32Array(N), RG = new Float32Array(N);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = (zs[i + 1] - zs[i - 1]) * 0.5, gy = (zs[i + W] - zs[i - W]) * 0.5;
      const g = Math.hypot(gx, gy);
      RG[i] = g;
      if (g < 1e-5) continue;
      const tx = -gy / g, ty = gx / g;
      RC[i] = (tx * tx - ty * ty) * g;
      RS[i] = 2 * tx * ty * g;
    }
    RC = boxBlur(RC, 3); RS = boxBlur(RS, 3); RG = boxBlur(RG, 2);
    const hcx = meta.head.cx, hcy = 0.5 * (LMk[468][1] + LMk[473][1]);
    const eyeYm = hcy;
    const RIM = dbg('rimblend', 0.9), HLB = dbg('hlblend', 0.8);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let c = flowC[i] * 2 - 1, s = flowS[i] * 2 - 1;
      const l = Math.hypot(c, s) || 1;
      c /= l; s /= l;
      let k = flowK[i];
      if (hairR[i] > 0.05) {
        const rw = RIM * smooth(0.7, 1.8, RG[i]);
        if (rw > 0.01) {
          const rl = Math.hypot(RC[i], RS[i]) || 1;
          c += (RC[i] / rl - c) * rw; s += (RS[i] / rl - s) * rw;
          k = Math.max(k, rw);
        }
        const hw = HLB * (1 - smooth(3, 16, dHL[i])) * (1 - smooth(eyeYm - 70, eyeYm - 30, y));
        if (hw > 0.01) {
          const a = 2 * Math.atan2(y - hcy, x - hcx);
          c += (Math.cos(a) - c) * hw; s += (Math.sin(a) - s) * hw;
          k = Math.max(k, hw);
        }
      }
      HC[i] = c; HS[i] = s; HK[i] = k;
    }
    const r = dbg('hsmooth', 16); // (finishing pass) heavy smoothing: long sleek strands, no curls
    if (r > 0) { HC.set(boxBlur(HC, r)); HS.set(boxBlur(HS, r)); }
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
  let brk = new Uint8Array(cap);
  function grow() {
    cap *= 2;
    const gf = (a: Float32Array, n: number) => { const b = new Float32Array(cap * n); b.set(a); return b; };
    const gu = (a: Uint8Array, n: number) => { const b = new Uint8Array(cap * n); b.set(a); return b; };
    Pp = gf(Pp, 3); A = gf(A, 4); Bk = gf(Bk, 3); G3 = gf(G3, 3);
    R8 = gu(R8, 1); E8 = gu(E8, 1); brk = gu(brk, 1);
  }
  let lineStart = true;
  let lastX = 0, lastY = 0, lastZ = 0, arc = 0, lineSeed = 0;
  function begin(seed: number) { lineStart = true; arc = 0; lineSeed = seed; }
  const neckY0 = chinY - 12;
  const onlyKinds: number[] | null = typeof params.kinds === 'string' ? params.kinds.split(',').map(Number) : null; // debug
  let curRank = 0, gX = 0, gY = 0, gZ = 0, dissolveMul = 1;
  function pt(x: number, y: number, z: number, I: number, half: number, kind: number, m: number, key: number) {
    if (onlyKinds && !onlyKinds.includes(Math.floor(kind))) return;
    if (nP >= cap) grow();
    if (!lineStart) arc += Math.hypot(x - lastX, y - lastY, z - lastZ);
    let nk = 1, mm = m;
    if (y > neckY0 - 140) {
      nk = neckK(x, y);
      // the mask's own neck fade starts ~25 px below the chin: remap it so the filaments stay whole for a short
      // neck and only then dissolve (the fragment dash dissolve keys on this value)
      if (y > chinY - 20 && !(kind >= K_HAIR && kind < K_BROW)) mm = Math.min(1, m / 0.62);
      if (kind < K_HAIR) I *= neckBright(x, y);
    }
    Pp[nP * 3] = x; Pp[nP * 3 + 1] = y; Pp[nP * 3 + 2] = z;
    A[nP * 4] = I; A[nP * 4 + 1] = half; A[nP * 4 + 2] = arc; A[nP * 4 + 3] = lineSeed;
    Bk[nP * 3] = kind; Bk[nP * 3 + 1] = mm * nk * dissolveMul; Bk[nP * 3 + 2] = key;
    G3[nP * 3] = gX; G3[nP * 3 + 1] = gY; G3[nP * 3 + 2] = gZ;
    R8[nP] = curRank; E8[nP] = isEar(x, y) ? 1 : 0;
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

  // ---------------------------------------------------------------- 1. scan filaments (the dominant family)
  // Contours of y - KT * z = c: planar slices tilted toward the viewer, so from the front they bend over the brow, nose,
  // lips and cheekbones. Line swelling (proto-c): width ~ gap^0.7, brightness ~ gap^0.45 (gap = local slice spacing /
  // nominal), so bunched slices under the nose / jaw neither burn nor go dark.
  const KT = dbg('tilt', 0.27);
  const PLANE_THIN = dbg('thin', 1.0);
  const BEARD_CUT = dbg('beardcut', 0.26), JAW_DARK = dbg('jawdark', 0.3), BEARD_DASH = dbg('bearddash', 0.12);
  const jawX0 = LMk[172][0], jawX1 = LMk[397][0];
  const SCAN_HAIR = dbg('scanhair', 0.94), SCAN_BROW = dbg('scanbrow', 0.85), SEAM_SH = dbg('seamsh', 0.4);
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
        I *= 1 - SCAN_HAIR * hair;
        I *= 1 - SCAN_BROW * Math.min(1, brow * 1.3);
        // (finishing pass) beard / stubble: darker than tone.png (whose shadow lift put the beard at 0.63 of skin; the
        // photo's luminance has it near 0.35-0.45), darkest along the jaw border, and broken into stubble dashes / dots
        // by the fragment dissolve (dissolveMul lowers the dissolve key in the beard)
        I *= 1 - BEARD_CUT * beard;
        if (x > jawX0 && x < jawX1) I *= 1 - JAW_DARK * Math.min(1, beard * 1.5) * Math.exp(-Math.pow((y - polyY(JAW, x) + 12) / 13, 2));
        I *= 1 - lashK(x, y);
        dissolveMul = 1 - BEARD_DASH * Math.min(1, beard * 1.2) * (1 - bil(lipF, x, y));
        if (x > mouthL - 4 && x < mouthR + 4) I *= 1 - SEAM_SH * Math.exp(-Math.pow((y - seamY(x)) / 3.2, 2)) * smooth(mouthL - 4, mouthL + 12, x) * smooth(mouthR + 4, mouthR - 12, x);
        const gap = Math.min(SW_HI, Math.max(SW_LO, 1 / dens));
        I *= Math.pow(gap, 0.45);
        const pl = bil(PLANE, x, y) * PLANE_THIN;
        const wf = (0.16 + 0.62 * t) * (1 - pl) + (0.15 + 0.5 * t) * pl;
        I *= Math.pow((0.16 + 0.62 * t) / wf, dbg('thincomp', 0.45)); // (finishing pass) less compensation: darker gaps on the planes, the mesh reads
        const half = Math.min(s * 0.5 * wf * Math.pow(gap, 0.7), 0.45 * s / Math.max(dens, 0.4));
        // vector to the neighbouring slice (along grad F, in image px) and its depth change
        const gl = Math.min(4 * s, s / dens);
        gX = (Fx / dens) * gl; gY = (Fy / dens) * gl; gZ = zx * gX + zy * gY;
        if (gY < 0) { gX = -gX; gY = -gY; gZ = -gZ; }
        const key2 = fy(y) * 0.86 + Math.abs(x - meta.head.cx) / W * 0.12;
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
  const MER_G = dbg('gmer', 0.3), MER_PLANE = dbg('gmerplane', 0.24);
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
        const I = (1 - 0.4 * bil(beardB, x, y)) * (1 - lashK(x, y)) * toneCurve(t) * (MER_G + MER_PLANE * plane) * Math.min(1, (w - 0.12) * 3) * (1 - 0.8 * Math.min(1, bil(browF, x, y) * 1.5)) * (1 - 0.6 * bil(eyeF, x, y)) * pupilK(x, y);
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
  const DIAG_G = dbg('gdiag', 0.4);
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
            pt(x, y, z + 0.8, DIAG_G * toneCurve(t) * Math.min(1, (pl - 0.12) * 2.5), 0.26, K_DIAG, bil(mask, x, y), fy(y) * 0.86 + 0.07);
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
  const fo = [0, 0, 0];
  function trace(x0: number, y0: number, maxSteps: number, step: number, accept: (x: number, y: number) => boolean, kind: number, Ifn: Field, half: number, lift: number, keyOff: number) {
    const xs: number[] = [], ys: number[] = [];
    for (const dir of [1, -1]) {
      let x = x0, y = y0;
      flowAt(x, y, fo);
      let tx = fo[0] * dir, ty = fo[1] * dir;
      const t0x = tx, t0y = ty;
      let low = 0;
      const seg: number[] = [];
      for (let i = 0; i < maxSteps; i++) {
        flowAt(x, y, fo);
        let fx = fo[0], fy2 = fo[1];
        if (fx * tx + fy2 * ty < 0) { fx = -fx; fy2 = -fy2; }
        const c = Math.min(1, fo[2] * 1.6 + 0.15);
        const cosA = fx * tx + fy2 * ty;
        if (cosA < 0.55 && fo[2] > 0.3) break;
        if (kind === K_HAIR && fo[2] < 0.14 && ++low > 3) break;
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
  function hairDir(x: number, y: number, out: number[]): number[] {
    const th = 0.5 * Math.atan2(bil(HS, x, y), bil(HC, x, y));
    out[0] = Math.cos(th); out[1] = Math.sin(th); out[2] = bil(HK, x, y);
    return out;
  }
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
      begin(rng());
      const nl = line.length;
      for (let i = 0; i < nl; i++) {
        const [x, y] = line[i];
        const taper = 0.12 + 0.88 * Math.min(1, Math.sin((Math.PI * i) / (nl - 1)) * 1.8);
        pt(x, y, bil(depth, x, y) + o.lift, o.Ifn(x, y) * taper, o.half * (0.55 + 0.45 * taper), o.kind, bil(mask, x, y), fy(y) * 0.86 + o.keyOff);
      }
      end();
      made++;
    }
    return made;
  }
  const BROW_G = dbg('gbrow', 0.26);
  traceEven({
    region: (x, y) => bil(browF, x, y), minRegion: 0.3, dsep: 1.25 * TS, step: 1.0, maxLen: 26, minLen: 5, follow: 0.6,
    cosStep: 0.75, cosCum: 0.87, dirFn: flowDir, minCoh: 0, seedSpacing: 1.5,
    Ifn: (x, y) => BROW_G * (0.12 + Math.pow(bil(tone, x, y), 1.3)) * Math.min(1, bil(browF, x, y) * 1.6),
    half: 0.3, lift: 2.0, kind: K_BROW + 0.6, keyOff: 0.0,
  });
  const HAIR_G = dbg('ghair', 1.0), HAIR_P = dbg('hexp', 1.9);
  // (finishing pass) near-black, smooth, glossy hair: strand brightness follows a lightly blurred tone (no hot specks
  // on every strand) and is lifted only inside broad sheen bands (large-scale tone of the hair), e.g. the crown and the
  // front wave
  const toneHS = boxBlur(tone, dbg('htoneblur', 4));
  const SHEEN = (() => {
    const th = new Float32Array(N);
    for (let i = 0; i < N; i++) th[i] = tone[i] * hairR[i];
    const a = boxBlur(th, 9), b = boxBlur(hairR, 9);
    const o = new Float32Array(N);
    for (let i = 0; i < N; i++) o[i] = b[i] > 0.05 ? smooth(dbg('sheenlo', 0.28), dbg('sheenhi', 0.45), a[i] / b[i]) : 0;
    return o;
  })();
  const hairRegion = (x: number, y: number) => {
    const m = bil(mask, x, y);
    return m < 0.05 ? 0 : (bil(hairR, x, y) / m) * Math.min(1, m * 2) * (1 - bil(browF, x, y));
  };
  traceEven({
    region: hairRegion, minRegion: 0.45, dsep: dbg('hdsep', 2.1) * TS, step: T.hairStep, maxLen: dbg('hlen', 170), minLen: dbg('hmin', 26), follow: dbg('hfollow', 0.2),
    cosStep: 0.85, cosCum: Math.cos((dbg('hturn', 30) * Math.PI) / 180), dirFn: hairDir, minCoh: dbg('hcoh', 0.3), seedSpacing: 2.0,
    Ifn: (x, y) => {
      const t = bil(toneHS, x, y);
      const fade = Math.max(smooth(2, 12, bil(dHL, x, y)), smooth(0.6, 0.78, t));
      return HAIR_G * Math.pow(t, HAIR_P) * (0.55 + dbg('sheen', 0.7) * bil(SHEEN, x, y)) * fade;
    },
    half: 0.42, lift: 2.2, kind: K_HAIR + 0.4, keyOff: 0.01,
  });
  {
    const mS = boxBlur(mask, 2);
    const hairS = boxBlur(hairR, 4);
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
      Ifn: (x, y) => { const hy = Math.min(1, bil(hairS, x, y) * 2.5); return RIM_G * (0.45 + 0.55 * hy) * (0.6 + 0.6 * bil(tone, x, y)) * (isEar(x, y) ? 1.6 : 1); }, // the ear's outline closes the ear when turned
      half: 0.3, lift: 1.0, kind: K_HAIR + 0.4, keyOff: 0.0,
    });
  }
  {
    const midX = (LMk[164][0] + LMk[152][0]) * 0.5;
    const halfW = (LMk[454][0] - LMk[234][0]) * 0.5;
    const lipTop = LMk[0][1], lipBot = LMk[17][1];
    const st = dbg('sdsep', 1.7) * TS;
    const tickLen = dbg('slen', 4.2);
    const SG = dbg('gstub', 0.3);
    for (let gy = 0; gy < H; gy += st) for (let gx = 0; gx < W; gx += st) {
      const sx = gx + rng() * st, sy = gy + rng() * st;
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
      pt(ax, ay, za + 1.0, I * 0.3, 0.16, K_BEARD, m, key);
      pt(sx, sy, zc + 1.0, I, 0.22, K_BEARD, m, key);
      pt(bx, by, zb + 1.0, I * 0.3, 0.16, K_BEARD, m, key);
      end();
    }
  }
  // ---------------------------------------------------------------- 3b. back-of-head shell (finishing pass)
  // The data is a front half-shell. For turned views a low-density shell continues the head behind the silhouette
  // plane: swept-back hair strands in vertical planes (constant x) from the top silhouette over the occiput to the nape,
  // plus a few faint latitude rings. Each point stores its outward normal in the gap slot; the shader shows only the
  // front-facing part and only when the head is turned (it never draws over the face head-on).
  {
    const SH_G = dbg('gshell', 0.3);
    const yc = 0.5 * (LMk[234][1] + LMk[454][1]);
    const C0 = dbg('shelldepth', 190);
    const topY = new Float32Array(W).fill(-1), halfAt = new Float32Array(H);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (mask[y * W + x] > 0.5) { topY[x] = y; break; }
    for (let y = 0; y < H; y++) {
      let l = -1, r = -1;
      for (let x = 0; x < W; x++) if (mask[y * W + x] > 0.5) { if (l < 0) l = x; r = x; }
      halfAt[y] = l < 0 ? 0 : 0.5 * (r - l);
    }
    const cx = meta.head.cx, a = 0.5 * (meta.head.right - meta.head.left);
    const yEnd = EAR_Y1 + 10;
    const emit = (P: number[][], I0: number, kind: number) => {
      // P: [[x, y, z, nx, ny, nz], ...] in crop px (normal: crop axes, unit)
      begin(rng());
      const n = P.length;
      for (let i = 0; i < n; i++) {
        const [x, y, z, nx, ny, nz] = P[i];
        const tp = Math.min(1, Math.min(i, n - 1 - i) / Math.max(3, n * 0.12));
        gX = nx * 15; gY = ny * 15; gZ = nz * 15;
        pt(x, y, z, I0 * (0.25 + 0.75 * tp) * bil(toneHS, Math.min(W - 1, Math.max(0, x)), Math.max(headTop + 4, y)) / 0.3, 0.36, kind, 1, fy(y) * 0.86 + 0.02);
      }
      end();
    };
    const dX = dbg('shellstep', 6.5) * TS;
    for (let x = cx - a * 0.94; x <= cx + a * 0.94; x += dX * (0.8 + 0.4 * rng())) {
      const xi = Math.round(x);
      if (topY[xi] < 0 || topY[xi] > yc - 40) continue;
      const u = (x - cx) / a;
      const B = yc - topY[xi] + 2, Cx = C0 * Math.sqrt(Math.max(0, 1 - u * u));
      if (Cx < 30) continue;
      const P: number[][] = [];
      const dphi = 2.6 / Math.max(B, Cx);
      for (let ph = 0.06; ph < 2.4; ph += dphi) {
        const y = yc - B * Math.cos(ph), z = -Cx * Math.sin(ph);
        if (y > yEnd) break;
        // outward normal of the ellipse (y, z) plane, tilted sideways by u
        // outward normal of the ellipsoid (x/a)^2 + (y/B)^2 + (z/C0)^2 = 1 at this point
        const ny = -Math.cos(ph) / B, nz = (-Cx * Math.sin(ph)) / (C0 * C0), nx = u / a;
        const l = Math.hypot(nx, ny, nz) || 1;
        P.push([x + (rng() - 0.5) * 0.6, y, z, nx / l, ny / l, nz / l]);
      }
      if (P.length > 6) emit(P, SH_G * 0.5 * (0.7 + 0.6 * rng()), K_SHELL + 0.4);
    }
    // faint latitude rings of the scanner shell
    // latitude contours: the scan slices continued around the back of the skull (they meet the rim at z = 0)
    for (let y = topY[Math.round(cx)] + 6; y < yEnd; y += dbg('shelllat', 9) * TS) {
      const A = halfAt[Math.round(y)];
      const v = (y - yc) / (yc - topY[Math.round(cx)] + 2);
      const Cy = C0 * Math.sqrt(Math.max(0, 1 - v * v));
      if (A < 40 || Cy < 30) continue;
      const P: number[][] = [];
      const dth = 2.4 / Math.max(A, Cy);
      for (let th = 0.05; th < Math.PI - 0.05; th += dth) {
        const x = cx + A * Math.cos(th), z = -Cy * Math.sin(th);
        const nx = Math.cos(th) / A, nz = -Math.sin(th) / Cy, ny = (y - yc) / Math.pow(yc - topY[Math.round(cx)] + 2, 2) * 0.6;
        const l = Math.hypot(nx, ny, nz) || 1;
        P.push([x, y, z, nx / l, ny / l, nz / l]);
      }
      emit(P, SH_G * 0.6, K_SHELL + 0.1);
    }
    gX = gY = gZ = 0;
  }
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
  const LID_FOLD = dbg('lidfold', 0.13), FOLD_OFF = dbg('foldoff', 3.0), LASH_LO = dbg('lashlo', 0.1), IRIS_G = dbg('iris', 0.1);
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
    begin(rng());
    const NS = 56;
    for (let k = 0; k <= NS; k++) {
      const a = (k / NS) * Math.PI * 2;
      const x = cx + Math.cos(a) * r * 0.98, y = cy + Math.sin(a) * r * 0.98;
      if (bil(eyeF, x, y) < 0.45 || y < upLid(e, x) + 2.2 || y > loLid(e, x) - 1.2) { end(); begin(rng()); continue; }
      pt(x, y, bil(depth, x, y) + 2.5, IRIS_G, 0.3, K_FEAT, 1, fy(y) * 0.86 + 0.09);
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
  const LIP_UP = dbg('lipup', 0.3), LIP_LO = dbg('liplo', 0.08), LIP_SEAM = dbg('lipseam', 0.26);
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
    const browSoft = boxBlur(browF, 3);
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
    let made = 0, tries = 0;
    while (made < T.edge && tries < T.edge * 40) {
      tries++;
      const x = meta.head.left + rng() * (meta.head.right - meta.head.left);
      const y = headTop + rng() * (headBot - headTop);
      const e = bil(edges, x, y);
      if (e < 0.42 || bil(hairR, x, y) > 0.3 || bil(beardB, x, y) > 0.55 || bil(mask, x, y) < 0.6 || bil(eyeF, x, y) > 0.2 || !acc(x, y)) continue;
      const n = trace(x, y, 10, 1.3, acc, K_EDGE, (xx, yy) => 0.06 + 0.3 * bil(edges, xx, yy) * (0.4 + 0.6 * bil(tone, xx, yy)), 0.3, 1.4, 0.05);
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
  //   w5 intensity / 4 | half width crop px / 16 (uint16 unorm)   w6 arc mod 4096 / 4096 | seed   w7 LOD rank
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
      rec[o + 3] = (s8(horizon(x, y, z, 1, 0) / 1.6) | (s8(horizon(x, y, z, -1, 0) / 1.6) << 8) | (s8(horizon(x, y, z, 0, -1) / 1.6) << 16) | (s8(horizon(x, y, z, 0, 1) / 1.6) << 24)) >>> 0;
      rec[o + 4] = (s8(gx) | (s8(gy) << 8) | (s8(gz) << 16) | (mEar << 24)) >>> 0;
      rec[o + 5] = (u16(A[i * 4] / 4) | (u16(A[i * 4 + 1] / 16) << 16)) >>> 0;
      rec[o + 6] = (u16((A[i * 4 + 2] % 4096) / 4096) | (u16(A[i * 4 + 3]) << 16)) >>> 0;
      rec[o + 7] = R8[i];
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
    // rest is parked as kind 9, never drawn), so the slim column does not end in a dense glitter cluster. The stream is
    // then rewound and advanced exactly as the reference neck's loop draws it (emit = false), so the network nodes and
    // glints after it stay put whatever the visible neck looks like.
    const DUST_W = dbg('neckdustw', 2), DUST_KEEP = dbg('neckdustkeep', 0.65), DUST_I = dbg('neckdusti', 0.7);
    const neckDust = (shape: ReturnType<typeof mkNeck>, emit: boolean, wPow: number) => {
      let made = 0, tries = 0;
      while (made < nNeck && tries < nNeck * 200) {
        tries++;
        const x = meta.head.left + rng() * (meta.head.right - meta.head.left);
        const y1 = shape.y1(x);
        const y = y1 - 10 + rng() * 90;
        const m = bil(mask, x, y);
        const wgt = Math.pow(shape.w(x, y), wPow) * Math.min(1, m * 2.5) * Math.pow(1 - shape.v(y, x), 0.6) * Math.exp(-Math.pow((y - y1 - 30) / 30, 2));
        if (rng() > wgt) continue;
        made++;
        if (!emit) { rng(); rng(); continue; }
        const z = bil(depth, x, y) + 2;
        toWorld(x, y, z, w);
        ppos.set(w, k * 3);
        pinfo.set([rng() < DUST_KEEP ? 1 : 9, rng(), rng(), DUST_I * (0.4 + 0.6 * bil(tone, x, y))], k * 4);
        phor.set([horizon(x, y, z, 1, 0), horizon(x, y, z, -1, 0), horizon(x, y, z, 0, -1), horizon(x, y, z, 0, 1)], k * 4);
        k++;
      }
    };
    const rs0 = rs;
    neckDust(NECK, true, DUST_W); // > 1 keeps the dust inside the column (not a wider skirt)
    rs = rs0;
    neckDust(neckRef, false, 1);
    // the neck's axis in world x: the shader draws the falling dust in toward it
    neckX = toWorld(NECK.cx, NECK.y1(NECK.cx), bil(depth, NECK.cx, NECK.y1(NECK.cx)) + 2, w)[0];
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
    pts,
    frame,
    info: {
      scanStep, scanWorld: scanStep * S, merWorld: merStep * S, cropWorld: S, tilt: KT, devPerCrop, neckX,
      counts: { scan: nScan, mer: nMer, diag: nDiag, strand: nStr, feat: nFeat, points: nP, nodes: nodes.length >> 2, particles: NPt },
      bytes: { records: nP * 32, texture: rec.byteLength, index: index.byteLength, perPoint: +((rec.byteLength + index.byteLength + nP * 2) / Math.max(1, nP)).toFixed(1) },
      ms: { ...prof, total: Math.round(tEnd - tStart) },
    },
    transfer: [rec.buffer, index.buffer, ppos.buffer, pinfo.buffer, phor.buffer],
  };
}
