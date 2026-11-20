"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { useSpinDrag } from "@/components/sphere/useSpinDrag";
import { openSections, up } from "@/lib/nav";
import Brackets from "@/components/hud/Brackets";

export const FLASH_BACK = "nav:flash-back";

/**
 * The invisible, accessible target over the hologram. Drag it to rotate the sphere; a
 * still tap opens the sections at home, closes them again, and goes up one level from a
 * section or an item. On a phone inside a section a stray tap must not throw away what
 * the visitor is reading, so there it only pulses the sphere and points at "‹ sections".
 */
export default function CoreButton({ coarse = false }: { coarse?: boolean }) {
  const view = useSiteStore((s) => s.view);
  const phase = useSiteStore((s) => s.phase);
  const step = useSiteStore((s) => s.step);
  const frame = useSphereStore((s) => s.frame);
  const tier = useSphereStore((s) => s.tier);
  const inDetail = phase === "detail";
  const intro = phase === "intro";
  const [focused, setFocused] = useState(false);
  const [pointing, setPointing] = useState(false);

  // a tap right after a change would reverse it mid-glide
  const changedAt = useRef(0);
  const downAt = useRef(0);
  // when the last pointer press happened: a click with no press before it came from the keyboard or assistive tech
  const pointerAt = useRef(0);
  useEffect(() => {
    changedAt.current = performance.now();
  }, [view, phase]);

  const act = useCallback(() => {
    const s = useSiteStore.getState();
    if (s.phase === "detail") up();
    else if (s.view === "core") openSections();
    else if (s.view === "menu") up();
    else if (coarse) {
      useSphereStore.getState().pulseToward(0, 0, 0.6);
      window.dispatchEvent(new Event(FLASH_BACK));
    } else up();
  }, [coarse]);
  // ignore a press that began within 350ms of a view change (a double tap would undo it
  // mid-glide); a change during the press is fine: the press that skipped the intro still opens
  const onTap = useCallback(() => {
    const since = downAt.current - changedAt.current;
    if (since >= 0 && since < 350) return;
    act();
  }, [act]);
  // a vertical finger drag pitches the sphere, except where the page scrolls (the section view)
  const scrolls = coarse && view === "module" && !inDetail;
  const drag = useSpinDrag({ allowPitch: !scrolls, onTap });

  if (phase === "boot") return null;

  const w = typeof window !== "undefined" ? window.innerWidth : 1440;
  const h = typeof window !== "undefined" ? window.innerHeight : 900;
  const aspect = w / Math.max(1, h);
  const size = Math.max(44, frame ? frame.size : (aspect < 0.8 ? 0.88 : 0.72) * Math.min(w, h));
  const x = frame ? frame.x : w / 2;
  const y = frame ? frame.y : h / 2;
  const isStatic = tier === "static";
  const home = view === "core" && !inDetail;
  const menu = view === "menu" && !inDetail;
  // on a phone inside a section (and over an open item) the real controls are visible text
  const pointerOnly = inDetail || (coarse && view === "module");
  const label = home ? "Show the sections" : menu ? "Hide the sections" : inDetail ? "Close the item" : "Back to all sections";
  const verb = coarse ? "tap to see my work" : "click to see my work";
  const prompt = home ? (isStatic ? verb : `${verb} · drag to rotate`) : null;
  // desktop captions say what a click on the sphere does right now
  const caption = !coarse && (pointing || focused) ? (menu ? "× close sections" : inDetail ? "× close" : null) : null;

  return (
    <div className={`pointer-events-none fixed inset-0 ${inDetail ? "z-[56]" : "z-30"}`}>
      <button
        type="button"
        data-core
        aria-label={label}
        aria-expanded={home ? false : menu ? true : undefined}
        aria-controls={menu ? (coarse ? "sections-list" : "sections-ring") : undefined}
        tabIndex={pointerOnly || intro ? -1 : 0}
        aria-hidden={pointerOnly || undefined}
        onClick={() => {
          // pointer taps are handled by the drag hook (a cancelled touch press reports detail 0 too)
          if (performance.now() - pointerAt.current > 500) act();
        }}
        onPointerDown={(e) => {
          pointerAt.current = downAt.current = performance.now();
          // a touch press must not turn into compatibility mouse events once the button has moved
          if (e.pointerType === "touch") e.preventDefault();
          drag.onPointerDown(e);
        }}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerCancel}
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse") return;
          setPointing(true);
          if (view === "module" && !inDetail) useSiteStore.getState().setHover("core");
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "mouse") return;
          setPointing(false);
          if (useSiteStore.getState().hover === "core") useSiteStore.getState().setHover(null);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`group pointer-events-auto absolute rounded-full outline-none ${isStatic ? "" : "cursor-pointer"}`}
        style={{
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          touchAction: scrolls ? "pan-y" : "none",
          // under the sticky mobile header the tabs must win the tap
          clipPath: frame?.clipTop ? `inset(${Math.max(0, frame.clipTop - (y - size / 2)).toFixed(1)}px 0 0 0)` : undefined,
          // the frame is re-pushed on every scroll in the section view: follow it directly, no lag
          transition: scrolls ? "none" : "left 480ms var(--ease-out), top 480ms var(--ease-out), width 480ms var(--ease-out), height 480ms var(--ease-out)",
        }}
      >
        {/* keyboard focus: gold corner ticks around the sphere, never a ring that blends with its rim */}
        <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-[240ms] group-focus-visible:opacity-100">
          <Brackets size={14} className="[&>span]:border-gold-hot!" />
        </span>
      </button>
      {prompt ? (
        <div
          aria-hidden
          onClick={act}
          className={`label pointer-events-auto absolute flex min-h-11 -translate-x-1/2 cursor-pointer items-center whitespace-nowrap transition-[opacity,color] duration-[480ms] ${focused ? "text-gold-hot" : "text-gold"}`}
          style={{ left: x, top: y + size / 2 + (coarse ? 12 : 20), opacity: step >= 3 ? 1 : 0 }}
        >
          <span className="inline-flex items-center gap-3">
            <span className="h-1.5 w-1.5 animate-[core-ping_1.8s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-gold" />
            {prompt}
            {!coarse ? <span className="text-steel-dim">↵</span> : null}
          </span>
        </div>
      ) : null}
      {caption ? (
        <div
          aria-hidden
          className="label absolute whitespace-nowrap text-gold-hot"
          style={
            inDetail
              ? { left: x + size / 2 + 12, top: y, transform: "translateY(-50%)" }
              : { left: x, top: y - size / 2 - 26, transform: "translate(-50%, -100%)" }
          }
        >
          {caption}
        </div>
      ) : null}
    </div>
  );
}
