"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate, m, useMotionValue, useMotionValueEvent, type PanInfo } from "framer-motion";
import { emailHref, profile, sectionIds, sections } from "@/content/content";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { useMediaQuery, useReducedMotion } from "@/lib/useMediaQuery";
import { HOME, home, navLink, openSection, up } from "@/lib/nav";
import { rovingKeys } from "@/lib/roving";
import Decode from "@/components/ui/Decode";
import Telemetry from "@/components/hud/Telemetry";
import ProjectsModule from "@/components/modules/ProjectsModule";
import AgentsModule from "@/components/modules/AgentsModule";
import SkillsModule from "@/components/modules/SkillsModule";
import SystemsModule from "@/components/modules/SystemsModule";
import AboutModule from "@/components/modules/AboutModule";
import OptionRow from "./OptionRow";
import ThumbLine, { THUMB_LINE_HEIGHT } from "./ThumbLine";

const PANES: Record<ModuleId, React.ComponentType<{ className?: string; compact?: boolean }>> = {
  projects: ProjectsModule,
  agents: AgentsModule,
  skills: SkillsModule,
  systems: SystemsModule,
  about: AboutModule,
};
const N = sectionIds.length;
const EMBLEM = 40;
/** how much of the next section shows at the right edge: a hint that the panes swipe (it fades out
 * below the section's top, so it never ends as a stray edge mid-page) */
const PEEK = 12;
const SPRING = { type: "spring", stiffness: 300, damping: 34 } as const;

/**
 * Mobile. Home: the name over the hologram. Sections: a compact sphere with the five
 * sections listed under it on a spine, and a way back in the thumb zone. A section: the
 * sphere docks into the sticky header as you scroll, one section at a time in swipeable
 * tabs, with "‹ sections" and prev/next in the thumb zone. An item is a bottom sheet.
 */
