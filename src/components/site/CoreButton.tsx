"use client";

import { useCallback } from "react";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { useSpinDrag } from "@/components/sphere/useSpinDrag";
import Kbd from "@/components/ui/Kbd";

/**
 * The invisible, accessible target over the hologram. Drag it to rotate the sphere;
 * tap it to step through the views: core -> options, options -> core, module -> options.
 */
export default function CoreButton({ coarse = false }: { coarse?: boolean }) {
  const view = useSiteStore((s) => s.view);
  const phase = useSiteStore((s) => s.phase);
  const step = useSiteStore((s) => s.step);
  const frame = useSphereStore((s) => s.frame);

  const onTap = useCallback(() => {
    const s = useSiteStore.getState();
    if (s.view === "core") s.openMenu();
    else if (s.view === "menu") s.closeToCore();
    else s.backToMenu();
  }, []);
  const drag = useSpinDrag({ allowPitch: !coarse, onTap });

  if (phase === "boot" || phase === "intro" || phase === "detail") return null;

  const w = typeof window !== "undefined" ? window.innerWidth : 1440;
  const h = typeof window !== "undefined" ? window.innerHeight : 900;
  const aspect = w / Math.max(1, h);
  const size = frame ? frame.size : (aspect < 0.8 ? 0.88 : 0.72) * Math.min(w, h);
  const x = frame ? frame.x : w / 2;
  const y = frame ? frame.y : h / 2;
  const label = view === "core" ? "Open the core: show the three modules" : view === "menu" ? "Collapse back to the core" : "Back to the three modules";
  // only the bare core needs a prompt; the menu and module views label themselves
  const prompt = view === "core" ? (coarse ? "tap the core · drag to rotate" : "enter the core · drag to rotate") : null;

  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      <button
        type="button"
        aria-label={label}
        onClick={(e) => {
          // pointer taps are handled by the drag hook; this is for keyboard activation
          if (e.detail === 0) onTap();
        }}
        {...drag}
        className="pointer-events-auto absolute cursor-grab rounded-full outline-offset-8 active:cursor-grabbing focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold"
        style={{
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          touchAction: coarse ? "pan-y" : "none",
          transition: "left 480ms var(--ease-out), top 480ms var(--ease-out), width 480ms var(--ease-out), height 480ms var(--ease-out)",
        }}
      />
      {prompt ? (
        <div
          className="label absolute -translate-x-1/2 text-center whitespace-nowrap text-gold transition-opacity duration-[480ms]"
          style={{ left: x, top: y + size / 2 + 22, opacity: step >= 3 ? 1 : 0 }}
        >
          <span className="inline-flex items-center gap-3 rounded-[2px] border border-gold-line bg-bg/50 px-3 py-2">
            <span className="h-1.5 w-1.5 animate-[core-ping_1.8s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-gold" />
            {prompt}
            {!coarse ? <Kbd>enter</Kbd> : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}
