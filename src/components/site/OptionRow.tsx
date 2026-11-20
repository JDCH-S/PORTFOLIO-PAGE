"use client";

import { useCallback, useState, type MouseEvent } from "react";
import { m } from "framer-motion";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import { navLink, openSection } from "@/lib/nav";
import Decode from "@/components/ui/Decode";

export interface OptionRowProps {
  id: ModuleId;
  index: string;
  title: string;
  count?: number;
  /** a few plain words under the title */
  hint?: string;
  order: number;
  /** the section open right now: lit, marked current, and a click scrolls it to the top */
  current?: boolean;
  /** rests in the lit style (the section the visitor was last in) */
  lit?: boolean;
  /** "spine": the shard sits on a centre line, index left, title right */
  layout?: "row" | "spine";
}

const GLOW = "0 0 12px var(--gold-glow)";
const GLOW_HOT = "0 0 16px var(--gold-glow), 0 0 3px rgba(255,236,200,0.6)";

/**
 * One section as minimal text: index, shard and title, no container. A real link, so
 * copy-link and new-tab give the section's URL; a plain click goes through nav.
 */
export default function OptionRow({ id, index, title, count, hint, order, current = false, lit = false, layout = "row" }: OptionRowProps) {
  const step = useSiteStore((s) => s.step);
  const setHover = useSiteStore((s) => s.setHover);
  const setAnchor = useSiteStore((s) => s.setAnchor);
  const reduced = useReducedMotion();
  const key = `opt-${id}`;
  const hovered = useSiteStore((s) => s.hover === key);
  const [focused, setFocused] = useState(false);
  const ref = useCallback((el: HTMLAnchorElement | null) => setAnchor(key, el), [key, setAnchor]);
  const shown = step >= 4;
  const on = hovered || focused || current || lit;
  const spine = layout === "spine";

  const link = navLink({ depth: 2, section: id }, () => openSection(id));
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (current) {
      // already here: back to the top of the section instead of navigating
      e.preventDefault();
      const panel = document.getElementById(`module-${id}`);
      panel?.querySelector<HTMLElement>("[data-scroll]")?.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
      return;
    }
    link.onClick(e);
  };

  const shard = <span aria-hidden className={`h-[3.5px] w-[3.5px] shrink-0 rotate-45 transition-colors duration-[240ms] ${on ? "bg-gold-hot shadow-[0_0_8px_var(--gold)]" : "bg-gold"}`} />;
  const titleEl = (
    <span className="relative">
      <Decode
        text={title.toUpperCase()}
        active={shown}
        reduced={reduced}
        duration={500}
        className={`font-display text-[15px] leading-[20px] font-medium tracking-[0.22em] transition-colors duration-[240ms] ${on ? "text-gold-hot" : "text-gold"}`}
        style={{ textShadow: on ? GLOW_HOT : GLOW }}
      />
      {/* the rule under the title: full for focus and hover, faint for "you are here", so the two never look alike */}
      <span
        aria-hidden
        className="absolute -bottom-1 left-0 h-px bg-gold transition-[width,opacity] duration-[240ms]"
        style={{ width: hovered || focused || current ? "100%" : 0, opacity: hovered || focused ? 1 : current ? 0.35 : 0 }}
      />
    </span>
  );
  const countEl = count !== undefined ? <span className="label text-steel-dim">{String(count).padStart(2, "0")}</span> : null;
  const hintEl = hint ? <span className="label block truncate text-steel-dim">{hint}</span> : null;

  return (
    <m.div
      initial={false}
      animate={shown ? { opacity: 1, x: 0 } : { opacity: 0, x: spine ? 0 : -6 }}
      transition={{ duration: reduced ? 0.2 : 0.35, delay: reduced ? 0 : order * 0.08 }}
      className={shown ? "" : "pointer-events-none"}
      aria-hidden={!shown}
      inert={!shown}
    >
      <a
        ref={ref}
        href={link.href}
        data-option={id}
        aria-current={current ? "page" : undefined}
        aria-label={count !== undefined ? `${title}, ${count} ${count === 1 ? "item" : "items"}` : title}
        onClick={onClick}
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
        className={`group min-h-11 w-full rounded-[2px] py-1 text-left outline-none ${spine ? "grid grid-cols-[1fr_auto_1fr] items-center gap-3" : "flex items-center gap-3 pr-2"}`}
      >
        {spine ? (
          <>
            <span className="label text-right text-steel-dim">{index}</span>
            {shard}
            <span className="flex min-w-0 flex-col">
              <span className="flex items-baseline gap-3">
                {titleEl}
                {countEl}
              </span>
              {hintEl}
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
              {hintEl}
            </span>
          </>
        )}
      </a>
    </m.div>
  );
}
