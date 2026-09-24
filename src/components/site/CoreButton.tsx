"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { useSpinDrag } from "@/components/sphere/useSpinDrag";

/**
 * The invisible, accessible target over the hologram. Drag it to rotate the sphere;
 * tap it to step through the views: core -> options, options -> core, module -> options,
 * and the parked sphere closes an open item.
 */
export default function CoreButton({ coarse = false }: { coarse?: boolean }) {
  const view = useSiteStore((s) => s.view);
  const phase = useSiteStore((s) => s.phase);
  const step = useSiteStore((s) => s.step);
  const frame = useSphereStore((s) => s.frame);
  const tier = useSphereStore((s) => s.tier);
  const inDetail = phase === "detail";

  // a tap right after a change would reverse it mid-glide
  const changedAt = useRef(0);
  useEffect(() => {
    changedAt.current = performance.now();
  }, [view, phase]);

  const act = useCallback(() => {
    const s = useSiteStore.getState();
    if (s.phase === "detail") s.closeItem();
    else if (s.view === "core") s.openMenu();
    else if (s.view === "menu") s.closeToCore();
    else s.backToMenu();
  }, []);
  // a pointer tap right after a change would reverse it mid-glide; keyboard activations are deliberate
  const onTap = useCallback(() => {
    if (performance.now() - changedAt.current < 350) return;
    act();
  }, [act]);
  // a vertical finger drag pitches the sphere, except where the page scrolls (the module view)
  const scrolls = coarse && view === "module" && !inDetail;
  const drag = useSpinDrag({ allowPitch: !scrolls, onTap });

  if (phase === "boot" || phase === "intro") return null;

  const w = typeof window !== "undefined" ? window.innerWidth : 1440;
  const h = typeof window !== "undefined" ? window.innerHeight : 900;
  const aspect = w / Math.max(1, h);
  const size = Math.max(44, frame ? frame.size : (aspect < 0.8 ? 0.88 : 0.72) * Math.min(w, h));
  const x = frame ? frame.x : w / 2;
  const y = frame ? frame.y : h / 2;
  const isStatic = tier === "static";
  const label = inDetail ? "Close the item" : view === "core" ? "Open the core: show the modules" : view === "menu" ? "Collapse back to the core" : "Back to the modules";
  // only the bare core needs a prompt; the menu and module views label themselves
  const verb = coarse ? "tap the core" : "enter the core";
  const prompt = view === "core" && !inDetail ? (isStatic ? verb : `${verb} · drag to rotate`) : null;

  return (
    <div className={`pointer-events-none fixed inset-0 ${inDetail ? "z-[56]" : "z-30"}`}>
      <button
        type="button"
        data-core
        aria-label={label}
        // while an item is open the dialog owns the keyboard; the parked sphere is pointer-only
        tabIndex={inDetail ? -1 : 0}
        aria-hidden={inDetail || undefined}
        onClick={(e) => {
          // pointer taps are handled by the drag hook; this is for keyboard activation
          if (e.detail === 0) act();
        }}
        {...drag}
        className={`pointer-events-auto absolute rounded-full outline-offset-8 focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold ${isStatic ? "" : "cursor-grab active:cursor-grabbing"}`}
        style={{
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          touchAction: scrolls ? "pan-y" : "none",
          // under the sticky mobile header the tabs must win the tap
          clipPath: frame?.clipTop ? `inset(${Math.max(0, frame.clipTop - (y - size / 2)).toFixed(1)}px 0 0 0)` : undefined,
          // the frame is re-pushed on every scroll in the module view: follow it directly, no lag
          transition: scrolls ? "none" : "left 480ms var(--ease-out), top 480ms var(--ease-out), width 480ms var(--ease-out), height 480ms var(--ease-out)",
        }}
      />
      {prompt ? (
        <div
          className="label absolute -translate-x-1/2 text-center whitespace-nowrap text-gold transition-opacity duration-[480ms]"
          style={{ left: x, top: y + size / 2 + 22, opacity: step >= 3 ? 1 : 0 }}
        >
          <span className="inline-flex items-center gap-3">
            <span className="h-1.5 w-1.5 animate-[core-ping_1.8s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-gold" />
            {prompt}
            {!coarse ? <span className="text-steel-dim">↵ enter</span> : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}
