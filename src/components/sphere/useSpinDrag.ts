"use client";

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { spin, useSphereStore } from "./sphereStore";

/** a drag across the sphere's diameter turns it three quarters, whatever its size on screen */
const TURN_PER_DIAMETER = 1.5 * Math.PI;
/** a coast faster than this is caught by a tap instead of the tap opening the menu */
const CATCH_SPEED = 1.2;

export interface SpinDragOptions {
  /** allow vertical drag to pitch the sphere (off on touch, where vertical swipes scroll) */
  allowPitch?: boolean;
  /** called for a tap or click that did not turn into a drag */
  onTap?: () => void;
}

/**
 * Pointer handlers that rotate the hologram by dragging (mouse or finger) with inertia
 * on release. A press that moves less than a few pixels counts as a tap.
 */
export function useSpinDrag({ allowPitch = true, onTap }: SpinDragOptions = {}) {
  const st = useRef({ id: -1, sx: 0, sy: 0, lx: 0, ly: 0, lt: 0, moved: false, vy: 0, vp: 0, k: 0.0085, slop: 5, caught: false });

  // if the target unmounts mid-drag (an item opened by keyboard), the sphere must not stay "held"
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
      if (!s.moved && Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > s.slop) s.moved = true;
      spin.yaw += dx * s.k;
      if (allowPitch) spin.pitch = Math.max(-1.1, Math.min(1.1, spin.pitch + dy * s.k));
      // smoothed release velocity
      s.vy = s.vy * 0.6 + ((dx * s.k) / dt) * 0.4;
      s.vp = allowPitch ? s.vp * 0.6 + ((dy * s.k) / dt) * 0.4 : 0;
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
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      if (s.moved) {
        // stale velocity after a pause means the finger stopped: no fling
        const stale = performance.now() - s.lt > 120;
        spin.vYaw = stale ? 0 : Math.max(-6, Math.min(6, s.vy));
        spin.vPitch = stale ? 0 : Math.max(-6, Math.min(6, s.vp));
      } else if (!cancelled && !s.caught) {
        // a still press on a coasting sphere just catches it
        onTap?.();
      }
    },
    [onTap],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => end(e, false), [end]);
  const onPointerCancel = useCallback((e: ReactPointerEvent<HTMLElement>) => end(e, true), [end]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
