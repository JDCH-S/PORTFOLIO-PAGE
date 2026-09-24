"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { aboutEntry, modules } from "@/content/content";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import Decode from "@/components/ui/Decode";

interface CalloutSpec {
  id: ModuleId;
  index: string;
  title: string;
  count?: number;
  blurb: string;
  /** angle on screen, degrees, clockwise from +x (y down) */
  angle: number;
  muted?: boolean;
}

const SPECS: CalloutSpec[] = [
  { ...modules[0], count: modules[0].items.length, angle: 200 },
  { ...modules[1], count: modules[1].items.length, angle: 340 },
  { ...modules[3], count: modules[3].items.length, angle: 160 },
  { ...modules[2], count: modules[2].items.length, angle: 20 },
  { ...aboutEntry, angle: 90, muted: true },
];

const ELBOW = 44; // leader length from the rim to the elbow
const ARM = 26; // horizontal arm from the elbow to the text

interface Geo {
  id: ModuleId;
  rim: { x: number; y: number };
  elbow: { x: number; y: number };
  side: "left" | "right" | "bottom";
  label: { x: number; y: number };
}

function layout(frame: { x: number; y: number; size: number } | null, w: number, h: number): Geo[] {
  const aspect = w / Math.max(1, h);
  const size = frame ? frame.size : (aspect < 0.8 ? 0.88 : 0.72) * Math.min(w, h);
  const cx = frame ? frame.x : w / 2;
  const cy = frame ? frame.y : h / 2;
  const r = size / 2;
  return SPECS.map((s) => {
    const a = (s.angle * Math.PI) / 180;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const rim = { x: cx + ux * r * 0.985, y: cy + uy * r * 0.985 };
    const elbow = { x: cx + ux * (r + ELBOW), y: cy + uy * (r + ELBOW) };
    const side: Geo["side"] = s.angle === 90 ? "bottom" : ux < 0 ? "left" : "right";
    const label = side === "bottom" ? { x: elbow.x, y: elbow.y + 10 } : { x: elbow.x + (side === "right" ? ARM : -ARM), y: elbow.y };
    return { id: s.id, rim, elbow, side, label };
  });
}

/**
 * The menu: five callouts attached to the hologram's rim by leader lines, the way an
 * instrument labels a specimen. Text only: index, title, count, and a blurb on hover.
 */
export default function MenuCallouts() {
  const step = useSiteStore((s) => s.step);
  const view = useSiteStore((s) => s.view);
  const hover = useSiteStore((s) => s.hover);
  const setHover = useSiteStore((s) => s.setHover);
  const setAnchor = useSiteStore((s) => s.setAnchor);
  const openModule = useSiteStore((s) => s.openModule);
  const frame = useSphereStore((s) => s.frame);
  const reduced = useReducedMotion();
  const [geo, setGeo] = useState<Geo[]>([]);

  useEffect(() => {
    const update = () => setGeo(layout(useSphereStore.getState().frame, window.innerWidth, window.innerHeight));
    update();
    // the sphere glides into its frame; re-measure while it settles
    const settle = [150, 350, 650].map((ms) => window.setTimeout(update, ms));
    window.addEventListener("resize", update);
    return () => {
      settle.forEach((id) => window.clearTimeout(id));
      window.removeEventListener("resize", update);
    };
  }, [frame, view]);

  const shown = view === "menu" && step >= 4;
  const anchorFor = useCallback((id: ModuleId) => (el: HTMLElement | null) => setAnchor(`opt-${id}`, el), [setAnchor]);

  return (
    <div className="pointer-events-none fixed inset-0 z-20" aria-hidden={!shown}>
      <svg className="absolute inset-0 h-full w-full">
        {geo.map((g, i) => {
          const spec = SPECS[i];
          const on = hover === `opt-${g.id}`;
          const arm = g.side === "bottom" ? "" : ` L ${g.label.x} ${g.elbow.y}`;
          return (
            <g key={g.id}>
              <motion.path
                d={`M ${g.rim.x} ${g.rim.y} L ${g.elbow.x} ${g.elbow.y}${arm}`}
                fill="none"
                stroke={on ? "var(--gold-hot)" : spec.muted ? "var(--steel)" : "var(--gold)"}
                strokeWidth={1}
                initial={false}
                animate={shown ? { pathLength: 1, opacity: on ? 1 : 0.7 } : { pathLength: 0, opacity: 0 }}
                transition={reduced ? { duration: 0.2 } : { duration: 0.4, delay: i * 0.07, ease: [0.2, 0.8, 0.2, 1] }}
                style={{ filter: on ? "drop-shadow(0 0 5px var(--gold))" : undefined }}
              />
              <circle cx={g.rim.x} cy={g.rim.y} r={on ? 3 : 2} fill={spec.muted ? "var(--steel)" : "var(--gold)"} style={{ opacity: shown ? 1 : 0, transition: "opacity 240ms var(--ease-out)" }} />
            </g>
          );
        })}
      </svg>
      {geo.map((g, i) => {
        const spec = SPECS[i];
        const key = `opt-${g.id}`;
        const on = hover === key;
        const right = g.side === "right";
        const bottom = g.side === "bottom";
        return (
          <motion.button
            key={g.id}
            ref={anchorFor(g.id)}
            type="button"
            data-option={g.id}
            onClick={() => openModule(g.id)}
            onMouseEnter={() => setHover(key)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(key)}
            onBlur={() => setHover(null)}
            tabIndex={shown ? 0 : -1}
            initial={false}
            animate={shown ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: reduced ? 0.2 : 0.3, delay: reduced ? 0 : 0.15 + i * 0.07 }}
            className={`absolute flex min-h-11 flex-col justify-center rounded-[2px] px-2 py-1 outline-offset-4 ${shown ? "pointer-events-auto" : "pointer-events-none"} ${
              bottom ? "-translate-x-1/2 items-center text-center" : right ? "items-start text-left" : "-translate-x-full items-end text-right"
            } ${bottom ? "" : "-translate-y-1/2"}`}
            style={{ left: g.label.x, top: g.label.y }}
          >
            <span className="flex items-baseline gap-3">
              <span className="label text-steel-dim">{spec.index}</span>
              <Decode
                text={spec.title.toUpperCase()}
                active={shown}
                reduced={reduced}
                duration={550}
                className={`font-display font-semibold tracking-[0.14em] transition-colors duration-[240ms] ${spec.muted ? "text-[14px] leading-[20px]" : "text-[20px] leading-[26px]"} ${
                  on ? "text-gold-hot" : spec.muted ? "text-steel" : "text-gold"
                }`}
              />
              {spec.count !== undefined ? <span className="label text-steel">{String(spec.count).padStart(2, "0")}</span> : null}
            </span>
            <span className={`label max-w-[260px] text-steel transition-opacity duration-[240ms] ${on ? "opacity-100" : "opacity-0"}`} style={{ textTransform: "none", letterSpacing: "0.02em", fontSize: 12, lineHeight: "18px" }}>
              {spec.blurb}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
