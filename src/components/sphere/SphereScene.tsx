"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { QualityTier } from "@/lib/tier";
import FaceHologram, { type HologramStats } from "@/components/hologram/FaceHologram";
import { prefetchHologram, releaseHologramWorker } from "@/components/hologram/loadHologram";
import { fillFor } from "@/components/hologram/config";
import { DEFAULT_LOOK, TIER_BUDGETS, type SphereLook, type Tier, type ToneMode } from "./config";
import SphereRig from "./SphereRig";
import Effects from "./Effects";
import StaticSphere from "./StaticSphere";
import { spin, useSphereStore } from "./sphereStore";
import { useSpinDrag } from "./useSpinDrag";

const DebugPanel = dynamic(() => import("./DebugPanel"), { ssr: false });

export interface SphereSceneProps {
  tier: Exclude<QualityTier, "static">;
  coarsePointer: boolean;
  /** a phone not known to be weak (see Capabilities.sharpen): its canvas may render above the tier's DPR */
  sharpen?: boolean;
  dpr: number;
  debug?: boolean;
  className?: string;
  /**
   * Screen-blend the black-cleared canvas over the page here. Turn off when the host puts
   * the scene inside its own stacking context (a fixed layer) and blends that layer instead.
   */
  blend?: boolean;
  /** attach drag-to-rotate to the scene itself (the site attaches it to its own overlay) */
  spin?: boolean;
}

declare global {
  interface Window {
    __sphereReady?: boolean;
    __sphereStats?: Record<string, unknown>;
    /** the device's GL info logs when a shader program failed (the scene then falls back to the poster) */
    __sphereShaderError?: { program: string; vertex: string; fragment: string };
    __sphereStore?: typeof useSphereStore;
    __sphereSpin?: typeof spin;
    /** the quality governor's state and its level changes (harness / review) */
    __sphereQuality?: QualityLog;
  }
}

/** Keeps the hologram's unit circle at ~72% of the limiting viewport dimension (88% on phones). */
function CameraFit() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    // (a collapsed canvas would put the camera at z = 1 / 0: a NaN view matrix in every shader)
    if (size.width < 1 || size.height < 1) return;
    const cam = camera as import("three").PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const vHalf = Math.tan((cam.fov * Math.PI) / 360);
    const limitHalf = aspect < 1 ? vHalf * aspect : vHalf;
    const fill = fillFor(size.width, size.height);
    cam.position.set(0, 0, 1 / (fill * limitHalf));
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function setInfoAutoReset(gl: import("three").WebGLRenderer, value: boolean) {
  gl.info.autoReset = value;
}

/**
 * Mounted last inside the Canvas: compiles the scene's shader programs in parallel
 * (KHR_parallel_shader_compile) before the render loop starts, so the first frame
 * does not stall the page. Falls through after a short timeout regardless.
 * The frameloop itself is React state on the scene (the Canvas prop is re-applied on
 * every re-render, so a store-level setFrameloop would be undone).
 */
function Warmup({ onWarm }: { onWarm: () => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let done = false;
    const start = () => {
      if (done) return;
      done = true;
      onWarm();
    };
    const timer = setTimeout(start, 1500);
    gl.compileAsync(scene, camera).then(start, start);
    return () => clearTimeout(timer);
  }, [gl, scene, camera, onWarm]);
  return null;
}

/** Reports whether the canvas is in view, so the loop can pause while it is scrolled away. */
function VisibilityGate({ enabled, onChange }: { enabled: boolean; onChange: (inView: boolean) => void }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => onChange(entry.isIntersecting), { threshold: 0.05 });
    io.observe(gl.domElement);
    return () => io.disconnect();
  }, [enabled, gl, onChange]);
  return null;
}

/**
 * Converts the store's screen-space frame (centre + diameter in CSS px) into the rig's
 * scale and offset targets. CameraFit puts radius 1 at fill * min(w, h) / 2 pixels.
 */
function SphereFraming() {
  const size = useThree((s) => s.size);
  const frame = useSphereStore((s) => s.frame);
  useEffect(() => {
    const st = useSphereStore.getState();
    if (!frame) {
      st.setScaleTarget(1);
      st.setOffsetTarget(0, 0);
      return;
    }
    const rPx = (fillFor(size.width, size.height) * Math.min(size.width, size.height)) / 2;
    st.setScaleTarget(Math.max(0.05, frame.size / 2 / rPx));
    st.setOffsetTarget((frame.x - size.width / 2) / rPx, (size.height / 2 - frame.y) / rPx);
  }, [frame, size.width, size.height]);
  return null;
}

