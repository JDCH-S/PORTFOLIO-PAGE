"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSphereStore } from "./sphereStore";
import type { SphereLook } from "./config";

/**
 * The group that carries the whole sphere: pointer / orientation tilt,
 * breathing pulse, and the imperative pulse/scale/offset targets from the store.
 */
export default function SphereRig({ look, coarsePointer, timeOffset = 0, children }: { look: SphereLook; coarsePointer: boolean; timeOffset?: number; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const size = useThree((s) => s.size);
  const target = useRef({ x: 0, y: 0 }); // normalised -1..1
  const drag = useRef<{ active: boolean; id: number; x: number; y: number; tx: number; ty: number }>({ active: false, id: -1, x: 0, y: 0, tx: 0, ty: 0 });
  const orient = useRef<{ x: number; y: number; has: boolean }>({ x: 0, y: 0, has: false });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (drag.current.active) {
        if (e.pointerId !== drag.current.id) return;
        const dx = (e.clientX - drag.current.x) / Math.max(1, size.width);
        const dy = (e.clientY - drag.current.y) / Math.max(1, size.height);
        target.current.x = THREE.MathUtils.clamp(drag.current.tx + dx * 3, -1.4, 1.4);
        target.current.y = THREE.MathUtils.clamp(drag.current.ty + dy * 3, -1.4, 1.4);
        return;
      }
      if (e.pointerType === "touch") return; // touch without drag: leave to orientation
      target.current.x = (e.clientX / Math.max(1, size.width)) * 2 - 1;
      target.current.y = (e.clientY / Math.max(1, size.height)) * 2 - 1;
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      drag.current = { active: true, id: e.pointerId, x: e.clientX, y: e.clientY, tx: target.current.x, ty: target.current.y };
    };
    const onUp = (e: PointerEvent) => {
      if (drag.current.active && e.pointerId === drag.current.id) drag.current.active = false;
    };
    const onLeave = () => {
      if (!coarsePointer) { target.current.x = 0; target.current.y = 0; }
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      orient.current.has = true;
      orient.current.x = THREE.MathUtils.clamp(e.gamma / 35, -1, 1);
      orient.current.y = THREE.MathUtils.clamp((e.beta - 40) / 35, -1, 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    if (coarsePointer && typeof window.DeviceOrientationEvent !== "undefined") {
      window.addEventListener("deviceorientation", onOrient, { passive: true });
    }
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("deviceorientation", onOrient);
    };
  }, [size.width, size.height, coarsePointer]);

  const time = useRef(timeOffset);
  const curRef = useRef({ rx: 0, ry: 0, scale: 1, ox: 0, oy: 0 });

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const step = Math.min(dt, 0.05);
    time.current += step;
    const cur = curRef.current;
    const store = useSphereStore.getState();

    // tilt target: pointer (desktop / drag) or device orientation (mobile, when not dragging)
    let tx = target.current.x;
    let ty = target.current.y;
    if (coarsePointer && !drag.current.active && orient.current.has) {
      tx = orient.current.x;
      ty = orient.current.y;
    }
    if (coarsePointer && !drag.current.active) {
      // spring back gently after a drag on touch devices
      target.current.x = THREE.MathUtils.damp(target.current.x, orient.current.has ? orient.current.x : 0, 1.2, step);
      target.current.y = THREE.MathUtils.damp(target.current.y, orient.current.has ? orient.current.y : 0, 1.2, step);
    }
    const lean = store.leanTarget;
    const pulse = store.pulse;
    const wantRy = (tx * 0.32 + lean[0] * 0.25 + store.pulseDir[0] * pulse * 0.2) * look.tilt;
    const wantRx = (ty * 0.22 + lean[1] * 0.18 + store.pulseDir[1] * pulse * 0.15) * look.tilt;
    cur.ry = THREE.MathUtils.damp(cur.ry, wantRy, 3.2, step);
    cur.rx = THREE.MathUtils.damp(cur.rx, wantRx, 3.2, step);
    g.rotation.set(cur.rx, cur.ry, 0);

    // breathing + pulse
    const breathe = 1 + Math.sin(time.current * look.breatheSpeed * Math.PI * 2) * look.breatheAmount;
    const wantScale = store.scaleTarget * breathe * (1 + pulse * 0.06);
    cur.scale = THREE.MathUtils.damp(cur.scale, wantScale, 6, step);
    g.scale.setScalar(cur.scale);

    cur.ox = THREE.MathUtils.damp(cur.ox, store.offsetTarget[0], 4, step);
    cur.oy = THREE.MathUtils.damp(cur.oy, store.offsetTarget[1], 4, step);
    g.position.set(cur.ox, cur.oy, 0);

    if (pulse > 0.001) useSphereStore.setState({ pulse: pulse * Math.exp(-step * 2.4) });
  });

  return <group ref={group}>{children}</group>;
}
