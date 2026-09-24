"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { animate, m, useMotionValue, type PanInfo } from "framer-motion";
import { aboutEntry, modules, profile } from "@/content/content";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import Decode from "@/components/ui/Decode";
import Telemetry from "@/components/hud/Telemetry";
import ProjectsModule from "@/components/modules/ProjectsModule";
import AgentsModule from "@/components/modules/AgentsModule";
import SkillsModule from "@/components/modules/SkillsModule";
import SystemsModule from "@/components/modules/SystemsModule";
import AboutModule from "@/components/modules/AboutModule";
import OptionRow from "./OptionRow";
import { rovingKeys } from "@/lib/roving";

const ORDER: ModuleId[] = ["projects", "agents", "skills", "systems", "about"];
const PANES: Record<ModuleId, React.ComponentType<{ className?: string; compact?: boolean }>> = {
  projects: ProjectsModule,
  agents: AgentsModule,
  skills: SkillsModule,
  systems: SystemsModule,
  about: AboutModule,
};
const TABS = [...modules.map((m) => ({ id: m.id as ModuleId, index: m.index, title: m.title })), { id: aboutEntry.id as ModuleId, index: aboutEntry.index, title: aboutEntry.title }];
const EMBLEM = 40;
const SPRING = { type: "spring", stiffness: 300, damping: 34 } as const;

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
  const header = useRef<HTMLElement>(null);
  const emblem = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const x = useMotionValue(0);

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
      // module view: interpolate into the header emblem while the hero passes under the header
      const e = emblem.current;
      if (!e) return;
      const er = e.getBoundingClientRect();
      const top = header.current?.getBoundingClientRect().bottom ?? 0;
      const span = Math.max(1, hr.height);
      const p = Math.min(1, Math.max(0, (top - hr.top) / span));
      const t = 1 - Math.pow(1 - p, 2);
      sphere.setFrame({
        x: hr.left + hr.width / 2 + (er.left + er.width / 2 - (hr.left + hr.width / 2)) * t,
        y: hr.top + hr.height / 2 + (er.top + er.height / 2 - (hr.top + hr.height / 2)) * t,
        size: heroSize + (EMBLEM - heroSize) * t,
        // until it has docked, the touch target stops at the header's edge so the tabs stay tappable
        clipTop: p < 1 ? top : 0,
      });
    };
    push();
    // one push per frame, however many scroll events arrive
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        push();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [phase, view]);

  const index = ORDER.indexOf(active);
  // one pane = the track's width (ResizeObserver reports once on observe, then on every change)
  useEffect(() => {
    const t = track.current;
    if (view !== "module" || !t) return;
    const ro = new ResizeObserver(() => setWidth(t.clientWidth));
    ro.observe(t);
    return () => ro.disconnect();
  }, [view]);
  // the strip follows the active tab; a swipe that changes nothing springs back
  useEffect(() => {
    if (view !== "module") return;
    const c = animate(x, -index * width, reduced ? { duration: 0 } : SPRING);
    return () => c.stop();
  }, [index, width, view, reduced, x]);
  // keep the active tab visible in the scrollable strip
  useEffect(() => {
    if (view !== "module") return;
    document.querySelector<HTMLElement>(`[data-tab="${active}"]`)?.scrollIntoView({ inline: "center", block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [active, view, reduced]);
  const go = useCallback(
    (i: number) => {
      const next = ORDER[Math.min(ORDER.length - 1, Math.max(0, i))];
      setActive(next);
      useSphereStore.getState().pulseToward(i > index ? 1 : -1, 0, 0.4);
    },
    [index, setActive],
  );
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (!width) return;
    const target = Math.max(0, Math.min(ORDER.length - 1, Math.round((-x.get() - info.velocity.x * 0.15) / width)));
    if (target === index) animate(x, -index * width, reduced ? { duration: 0 } : SPRING);
    else go(target);
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
        <header className="px-4 transition-opacity duration-[480ms]" style={{ opacity: step >= 2 ? 1 : 0.35, paddingTop: "calc(12px + env(safe-area-inset-top, 0px))" }}>
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
        <div className="flex min-h-0 flex-1 flex-col [@media(orientation:landscape)_and_(max-height:500px)]:flex-row [@media(orientation:landscape)_and_(max-height:500px)]:items-center">
          <div ref={hero} aria-hidden className="min-h-0 flex-1 [@media(orientation:landscape)_and_(max-height:500px)]:h-full" />
          <nav
            aria-label="Modules"
            onKeyDown={rovingKeys("button[data-option]")}
            className="relative flex flex-col gap-0.5 px-4 pt-6 sm:mx-auto sm:w-[min(100%,440px)] [@media(orientation:landscape)_and_(max-height:500px)]:w-[min(46%,320px)] [@media(orientation:landscape)_and_(max-height:500px)]:justify-center [@media(orientation:landscape)_and_(max-height:500px)]:pt-0"
            style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))" }}
          >
          {/* spine: down from the sphere, through the option shards */}
          <span
            aria-hidden
            className="pointer-events-none absolute -top-16 left-1/2 w-px bg-gradient-to-b from-transparent via-gold-line to-gold-line transition-opacity duration-[480ms] [@media(orientation:landscape)_and_(max-height:500px)]:hidden"
            style={{ bottom: "calc(38px + env(safe-area-inset-bottom, 0px))", opacity: step >= 4 ? 1 : 0 }}
          />
          {modules.map((m, i) => (
            <OptionRow key={m.id} layout="spine" id={m.id} index={m.index} title={m.title} count={m.items.length} order={i} />
          ))}
          <OptionRow layout="spine" id="about" index={aboutEntry.index} title={aboutEntry.title} order={modules.length} muted />
          </nav>
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-10 min-h-dvh">
      {/* sticky header: emblem + name + tabs */}
      <header ref={header} className="glass-solid sticky top-0 z-20 border-b border-steel-line" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="flex items-center gap-3 px-4 py-2">
          <div ref={emblem} data-emblem aria-hidden className="h-10 w-10 shrink-0" />
          {nameBlock("sm")}
        </div>
        <nav aria-label="Modules" className="flex overflow-x-auto border-t border-steel-line [mask-image:linear-gradient(90deg,transparent,#000_10px,#000_calc(100%-10px),transparent)] [scrollbar-width:none]">
          {TABS.map((m, i) => {
            const on = m.id === active;
            return (
              <button
                key={m.id}
                type="button"
                data-tab={m.id}
                aria-label={m.title}
                aria-current={on ? "true" : undefined}
                onClick={() => go(i)}
                className={`label flex h-11 flex-1 items-center justify-center gap-1.5 border-b-2 px-2 whitespace-nowrap transition-colors ${on ? "border-gold text-gold-hot" : "border-transparent text-steel"}`}
              >
                <span className="hidden text-steel-dim min-[430px]:inline">{m.index}</span>
                {m.title}
              </button>
            );
          })}
        </nav>
      </header>

      {/* hero: the sphere sits here and shrinks into the emblem on scroll */}
      <div aria-hidden className="relative" style={{ height: "min(56vw, 320px, 60vh)" }}>
        <div ref={hero} className="absolute inset-x-0 top-0 h-full" />
      </div>

      {/* swipeable tabs (the track has no padding, so its width is one pane) */}
      <div ref={track} className="mx-4 overflow-hidden pb-6">
        <m.div
          className="flex"
          drag="x"
          dragConstraints={{ left: -(ORDER.length - 1) * width, right: 0 }}
          dragElastic={0.2}
          dragMomentum={false}
          onDragEnd={onDragEnd}
          style={{ width: `${ORDER.length * 100}%`, x }}
        >
          {ORDER.map((id) => {
            const Pane = PANES[id];
            return (
              <div
                key={id}
                className={`shrink-0 pr-4 ${active !== id ? "[content-visibility:auto] [contain-intrinsic-size:0_800px]" : ""}`}
                style={{ width: `${100 / ORDER.length}%` }}
                aria-hidden={active !== id}
                inert={active !== id}
              >
                <Pane compact />
              </div>
            );
          })}
        </m.div>
      </div>

      <footer className="border-t border-steel-line px-4 py-3" style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))" }}>
        <Telemetry />
      </footer>
    </div>
  );
}
