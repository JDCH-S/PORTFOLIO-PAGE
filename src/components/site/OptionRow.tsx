"use client";

import { useCallback, useState } from "react";
import { m } from "framer-motion";
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
  /** "row": a leader tick at the left. "spine": the shard sits on a centre line, index left, title right */
  layout?: "row" | "spine";
}

const GLOW = "0 0 12px var(--gold-glow)";
const GLOW_HOT = "0 0 16px var(--gold-glow), 0 0 3px rgba(255,236,200,0.6)";

/**
 * A minimal option: index, shard and title, no container. Used in the mobile menu and
 * beside the sphere in the module view, where the rows hang off a spine under the sphere.
 */
export default function OptionRow({ id, index, title, count, blurb, order, muted = false, layout = "row" }: OptionRowProps) {
  const step = useSiteStore((s) => s.step);
  const setHover = useSiteStore((s) => s.setHover);
  const setAnchor = useSiteStore((s) => s.setAnchor);
  const openModule = useSiteStore((s) => s.openModule);
  const reduced = useReducedMotion();
  const key = `opt-${id}`;
  const hovered = useSiteStore((s) => s.hover === key);
  const [focused, setFocused] = useState(false);
  const ref = useCallback((el: HTMLButtonElement | null) => setAnchor(key, el), [key, setAnchor]);
  const shown = step >= 4;
  const on = hovered || focused;
  const spine = layout === "spine";

  const shard = (
    <span
      aria-hidden
      className={`h-[3.5px] w-[3.5px] shrink-0 rotate-45 transition-colors duration-[240ms] ${on ? "bg-gold-hot shadow-[0_0_8px_var(--gold)]" : "bg-gold"}`}
    />
  );
  const titleEl = (
    <Decode
      text={title.toUpperCase()}
      active={shown}
      reduced={reduced}
      duration={500}
      className={`font-display text-[15px] leading-[20px] font-medium tracking-[0.22em] transition-colors duration-[240ms] ${on ? "text-gold-hot" : "text-gold"}`}
      style={{ textShadow: on ? GLOW_HOT : GLOW }}
    />
  );
  const countEl = count !== undefined ? <span className="label text-steel-dim">{String(count).padStart(2, "0")}</span> : null;

  return (
    <m.div
      initial={false}
      animate={shown ? { opacity: 1, x: 0 } : { opacity: 0, x: spine ? 0 : -6 }}
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
        onFocus={() => {
          setHover(key);
          setFocused(true);
        }}
        onBlur={() => {
          setHover(null);
          setFocused(false);
        }}
        aria-label={count !== undefined ? `${title}, ${count} ${count === 1 ? "item" : "items"}` : title}
        className={`group min-h-11 w-full rounded-[2px] py-1 text-left outline-none ${spine ? "grid grid-cols-[1fr_auto_1fr] items-center gap-3" : "flex items-center gap-3 pr-2"}`}
        style={{ opacity: muted && !on ? 0.8 : 1 }}
      >
        {spine ? (
          <>
            <span className="label text-right text-steel-dim">{index}</span>
            {shard}
            <span className="flex min-w-0 items-baseline gap-3">
              {titleEl}
              {countEl}
            </span>
          </>
        ) : (
          <>
            <span aria-hidden className={`h-px shrink-0 transition-[width,background-color] duration-[240ms] ${on ? "w-8 bg-gold" : "w-4 bg-gold-line"}`} />
            {shard}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-baseline gap-3">
                <span className="label text-steel-dim">{index}</span>
                {titleEl}
                {countEl}
              </span>
              {blurb ? <span className={`text-[12px] leading-[18px] text-steel transition-opacity duration-[240ms] ${on ? "opacity-100" : "opacity-70"}`}>{blurb}</span> : null}
            </span>
          </>
        )}
      </button>
    </m.div>
  );
}
