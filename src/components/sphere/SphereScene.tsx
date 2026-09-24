"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import StaticSphere from "./StaticSphere";
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

const DebugPanel = dynamic(() => import("./DebugPanel"), { ssr: false });

export interface SphereSceneProps {
  tier: Exclude<QualityTier, "static">;
  coarsePointer: boolean;
  dpr: number;
  debug?: boolean;
  className?: string;
}

declare global {
  interface Window {
    __sphereReady?: boolean;
    __sphereStats?: Record<string, unknown>;
  }
}

/** Keeps the sphere (radius 1) at ~72% of the limiting viewport dimension. */
function CameraFit() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    const cam = camera as import("three").PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const vHalf = Math.tan((cam.fov * Math.PI) / 360);
    const limitHalf = aspect < 1 ? vHalf * aspect : vHalf;
    const fill = aspect < 0.8 ? 0.88 : 0.72; // phones: the sphere fills most of the width
    cam.position.set(0, 0, 1 / (fill * limitHalf));
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function setInfoAutoReset(gl: import("three").WebGLRenderer, value: boolean) {
  gl.info.autoReset = value;
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

const STRUCTURAL = new Set<string>(STRUCTURE_KEYS);
const TONES: ToneMode[] = ["none", "aces", "agx", "neutral"];

/** Exposes readiness + live stats for the screenshot harness and the debug panel. */
function Telemetry({ tier, fragments, onFps, onFirstFrame }: { tier: Tier; fragments: number; onFps: (fps: number) => void; onFirstFrame: () => void }) {
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  const acc = useRef(0);
  const first = useRef(true);
  useEffect(() => {
    // count every pass of the frame (composer included), not just the last one
    setInfoAutoReset(gl, false);
    return () => setInfoAutoReset(gl, true);
  }, [gl]);
  useFrame((_, dt) => {
    if (first.current) {
      first.current = false;
      window.__sphereReady = true;
      onFirstFrame();
    }
    frames.current++;
    acc.current += dt;
    if (acc.current >= 1) {
      const fps = Math.round(frames.current / acc.current);
      frames.current = 0;
      acc.current = 0;
      onFps(fps);
      window.__sphereStats = {
        tier,
        fragments,
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

export default function SphereScene({ tier: initialTier, coarsePointer, dpr, debug = false, className = "" }: SphereSceneProps) {
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
  const [fragments, setFragments] = useState(0);
  const [fps, setFps] = useState(0);
  const [visible, setVisible] = useState(false);
  const onFirstFrame = useCallback(() => setVisible(true), []);
  // runtime regression: if frames drop, lower the pixel ratio, then the tier
  const [dprScale, setDprScale] = useState(1);
  const onDecline = useCallback(() => setDprScale((s) => Math.max(0.6, s * 0.8)), []);
  const onFallback = useCallback(() => setTier((t) => (t === "high" ? "medium" : "low")), []);
  const budget = TIER_BUDGETS[tier];
  const stats = useMemo(() => ({ fragments, fps }), [fragments, fps]);
  const onBuilt = useCallback((n: number) => setFragments(n), []);
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

  return (
    <div className={`absolute inset-0 ${className}`} data-tier={tier}>
      <div className={`absolute inset-0 transition-opacity duration-700 ease-out ${visible ? "opacity-0" : "opacity-100"}`} aria-hidden>
        <StaticSphere loading />
      </div>
      <div className={`absolute inset-0 mix-blend-screen transition-opacity duration-700 ease-out ${visible ? "opacity-100" : "opacity-0"}`}>
      <Canvas
        dpr={[budget.dpr[0], Math.max(1, Math.min(budget.dpr[1], dpr) * dprScale)]}
        camera={{ fov: 40, near: 0.1, far: 50, position: [0, 0, 3.8] }}
        gl={{ antialias: false, alpha: false, powerPreference: "high-performance", stencil: false, depth: false }}
        flat
        frameloop="always"
        style={{ background: "transparent" }}
        onCreated={({ gl }) => {
          // cleared to pure black and screen-blended over the page: screen(bg, black) = bg, so
          // no tone-map-dependent seam, and later phases can draw a grid behind the sphere
          gl.setClearColor("#000000", 1);
        }}
      >
        <CameraFit />
        <ContextGuard onLost={onLost} onRestored={onRestored} />
        {!pinned && monitor ? <PerformanceMonitor flipflops={3} onDecline={onDecline} onFallback={onFallback} /> : null}
        <Suspense fallback={null}>
          <SphereRig look={look} coarsePointer={coarsePointer} timeOffset={timeOffset}>
            <Fragments look={look} budget={budget} onBuilt={onBuilt} timeOffset={timeOffset} />
            <Vortex look={look} budget={budget} timeOffset={timeOffset} />
            <CoreGlow look={look} timeOffset={timeOffset} />
            <Particles look={look} budget={budget} timeOffset={timeOffset} />
          </SphereRig>
          <Effects look={look} budget={budget} />
        </Suspense>
        <Telemetry tier={tier} fragments={fragments} onFps={setFps} onFirstFrame={onFirstFrame} />
      </Canvas>
      </div>
      {showDebug ? <DebugPanel tier={tier} onLook={setLook} onTier={setTier} stats={stats} /> : null}
      {!captureMode ? (
        <div className="pointer-events-none absolute right-4 bottom-4 select-none text-right font-mono text-[10px] uppercase tracking-[0.22em] text-fg-dim/70">
          core // phase 1 · tier {tier} · {fragments.toLocaleString()} fragments · {fps} fps
        </div>
      ) : null}
    </div>
  );
}
