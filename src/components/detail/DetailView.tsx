"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, m, useDragControls, type PanInfo } from "framer-motion";
import { emailHref, findItem, itemsOf, sectionById, sectionOfItem } from "@/content/content";
import type { Item } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { spin, useSphereStore } from "@/components/sphere/sphereStore";
import { useIsDesktop, useReducedMotion } from "@/lib/useMediaQuery";
import { stepItem, up } from "@/lib/nav";
import Brackets from "@/components/hud/Brackets";
import Kbd from "@/components/ui/Kbd";
import { EMBLEM, emblemCentre } from "@/components/site/emblem";
import DetailSections from "./DetailSections";

const text = "label flex h-11 items-center gap-2 transition-colors duration-[240ms]";
const live = `${text} text-gold hover:text-gold-hot focus-visible:text-gold-hot`;
const dead = `${text} text-steel-dim cursor-default`;

const codeOf = (item: Item) => (item.category === "project" ? item.code : item.id.toUpperCase());

/** Where the item sits in its section: for the breadcrumb, the count and prev/next. */
function placeOf(item: Item) {
  const section = sectionById(sectionOfItem(item.id) ?? "projects");
  const list = itemsOf(section.id);
  const i = list.findIndex((it) => it.id === item.id);
  return { section, i, n: list.length, prev: list[i - 1] ?? null, next: list[i + 1] ?? null };
}

function PrevNext({ item, className = "" }: { item: Item; className?: string }) {
  const { i, n, prev, next } = placeOf(item);
  const name = (it: Item) => it.name.replace(/^PLACEHOLDER · /, "");
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <button
        type="button"
        aria-disabled={!prev}
        aria-label={prev ? `Previous item: ${name(prev)}` : "Previous item, none"}
        onClick={() => prev && stepItem(-1)}
        className={prev ? live : dead}
      >
        <span aria-hidden>←</span> prev
      </button>
      <span className="label text-steel" aria-hidden>
        {i + 1} / {n}
      </span>
      <button type="button" aria-disabled={!next} aria-label={next ? `Next item: ${name(next)}` : "Next item, none"} onClick={() => next && stepItem(1)} className={next ? live : dead}>
        next <span aria-hidden>→</span>
      </button>
    </div>
  );
}

function Contact() {
  if (!emailHref) return null;
  return (
    <p className="mt-8 border-t border-steel-line pt-4">
      <a href={emailHref} className="label inline-flex h-11 items-center gap-2 text-steel transition-colors hover:text-gold-hot focus-visible:text-gold-hot">
        questions? email ↗
      </a>
    </p>
  );
}

/**
 * One item over its section: a dimmed overlay with the sphere parked in the top-left corner
 * on desktop, a draggable bottom sheet on mobile. A breadcrumb says where it sits, prev/next
 * walks its siblings, Esc / Back / close all go up one level; focus is trapped inside.
 */
