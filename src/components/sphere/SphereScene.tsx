"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import type { QualityTier } from "@/lib/tier";
import { DEFAULT_LOOK, STRUCTURE_KEYS, TIER_BUDGETS, type SphereLook, type Tier, type ToneMode } from "./config";
import Fragments from "./Fragments";
import Vortex from "./Vortex";
import CoreGlow from "./CoreGlow";
import Particles from "./Particles";
import SphereRig from "./SphereRig";
import Effects from "./Effects";
import StaticSphere from "./StaticSphere";
import { useSphereStore } from "./sphereStore";

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
}

declare global {
  interface Window {
    __sphereReady?: boolean;
    __sphereStats?: Record<string, unknown>;
    __sphereStore?: typeof useSphereStore;
  }
}

/** Keeps the sphere (radius 1) at ~72% of the limiting viewport dimension (88% on phones). */
function CameraFit() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    const cam = camera as import("three").PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const vHalf = Math.tan((cam.fov * Math.PI) / 360);
    const limitHalf = aspect < 1 ? vHalf * aspect : vHalf;
    const fill = aspect < 0.8 ? 0.88 : 0.72;
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
    const aspect = size.width / Math.max(1, size.height);
    const fill = aspect < 0.8 ? 0.88 : 0.72;
    const rPx = (fill * Math.min(size.width, size.height)) / 2;
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

/** Readiness + live stats for the harness and the panel. Flips `visible` after the second frame, once the composer's shaders exist. */
function Telemetry({ tier, onReady }: { tier: Tier; onReady: () => void }) {
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
    total.current++;
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
      store.setStats(fps, store.fragments);
      window.__sphereStats = {
        tier,
        fragments: store.fragments,
        fps,
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        points: gl.info.render.points,
        dpr: gl.getPixelRatio(),
      };
    }
    gl.info.reset();
  });
  return null;
}

function Caption({ tier }: { tier: Tier }) {
  const fps = useSphereStore((s) => s.fps);
  const fragments = useSphereStore((s) => s.fragments);
  return (
    <div className="pointer-events-none absolute right-4 bottom-4 select-none text-right font-mono text-[10px] uppercase tracking-[0.22em] text-fg-dim/70">
      core // phase 1 · tier {tier} · {fragments.toLocaleString()} fragments · {fps} fps
    </div>
  );
}

const STRUCTURAL = new Set<string>(STRUCTURE_KEYS);
const TONES: ToneMode[] = ["none", "aces", "agx", "neutral"];
/** full-resolution half-float passes get expensive above this many canvas pixels */
const PIXEL_BUDGET = 4.5e6;

