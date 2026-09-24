"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";

/**
 * An empty box that tells the sphere where to sit: its rect becomes the sphere's
 * screen-space frame while the site is not in the detail phase.
 */
export default function SphereSlot({ className = "", style, fill = 0.92 }: { className?: string; style?: CSSProperties; fill?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const phase = useSiteStore((s) => s.phase);
  useEffect(() => {
    if (phase === "detail") return;
    const el = ref.current;
    if (!el) return;
    const push = () => {
      const r = el.getBoundingClientRect();
      useSphereStore.getState().setFrame({ x: r.left + r.width / 2, y: r.top + r.height / 2, size: Math.min(r.width, r.height) * fill });
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    window.addEventListener("resize", push);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", push);
    };
  }, [phase, fill]);
  return <div ref={ref} aria-hidden className={`pointer-events-none ${className}`} style={style} />;
}
