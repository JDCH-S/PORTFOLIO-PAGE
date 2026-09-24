"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { modules } from "@/content/content";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { useReducedMotion } from "@/lib/useMediaQuery";

interface Beam {
  id: string;
  d: string;
  end: { x: number; y: number };
  strong: boolean;
}

/** Which anchors the beams connect to in each view. */
function targets(view: string, active: string): { key: string; strong: boolean }[] {
  if (view === "menu") return modules.map((m) => ({ key: `opt-${m.id}`, strong: true }));
  if (view === "module") return [{ key: active, strong: true }, ...modules.filter((m) => m.id !== active).map((m) => ({ key: `opt-${m.id}`, strong: false }))];
  return [];
}

function measure(): Beam[] {
  const { anchors, view, activeModule } = useSiteStore.getState();
  const f = useSphereStore.getState().frame;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cx = f ? f.x : w / 2;
  const cy = f ? f.y : h / 2;
  const r = f ? f.size / 2 : (0.72 * Math.min(w, h)) / 2;
  const out: Beam[] = [];
  for (const t of targets(view, activeModule)) {
    const el = anchors[t.key];
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) continue;
    // nearest point on the panel edge to the sphere centre
    const ex = Math.min(Math.max(cx, rect.left), rect.right);
    const ey = Math.min(Math.max(cy, rect.top), rect.bottom);
    const dx = ex - cx;
    const dy = ey - cy;
    const len = Math.hypot(dx, dy) || 1;
    const sx = cx + (dx / len) * r * 0.98;
    const sy = cy + (dy / len) * r * 0.98;
    out.push({ id: t.key, d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${ex.toFixed(1)} ${ey.toFixed(1)}`, end: { x: ex, y: ey }, strong: t.strong });
  }
  return out;
}

/** Thin beams from the sphere to the options or the open module: drawn on, then flowing. */
export default function Beams() {
  const step = useSiteStore((s) => s.step);
  const phase = useSiteStore((s) => s.phase);
  const view = useSiteStore((s) => s.view);
  const anchors = useSiteStore((s) => s.anchors);
  const frame = useSphereStore((s) => s.frame);
  const reduced = useReducedMotion();
  const [beams, setBeams] = useState<Beam[]>([]);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setBeams(measure()));
    };
    update();
    // the sphere glides into its frame over ~0.5s; re-measure while it settles
    const settle = [120, 300, 600, 900].map((ms) => window.setTimeout(update, ms));
    window.addEventListener("resize", update);
    const ro = new ResizeObserver(update);
    Object.values(anchors).forEach((el) => el && ro.observe(el));
    return () => {
      cancelAnimationFrame(raf);
      settle.forEach((id) => window.clearTimeout(id));
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, [anchors, frame, step, view]);

  const drawn = step >= 4 && phase !== "detail";
  return (
    <svg aria-hidden className="pointer-events-none fixed inset-0 z-[5] h-full w-full">
      {beams.map((b, i) => (
        <g key={b.id}>
          <motion.path
            d={b.d}
            fill="none"
            stroke="var(--gold)"
            strokeWidth={1}
            initial={false}
            animate={drawn ? { pathLength: 1, opacity: b.strong ? 0.8 : 0.35 } : { pathLength: 0, opacity: 0 }}
            transition={reduced ? { duration: 0.2 } : { duration: 0.45, delay: i * 0.12, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ filter: "drop-shadow(0 0 6px var(--gold))" }}
          />
          {!reduced && b.strong ? (
            <path
              d={b.d}
              fill="none"
              stroke="var(--gold-hot)"
              strokeWidth={1.5}
              strokeDasharray="3 19"
              className="animate-[dash_1.4s_linear_infinite]"
              style={{ opacity: drawn ? 0.9 : 0, transition: "opacity 480ms var(--ease-out)" }}
            />
          ) : null}
          <circle cx={b.end.x} cy={b.end.y} r={2.2} fill="var(--gold)" style={{ opacity: drawn ? (b.strong ? 1 : 0.5) : 0, transition: "opacity 240ms var(--ease-out)" }} />
        </g>
      ))}
    </svg>
  );
}