export default function DetailView() {
  const activeItem = useSiteStore((s) => s.activeItem);
  const isDesktop = useIsDesktop();
  const reduced = useReducedMotion();
  const item = findItem(activeItem);
  const open = Boolean(item);
  const panel = useRef<HTMLDivElement>(null);
  const region = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const dragControls = useDragControls();
  // one sheet drag per touch gesture
  const pulling = useRef(false);

  // while open: sphere to the corner, scroll lock, focus trap, Esc and arrows (not re-run when prev/next swaps the item)
  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement as HTMLElement | null;
    const sphere = useSphereStore.getState();
    // a coasting sphere parks still
    spin.vYaw = spin.vPitch = 0;
    if (isDesktop) {
      // the left margin beside the overlay, below the header row
      sphere.setFrame({ x: Math.max(48, window.innerWidth * 0.04), y: window.innerHeight * 0.09 + 56, size: 76 });
    } else {
      // shrink into the header emblem, which stays visible above the sheet (MobileLayout opens its slot meanwhile)
      const head = document.querySelector<HTMLElement>("[data-emblem]")?.closest("header");
      sphere.setFrame({ ...(head ? emblemCentre(head) : { x: 36, y: 36 }), size: EMBLEM });
    }
    sphere.setLeanTarget(0, 0);
    document.body.style.overflow = "hidden";
    const focusFirst = window.setTimeout(() => panel.current?.querySelector<HTMLElement>("button")?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        up();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (!e.altKey && !e.metaKey && !e.ctrlKey && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          stepItem(1);
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          stepItem(-1);
          return;
        }
      }
      if (e.key === "Tab" && panel.current) {
        const focusables = panel.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])');
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusFirst);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      // back to the card of the item that was open last (prev/next may have changed it)
      const lastItem = useSiteStore.getState().lastItem;
      const card = lastItem ? document.querySelector<HTMLElement>(`[data-item="${lastItem}"]`) : null;
      (card && !card.closest("[inert]") ? card : lastFocus.current)?.focus?.({ preventScroll: false });
    };
  }, [open, isDesktop]);

  // prev/next swaps the item in place: start it from the top
  useEffect(() => {
    region.current?.scrollTo({ top: 0 });
  }, [activeItem]);

  // on the sheet, a downward swipe from anywhere closes it once the content is at its top
  useEffect(() => {
    const el = region.current;
    if (!open || isDesktop || !el) return;
    let sx = 0;
    let sy = 0;
    let armed = false;
    const onStart = (e: TouchEvent) => {
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      armed = el.scrollTop <= 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!armed) return;
      const dy = e.touches[0].clientY - sy;
      const dx = e.touches[0].clientX - sx;
      // only a mostly vertical pull downward at the top of the content; anything else scrolls
      if (dy > 6 && dy > Math.abs(dx)) e.preventDefault();
      else if (dy < -2) armed = false;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
    };
  }, [open, isDesktop, item]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) up();
  };

  const place = item ? placeOf(item) : null;
  const crumb = place ? (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2">
        <li>
          <button type="button" onClick={up} className={live}>
            <span aria-hidden>‹</span> {isDesktop ? <span className="text-steel-dim">{place.section.index}</span> : null}
            {place.section.title.toLowerCase()}
          </button>
        </li>
        <li aria-hidden className="label text-steel-dim">
          /
        </li>
        <li className="label min-w-0 truncate text-steel" aria-current="page">
          {item ? codeOf(item).toLowerCase() : null}
        </li>
      </ol>
    </nav>
  ) : null;

  return (
    <AnimatePresence>
      {item ? (
        <m.div
          key="detail"
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.2 : 0.3 }}
        >
          {/* the page behind is inert and the dialog has its own close control: the backdrop is pointer-only */}
          <div aria-hidden onClick={up} className="absolute inset-0 cursor-default bg-bg/80" />
          {isDesktop ? (
            <m.div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-labelledby="detail-title"
              className="glass-solid absolute inset-x-[max(8vw,100px)] top-[9vh] bottom-[7vh] flex flex-col rounded-[2px] border border-gold shadow-glow-strong"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <Brackets size={18} />
              <div className="flex items-center justify-between gap-4 border-b border-steel-line px-8 py-1">
                {crumb}
                <div className="flex items-center gap-5">
                  <PrevNext item={item} />
                  <span aria-hidden className="h-5 w-px bg-steel-line" />
                  <Kbd>esc</Kbd>
                  <button type="button" onClick={up} className="label flex h-11 items-center gap-2 rounded-[2px] border border-gold-line px-3 text-gold hover:border-gold hover:text-gold-hot">
                    close <span aria-hidden>×</span>
                  </button>
                </div>
              </div>
              <div ref={region} tabIndex={0} role="region" aria-label="Item details" className="min-h-0 flex-1 overflow-y-auto px-8 py-6 outline-none [scrollbar-width:thin]">
                <DetailSections item={item} />
                <Contact />
              </div>
            </m.div>
          ) : (
            <m.div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-labelledby="detail-title"
              className="glass-solid absolute inset-x-0 bottom-0 flex flex-col rounded-t-[6px] border border-gold border-b-0 shadow-glow-strong sm:mx-auto sm:max-w-[640px]"
              style={{ top: "calc(env(safe-area-inset-top, 0px) + 56px)" }}
              initial={reduced ? { opacity: 0 } : { y: "100%" }}
              animate={reduced ? { opacity: 1 } : { y: 0 }}
              exit={reduced ? { opacity: 0 } : { y: "100%" }}
              transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={onDragEnd}
            >
              {/* the handle row starts a drag anywhere on it */}
              <div className="relative flex touch-none items-center justify-between gap-3 border-b border-steel-line px-4 pt-3 pb-1" onPointerDown={(e) => dragControls.start(e)}>
                <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-steel-dim" />
                <div className="min-w-0 pt-2">{crumb}</div>
                <button type="button" onClick={up} className="label mt-2 flex h-11 shrink-0 items-center gap-2 rounded-[2px] border border-gold-line px-3 text-gold">
                  close <span aria-hidden>×</span>
                </button>
              </div>
              <div
                ref={region}
                tabIndex={0}
                role="region"
                aria-label="Item details"
                className="min-h-0 flex-1 overflow-y-auto px-4 py-4 outline-none [scrollbar-width:thin]"
                onPointerDown={() => {
                  pulling.current = false;
                }}
                onPointerMove={(e) => {
                  // the pull that the touch listener kept from scrolling becomes the sheet's drag
                  const r = region.current;
                  if (pulling.current || e.pointerType !== "touch" || !r || r.scrollTop > 0 || e.movementY <= 0 || e.buttons === 0) return;
                  pulling.current = true;
                  dragControls.start(e);
                }}
              >
                <DetailSections item={item} />
                <Contact />
              </div>
              {/* prev / next in the thumb zone */}
              <div className="border-t border-steel-line px-4" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
                <PrevNext item={item} className="justify-between" />
              </div>
            </m.div>
          )}
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}