/** Show the poster while the GL context is lost; the renderer rebuilds itself on restore. */
function ContextGuard({ onLost, onRestored }: { onLost: () => void; onRestored: () => void }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const el = gl.domElement;
    const lost = (e: Event) => {
      e.preventDefault();
      onLost();
    };
    const restored = () => onRestored();
    el.addEventListener("webglcontextlost", lost);
    el.addEventListener("webglcontextrestored", restored);
    return () => {
      el.removeEventListener("webglcontextlost", lost);
      el.removeEventListener("webglcontextrestored", restored);
    };
  }, [gl, onLost, onRestored]);
  return null;
}

/**
 * Readiness + live stats for the harness and the panel. Flips `visible` (and the store's `ready`, which starts the
 * intro) only once the hologram is built and two frames of it have rendered, so the poster stays up until then.
 */
/** the resolution handling, as Telemetry reports it */
interface ResolutionStats {
  /** the DPR the head's slice pitch is built for (the display's, within the tier's cap) */
  pitchDpr: number;
  /** "aa": a low-DPR desktop supersamples for anti-aliasing; "sharpen": a phone renders above pitchDpr for resolution */
  supersampling: "none" | "aa" | "sharpen";
  /** the quality governor's level (0 = the tier's start) and its floor */
  level: number;
  maxLevel: number;
}

function Telemetry({ tier, built, frameCap, res, onReady }: { tier: Tier; built: HologramStats | null; frameCap: { readonly current: number }; res: ResolutionStats; onReady: () => void }) {
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  const acc = useRef(0);
  const total = useRef(0);
  useEffect(() => {
    // count every pass of the frame (composer included), not just the last one
    setInfoAutoReset(gl, false);
    return () => setInfoAutoReset(gl, true);
  }, [gl]);
  useFrame((_, dt) => {
    if (built) total.current++;
    if (total.current === 2) {
      window.__sphereReady = true;
      useSphereStore.getState().setReady(true);
      onReady();
    }
    frames.current++;
    acc.current += Math.min(dt, 0.1); // the first frame after warm-up carries the compile time
    if (acc.current >= 1) {
      const fps = Math.round(frames.current / acc.current);
      frames.current = 0;
      acc.current = 0;
      const store = useSphereStore.getState();
      store.setStats(fps, built?.filaments ?? 0);
      window.__sphereStats = {
        tier,
        fps,
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        points: gl.info.render.points,
        dpr: gl.getPixelRatio(),
        ...res,
        // render px per display px (the shaders' uSS)
        ss: +(gl.getPixelRatio() / res.pitchDpr).toFixed(3),
        scanStep: built?.scanStep,
        // the browser's idle frame-rate cap (0 = not measured), which sets the performance monitor's decline bound
        frameCap: Math.round(frameCap.current),
        hologram: built,
      };
    }
    gl.info.reset();
  });
  return null;
}

function Caption({ tier, built }: { tier: Tier; built: HologramStats | null }) {
  const fps = useSphereStore((s) => s.fps);
  return (
    <div className="pointer-events-none absolute right-4 bottom-4 select-none text-right font-mono text-[10px] uppercase tracking-[0.22em] text-fg-dim/70">
      hologram · tier {tier} · {built ? `${built.vertices.toLocaleString()} vertices · build ${built.buildMs} ms (${built.where})` : "building"} · {fps} fps
    </div>
  );
}

/** idle frame intervals the cap estimate needs, and the most it keeps (~0.35 s and ~2 s at 30 fps) */
const CAP_MIN_INTERVALS = 10;
const CAP_MAX_INTERVALS = 60;
/** a measured cap at or under this is a power-saving one (iOS Low Power Mode, Energy Saver: 30 fps) */
const LOW_CAP_FPS = 35;

/**
 * Measures the browser's own frame-rate cap while `active` (the render loop is off, so the GPU is idle) with an empty
 * rAF loop. iOS Low Power Mode, Chrome's Energy Saver and Safari on a Mac in Low Power Mode cap rAF at 30 fps; a normal
 * display reads 60 / 120. Main-thread stalls (canvas creation, shader compile) only lengthen some intervals, so the
 * cap is read from the shorter ones (the 25th percentile). Returns a ref holding the cap in fps (0 until enough
 * intervals were timed), whether it is a power-saving cap (`lowCap`, state) and the governor's decline bound.
 */
