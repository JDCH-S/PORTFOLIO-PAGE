"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
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
function Telemetry({ tier, built, frameCap, onReady }: { tier: Tier; built: HologramStats | null; frameCap: { readonly current: number }; onReady: () => void }) {
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

/**
 * Measures the browser's own frame-rate cap while `active` (the render loop is off, so the GPU is idle) with an empty
 * rAF loop. iOS Low Power Mode, Chrome's Energy Saver and Safari on a Mac in Low Power Mode cap rAF at 30 fps; a normal
 * display reads 60 / 120. Main-thread stalls (canvas creation, shader compile) only lengthen some intervals, so the
 * cap is read from the shorter ones (the 25th percentile). Returns a ref holding the cap in fps (0 until enough
 * intervals were timed) and the performance monitor's bounds.
 */
function useFrameCap(active: boolean) {
  const cap = useRef(0);
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
  // browser, or an unmeasured cap, keeps the 40 fps bound; frames above 50 under load (drei's `refreshrate`, the
  // fastest window so far) also prove there is no 30 cap. The bound never drops below 24, so a probe misread by heavy
  // stalls cannot shield a device that really struggles. Incline also counts toward the monitor's flip-flops, so only
  // declines may ever fire.
  const bounds = useCallback((refreshrate: number): [number, number] => {
    const limit = cap.current > 0 && refreshrate < 50 ? cap.current : Number.POSITIVE_INFINITY;
    return [Math.min(40, Math.max(24, 0.8 * limit)), Number.POSITIVE_INFINITY];
  }, []);
  return { cap, bounds };
}

const TONES: ToneMode[] = ["none", "aces", "agx", "neutral"];
/** full-resolution half-float passes get expensive above this many canvas pixels */
const PIXEL_BUDGET = 4.5e6;

export default function SphereScene({ tier: initialTier, coarsePointer, dpr, debug = false, className = "", blend = true, spin: spinHere = false }: SphereSceneProps) {
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
  // ?holo.ss=0 turns the low-DPR supersampling off (comparison)
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
  // runtime regression: if frames drop, lower the pixel ratio, then the tier
  const [dprScale, setDprScale] = useState(1);
  const onDecline = useCallback(() => setDprScale((s) => Math.max(0.6, s * 0.8)), []);
  const onFallback = useCallback(() => setTier((t) => (t === "high" ? "medium" : "low")), []);
  const showDebug = debug && !captureMode;
  // the performance monitor only starts after warm-up (shader compile, poster cross-fade)
  const [monitor, setMonitor] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => setMonitor(true), 2500);
    return () => clearTimeout(id);
  }, [visible]);
  const onLost = useCallback(() => setVisible(false), []);
  const onRestored = useCallback(() => setVisible(true), []);
  // pixel budget: retina / 4K desktops must not push 5-15 Mpx through the half-float post chain
  const [budgetDpr] = useState(() => {
    if (typeof window === "undefined") return 2;
    const css = window.innerWidth * window.innerHeight;
    return Math.max(1, Math.sqrt(PIXEL_BUDGET / Math.max(1, css)));
  });
  const maxDpr = Math.max(1, Math.min(budget.dpr[1], dpr, budgetDpr) * dprScale);
  // supersampling on low-DPR displays (high / medium tiers): ~1 px filaments sampled at pixel centres break into
  // staircase dashes and the slice stack beats against the pixel grid (moire). The canvas renders at the tier's DPR cap
  // (within the pixel budget) and the browser box-filters it down; the slice pitch still follows the display (pitchDpr),
  // so the head looks as designed for DPR 1, only anti-aliased. The performance monitor's declines lower it first.
  const ssDpr = Math.min(budget.dpr[1], budgetDpr) * dprScale;
  const supersample = tier !== "low" && dpr < 1.5 && !ssOff && ssDpr >= dpr * 1.25 ? ssDpr : 0;
  const pitchDpr = Math.min(dpr, maxDpr);
  // declines are judged against the browser's idle frame-rate cap (iOS Low Power Mode: 30 fps), measured until the
  // monitor starts
  const { cap: frameCap, bounds: monitorBounds } = useFrameCap(frameloop === "never" && !monitor);

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
          dpr={supersample ? supersample : [budget.dpr[0], maxDpr]}
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
          {!pinned && monitor ? <PerformanceMonitor bounds={monitorBounds} flipflops={3} onDecline={onDecline} onFallback={onFallback} /> : null}
          <Suspense fallback={null}>
            <SphereRig look={look} coarsePointer={coarsePointer} timeOffset={timeOffset} frozen={frozen}>
              <FaceHologram tier={tier} pitchDpr={pitchDpr} tune={tune} timeOffset={timeOffset} frozen={frozen} onBuilt={onBuilt} onError={onError} />
            </SphereRig>
            <Effects look={look} budget={budget} />
          </Suspense>
          <Telemetry tier={tier} built={built} frameCap={frameCap} onReady={onReady} />
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
