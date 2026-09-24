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
import OptionNode from "./OptionNode";

const ORDER: ModuleId[] = ["projects", "agents", "systems"];
const EMBLEM = 40;

/**
 * Mobile. Core: the name over the hologram. Menu: a compact sphere with the three options
 * listed under it. Module: the sphere shrinks into the sticky header's emblem on scroll,
 * one module at a time in swipeable tabs. The detail view is a bottom sheet.
 */
export default function MobileLayout() {
  const step = useSiteStore((s) => s.step);
  const phase = useSiteStore((s) => s.phase);
  const view = useSiteStore((s) => s.view);
  const active = useSiteStore((s) => s.activeModule);
  const setActive = useSiteStore((s) => s.setActiveModule);
  const reduced = useReducedMotion();
  const hero = useRef<HTMLDivElement>(null);
  const emblem = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // sphere framing per view
  useEffect(() => {
    if (phase === "detail") return;
    const sphere = useSphereStore.getState();
    if (view === "core") {
      sphere.setFrame(null);
      window.scrollTo({ top: 0 });
      return;
    }
    const push = () => {
      const h = hero.current;
      if (!h) return;
      const hr = h.getBoundingClientRect();
      const heroSize = Math.min(hr.width, hr.height) * 0.92;
      if (view === "menu") {
        sphere.setFrame({ x: hr.left + hr.width / 2, y: hr.top + hr.height / 2, size: heroSize });
        return;
      }
      // module view: interpolate into the header emblem while scrolling
      const e = emblem.current;
      if (!e) return;
      const er = e.getBoundingClientRect();
      const span = Math.max(1, hr.height);
      const p = Math.min(1, Math.max(0, -hr.top / span));
      const t = 1 - Math.pow(1 - p, 2);
      sphere.setFrame({
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
  }, [phase, view]);

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

  const nameBlock = (size: "lg" | "sm") => (
    <div className="min-w-0 flex-1">
      <Decode
        as="h1"
        text={profile.name.toUpperCase()}
        active={step >= 3}
        reduced={reduced}
        className={`truncate font-display font-semibold tracking-[0.06em] text-gold-hot ${size === "lg" ? "text-[17px] leading-[22px]" : "text-[15px] leading-[20px]"}`}
      />
      <p className="label truncate text-steel">{profile.role}</p>
    </div>
  );

  if (view === "core") {
    return (
      <div className="relative z-10 h-dvh overflow-hidden">
        <header className="px-4 transition-opacity duration-[480ms]" style={{ opacity: step >= 2 ? 1 : 0, paddingTop: "calc(12px + env(safe-area-inset-top, 0px))" }}>
          {nameBlock("lg")}
        </header>
      </div>
    );
  }

  if (view === "menu") {
    return (
      <div className="relative z-10 flex h-dvh flex-col overflow-hidden">
        <header className="px-4" style={{ paddingTop: "calc(12px + env(safe-area-inset-top, 0px))" }}>
          {nameBlock("lg")}
        </header>
        <div ref={hero} aria-hidden className="min-h-0 flex-1" />
        <div className="flex flex-col gap-3 px-4" style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))" }}>
          <p className="label text-center text-steel">choose a module</p>
          {modules.map((m, i) => (
            <OptionNode key={m.id} id={m.id} index={m.index} title={m.title} count={m.items.length} blurb={m.blurb} order={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-10 min-h-dvh">
      {/* sticky header: emblem + name + tabs */}
      <header className="glass sticky top-0 z-20 border-b border-steel-line" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="flex items-center gap-3 px-4 py-2">
          <div ref={emblem} data-emblem aria-hidden className="h-10 w-10 shrink-0" />
          {nameBlock("sm")}
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

      {/* hero: the sphere sits here and shrinks into the emblem on scroll */}
      <section aria-label="Core" className="relative" style={{ height: "min(56vw, 320px)" }}>
        <div ref={hero} aria-hidden className="absolute inset-x-0 top-0 h-full" />
      </section>

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
