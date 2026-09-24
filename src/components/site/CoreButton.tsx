"use client";

import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import Kbd from "@/components/ui/Kbd";

/**
 * The invisible, accessible target over the hologram. In the core view it opens the
 * content; in the modules view it collapses back to the lone hologram.
 */
export default function CoreButton({ coarse = false }: { coarse?: boolean }) {
  const view = useSiteStore((s) => s.view);
  const phase = useSiteStore((s) => s.phase);
  const step = useSiteStore((s) => s.step);
  const openModules = useSiteStore((s) => s.openModules);
  const closeModules = useSiteStore((s) => s.closeModules);
  const frame = useSphereStore((s) => s.frame);
  if (phase === "boot" || phase === "intro" || phase === "detail") return null;

  const w = typeof window !== "undefined" ? window.innerWidth : 1440;
  const h = typeof window !== "undefined" ? window.innerHeight : 900;
  const aspect = w / Math.max(1, h);
  const size = frame ? frame.size : (aspect < 0.8 ? 0.88 : 0.72) * Math.min(w, h);
  const x = frame ? frame.x : w / 2;
  const y = frame ? frame.y : h / 2;
  const core = view === "core";

  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      <button
        type="button"
        aria-label={core ? "Open the core: show projects, agents and systems" : "Collapse back to the core"}
        onClick={() => (core ? openModules() : closeModules())}
        className="group pointer-events-auto absolute rounded-full outline-offset-8 focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold"
        style={{ left: x - size / 2, top: y - size / 2, width: size, height: size, transition: "left 480ms var(--ease-out), top 480ms var(--ease-out), width 480ms var(--ease-out), height 480ms var(--ease-out)" }}
      />
      {core ? (
        <div
          className="label absolute -translate-x-1/2 text-center text-gold transition-opacity duration-[480ms]"
          style={{ left: x, top: y + size / 2 + 22, opacity: step >= 3 ? 1 : 0 }}
        >
          <span className="inline-flex items-center gap-3 rounded-[2px] border border-gold-line bg-bg/50 px-3 py-2">
            <span className="h-1.5 w-1.5 animate-[core-ping_1.8s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-gold" />
            {coarse ? "tap the core" : "enter the core"}
            {!coarse ? <Kbd>enter</Kbd> : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}
