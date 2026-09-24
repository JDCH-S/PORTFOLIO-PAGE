"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { QualityTier } from "@/lib/tier";
import { DEFAULT_LOOK, TIER_BUDGETS, type SphereLook, type Tier } from "./config";
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
    cam.position.set(0, 0, 1 / (0.72 * limitHalf));
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function setInfoAutoReset(gl: import("three").WebGLRenderer, value: boolean) {
  gl.info.autoReset = value;
}

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
  const [look, setLook] = useState<SphereLook>(DEFAULT_LOOK);
  const [tier, setTier] = useState<Tier>(initialTier);
  const [fragments, setFragments] = useState(0);
  const [fps, setFps] = useState(0);
  const [visible, setVisible] = useState(false);
  const onFirstFrame = useCallback(() => setVisible(true), []);
  const budget = TIER_BUDGETS[tier];
  const stats = useMemo(() => ({ fragments, fps }), [fragments, fps]);
  const onBuilt = useCallback((n: number) => setFragments(n), []);
  const captureMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("capture");
  const showDebug = debug && !captureMode;

  return (
    <div
      className={`absolute inset-0 transition-opacity duration-700 ease-out ${visible ? "opacity-100" : "opacity-0"} ${className}`}
      data-tier={tier}
    >
      <Canvas
        dpr={[budget.dpr[0], Math.min(budget.dpr[1], dpr)]}
        camera={{ fov: 40, near: 0.1, far: 50, position: [0, 0, 3.8] }}
        gl={{ antialias: false, alpha: false, powerPreference: "high-performance", stencil: false, depth: false }}
        flat
        frameloop="always"
        style={{ background: "transparent" }}
        onCreated={({ gl }) => {
          gl.setClearColor("#04060f", 1);
        }}
      >
        <CameraFit />
        <Suspense fallback={null}>
          <SphereRig look={look} coarsePointer={coarsePointer}>
            <Fragments look={look} budget={budget} onBuilt={onBuilt} />
            <Vortex look={look} budget={budget} />
            <CoreGlow look={look} />
            <Particles look={look} budget={budget} />
          </SphereRig>
          <Effects look={look} budget={budget} />
        </Suspense>
        <Telemetry tier={tier} fragments={fragments} onFps={setFps} onFirstFrame={onFirstFrame} />
      </Canvas>
      {showDebug ? <DebugPanel tier={tier} onLook={setLook} onTier={setTier} stats={stats} /> : null}
      {!captureMode ? (
        <div className="pointer-events-none absolute right-4 bottom-4 select-none text-right font-mono text-[10px] uppercase tracking-[0.22em] text-fg-dim/70">
          core // phase 1 · tier {tier} · {fragments.toLocaleString()} fragments · {fps} fps
        </div>
      ) : null}
    </div>
  );
}