function useFrameCap(active: boolean) {
  const cap = useRef(0);
  const [lowCap, setLowCap] = useState(false);
  const intervals = useRef<number[]>([]);
  useEffect(() => {
    const iv = intervals.current;
    if (!active || iv.length >= CAP_MAX_INTERVALS) return;
    let raf = 0;
    let last = -1;
    const tick = (t: number) => {
      if (last >= 0) iv.push(t - last);
      last = t;
      if (iv.length >= CAP_MIN_INTERVALS) {
        const sorted = [...iv].sort((a, b) => a - b);
        cap.current = 1000 / Math.max(1, sorted[Math.floor(sorted.length / 4)]);
        setLowCap(cap.current <= LOW_CAP_FPS);
      }
      if (iv.length < CAP_MAX_INTERVALS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  // The decline bound is relative to the browser's frame-rate cap: a phone in Low Power Mode delivers a steady 30 fps
  // with the GPU half idle, and a fixed 40 fps bound would read that as struggling and blur the head (DPR 1.25 -> 1).
  // Frame timing alone cannot tell that cap from a GPU that vsync-quantises to a steady 30 on a 60 Hz display, so the
  // cap is measured while nothing renders and declines fire below 80% of it (24 fps under a 30 cap). A 60 / 120 Hz
  // browser, or an unmeasured cap, keeps the 40 fps bound; frames above 50 under load (the governor's `refreshrate`,
  // the fastest window so far) also prove there is no 30 cap. The bound never drops below 24, so a probe misread by
  // heavy stalls cannot shield a device that really struggles.
  const declineBound = useCallback((refreshrate: number) => {
    const limit = cap.current > 0 && refreshrate < 50 ? cap.current : Number.POSITIVE_INFINITY;
    return Math.min(40, Math.max(24, 0.8 * limit));
  }, []);
  return { cap, lowCap, declineBound };
}

export interface QualityLog {
  level: number;
  /** declines per level (index = the level that declined): a level with MAX_FAILS of them is never stepped up to */
  fails: number[];
  /** level changes: page time (ms), the new level, why, the window's fps and the decline bound */
  changes: { t: number; level: number; why: "decline" | "recover" | "fallback"; fps: number; bound: number }[];
}

// The governor samples like drei's PerformanceMonitor did (ten 250 ms windows; a decline when more than 75 % of them
// are under the bound), so desktops step down exactly as before.
const WINDOW_MS = 250;
const WINDOWS = 10;
const DECLINE_SHARE = 0.75;
/**
 * a frame interval this long right after normal ones is a pause (the loop stopped off screen, a hidden tab), not a slow
 * frame: the windows restart. A run of them is a device that really is that slow (under 2 fps: software GL, a VM),
 * and those count, as they did for drei, so it still steps down and falls back a tier.
 */
const GAP_MS = 500;
/** after a drag, its coast and the spring back to front, frames count again only after this long */
const DRAG_QUIET_MS = 1000;
/** recovery: every window for this long at HEADROOM x the decline bound (capped just under the fastest window seen) */
const RECOVER_MS = 20000;
const HEADROOM = 1.25;
/** a level that declined this many times is never stepped up to again (so each level gets one retry at most) */
const MAX_FAILS = 2;

/** the head is being dragged, coasts or springs back (SphereRig snaps it to exactly 0 once it has settled) */
function spinMoving() {
  return spin.active || spin.yaw !== 0 || spin.pitch !== 0 || spin.vYaw !== 0 || spin.vPitch !== 0;
}

/**
 * Frame-rate governor (in place of drei's PerformanceMonitor): moves the scene's quality `level` one step down
 * (`onLevel(level + 1)`) when frames are sustainedly under the decline bound, and back up (`upLevel`) after sustained
 * headroom; a decline at `maxLevel` is the fallback (a lower tier), after which it stops, as the monitor did.
 * - Drags do not count: turning the head brings in the back-of-head shell and sweep strands, a short honest dip that
 *   must not cost the head its resolution for good. Frames are ignored while the head is held, coasts or springs back,
 *   and for DRAG_QUIET_MS after. Frames also do not count while `active` is off (the GL context is lost: nothing
 *   renders, so they would read as headroom).
 * - Recovery is a retry, not a measurement: under a vsync cap a level that holds 60 fps reads the same whether the
 *   level above would make it or not. So it is rare and bounded: it needs RECOVER_MS of windows well above the bound
 *   (HEADROOM, so a level that just made the bound does not count), and each level is retried at most once (MAX_FAILS
 *   declines bar it for good). A device on the edge between two levels therefore switches at most twice more, and a
 *   transient load (the page still busy at start, another tab) still gets its resolution back.
 */
function QualityGovernor({
  active,
  level,
  upLevel,
  maxLevel,
  declineBound,
  onLevel,
  onFallback,
}: {
  active: boolean;
  level: number;
  /** where a recovery goes (the next level up that renders differently) */
  upLevel: number;
  maxLevel: number;
  declineBound: (refreshrate: number) => number;
  onLevel: (level: number) => void;
  onFallback: () => void;
}) {
  const g = useRef({ frames: [] as number[], windows: [] as number[], last: -1, prevDt: 0, refreshrate: 0, quietUntil: 0, roomSince: -1, done: false });
  const log = useRef<QualityLog>({ level, fails: [], changes: [] });
  useEffect(() => {
    const l = log.current;
    window.__sphereQuality = l;
    return () => {
      if (window.__sphereQuality === l) delete window.__sphereQuality;
    };
  }, []);
  useEffect(() => {
    // a new level is judged on its own frames
    const s = g.current;
    s.frames.length = 0;
    s.windows.length = 0;
    s.roomSince = -1;
    log.current.level = level;
  }, [level]);
  useFrame(() => {
    const s = g.current;
    if (s.done) return;
    const now = performance.now();
    const dt = s.last >= 0 ? now - s.last : 0;
    s.last = now;
    const pause = dt > GAP_MS && s.prevDt <= GAP_MS;
    s.prevDt = dt;
    if (spinMoving()) s.quietUntil = now + DRAG_QUIET_MS;
    if (!active || now < s.quietUntil || pause) {
      s.frames.length = 0;
      s.windows.length = 0;
      s.roomSince = -1;
      return;
    }
    s.frames.push(now);
    const span = now - s.frames[0];
    if (span < WINDOW_MS) return;
    const fps = Math.round((s.frames.length / span) * 1000);
    s.frames.length = 0;
    s.refreshrate = Math.max(s.refreshrate, fps);
    const bound = declineBound(s.refreshrate);
    const fails = log.current.fails;
    const change = (to: number, why: QualityLog["changes"][number]["why"]) => {
      log.current.changes.push({ t: Math.round(now), level: to, why, fps, bound });
      if (log.current.changes.length > 64) log.current.changes.shift();
    };
    // recovery: sustained headroom steps back up (never above the tier's start, level 0). Headroom is HEADROOM x the
    // bound, or just under the fastest window seen where a frame cap is lower than that (iOS Low Power Mode: 30 fps
    // against a 24 bound), but never less than 10 % above the bound: a level that only just makes it is no headroom.
    const room = Math.max(bound * 1.1, Math.min(bound * HEADROOM, 0.92 * s.refreshrate));
    if (level > 0 && (fails[upLevel] ?? 0) < MAX_FAILS && fps >= room) {
      if (s.roomSince < 0) s.roomSince = now - span;
      if (now - s.roomSince >= RECOVER_MS) {
        s.roomSince = -1;
        change(upLevel, "recover");
        onLevel(upLevel);
        return;
      }
    } else {
      s.roomSince = -1;
    }
    s.windows.push(fps);
    if (s.windows.length < WINDOWS) return;
    const slow = s.windows.filter((v) => v < bound).length;
    s.windows.length = 0;
    if (slow <= WINDOWS * DECLINE_SHARE) return;
    fails[level] = (fails[level] ?? 0) + 1;
    if (level >= maxLevel) {
      s.done = true;
      change(level, "fallback");
      onFallback();
    } else {
      change(level + 1, "decline");
      onLevel(level + 1);
    }
  });
  return null;
}

const TONES: ToneMode[] = ["none", "aces", "agx", "neutral"];
/** full-resolution half-float passes get expensive above this many canvas pixels */
const PIXEL_BUDGET = 4.5e6;
/** the DPR a phone's canvas sharpens to (see sharpTop): 2.6x the pixels of the low tier's 1.25 */
const SHARP_DPR = 2;

export default function SphereScene({ tier: initialTier, coarsePointer, sharpen = false, dpr, debug = false, className = "", blend = true, spin: spinHere = false }: SphereSceneProps) {
  const drag = useSpinDrag({ allowPitch: !coarsePointer });
  const query = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const captureMode = !!query?.has("capture");
  // a forced ?tier= pins the tier (review + screenshot harness), so no runtime regression
  const pinned = !!query?.get("tier");
  // ?t=seconds starts the animation clocks mid-flight (screenshot harness / review)
  const timeOffset = Math.max(0, Number(query?.get("t") ?? 0)) || 0;
  // ?capture&freeze stops every clock at ?t= and holds the head still and front-on (poster capture)
  const frozen = captureMode && !!query?.has("freeze");
  const toneParam = query?.get("tone");
  // ?holo.ss=0 turns the low-DPR supersampling and the phones' sharpening off (comparison)
  const ssOff = query?.get("holo.ss") === "0";
  const initialLook = useMemo<SphereLook>(() => {
    const l = toneParam && TONES.includes(toneParam as ToneMode) ? { ...DEFAULT_LOOK, toneMapping: toneParam as ToneMode } : DEFAULT_LOOK;
    return frozen ? { ...l, sway: 0, tilt: 0, breatheAmount: 0 } : l;
  }, [toneParam, frozen]);
  // every look value is live (uniforms, rig, post): the geometry is measured data and only rebuilds per tier
  const [look, setLook] = useState<SphereLook>(initialLook);
  const tune = useMemo(
    () => ({ gain: look.gain, halo: look.halo, nodes: look.nodes, colorBase: look.colorBase, colorHot: look.colorHot, colorDeep: look.colorDeep }),
    [look.gain, look.halo, look.nodes, look.colorBase, look.colorHot, look.colorDeep],
  );

  const [tier, setTier] = useState<Tier>(initialTier);
  useEffect(() => {
    // the maps start downloading in the worker while the canvas initialises
    prefetchHologram(initialTier);
    return () => releaseHologramWorker();
  }, [initialTier]);
  useEffect(() => {
    // the intro waits for a build in progress instead of giving up on a fixed timer
    useSphereStore.getState().setBuilding(true);
    return () => useSphereStore.getState().setBuilding(false);
  }, []);
  const budget = TIER_BUDGETS[tier];
  useEffect(() => {
    useSphereStore.getState().setTier(tier);
  }, [tier]);
  useEffect(() => {
    // handle for the screenshot harness and for tuning from the console
    window.__sphereStore = useSphereStore;
    window.__sphereSpin = spin;
    return () => {
      delete window.__sphereStore;
      delete window.__sphereSpin;
    };
  }, []);
  // the built head (stats); a tier rebuild replaces it, the readiness gate only waits for the first one
  const [built, setBuilt] = useState<HologramStats | null>(null);
  const onBuilt = useCallback((stats: HologramStats) => {
    setBuilt(stats);
    const store = useSphereStore.getState();
    store.setStats(store.fps, stats.filaments);
    store.setBuilding(false);
  }, []);
  // no data / no build: the poster stays, the canvas (GL context, composer targets) is unmounted, and the page
  // carries on as on the static tier
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => {
    setFailed(true);
    window.__sphereReady = true;
    const store = useSphereStore.getState();
    store.setBuilding(false);
    store.setReady(true);
  }, []);
  const [visible, setVisible] = useState(false);
  const onReady = useCallback(() => setVisible(true), []);
  // render loop: off until the shaders are warm AND the head is built, then follows the canvas's visibility.
  // Frames rendered into the still-hidden canvas while the worker builds are wasted GPU work: on software GL they
  // queue up into a multi-second stall that delays the first head frame (and with it the scan-in intro).
  // A failed build never starts the loop (the poster stays and the canvas is unmounted).
  const [warm, setWarm] = useState(false);
  const [inView, setInView] = useState(true);
  const onWarm = useCallback(() => setWarm(true), []);
  const onInView = useCallback((v: boolean) => setInView(v), []);
  const frameloop = warm && inView && built && !failed ? "always" : "never";
  // runtime regression: if frames drop, the governor steps the quality level down (lower resolution, see below), then
  // the tier; with headroom again it steps back up
  const [level, setLevel] = useState(0);
  const onFallback = useCallback(() => setTier((t) => (t === "high" ? "medium" : "low")), []);
  const showDebug = debug && !captureMode;
  // the governor only starts after warm-up (shader compile, poster cross-fade)
  const [monitor, setMonitor] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => setMonitor(true), 2500);
    return () => clearTimeout(id);
  }, [visible]);
  // declines are judged against the browser's idle frame-rate cap (iOS Low Power Mode: 30 fps), measured until the
  // governor starts
  const { cap: frameCap, lowCap, declineBound } = useFrameCap(frameloop === "never" && !monitor);
  const onLost = useCallback(() => setVisible(false), []);
  const onRestored = useCallback(() => setVisible(true), []);
  // pixel budget: retina / 4K desktops must not push 5-15 Mpx through the half-float post chain
  const [budgetDpr] = useState(() => {
    if (typeof window === "undefined") return 2;
    const css = window.innerWidth * window.innerHeight;
    return Math.max(1, Math.sqrt(PIXEL_BUDGET / Math.max(1, css)));
  });
  // Sharpening on phones (the low tier on a DPR >= 2 touch screen): the head is built and drawn for the tier's DPR
  // (1.25: slice pitch, line footprints, LOD, glow), and on a 3x screen a 1.25 canvas is magnified 2.4x by the browser,
  // which reads as soft next to the crisp poster. The canvas renders above it (up to SHARP_DPR, within the pixel
  // budget) while pitchDpr, every footprint (HoloFrameState.sharpen) and the glow's mip chain (Effects' glowScale) stay
  // those of the tier's DPR: the same picture with finer pixels. Only for a page that starts on the low tier, so a
  // fallback from a higher tier never turns it on; only on phones not known to be weak (Capabilities.sharpen: no
  // tablets, no <= 4 GB Android phones); and not under a power-saving frame cap (iOS Low Power Mode, which also lowers
  // the GPU clock: 2.6x the pixels is the opposite of what was asked for, and at a 30 fps cap the governor cannot see
  // a level that only manages 20). The cap is measured before the loop starts, so the canvas starts at the tier's DPR.
  const sharpTop = initialTier === "low" && coarsePointer && sharpen && !lowCap && dpr >= 2 && !ssOff ? Math.min(SHARP_DPR, dpr, budgetDpr) : 0;
  const baseDpr = Math.min(budget.dpr[1], dpr, budgetDpr);
  // Quality levels: the sharpening's steps come first (2 -> 1.6 on a phone; a step must stay 1.25x above the base to be
  // worth its pixels), then the base DPR's (x 0.8 each, floor 0.6 of the tier's cap, as before). Desktops have no
  // sharpening steps, so their ladder is the old one: 1, 0.8, 0.64, 0.6, then the tier fallback.
  let sharpSteps = 0;
  while (sharpTop * 0.8 ** sharpSteps >= baseDpr * 1.25) sharpSteps++;
  const maxLevel = sharpSteps + 3;
  // supersampling on low-DPR displays (high / medium tiers): ~1 px filaments sampled at pixel centres break into
  // staircase dashes and the slice stack beats against the pixel grid (moire). The canvas renders at the tier's DPR cap
  // (within the pixel budget) and the browser box-filters it down; the slice pitch still follows the display (pitchDpr),
  // so the head looks as designed for DPR 1, only anti-aliased. The governor's declines lower it first.
  const resolutionAt = (l: number) => {
    const dprScale = Math.max(0.6, 0.8 ** Math.max(0, l - sharpSteps));
    const sharpDpr = l < sharpSteps ? sharpTop * 0.8 ** l : 0;
    const maxDpr = Math.max(1, baseDpr * dprScale);
    const ssDpr = Math.min(budget.dpr[1], budgetDpr) * dprScale;
    const supersample = tier !== "low" && dpr < 1.5 && !ssOff && ssDpr >= dpr * 1.25 ? ssDpr : 0;
    const pitchDpr = Math.min(dpr, maxDpr);
    const canvasDpr = supersample || sharpDpr || Math.min(Math.max(budget.dpr[0], dpr), maxDpr);
    return { sharpDpr, maxDpr, supersample, pitchDpr, canvasDpr };
  };
  const { sharpDpr, maxDpr, supersample, pitchDpr, canvasDpr } = resolutionAt(level);
  // a recovery goes to the nearest level above that actually renders differently (the lowest levels can all clamp to
  // DPR 1: they only count down to the tier fallback)
  let upLevel = Math.max(0, level - 1);
  while (upLevel > 0 && resolutionAt(upLevel).canvasDpr === canvasDpr && resolutionAt(upLevel).pitchDpr === pitchDpr) upLevel--;
  const res = useMemo<ResolutionStats>(
    () => ({ pitchDpr, supersampling: supersample ? "aa" : sharpDpr ? "sharpen" : "none", level, maxLevel }),
    [pitchDpr, supersample, sharpDpr, level, maxLevel],
  );

  return (
    <div
      className={`absolute inset-0 ${spinHere ? "cursor-grab active:cursor-grabbing" : ""} ${className}`}
      data-tier={tier}
      style={spinHere ? { touchAction: coarsePointer ? "pan-y" : "none" } : undefined}
      {...(spinHere ? drag : {})}
    >
      <div className={`absolute inset-0 transition-opacity duration-700 ease-out ${visible && !failed ? "opacity-0" : "opacity-100"}`} aria-hidden={!failed}>
        <StaticSphere loading={!failed} />
      </div>
      {failed ? null : (
      <div className={`absolute inset-0 ${blend ? "mix-blend-screen" : ""} transition-opacity duration-700 ease-out ${visible ? "opacity-100" : "opacity-0"}`}>
        <Canvas
          dpr={supersample || sharpDpr ? canvasDpr : [budget.dpr[0], maxDpr]}
          camera={{ fov: 40, near: 0.1, far: 50, position: [0, 0, 3.8] }}
          gl={{ antialias: false, alpha: false, powerPreference: "high-performance", stencil: false, depth: false }}
          flat
          frameloop={frameloop}
          style={{ background: "transparent" }}
          onCreated={({ gl }) => {
            // cleared to pure black and screen-blended over the page: screen(bg, black) = bg, so
            // no tone-map-dependent seam, and later phases can draw a grid behind the sphere
            gl.setClearColor("#000000", 1);
            // a shader the device's GL rejects draws nothing: without this the head would be "ready" (frames render)
            // but invisible, and the poster would fade out over an empty canvas. Fall back to the poster instead.
            gl.debug.onShaderError = (ctx, program, vs, fs) => {
              const log = (s: WebGLShader) => (ctx.getShaderParameter(s, ctx.COMPILE_STATUS) ? "" : ctx.getShaderInfoLog(s)?.trim() || "compile failed");
              const detail = { program: ctx.getProgramInfoLog(program)?.trim() || "", vertex: log(vs), fragment: log(fs) };
              window.__sphereShaderError = detail;
              console.error("[hologram] shader program failed, showing the poster", detail);
              onError();
            };
          }}
        >
          <CameraFit />
          <SphereFraming />
          <ContextGuard onLost={onLost} onRestored={onRestored} />
          {!pinned && monitor ? <QualityGovernor active={visible} level={level} upLevel={upLevel} maxLevel={maxLevel} declineBound={declineBound} onLevel={setLevel} onFallback={onFallback} /> : null}
          <Suspense fallback={null}>
            <SphereRig look={look} coarsePointer={coarsePointer} timeOffset={timeOffset} frozen={frozen}>
              <FaceHologram tier={tier} pitchDpr={pitchDpr} sharpen={!!sharpDpr} tune={tune} timeOffset={timeOffset} frozen={frozen} onBuilt={onBuilt} onError={onError} />
            </SphereRig>
            <Effects look={look} budget={budget} glowScale={sharpDpr ? pitchDpr / sharpDpr : 1} />
          </Suspense>
          <Telemetry tier={tier} built={built} frameCap={frameCap} res={res} onReady={onReady} />
          <VisibilityGate enabled={visible} onChange={onInView} />
          <Warmup onWarm={onWarm} />
        </Canvas>
      </div>
      )}
      {showDebug ? <DebugPanel tier={tier} initialLook={initialLook} onLook={setLook} onTier={setTier} /> : null}
      {showDebug ? <Caption tier={tier} built={built} /> : null}
    </div>
  );
}