export default function MobileLayout() {
  const step = useSiteStore((s) => s.step);
  const phase = useSiteStore((s) => s.phase);
  const view = useSiteStore((s) => s.view);
  const active = useSiteStore((s) => s.activeModule);
  const lastModule = useSiteStore((s) => s.lastModule);
  const reduced = useReducedMotion();
  // a phone on its side: the list sits beside the sphere, too narrow for the centred spine
  const landscape = useMediaQuery("(orientation: landscape) and (max-height: 500px)");
  const hero = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  const tabs = useRef<HTMLElement>(null);
  const rule = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const panes = useRef<Partial<Record<ModuleId, HTMLDivElement | null>>>({});
  const [trackWidth, setTrackWidth] = useState(0);
  const [paneHeight, setPaneHeight] = useState<number | null>(null);
  const x = useMotionValue(0);
  // a mouse drag on the strip must not end as a click on the card it started on
  const dragging = useRef(false);

  const paneW = Math.max(0, trackWidth - PEEK);
  const index = sectionIds.indexOf(active);
  const xFor = useCallback((i: number) => (i >= N - 1 ? -(N - 1) * paneW + PEEK : -i * paneW), [paneW]);

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
      // section view: dock into the header emblem while the hero passes under the header
      const head = header.current;
      if (!head) return;
      const er = head.getBoundingClientRect();
      const safeTop = parseFloat(getComputedStyle(head).paddingTop) || 0;
      // where the emblem's centre ends up once it is fully open (computed from the header, not the emblem, so no feedback loop)
      const ex = er.left + 16 + EMBLEM / 2;
      const ey = er.top + safeTop + 8 + EMBLEM / 2;
      const top = er.bottom;
      const span = Math.max(1, hr.height);
      const p = hr.height <= 1 ? 1 : Math.min(1, Math.max(0, (top - hr.top) / span));
      const t = 1 - Math.pow(1 - p, 2);
      head.style.setProperty("--dock", t.toFixed(3));
      sphere.setFrame({
        x: hr.left + hr.width / 2 + (ex - (hr.left + hr.width / 2)) * t,
        y: hr.top + hr.height / 2 + (ey - (hr.top + hr.height / 2)) * t,
        // the whole drawn sphere is its tap target (a stray tap only pulses it); the round
        // button leaves the tabs and the name beside it tappable
        size: heroSize + (EMBLEM - heroSize) * t,
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

  // one pane = the track's width minus the peek
  useEffect(() => {
    const t = track.current;
    if (view !== "module" || !t) return;
    const ro = new ResizeObserver(() => setTrackWidth(t.clientWidth));
    ro.observe(t);
    return () => ro.disconnect();
  }, [view]);

  // the track is as tall as the open section, so a short one leaves no empty page below it
  useEffect(() => {
    const el = panes.current[active];
    if (view !== "module" || !el) return;
    const ro = new ResizeObserver(() => setPaneHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, view]);

  // the strip follows the active section; a swipe that changes nothing springs back
  useEffect(() => {
    if (view !== "module" || !paneW) return;
    const c = animate(x, xFor(index), reduced ? { duration: 0 } : SPRING);
    return () => c.stop();
  }, [index, paneW, view, reduced, x, xFor]);

  // the gold rule under the tabs slides with the strip, under the finger during a swipe
  const placeRule = useCallback(
    (v: number) => {
      const nav = tabs.current;
      const el = rule.current;
      if (!nav || !el || !paneW) return;
      const last = xFor(N - 1);
      const p = Math.min(N - 1, Math.max(0, last ? ((N - 1) * v) / last : 0));
      const a = Math.floor(p);
      const b = Math.min(N - 1, a + 1);
      const f = p - a;
      const ta = nav.querySelector<HTMLElement>(`[data-tab="${sectionIds[a]}"]`);
      const tb = nav.querySelector<HTMLElement>(`[data-tab="${sectionIds[b]}"]`);
      if (!ta || !tb) return;
      el.style.left = `${ta.offsetLeft + (tb.offsetLeft - ta.offsetLeft) * f}px`;
      el.style.width = `${ta.offsetWidth + (tb.offsetWidth - ta.offsetWidth) * f}px`;
    },
    [paneW, xFor],
  );
  useMotionValueEvent(x, "change", placeRule);
  useLayoutEffect(() => placeRule(x.get()), [placeRule, x, view, trackWidth]);

  // keep the active tab visible in the strip
  useEffect(() => {
    if (view !== "module") return;
    // scroll the strip, not the tab: scrollIntoView would also move the browser's Tab starting point
    const nav = tabs.current;
    const t = nav?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    if (nav && t) nav.scrollTo({ left: t.offsetLeft - (nav.clientWidth - t.offsetWidth) / 2, behavior: reduced ? "auto" : "smooth" });
  }, [active, view, reduced]);

  // after switching section deep in a long one, bring the new section's title up under the header
  const shownSection = useRef(active);
  useEffect(() => {
    if (view !== "module") {
      shownSection.current = active;
      return;
    }
    if (shownSection.current === active) return;
    shownSection.current = active;
    const t = track.current;
    const head = header.current;
    if (!t || !head) return;
    const target = window.scrollY + t.getBoundingClientRect().top - head.getBoundingClientRect().bottom - 8;
    if (target < window.scrollY) window.scrollTo({ top: Math.max(0, target), behavior: reduced ? "auto" : "smooth" });
  }, [active, view, reduced]);

  const go = useCallback(
    (i: number) => {
      const next = sectionIds[Math.min(N - 1, Math.max(0, i))];
      if (next === active) return;
      useSphereStore.getState().pulseToward(i > index ? 1 : -1, 0, 0.4);
      openSection(next);
    },
    [active, index],
  );
  const onDragEnd = (_: unknown, info: PanInfo) => {
    window.setTimeout(() => {
      dragging.current = false;
    }, 0);
    if (!paneW) return;
    const dx = x.get() - xFor(index);
    const vx = info.velocity.x;
    const delta = dx < -0.22 * paneW || vx < -350 ? 1 : dx > 0.22 * paneW || vx > 350 ? -1 : 0;
    const target = Math.max(0, Math.min(N - 1, index + delta));
    if (target === index) animate(x, xFor(index), reduced ? { duration: 0 } : SPRING);
    else go(target);
  };

  // the name is the way home from anywhere but home
  const nameBlock = (size: "lg" | "sm") => {
    const title = (
      <Decode
        as="h1"
        text={profile.name.toUpperCase()}
        active={step >= 3}
        reduced={reduced}
        className={`truncate font-display font-semibold tracking-[0.06em] text-gold-hot ${size === "lg" ? "text-[17px] leading-[22px]" : "text-[15px] leading-[20px]"}`}
      />
    );
    return (
      <div className="min-w-0 flex-1">
        {view === "core" ? (
          title
        ) : (
          <a {...navLink(HOME, home)} aria-label={`${profile.name}, home`} className="group relative block w-fit max-w-full outline-none">
            {title}
            <span aria-hidden className="absolute -bottom-0.5 left-0 h-px w-full bg-gold opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100" />
          </a>
        )}
        <p className="label truncate text-steel">
          {profile.role}
          {emailHref ? (
            <>
              {" · "}
              <a href={emailHref} className="text-gold transition-colors hover:text-gold-hot focus-visible:text-gold-hot">
                email<span aria-hidden> ↗</span>
              </a>
            </>
          ) : null}
        </p>
      </div>
    );
  };

  if (view === "core") {
    return (
      <div className="relative z-10 h-dvh overflow-hidden">
        <header className="px-4 transition-opacity duration-[480ms]" style={{ opacity: step >= 2 ? 1 : 0.35, paddingTop: "calc(12px + env(safe-area-inset-top, 0px))" }}>
          {nameBlock("lg")}
        </header>
        <main id="content" aria-label="Home" />
      </div>
    );
  }

  if (view === "menu") {
    return (
      <div className="relative z-10 flex h-dvh flex-col overflow-hidden">
        <header className="px-4" style={{ paddingTop: "calc(12px + env(safe-area-inset-top, 0px))" }}>
          {nameBlock("lg")}
        </header>
        <main id="content" className={"flex min-h-0 flex-1 flex-col landscape-short:flex-row landscape-short:items-center"}>
          <div ref={hero} aria-hidden className={"min-h-0 flex-1 landscape-short:h-full"} />
          <nav
            id="sections-list"
            aria-label="Sections"
            onKeyDown={rovingKeys("[data-option], [data-up]")}
            className={"relative flex flex-col px-4 pt-5 sm:mx-auto sm:w-[min(100%,440px)] landscape-short:mx-0 landscape-short:w-[min(46%,320px)] landscape-short:justify-center landscape-short:pt-0"}
            style={{ paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))" }}
          >
            {/* spine: down from the sphere, through the section shards, ending on "close" */}
            <span
              aria-hidden
              className={`pointer-events-none absolute -top-16 left-1/2 w-px bg-gradient-to-b from-transparent via-gold-line to-gold-line transition-opacity duration-[480ms] landscape-short:hidden`}
              style={{ bottom: "calc(30px + env(safe-area-inset-bottom, 0px))", opacity: step >= 4 ? 1 : 0 }}
            />
            {sections.map((s, i) => (
              <OptionRow key={s.id} layout={landscape ? "row" : "spine"} id={s.id} index={s.index} title={s.title} hint={s.hint} count={s.count} order={i} lit={s.id === lastModule} />
            ))}
            {/* the visible way back, where the thumb is */}
            <a
              {...navLink(HOME, up)}
              data-up
              className={`group mt-1 grid min-h-11 grid-cols-[1fr_auto_1fr] items-center gap-3 outline-none transition-opacity duration-[480ms] landscape-short:flex ${step >= 4 ? "opacity-100" : "opacity-0"}`}
            >
              <span className="landscape-short:w-4" />
              <span aria-hidden className="h-[7px] w-[7px] rounded-full border border-gold-line bg-bg group-hover:border-gold-hot group-focus-visible:border-gold-hot" />
              <span className="label relative text-steel group-hover:text-gold-hot group-focus-visible:text-gold-hot group-active:text-gold-hot">
                <span aria-hidden>× </span>close
                <span aria-hidden className="absolute -bottom-1 left-0 h-px w-full bg-gold opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
              </span>
            </a>
          </nav>
        </main>
      </div>
    );
  }

  return (
    <div className="relative z-10 min-h-dvh">
      {/* sticky header: emblem (opens as the sphere docks) + name + tabs */}
      <header ref={header} className="sticky top-0 z-20 bg-bg border-b border-steel-line" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="flex items-center px-4 py-2">
          <div data-emblem aria-hidden className="h-10 shrink-0" style={{ width: `calc(var(--dock, 0) * ${EMBLEM}px)`, marginRight: "calc(var(--dock, 0) * 12px)" }} />
          {nameBlock("sm")}
        </div>
        <nav
          ref={tabs}
          aria-label="Sections"
          onKeyDown={rovingKeys("[data-tab]")}
          className="relative flex overflow-x-auto border-t border-steel-line px-2.5 [mask-image:linear-gradient(90deg,transparent,#000_10px,#000_calc(100%-10px),transparent)] [scrollbar-width:none]"
        >
          {sections.map((s, i) => {
            const on = s.id === active;
            const link = navLink({ depth: 2, section: s.id }, () => go(i));
            return (
              <a
                key={s.id}
                href={link.href}
                data-tab={s.id}
                aria-current={on ? "page" : undefined}
                onClick={(e) => {
                  if (on) {
                    // already here: bring this section's title up under the header
                    e.preventDefault();
                    const t = track.current;
                    const head = header.current;
                    if (t && head) window.scrollTo({ top: Math.max(0, window.scrollY + t.getBoundingClientRect().top - head.getBoundingClientRect().bottom - 8), behavior: reduced ? "auto" : "smooth" });
                    return;
                  }
                  link.onClick(e);
                }}
                className={`group relative label flex h-11 flex-1 items-center justify-center gap-1.5 px-2 whitespace-nowrap outline-none transition-colors focus-visible:text-gold-hot max-[374px]:px-1 max-[374px]:tracking-[0.1em]! ${on ? "text-gold-hot" : "text-steel"}`}
              >
                <span className="hidden text-steel-dim min-[490px]:inline">{s.index}</span>
                {s.title}
                {/* keyboard focus, drawn inside the strip (an outline would be clipped by its scroll box) */}
                <span aria-hidden className="pointer-events-none absolute inset-x-1 top-1 bottom-1 rounded-[2px] border border-gold opacity-0 group-focus-visible:opacity-100" />
              </a>
            );
          })}
          <span ref={rule} aria-hidden className="pointer-events-none absolute bottom-0 h-0.5 bg-gold shadow-[0_0_8px_var(--gold)]" />
        </nav>
      </header>

      <main id="content">
        {/* hero: the sphere sits here and shrinks into the emblem on scroll (none in short landscape) */}
        <div aria-hidden className={"relative h-[min(56vw,320px,60vh)] landscape-short:h-0"}>
          <div ref={hero} className="absolute inset-x-0 top-0 h-full" />
        </div>

        {/* swipeable sections (the track has no padding, so its width is one pane plus the peek) */}
        <div ref={track} className="mx-4 overflow-hidden" style={{ height: paneHeight ?? undefined }}>
          <m.div
            className="flex items-start"
            drag="x"
            dragConstraints={{ left: xFor(N - 1), right: 0 }}
            dragElastic={0.2}
            dragMomentum={false}
            onDragStart={() => {
              dragging.current = true;
            }}
            onDragEnd={onDragEnd}
            onClickCapture={(e) => {
              if (dragging.current) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            style={{ width: paneW ? N * paneW : `${N * 100}%`, x }}
          >
            {sectionIds.map((id) => {
              const Pane = PANES[id];
              return (
                <div
                  key={id}
                  ref={(el) => {
                    panes.current[id] = el;
                  }}
                  className={`shrink-0 pr-3 pb-6 ${active !== id ? "[content-visibility:auto] [contain-intrinsic-size:0_800px] [mask-image:linear-gradient(to_bottom,#000_0,#000_180px,transparent_360px)]" : ""}`}
                  style={{ width: paneW || `${100 / N}%` }}
                  aria-hidden={active !== id}
                  inert={active !== id}
                >
                  <Pane compact />
                </div>
              );
            })}
          </m.div>
        </div>
      </main>

      <footer className="border-t border-steel-line px-4 pt-3" style={{ paddingBottom: `calc(${THUMB_LINE_HEIGHT + 12}px + env(safe-area-inset-bottom, 0px))` }}>
        <Telemetry />
      </footer>
      <ThumbLine />
    </div>
  );
}
