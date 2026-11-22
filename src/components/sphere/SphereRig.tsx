"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { PITCH_LIMIT, SWAY, YAW_LIMIT } from "@/components/hologram/config";
import { rigPose, spin, useSphereStore } from "./sphereStore";
import type { SphereLook } from "./config";

/** spring that pulls a released drag back to front: stiffness (1/s^2) and damping ratio (a touch under critical) */
const SPRING_K = 22;
const SPRING_ZETA = 0.82;

/**
 * Adds the lean + sway offset to the drag angle without passing the limit. The drag itself is already rubber-banded
 * into the limit (useSpinDrag), so it passes through unchanged (one soft limit, not two); the offset gets the room
 * left toward the limit and eases into it (tanh: ~identity while there is room, never past it).
 */
function addWithin(base: number, extra: number, limit: number) {
  const room = extra * base >= 0 ? limit - Math.abs(base) : limit + Math.abs(base);
  if (room <= 1e-6) return base;
  return base + Math.sign(extra) * room * Math.tanh(Math.abs(extra) / room);
}

/**
 * The group that carries the head: a small cursor lean (fine pointers) or device-orientation lean (touch), the
 * clamped drag-to-turn with inertia and a spring back to front, an idle sway, a faint breathing scale, and the
 * imperative pulse/scale/offset targets from the store. When the head is parked off-centre it is turned to face the
 * camera, so it always reads front-on (a perspective camera would otherwise show the side of an off-axis head).
 */
export default function SphereRig({
  look,
  coarsePointer,
  timeOffset = 0,
  frozen = false,
  children,
}: {
  look: SphereLook;
  coarsePointer: boolean;
  timeOffset?: number;
  /** capture mode: the clock stands still at timeOffset */
  frozen?: boolean;
  children: ReactNode;
}) {
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

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const step = frozen ? 0 : Math.min(dt, 0.05); // simulation time (breathing, sway)
    const real = Math.min(dt, 0.25); // wall-clock for damping, so slow devices still converge
    time.current += step;
    const t = time.current;
    const cur = curRef.current;
    const store = useSphereStore.getState();

    // lean target: pointer (desktop) or device orientation (touch); a face only leans a few degrees
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
    const wantRy = (tx * 0.1 + lean[0] * 0.08 + store.pulseDir[0] * pulse * 0.06) * look.tilt;
    const wantRx = (ty * 0.06 + lean[1] * 0.05 + store.pulseDir[1] * pulse * 0.05) * look.tilt;
    cur.ry = THREE.MathUtils.damp(cur.ry, wantRy, 3.2, real);
    cur.rx = THREE.MathUtils.damp(cur.rx, wantRx, 3.2, real);

    // drag-to-turn: direct (rubber-banded in useSpinDrag) while held; released, the fling coasts on a spring that
    // brings the head back to front (sub-stepped so a long frame cannot destabilise it)
    if (!spin.active) {
      const braking = performance.now() < spin.brakeUntil;
      const k = braking ? SPRING_K * 2.5 : SPRING_K;
      const c = 2 * SPRING_ZETA * Math.sqrt(k);
      const n = Math.max(1, Math.ceil(real / 0.012));
      const h = real / n;
      for (let i = 0; i < n; i++) {
        spin.vYaw += (-k * spin.yaw - c * spin.vYaw) * h;
        spin.vPitch += (-k * spin.pitch - c * spin.vPitch) * h;
        spin.yaw += spin.vYaw * h;
        spin.pitch += spin.vPitch * h;
      }
      // the limits hold during the coast too: a fling into a limit stops there
      if (Math.abs(spin.yaw) > YAW_LIMIT) {
        spin.yaw = Math.sign(spin.yaw) * YAW_LIMIT;
        if (spin.vYaw * spin.yaw > 0) spin.vYaw = 0;
      }
      if (Math.abs(spin.pitch) > PITCH_LIMIT) {
        spin.pitch = Math.sign(spin.pitch) * PITCH_LIMIT;
        if (spin.vPitch * spin.pitch > 0) spin.vPitch = 0;
      }
      if (Math.abs(spin.yaw) < 1e-4 && Math.abs(spin.vYaw) < 1e-3) spin.yaw = spin.vYaw = 0;
      if (Math.abs(spin.pitch) < 1e-4 && Math.abs(spin.vPitch) < 1e-3) spin.pitch = spin.vPitch = 0;
    }
    // (a non-finite pose would never recover through the springs, and would reach every shader as a NaN transform)
    if (!Number.isFinite(spin.yaw + spin.pitch + spin.vYaw + spin.vPitch)) spin.yaw = spin.pitch = spin.vYaw = spin.vPitch = 0;
    if (!Number.isFinite(cur.rx + cur.ry)) cur.rx = cur.ry = 0;

    // idle sway: the head is alive, never turning far
    const swayYaw = SWAY.yaw * look.sway * Math.sin(t * SWAY.yawRate);
    const swayPitch = SWAY.pitch * look.sway * Math.sin(t * SWAY.pitchRate);
    const yaw = addWithin(spin.yaw, cur.ry + swayYaw, YAW_LIMIT);
    const pitch = addWithin(spin.pitch, cur.rx + swayPitch, PITCH_LIMIT);
    rigPose.yaw = yaw;
    rigPose.pitch = pitch;

    cur.ox = THREE.MathUtils.damp(cur.ox, store.offsetTarget[0], 4, real);
    cur.oy = THREE.MathUtils.damp(cur.oy, store.offsetTarget[1], 4, real);
    if (!Number.isFinite(cur.ox + cur.oy)) cur.ox = cur.oy = 0;
    g.position.set(cur.ox, cur.oy, 0);
    // face the camera wherever the head is parked
    const camZ = Math.max(0.1, state.camera.position.z);
    const faceYaw = Math.atan2(-cur.ox, camZ);
    const facePitch = Math.atan2(cur.oy, Math.hypot(camZ, cur.ox));
    g.rotation.set(pitch + facePitch, yaw + faceYaw, 0);

    // breathing + pulse
    const breathe = 1 + Math.sin(t * look.breatheSpeed * Math.PI * 2) * look.breatheAmount;
    const wantScale = store.scaleTarget * breathe * (1 + pulse * 0.04);
    cur.scale = THREE.MathUtils.damp(cur.scale, wantScale, 6, real);
    if (!(Number.isFinite(cur.scale) && cur.scale > 0)) cur.scale = Number.isFinite(wantScale) && wantScale > 0 ? wantScale : 1;
    g.scale.setScalar(cur.scale);

    if (pulse > 0.001) useSphereStore.setState({ pulse: pulse * Math.exp(-real * 2.4) });
  });

  return <group ref={group}>{children}</group>;
}
