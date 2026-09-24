"use client";

import { useCallback } from "react";
import { motion } from "framer-motion";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import Decode from "@/components/ui/Decode";

export interface OptionRowProps {
  id: ModuleId;
  index: string;
  title: string;
  count?: number;
  blurb?: string;
  order: number;
  /** quieter styling for the secondary "about" entry */
  muted?: boolean;
}

/**
 * A minimal option: a leader tick, the index and the title, no container. Used in the
 * mobile menu and beside the sphere in the module view.
 */
export default function OptionRow({ id, index, title, count, blurb, order, muted = false }: OptionRowProps) {
  const step = useSiteStore((s) => s.step);
  const hover = useSiteStore((s) => s.hover);
  const setHover = useSiteStore((s) => s.setHover);
  const setAnchor = useSiteStore((s) => s.setAnchor);
  const openModule = useSiteStore((s) => s.openModule);
  const reduced = useReducedMotion();
  const key = `opt-${id}`;
  const ref = useCallback((el: HTMLButtonElement | null) => setAnchor(key, el), [key, setAnchor]);
  const shown = step >= 4;
  const on = hover === key;

  return (
    <motion.div
      initial={false}
      animate={shown ? { opacity: 1, x: 0 } : { opacity: 0, x: -6 }}
      transition={{ duration: reduced ? 0.2 : 0.35, delay: reduced ? 0 : order * 0.08 }}
      className={shown ? "" : "pointer-events-none"}
      aria-hidden={!shown}
      inert={!shown}
    >
      <button
        ref={ref}
        type="button"
        data-option={id}
        onClick={() => openModule(id)}
        onMouseEnter={() => setHover(key)}
        onMouseLeave={() => setHover(null)}
        onFocus={() => setHover(key)}
        onBlur={() => setHover(null)}
        className="group flex min-h-11 w-full items-center gap-3 rounded-[2px] py-1 pr-2 text-left outline-offset-4"
      >
        <span aria-hidden className={`h-px shrink-0 transition-[width,background-color] duration-[240ms] ${on ? "w-8 bg-gold" : "w-5 bg-steel-line"}`} />
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-[240ms] ${on ? "bg-gold-hot shadow-[0_0_8px_var(--gold)]" : muted ? "bg-steel-dim" : "bg-gold"}`} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-3">
            <span className="label text-steel-dim">{index}</span>
            <Decode
              text={title.toUpperCase()}
              active={shown}
              reduced={reduced}
              duration={500}
              className={`font-display text-[15px] leading-[20px] font-semibold tracking-[0.12em] transition-colors duration-[240ms] ${on ? "text-gold-hot" : muted ? "text-steel" : "text-gold"}`}
            />
            {count !== undefined ? <span className="label text-steel-dim">{String(count).padStart(2, "0")}</span> : null}
          </span>
          {blurb ? <span className={`text-[12px] leading-[18px] text-steel transition-opacity duration-[240ms] ${on ? "opacity-100" : "opacity-70"}`}>{blurb}</span> : null}
        </span>
        <span aria-hidden className={`label transition-[opacity,transform] duration-[240ms] ${on ? "translate-x-0 text-gold opacity-100" : "-translate-x-1 text-steel-dim opacity-0"}`}>
          →
        </span>
      </button>
    </motion.div>
  );
}
