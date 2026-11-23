"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { rigPose, useSphereStore } from "@/components/sphere/sphereStore";
import type { HoloTier } from "./builder";
import { fillFor } from "./config";
import { createHologramObjects, type HoloFrameState, type HologramObjects, type HoloTune } from "./hologramObjects";
import { buildHologram, holoParams, isCancelled, type BuiltHologram } from "./loadHologram";

export interface HologramStats {
  tier: HoloTier;
  vertices: number;
  filaments: number;
  particles: number;
  drawCalls: number;
  buildMs: number;
  loadMs: number;
  wallMs: number;
  where: BuiltHologram["where"];
  bytes: number;
  gpuBytes: number;
  scanStep: number;
}

/**
 * Device px per world unit at the hero framing, quantised to the nearest power of 1.25: the builder picks the slice pitch
 * from it, so builds are reproducible across nearby window sizes and a resize only rebuilds on a real step up.
 */
function devBucket(width: number, height: number, dpr: number) {
  const v = ((fillFor(width, height) * Math.min(width, height)) / 2) * dpr;
  return +Math.pow(1.25, Math.round(Math.log(Math.max(1, v)) / Math.log(1.25))).toFixed(3);
}

/**
 * The holographic head inside the rig: geometry built in the worker for the tier (rebuilt off the main thread when
 * the tier drops, or when the canvas grows past the next slice-pitch bucket: a window maximised, a move to a DPR-2
 * screen; the old head stays on screen until the new one is compiled), then driven every frame from the
 * intro / pulse values in the store and the rig's pose.
 */
export default function FaceHologram({
  tier,
  pitchDpr,
  sharpen = false,
  tune,
  timeOffset = 0,
  frozen = false,
  onBuilt,
  onError,
}: {
  tier: HoloTier;
  /** the DPR the slice pitch is built for (the display's; the canvas may render above it to supersample) */
  pitchDpr?: number;
  /** the canvas renders above pitchDpr only for resolution (phones): footprints and glow stay the display's (see HoloFrameState) */
  sharpen?: boolean;
  tune: HoloTune;
  timeOffset?: number;
  /** capture mode: the clock stands still at timeOffset (and the LOD snaps) */
  frozen?: boolean;
  onBuilt: (stats: HologramStats) => void;
  onError: (err: unknown) => void;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const dprNow = useThree((s) => s.viewport.dpr);
  const bucket = devBucket(size.width, size.height, pitchDpr ? Math.min(pitchDpr, dprNow) : dprNow);
  // the pitch only ever gets finer: a smaller canvas (or a lower DPR from the performance monitor) keeps the head
  // (the LOD copes); a larger one rebuilds once the resize has settled
  const [buildBucket, setBuildBucket] = useState(bucket);
  useEffect(() => {
    if (bucket <= buildBucket) return;
    const id = setTimeout(() => setBuildBucket(bucket), 500);
    return () => clearTimeout(id);
  }, [bucket, buildBucket]);
  const [objs, setObjs] = useState<HologramObjects | null>(null);
  const tuneRef = useRef(tune);
  const cbs = useRef({ onBuilt, onError });
  useEffect(() => {
    cbs.current = { onBuilt, onError };
  }, [onBuilt, onError]);

  useEffect(() => {
    let alive = true;
    const params = holoParams();
    buildHologram({ tier, devPerWorld: buildBucket, params })
      .then(async (b) => {
        if (!alive) return;
        const o = createHologramObjects(b.out, b.world, b.meta, params);
        o.tune(tuneRef.current);
        // compile the four programs before the head is shown (parallel compile where the driver has it)
        await Promise.race([gl.compileAsync(o.group, camera, scene).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
        if (!alive) {
          o.dispose();
          return;
        }
        setObjs(o);
        const c = o.counts;
        cbs.current.onBuilt({
          tier,
          vertices: c.vertices,
          filaments: b.out.fil.count,
          particles: b.out.pts.count,
          drawCalls: 4,
          buildMs: Math.round(b.buildMs),
          loadMs: Math.round(b.loadMs),
          wallMs: Math.round(b.wallMs),
          where: b.where,
          bytes: b.bytes,
          gpuBytes: c.gpuBytes,
          scanStep: c.scanStep,
        });
      })
      .catch((err) => {
        if (!alive || isCancelled(err)) return;
        console.error("[hologram] build failed", err);
        cbs.current.onError(err);
      });
    return () => {
      alive = false;
    };
  }, [tier, buildBucket, gl, camera, scene]);

  // the previous head is freed once its replacement is in the scene (and on unmount)
  useEffect(() => () => objs?.dispose(), [objs]);

  useEffect(() => {
    tuneRef.current = tune;
    objs?.tune(tune);
  }, [tune, objs]);

  const time = useRef(timeOffset);
  const scaleV = useRef(new THREE.Vector3());
  // one state object, refilled every frame (no per-frame garbage)
  const frameState = useRef<HoloFrameState | null>(null);
  useFrame((state, dt) => {
    if (!objs) return;
    const step = frozen ? 0 : Math.min(dt, 0.05);
    time.current += step;
    const st = useSphereStore.getState();
    const cam = state.camera as THREE.PerspectiveCamera;
    objs.group.getWorldScale(scaleV.current);
    // world units per CSS px at view distance 1, and in the head's own units on its plane (LOD)
    const perDist = (2 * Math.tan((cam.fov * Math.PI) / 360)) / (Math.max(1, state.size.height) * cam.zoom);
    const camDist = Math.max(0.1, cam.position.z);
    const f = (frameState.current ??= { time: 0, dt: 0, assemble: 1, ignite: 1, converge: 1, pulse: 0, pxWorld: 1, pxWorldPerDist: 1, dpr: 1, ss: 1, sharpen: false, yaw: 0, pitch: 0, camera: cam });
    f.time = time.current;
    f.dt = step;
    f.assemble = st.assemble;
    f.ignite = st.ignite;
    f.converge = st.converge;
    f.pulse = st.pulse;
    f.pxWorld = (perDist * camDist) / Math.max(1e-4, scaleV.current.x);
    f.pxWorldPerDist = perDist;
    f.dpr = state.gl.getPixelRatio();
    f.ss = pitchDpr ? Math.max(1, f.dpr / pitchDpr) : 1;
    f.sharpen = sharpen;
    f.yaw = rigPose.yaw;
    f.pitch = rigPose.pitch;
    f.camera = cam;
    objs.update(f);
  });

  return objs ? <primitive object={objs.group} /> : null;
}
