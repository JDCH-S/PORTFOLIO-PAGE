"use client";

import { useCallback, useEffect, useState } from "react";
import { m } from "framer-motion";
import { sections } from "@/content/content";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import Decode from "@/components/ui/Decode";
import { rovingKeys } from "@/lib/roving";
import { navLink, openSection } from "@/lib/nav";

/** where each callout hangs off the rim (degrees, clockwise from +x); DOM and Tab order stay 01..05 */
const ANGLE: Record<ModuleId, number> = { projects: 210, agents: 330, skills: 30, systems: 150, about: 90 };
const SPECS = sections.map((sec) => ({ ...sec, angle: ANGLE[sec.id] }));
/** arrow keys go clockwise around the ring, starting top-left */
const CLOCKWISE = (Object.keys(ANGLE) as ModuleId[]).sort((a, b) => ((ANGLE[a] - 210 + 360) % 360) - ((ANGLE[b] - 210 + 360) % 360));

const ELBOW = 36; // leader length from the rim to the elbow
const ARM = 22; // horizontal arm from the elbow to the text

interface Geo {
  id: ModuleId;
  rim: { x: number; y: number };
  elbow: { x: number; y: number };
  side: "left" | "right" | "bottom";
  label: { x: number; y: number };
  angle: number;
  /** no room for the hover blurb above the footer: it stays for screen readers only */
  tight: boolean;
}

function layout(frame: { x: number; y: number; size: number } | null, w: number, h: number, footerTop: number): Geo[] {
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
    // on short viewports the bottom callout's leader shortens so its title, hint and blurb
    // (about 90px below the elbow) stay above the footer rule
    if (side === "bottom") elbow.y = Math.max(rim.y + 10, Math.min(elbow.y, footerTop - 100));
    const label = side === "bottom" ? { x: elbow.x, y: elbow.y + 8 } : { x: elbow.x + (side === "right" ? ARM + 6 : -(ARM + 6)), y: elbow.y };
    const tight = side === "bottom" && footerTop - elbow.y < 96;
    return { id: s.id, rim, elbow, side, label, angle: s.angle, tight };
  });
}

const GLOW = "0 0 12px var(--gold-glow), 0 0 2px rgba(255,178,63,0.45)";
const GLOW_HOT = "0 0 16px var(--gold-glow), 0 0 3px rgba(255,236,200,0.6)";

/**
 * The menu: five callouts attached to the hologram's rim by leader lines, the way an
 * instrument labels a specimen. Text only: index, title, count and a few plain words;
 * the blurb on hover or focus. The section the visitor was last in stays lit.
 */
