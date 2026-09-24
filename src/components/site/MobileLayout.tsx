"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, type PanInfo } from "framer-motion";
import { modules, profile } from "@/content/content";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import Decode from "@/components/ui/Decode";
import Telemetry from "@/components/hud/Telemetry";
import ProjectsModule from "@/components/modules/ProjectsModule";
import AgentsModule from "@/components/modules/AgentsModule";
import SystemsModule from "@/components/modules/SystemsModule";

const ORDER: ModuleId[] = ["projects", "agents", "systems"];
const EMBLEM = 40;

/**
 * Mobile: compact sphere hero that shrinks into the sticky header's emblem on scroll,
 * then three swipeable tabs with a sticky tab bar. The detail view is a bottom sheet.
 */
export default function MobileLayout() {
  const step = useSiteStore((s) => s.step);
  const phase = useSiteStore((s) => s.phase);
  const active = useSiteStore((s) => s.activeModule);
  const setActive = useSiteStore((s) => s.setActiveModule);
  const reduced = useReducedMotion();
  const hero = useRef<HTMLDivElement>(null);
  const emblem = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // sphere framing: follow the hero, then interpolate into the header emblem while scrolling
  useEffect(() => {
    if (phase === "detail") return;
    const push = () => {
      const h = hero.current;
      const e = emblem.current;
      if (!h || !e) return;
      const hr = h.getBoundingClientRect();
      const er = e.getBoundingClientRect();
      const span = Math.max(1, hr.height);
      const p = Math.min(1, Math.max(0, -hr.top / span));
      const t = 1 - Math.pow(1 - p, 2);
      const heroSize = Math.min(hr.width, hr.height) * 0.92;
      useSphereStore.getState().setFrame({
        x: hr.left + hr.width / 2 + (er.left + er.width / 2 - (hr.left + hr.width / 2)) * t,
        y: hr.top + hr.height / 2 + (er.top + er.height / 2 - (hr.top + hr.height / 2)) * t,
        size: heroSize + (EMBLEM - heroSize) * t,
      });
      setWidth(track.current?.clientWidth ?? window.innerWidth);
    };
    push();
    window.addEventListener("scroll", push, { passive: true });
    window.addEventListener("resize", push);
    return () => {
      window.removeEventListener("scroll", push);
      window.removeEventListener("resize", push);
    };
  }, [phase]);

  const index = ORDER.indexOf(active);
  const go = useCallback(
    (i: number) => {
      const next = ORDER[Math.min(ORDER.length - 1, Math.max(0, i))];
      setActive(next);
      useSphereStore.getState().pulseToward(i > index ? 1 : -1, 0, 0.4);
    },
    [index, setActive],
  );
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const swipe = info.offset.x + info.velocity.x * 0.2;
    if (swipe < -60) go(index + 1);
    else if (swipe > 60) go(index - 1);
  };

  return (
    <div className="relative z-10 min-h-dvh">
      {/* sticky header: emblem + name + tabs */}
      <header
        className="glass sticky top-0 z-20 border-b border-steel-line transition-opacity duration-[480ms]"
        style={{ opacity: step >= 2 ? 1 : 0, paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="flex items-center gap-3 px-4 py-2">
          <div ref={emblem} data-emblem aria-hidden className="h-10 w-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <Decode as="h1" text={profile.name.toUpperCase()} active={step >= 3} reduced={reduced} className="truncate font-display text-[15px] leading-[20px] font-semibold tracking-[0.06em] text-gold-hot" />
            <p className="label truncate text-steel">{profile.role}</p>
          </div>
        </div>
        <nav aria-label="Modules" className="grid grid-cols-3 border-t border-steel-line">
          {modules.map((m, i) => {
            const on = m.id === active;
            return (
              <button
                key={m.id}
                type="button"
                aria-current={on ? "true" : undefined}
                onClick={() => go(i)}
                className={`label flex h-11 items-center justify-center gap-2 border-b-2 transition-colors ${on ? "border-gold text-gold-hot" : "border-transparent text-steel"}`}
              >
                <span className="text-steel-dim">{m.index}</span>
                {m.title}
              </button>
            );
          })}
        </nav>
      </header>

      {/* hero: the sphere sits here */}
      <section aria-label="Core" className="relative" style={{ height: "min(62vw, 360px)" }}>
        <div ref={hero} aria-hidden className="absolute inset-x-0 top-0 h-full" />
      </section>
      <p className="label px-4 pb-3 text-center text-steel transition-opacity duration-[480ms]" style={{ opacity: step >= 5 ? 1 : 0 }}>
        {profile.tagline}
      </p>

      {/* swipeable tabs */}
      <div ref={track} className="overflow-hidden px-4 pb-6">
        <motion.div
          className="flex"
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.15}
          onDragEnd={onDragEnd}
          animate={{ x: -index * (width || 0) }}
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 34 }}
          style={{ width: `${ORDER.length * 100}%` }}
        >
          <div className="shrink-0 pr-4" style={{ width: `${100 / ORDER.length}%` }} aria-hidden={active !== "projects"} inert={active !== "projects"}>
            <ProjectsModule />
          </div>
          <div className="shrink-0 pr-4" style={{ width: `${100 / ORDER.length}%` }} aria-hidden={active !== "agents"} inert={active !== "agents"}>
            <AgentsModule />
          </div>
          <div className="shrink-0 pr-4" style={{ width: `${100 / ORDER.length}%` }} aria-hidden={active !== "systems"} inert={active !== "systems"}>
            <SystemsModule compact />
          </div>
        </motion.div>
      </div>

      <footer className="border-t border-steel-line px-4 py-3" style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))" }}>
        <Telemetry />
      </footer>
    </div>
  );
}
