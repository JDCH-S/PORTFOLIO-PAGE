"use client";

import { useEffect } from "react";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";

function sphereCentre() {
  const f = useSphereStore.getState().frame;
  return f ? { x: f.x, y: f.y } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** Leans and pulses the sphere toward whatever module or item is hovered or focused. */
export default function SphereLean() {
  useEffect(() => {
    return useSiteStore.subscribe((state, prev) => {
      if (state.hover === prev.hover) return;
      const sphere = useSphereStore.getState();
      if (!state.hover || state.phase === "detail") {
        sphere.setLeanTarget(0, 0);
        return;
      }
      const el = state.anchors[state.hover] ?? document.querySelector<HTMLElement>(`[data-item="${state.hover}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const c = sphereCentre();
      const dx = (r.left + r.width / 2 - c.x) / (window.innerWidth / 2);
      const dy = (r.top + r.height / 2 - c.y) / (window.innerHeight / 2);
      const len = Math.hypot(dx, dy) || 1;
      sphere.setLeanTarget((dx / len) * Math.min(1, len), (dy / len) * Math.min(1, len));
      sphere.pulseToward(dx / len, dy / len, 0.35);
    });
  }, []);
  return null;
}