export default function MenuCallouts() {
  const step = useSiteStore((s) => s.step);
  const view = useSiteStore((s) => s.view);
  const hover = useSiteStore((s) => s.hover);
  const setHover = useSiteStore((s) => s.setHover);
  const setAnchor = useSiteStore((s) => s.setAnchor);
  const lastModule = useSiteStore((s) => s.lastModule);
  const frame = useSphereStore((s) => s.frame);
  const reduced = useReducedMotion();
  const [geo, setGeo] = useState<Geo[]>([]);
  // focus keeps its indicator even when the mouse moves over another option
  const [focusKey, setFocusKey] = useState<string | null>(null);

  useEffect(() => {
    // while hidden the geometry stays put, so the leaders retract where they were drawn
    if (view !== "menu") return;
    const update = () => {
      const footerTop = document.querySelector("footer")?.getBoundingClientRect().top ?? window.innerHeight;
      setGeo(layout(useSphereStore.getState().frame, window.innerWidth, window.innerHeight, footerTop));
    };
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
    <nav
      id="sections-ring"
      aria-label="Sections"
      className="pointer-events-none fixed inset-0 z-20"
      aria-hidden={!shown}
      inert={!shown}
      onKeyDown={rovingKeys("[data-option]", CLOCKWISE)}
    >
      <svg aria-hidden className="absolute inset-0 h-full w-full">
        <defs>
          {geo.map((g) => (
            <linearGradient key={g.id} id={`lead-${g.id}`} gradientUnits="userSpaceOnUse" x1={g.rim.x} y1={g.rim.y} x2={g.label.x} y2={g.label.y}>
              <stop offset="0" stopColor="var(--gold-deep)" stopOpacity={0.95} />
              <stop offset="1" stopColor="var(--gold)" stopOpacity={0.65} />
            </linearGradient>
          ))}
        </defs>
        {geo.map((g, i) => {
          const on = hover === `opt-${g.id}` || focusKey === `opt-${g.id}` || lastModule === g.id;
          const arm = g.side === "bottom" ? "" : ` L ${g.label.x} ${g.elbow.y}`;
          return (
            <g key={g.id}>
              <m.path
                d={`M ${g.rim.x} ${g.rim.y} L ${g.elbow.x} ${g.elbow.y}${arm}`}
                fill="none"
                stroke={on ? "var(--gold-hot)" : `url(#lead-${g.id})`}
                strokeWidth={1}
                initial={false}
                animate={shown ? { pathLength: 1, opacity: on ? 1 : 0.85 } : { pathLength: 0, opacity: 0 }}
                transition={reduced ? { duration: 0.2 } : shown ? { duration: 0.4, delay: i * 0.07, ease: [0.2, 0.8, 0.2, 1] } : { duration: 0.3, delay: i * 0.04, ease: [0.2, 0.8, 0.2, 1] }}
                style={{ filter: on ? "drop-shadow(0 0 6px var(--gold))" : "drop-shadow(0 0 4px var(--gold-glow))" }}
              />
              {/* a data shard where the leader leaves the rim */}
              <rect
                x={g.rim.x - 1.75}
                y={g.rim.y - 1.75}
                width={3.5}
                height={3.5}
                fill={on ? "var(--gold-hot)" : "var(--gold)"}
                transform={`rotate(${g.angle} ${g.rim.x} ${g.rim.y})`}
                style={{ opacity: shown ? 1 : 0, transition: "opacity 240ms var(--ease-out)", filter: on ? "drop-shadow(0 0 6px var(--gold))" : undefined }}
              />
            </g>
          );
        })}
      </svg>
      {geo.map((g, i) => {
        const spec = SPECS[i];
        const key = `opt-${g.id}`;
        const active = hover === key || focusKey === key;
        const on = active || lastModule === g.id;
        const right = g.side === "right";
        const bottom = g.side === "bottom";
        const link = navLink({ depth: 2, section: g.id }, () => openSection(g.id));
        const align = bottom ? "left-1/2 -translate-x-1/2 text-center" : right ? "left-0 text-left" : "right-0 text-right";
        return (
          <m.a
            key={g.id}
            ref={anchorFor(g.id)}
            href={link.href}
            onClick={link.onClick}
            data-option={g.id}
            onMouseEnter={() => setHover(key)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => {
              setHover(key);
              setFocusKey(key);
            }}
            onBlur={() => {
              setHover(null);
              setFocusKey(null);
            }}
            aria-label={spec.count !== undefined ? `${spec.title}, ${spec.count} ${spec.count === 1 ? "item" : "items"}` : spec.title}
            aria-describedby={`opt-${g.id}-blurb`}
            tabIndex={shown ? 0 : -1}
            initial={false}
            animate={shown ? { opacity: 1 } : { opacity: 0 }}
            transition={reduced ? { duration: 0.2 } : shown ? { duration: 0.3, delay: 0.15 + i * 0.07 } : { duration: 0.16 }}
            className={`absolute flex h-11 items-center outline-none ${shown ? "pointer-events-auto" : "pointer-events-none"} ${
              bottom ? "-translate-x-1/2" : right ? "" : "-translate-x-full"
            } ${bottom ? "" : "-translate-y-1/2"}`}
            style={{ left: g.label.x, top: g.label.y }}
          >
            {/* title row sits exactly on the leader's arm; the hint and blurb hang below it, out of flow */}
            <span className="relative flex items-baseline gap-3">
              <span className="label text-steel-dim">{spec.index}</span>
              <Decode
                text={spec.title.toUpperCase()}
                active={shown}
                reduced={reduced}
                duration={550}
                className={`font-display text-[15px] leading-[20px] font-medium tracking-[0.22em] transition-colors duration-[240ms] ${on ? "text-gold-hot" : "text-gold"}`}
                style={{ textShadow: on ? GLOW_HOT : GLOW }}
              />
              {spec.count !== undefined ? <span className="label text-steel">{String(spec.count).padStart(2, "0")}</span> : null}
              {/* focus / hover rule under the title */}
              <span
                aria-hidden
                className="absolute -bottom-1 h-px bg-gold transition-[width,opacity] duration-[240ms]"
                style={{ [right || bottom ? "left" : "right"]: 0, width: active ? "100%" : 0, opacity: active ? 1 : 0 }}
              />
              <span className={`absolute top-full mt-2 flex w-max max-w-[260px] flex-col gap-1 ${align}`}>
                {/* a few plain words, always there on wide screens */}
                <span aria-hidden className="label hidden whitespace-nowrap text-steel min-[1100px]:block">
                  {spec.hint}
                </span>
                <span id={`opt-${g.id}-blurb`} className={`font-mono text-[12px] leading-[18px] text-steel transition-opacity duration-[240ms] ${g.tight ? "sr-only" : active ? "opacity-100" : "opacity-0"}`}>
                  {spec.blurb}
                </span>
              </span>
            </span>
          </m.a>
        );
      })}
    </nav>
  );
}
