"use client";

import { useCallback, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import Panel from "@/components/hud/Panel";

export interface ModuleFrameProps {
  id: ModuleId;
  index: string;
  title: string;
  count?: number;
  status?: string;
  children: ReactNode;
  className?: string;
}

/**
 * A module panel: title row, status line, beam anchor, and the materialise animation
 * (outline assembles, flickers, then fills) driven by the intro step.
 */
export default function ModuleFrame({ id, index, title, count, status, children, className = "" }: ModuleFrameProps) {
  const step = useSiteStore((s) => s.step);
  const hover = useSiteStore((s) => s.hover);
  const setHover = useSiteStore((s) => s.setHover);
  const setAnchor = useSiteStore((s) => s.setAnchor);
  const active = useSiteStore((s) => s.activeModule) === id;
  const reduced = useReducedMotion();
  const ref = useCallback((el: HTMLElement | null) => setAnchor(id, el), [id, setAnchor]);
  const view = useSiteStore((s) => s.view);
  const shown = view === "module" && step >= 5;
  const delay = 0;

  return (
    <motion.div
      initial={false}
      animate={shown ? "shown" : "hidden"}
      variants={{
        hidden: { opacity: 0 },
        shown: reduced
          ? { opacity: 1, transition: { duration: 0.24 } }
          : { opacity: [0, 1, 0.35, 1, 0.6, 1], transition: { duration: 0.6, delay, times: [0, 0.25, 0.4, 0.55, 0.7, 1] } },
      }}
      className={`min-h-0 ${shown ? "" : "pointer-events-none"} ${className}`}
      aria-hidden={!shown}
      inert={!shown}
    >
      <Panel
        ref={ref}
        id={`module-${id}`}
        aria-labelledby={`module-${id}-title`}
        active={active || hover === id}
        onMouseEnter={() => setHover(id)}
        onMouseLeave={() => setHover(null)}
        onFocusCapture={() => setHover(id)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null);
        }}
        className="flex h-full min-h-0 flex-col p-4 lg:p-6"
      >
        <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-steel-line pb-3">
          <h2 id={`module-${id}-title`} className="shrink-0 font-display text-h3 font-semibold tracking-[0.08em] text-gold uppercase">
            <span className="mr-2 text-steel-dim">{index}</span>
            {title}
          </h2>
          <span className="label min-w-0 truncate whitespace-nowrap text-steel">
            {count !== undefined ? String(count).padStart(2, "0") : null}
            {status ? <span className={`text-steel-dim ${count !== undefined ? "hidden xl:inline" : ""}`}>{count !== undefined ? " · " : ""}{status}</span> : null}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">{children}</div>
      </Panel>
    </motion.div>
  );
}
