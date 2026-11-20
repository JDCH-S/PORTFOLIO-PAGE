"use client";

import { useEffect, useState } from "react";
import { sectionById, sectionIds } from "@/content/content";
import { useSiteStore } from "@/store/siteStore";
import { navLink, SECTIONS, stepSection, up } from "@/lib/nav";
import { FLASH_BACK } from "./CoreButton";

export const THUMB_LINE_HEIGHT = 56;

// legible over cards without a ground behind it
const HALO =
  "0 0 2px var(--bg), 0 0 4px var(--bg), 0 0 8px var(--bg), 0 0 12px var(--bg), 0 0 18px var(--bg), 0 0 26px var(--bg)";
const GLOW_HOT =
  "0 0 16px var(--gold-glow), 0 0 3px rgba(255,236,200,0.6), " + HALO;

/**
 * Phone, inside a section: the way back and prev/next where the thumb is. Plain text on a
 * soft fade of the page colour (no bar, no rule, no box). A stray tap on the sphere makes "‹ sections" light up, to
 * show where going back actually lives.
 */
export default function ThumbLine() {
  const active = useSiteStore((s) => s.activeModule);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let t = 0;
    const on = () => {
      setFlash(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setFlash(false), 600);
    };
    window.addEventListener(FLASH_BACK, on);
    return () => {
      window.removeEventListener(FLASH_BACK, on);
      window.clearTimeout(t);
    };
  }, []);

  const i = sectionIds.indexOf(active);
  const prev = i > 0 ? sectionById(sectionIds[i - 1]) : null;
  const next =
    i < sectionIds.length - 1 ? sectionById(sectionIds[i + 1]) : null;
  // sideways is ← →; "‹" only ever means up a level
  const arrow =
    "flex h-11 w-11 items-center justify-center font-mono text-[18px] leading-none transition-colors";

  return (
    <>
      {/* a mist of the page colour, not a bar: content passing underneath never fights the labels */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30"
        style={{
          height: `calc(${THUMB_LINE_HEIGHT + 40}px + env(safe-area-inset-bottom, 0px))`,
          background:
            "linear-gradient(to top, var(--bg) 0%, var(--bg) 52%, color-mix(in oklab, var(--bg) 70%, transparent) 76%, transparent 100%)",
        }}
      />
      <nav
        aria-label="Section navigation"
        className="pointer-events-none fixed inset-x-0 z-30 flex items-center justify-between px-4"
        style={{
          bottom: "env(safe-area-inset-bottom, 0px)",
          height: THUMB_LINE_HEIGHT,
          textShadow: HALO,
        }}
      >
        <a
          {...navLink(SECTIONS, up)}
          className={`label pointer-events-auto flex h-11 items-center pr-3 transition-colors duration-[240ms] ${flash ? "text-gold-hot" : "text-gold active:text-gold-hot"}`}
          style={flash ? { textShadow: GLOW_HOT } : undefined}
        >
          <span aria-hidden>‹&nbsp;</span>sections
        </a>
        <div className="pointer-events-auto flex items-center">
          <button
            type="button"
            aria-label={
              prev ? `Previous section: ${prev.title}` : "Previous section, none"
            }
            aria-disabled={!prev}
            onClick={() => prev && stepSection(-1)}
            className={`${arrow} ${prev ? "text-gold active:text-gold-hot" : "text-steel-dim"}`}
          >
            ←
          </button>
          <span className="label text-steel" aria-hidden>
            {sectionById(active).index} /{" "}
            {String(sectionIds.length).padStart(2, "0")}
          </span>
          <button
            type="button"
            aria-label={
              next ? `Next section: ${next.title}` : "Next section, none"
            }
            aria-disabled={!next}
            onClick={() => next && stepSection(1)}
            className={`${arrow} ${next ? "text-gold active:text-gold-hot" : "text-steel-dim"}`}
          >
            →
          </button>
        </div>
      </nav>
    </>
  );
}
