"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { agents, projects, systems } from "@/content/content";
import type { Item } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { useIsDesktop, useReducedMotion } from "@/lib/useMediaQuery";
import Brackets from "@/components/hud/Brackets";
import Kbd from "@/components/ui/Kbd";
import DetailSections from "./DetailSections";

const ALL: Item[] = [...projects, ...agents, ...systems];

function findItem(id: string | null): Item | undefined {
  return id ? ALL.find((i) => i.id === id) : undefined;
}

/**
 * Full-screen detail: a dimmed overlay with the sphere parked in the top-left corner
 * on desktop, a draggable bottom sheet on mobile. Esc closes; focus is trapped inside.
 */
export default function DetailView() {
  const activeItem = useSiteStore((s) => s.activeItem);
  const closeItem = useSiteStore((s) => s.closeItem);
  const isDesktop = useIsDesktop();
  const reduced = useReducedMotion();
  const item = findItem(activeItem);
  const panel = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  // sphere to the corner while open, focus management, Esc
  useEffect(() => {
    if (!item) return;
    lastFocus.current = document.activeElement as HTMLElement | null;
    const sphere = useSphereStore.getState();
    if (isDesktop) sphere.setFrame({ x: 60, y: 60, size: 76 });
    sphere.setLeanTarget(0, 0);
    document.body.style.overflow = "hidden";
    const focusFirst = window.setTimeout(() => panel.current?.querySelector<HTMLElement>("button")?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeItem();
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
      lastFocus.current?.focus?.();
    };
  }, [item, isDesktop, closeItem]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) closeItem();
  };

  return (
    <AnimatePresence>
      {item ? (
        <motion.div
          key="detail"
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.2 : 0.3 }}
        >
          <button type="button" aria-label="Close" onClick={closeItem} className="absolute inset-0 h-full w-full cursor-default bg-bg/70 backdrop-blur-[2px]" />
          {isDesktop ? (
            <motion.div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-labelledby="detail-title"
              className="glass absolute inset-x-[8vw] top-[9vh] bottom-[7vh] flex flex-col rounded-[2px] border border-gold shadow-glow-strong"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <Brackets size={18} />
              <div className="flex items-center justify-between gap-4 border-b border-steel-line px-8 py-3">
                <span className="label text-steel">detail view</span>
                <div className="flex items-center gap-3">
                  <Kbd>esc</Kbd>
                  <button type="button" onClick={closeItem} className="label flex h-11 items-center gap-2 rounded-[2px] border border-gold-line px-3 text-gold hover:border-gold hover:text-gold-hot">
                    close ×
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6 [scrollbar-width:thin]">
                <DetailSections item={item} />
              </div>
            </motion.div>
          ) : (
            <motion.div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-labelledby="detail-title"
              className="glass absolute inset-x-0 bottom-0 top-[6vh] flex flex-col rounded-t-[6px] border border-gold border-b-0 shadow-glow-strong"
              initial={reduced ? { opacity: 0 } : { y: "100%" }}
              animate={reduced ? { opacity: 1 } : { y: 0 }}
              exit={reduced ? { opacity: 0 } : { y: "100%" }}
              transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={onDragEnd}
            >
              <div className="flex items-center justify-between gap-3 border-b border-steel-line px-4 pt-2 pb-3">
                <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-steel-dim" />
                <span className="label pt-3 text-steel">swipe down to close</span>
                <button type="button" onClick={closeItem} className="label mt-2 flex h-11 items-center gap-2 rounded-[2px] border border-gold-line px-3 text-gold">
                  close ×
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-width:thin]" style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))" }}>
                <DetailSections item={item} />
              </div>
            </motion.div>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
