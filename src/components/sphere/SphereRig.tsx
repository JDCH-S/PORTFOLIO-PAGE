"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { spin, useSphereStore } from "./sphereStore";
import type { SphereLook } from "./config";

/**
 * The group that carries the whole sphere: cursor tilt (fine pointers) or device
 * orientation (touch), the drag-to-rotate spin with inertia, breathing, and the
 * imperative pulse/scale/offset targets from the store.
 */
export default function SphereRig({ look, coarsePointer, timeOffset = 0, children }: { look: SphereLook; coarsePointer: boolean; timeOffset?: number; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const size = useThree((s) => s.size);
  const target = useRef({ x: 0, y: 0 }); // normalised -1..1
  const orient = useRef<{ x: number; y: number; has: boolean }>({ x: 0, y: 0, has: false });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" || spin.active) return;
      target.current.x = (e.clientX / Math.max(1, size.width)) * 2 - 1;
      target.current.y = (e.clientY / Math.max(1, size.height)) * 2 - 1;
    };
    const onLeave = () => {
      if (!coarsePointer) {
        target.current.x = 0;
        target.current.y = 0;
      }
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      orient.current.has = true;
      orient.current.x = THREE.MathUtils.clamp(e.gamma / 35, -1, 1);
      orient.current.y = THREE.MathUtils.clamp((e.beta - 40) / 35, -1, 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    if (coarsePointer && typeof window.DeviceOrientationEvent !== "undefined") {
      window.addEventListener("deviceorientation", onOrient, { passive: true });
    }
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("deviceorientation", onOrient);
    };
  }, [size.width, size.height, coarsePointer]);

  const time = useRef(timeOffset);
  const curRef = useRef({ rx: 0, ry: 0, scale: 1, ox: 0, oy: 0 });

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const step = Math.min(dt, 0.05);       // simulation time (breathing)
    const real = Math.min(dt, 0.25);       // wall-clock for damping, so slow devices still converge
    time.current += step;
    const cur = curRef.current;
    const store = useSphereStore.getState();

    // tilt target: pointer (desktop) or device orientation (touch)
    let tx = target.current.x;
    let ty = target.current.y;
    if (coarsePointer && orient.current.has) {
      // low-pass the gyro so it never jitters
      target.current.x = THREE.MathUtils.damp(target.current.x, orient.current.x, 1.2, real);
      target.current.y = THREE.MathUtils.damp(target.current.y, orient.current.y, 1.2, real);
      tx = target.current.x;
      ty = target.current.y;
    }
    const lean = store.leanTarget;
    const pulse = store.pulse;
    const wantRy = (tx * 0.32 + lean[0] * 0.25 + store.pulseDir[0] * pulse * 0.2) * look.tilt;
    const wantRx = (ty * 0.22 + lean[1] * 0.18 + store.pulseDir[1] * pulse * 0.15) * look.tilt;
    cur.ry = THREE.MathUtils.damp(cur.ry, wantRy, 3.2, real);
    cur.rx = THREE.MathUtils.damp(cur.rx, wantRx, 3.2, real);

    // drag-to-rotate: direct while dragging, inertia with friction after release
    if (!spin.active) {
      spin.yaw += spin.vYaw * real;
      spin.pitch = THREE.MathUtils.clamp(spin.pitch + spin.vPitch * real, -1.1, 1.1);
      const friction = Math.exp(-real * 1.6);
      spin.vYaw *= friction;
      spin.vPitch *= friction;
      if (Math.abs(spin.vYaw) < 0.002) spin.vYaw = 0;
      if (Math.abs(spin.vPitch) < 0.002) spin.vPitch = 0;
      // pitch eases back toward level once the fling has died down
      if (spin.vPitch === 0) spin.pitch = THREE.MathUtils.damp(spin.pitch, 0, 0.6, real);
    }
    g.rotation.set(cur.rx + spin.pitch, cur.ry + spin.yaw, 0);

    // breathing + pulse
    const breathe = 1 + Math.sin(time.current * look.breatheSpeed * Math.PI * 2) * look.breatheAmount;
    const wantScale = store.scaleTarget * breathe * (1 + pulse * 0.06);
    cur.scale = THREE.MathUtils.damp(cur.scale, wantScale, 6, real);
    g.scale.setScalar(cur.scale);

    cur.ox = THREE.MathUtils.damp(cur.ox, store.offsetTarget[0], 4, real);
    cur.oy = THREE.MathUtils.damp(cur.oy, store.offsetTarget[1], 4, real);
    g.position.set(cur.ox, cur.oy, 0);

    if (pulse > 0.001) useSphereStore.setState({ pulse: pulse * Math.exp(-real * 2.4) });
  });

  return <group ref={group}>{children}</group>;
}