export default function SphereScene({ tier: initialTier, coarsePointer, dpr, debug = false, className = "", blend = true }: SphereSceneProps) {
  const query = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const captureMode = !!query?.has("capture");
  // a forced ?tier= pins the tier (review + screenshot harness), so no runtime regression
  const pinned = !!query?.get("tier");
  // ?t=seconds starts the animation clocks mid-flight (screenshot harness / review)
  const timeOffset = Math.max(0, Number(query?.get("t") ?? 0)) || 0;
  const toneParam = query?.get("tone");
  const initialLook = useMemo<SphereLook>(
    () => (toneParam && TONES.includes(toneParam as ToneMode) ? { ...DEFAULT_LOOK, toneMapping: toneParam as ToneMode } : DEFAULT_LOOK),
    [toneParam],
  );
  const [look, setLookState] = useState<SphereLook>(initialLook);
  // live keys apply immediately; structural keys (geometry rebuilds) are debounced
  const pending = useRef<SphereLook | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setLook = useCallback((next: SphereLook) => {
    setLookState((prev) => {
      const structuralChanged = STRUCTURE_KEYS.some((k) => prev[k] !== next[k]);
      if (!structuralChanged) return next;
      const live = { ...next };
      for (const k of Object.keys(live) as (keyof SphereLook)[]) {
        if (STRUCTURAL.has(k)) (live as unknown as Record<string, unknown>)[k] = prev[k];
      }
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (pending.current) setLookState(pending.current);
        pending.current = null;
      }, 180);
      return live;
    });
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const [tier, setTier] = useState<Tier>(initialTier);
  const budget = TIER_BUDGETS[tier];
  useEffect(() => {
    useSphereStore.getState().setTier(tier);
  }, [tier]);
  useEffect(() => {
    // handle for the screenshot harness and for tuning from the console
    window.__sphereStore = useSphereStore;
    return () => {
      delete window.__sphereStore;
    };
  }, []);
  const onBuilt = useCallback((n: number) => {
    const store = useSphereStore.getState();
    store.setStats(store.fps, n);
  }, []);
  const [visible, setVisible] = useState(false);
  const onReady = useCallback(() => setVisible(true), []);
  const hidePoster = useSphereStore((s) => s.hidePoster);
  // render loop: off until the shaders are warm, then follows the canvas's visibility
  const [warm, setWarm] = useState(false);
  const [inView, setInView] = useState(true);
  const onWarm = useCallback(() => setWarm(true), []);
  const onInView = useCallback((v: boolean) => setInView(v), []);
  const frameloop = warm && inView ? "always" : "never";
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
  // incline also counts toward the monitor's flip-flops, so only declines may ever fire
  const monitorBounds = useCallback((): [number, number] => [40, Number.POSITIVE_INFINITY], []);

  return (
    <div className={`absolute inset-0 ${className}`} data-tier={tier}>
      <div className={`absolute inset-0 transition-opacity duration-700 ease-out ${visible || hidePoster ? "opacity-0" : "opacity-100"}`} aria-hidden>
        <StaticSphere loading />
      </div>
      <div className={`absolute inset-0 ${blend ? "mix-blend-screen" : ""} transition-opacity duration-700 ease-out ${visible ? "opacity-100" : "opacity-0"}`}>
        <Canvas
          dpr={[budget.dpr[0], maxDpr]}
          camera={{ fov: 40, near: 0.1, far: 50, position: [0, 0, 3.8] }}
          gl={{ antialias: false, alpha: false, powerPreference: "high-performance", stencil: false, depth: false }}
          flat
          frameloop={frameloop}
          style={{ background: "transparent" }}
          onCreated={({ gl }) => {
            // cleared to pure black and screen-blended over the page: screen(bg, black) = bg, so
            // no tone-map-dependent seam, and later phases can draw a grid behind the sphere
            gl.setClearColor("#000000", 1);
          }}
        >
          <CameraFit />
          <SphereFraming />
          <ContextGuard onLost={onLost} onRestored={onRestored} />
          {!pinned && monitor ? <PerformanceMonitor bounds={monitorBounds} flipflops={3} onDecline={onDecline} onFallback={onFallback} /> : null}
          <Suspense fallback={null}>
            <SphereRig look={look} coarsePointer={coarsePointer} timeOffset={timeOffset}>
              <Fragments look={look} budget={budget} onBuilt={onBuilt} timeOffset={timeOffset} />
              <Vortex look={look} budget={budget} timeOffset={timeOffset} />
              <CoreGlow look={look} timeOffset={timeOffset} />
              <Particles look={look} budget={budget} timeOffset={timeOffset} />
            </SphereRig>
            <Effects look={look} budget={budget} />
          </Suspense>
          <Telemetry tier={tier} onReady={onReady} />
          <VisibilityGate enabled={visible} onChange={onInView} />
          <Warmup onWarm={onWarm} />
        </Canvas>
      </div>
      {showDebug ? <DebugPanel tier={tier} initialLook={initialLook} onLook={setLook} onTier={setTier} /> : null}
      {showDebug ? <Caption tier={tier} /> : null}
    </div>
  );
}
