"use client";

import { useCallback } from "react";
import { motion } from "framer-motion";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import Panel from "@/components/hud/Panel";

export interface OptionNodeProps {
  id: ModuleId;
  index: string;
  title: string;
  count: number;
  blurb: string;
  /** small chip (module view) instead of the full option card (menu view) */
  compact?: boolean;
  /** order for the stagger */
  order: number;
  className?: string;
}

/** One of the three options that emerge around the core; clicking it opens that module. */
export default function OptionNode({ id, index, title, count, blurb, compact = false, order, className = "" }: OptionNodeProps) {
  const step = useSiteStore((s) => s.step);
  const hover = useSiteStore((s) => s.hover);
  const setHover = useSiteStore((s) => s.setHover);
  const setAnchor = useSiteStore((s) => s.setAnchor);
  const openModule = useSiteStore((s) => s.openModule);
  const reduced = useReducedMotion();
  const key = `opt-${id}`;
  const ref = useCallback((el: HTMLElement | null) => setAnchor(key, el), [key, setAnchor]);
  const shown = step >= 4;
  const on = hover === key;

  return (
    <motion.div
      initial={false}
      animate={shown ? "shown" : "hidden"}
      variants={{
        hidden: { opacity: 0, scale: 0.96 },
        shown: reduced
          ? { opacity: 1, scale: 1, transition: { duration: 0.24 } }
          : { opacity: [0, 1, 0.4, 1], scale: 1, transition: { duration: 0.5, delay: order * 0.12, times: [0, 0.3, 0.5, 1] } },
      }}
      className={`${shown ? "" : "pointer-events-none"} ${className}`}
      aria-hidden={!shown}
      inert={!shown}
    >
      <Panel ref={ref} as="div" active={on} className="h-full">
        <button
          type="button"
          data-option={id}
          onClick={() => openModule(id)}
          onMouseEnter={() => setHover(key)}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setHover(key)}
          onBlur={() => setHover(null)}
          className={`flex h-full w-full flex-col text-left ${compact ? "min-h-11 gap-0.5 px-3 py-2" : "min-h-[112px] gap-2 p-4 lg:p-5"}`}
        >
          <span className="flex items-baseline justify-between gap-3">
            <span className={`font-display font-semibold tracking-[0.08em] text-gold uppercase ${compact ? "text-[14px] leading-[20px]" : "text-h3"}`}>
              <span className="mr-2 text-steel-dim">{index}</span>
              {title}
            </span>
            <span className="label whitespace-nowrap text-steel">
              {String(count).padStart(2, "0")} <span aria-hidden className="ml-1 text-gold">→</span>
            </span>
          </span>
          {!compact ? <span className="text-[14px] leading-[22px] text-fg-dim">{blurb}</span> : null}
        </button>
      </Panel>
    </motion.div>
  );
}
