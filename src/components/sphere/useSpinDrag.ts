"use client";

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { PITCH_LIMIT, SOFT_START, YAW_LIMIT } from "@/components/hologram/config";
import { spin, useSphereStore } from "./sphereStore";

/** a drag across the head's whole circle turns it ~110 degrees (so half the circle reaches the yaw limit), whatever its size on screen */
const TURN_PER_DIAMETER = 0.62 * Math.PI;
/** a coast faster than this is caught by a tap instead of the tap opening the menu */
const CATCH_SPEED = 2.5;
/** rubber-band integration step, radians (1 deg) */
const BAND_STEP = Math.PI / 180;

/**
 * Rubber band: inside SOFT_START of the limit a drag turns the head 1:1; beyond it, moving further out meets a
 * resistance that grows to a full stop at the limit (moving back in is always free).
 */
function band(cur: number, d: number, limit: number) {
  const soft = limit * SOFT_START;
  // sub-stepped (<= 1 deg per step): one fast pointer event can move 15 deg, almost the whole soft zone, and a single
  // step would evaluate the resistance only at its start and hit the hard stop without the band
  const n = Math.max(1, Math.ceil(Math.abs(d) / BAND_STEP));
  const h = d / n;
  let v = cur;
  for (let i = 0; i < n; i++) {
    const over = Math.min(1, Math.max(0, Math.abs(v) - soft) / (limit - soft));
    const k = h * v > 0 ? (1 - over) * (1 - over) : 1;
    v = Math.max(-limit, Math.min(limit, v + h * k));
  }
  return v;
}

export interface SpinDragOptions {
  /** allow vertical drag to pitch the head (off on touch, where vertical swipes scroll) */
  allowPitch?: boolean;
  /** called for a tap or click that did not turn into a drag */
  onTap?: () => void;
}

/**
 * Pointer handlers that turn the hologram by dragging (mouse or finger): clamped to about +-55 deg yaw and
 * +-25 deg pitch with a rubber band near the limits; on release it coasts and springs back to front (SphereRig).
 * A press that moves less than a few pixels counts as a tap.
 */
export function useSpinDrag({ allowPitch = true, onTap }: SpinDragOptions = {}) {
  const st = useRef({ id: -1, sx: 0, sy: 0, lx: 0, ly: 0, lt: 0, moved: false, vy: 0, vp: 0, k: 0.0085, slop: 5, caught: false });

  // if the target unmounts mid-drag (an item opened by keyboard), the head must not stay "held"
  useEffect(
    () => () => {
      spin.active = false;
    },
    [],
  );

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const s = st.current;
    s.id = e.pointerId;
    s.sx = s.lx = e.clientX;
    s.sy = s.ly = e.clientY;
    s.lt = performance.now();
    s.moved = false;
    s.vy = s.vp = 0;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const size = useSphereStore.getState().frame?.size ?? (w / Math.max(1, h) < 0.8 ? 0.88 : 0.72) * Math.min(w, h);
    s.k = Math.min(0.02, Math.max(0.004, TURN_PER_DIAMETER / Math.max(44, size)));
    s.slop = e.pointerType === "touch" ? 10 : 5;
    s.caught = Math.hypot(spin.vYaw, spin.vPitch) > CATCH_SPEED;
    spin.active = true;
    spin.vYaw = spin.vPitch = 0;
    if (s.caught) useSphereStore.getState().pulseToward(0, 0, 0.3);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const s = st.current;
      if (e.pointerId !== s.id || !spin.active) return;
      const now = performance.now();
      const dt = Math.max(1, now - s.lt) / 1000;
      const dx = e.clientX - s.lx;
      const dy = e.clientY - s.ly;
      if (!s.moved && Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > s.slop) {
        s.moved = true;
        // a pointer at rest says "click"; only an actual drag shows the grabbing hand
        e.currentTarget.style.cursor = "grabbing";
      }
      const y0 = spin.yaw;
      const p0 = spin.pitch;
      spin.yaw = band(spin.yaw, dx * s.k, YAW_LIMIT);
      if (allowPitch) spin.pitch = band(spin.pitch, dy * s.k, PITCH_LIMIT);
      // smoothed release velocity of the head itself (after the rubber band)
      s.vy = s.vy * 0.6 + ((spin.yaw - y0) / dt) * 0.4;
      s.vp = allowPitch ? s.vp * 0.6 + ((spin.pitch - p0) / dt) * 0.4 : 0;
      s.lx = e.clientX;
      s.ly = e.clientY;
      s.lt = now;
    },
    [allowPitch],
  );

  const end = useCallback(
    (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const s = st.current;
      if (e.pointerId !== s.id) return;
      s.id = -1;
      spin.active = false;
      e.currentTarget.style.cursor = "";
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      if (s.moved) {
        // stale velocity after a pause means the finger stopped: no fling
        const stale = performance.now() - s.lt > 120;
        spin.vYaw = stale ? 0 : Math.max(-4, Math.min(4, s.vy));
        spin.vPitch = stale ? 0 : Math.max(-3, Math.min(3, s.vp));
      } else if (!cancelled && !s.caught) {
        // a still press on a coasting head just catches it
        onTap?.();
      }
    },
    [onTap],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => end(e, false), [end]);
  const onPointerCancel = useCallback((e: ReactPointerEvent<HTMLElement>) => end(e, true), [end]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
