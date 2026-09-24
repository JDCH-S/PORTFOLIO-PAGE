"use client";

import { modules } from "@/content/content";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";

/** Jump between modules. Desktop: top-right corner; mobile: the tab bar. */
export default function CornerNav({ className = "", onSelect }: { className?: string; onSelect?: (id: ModuleId) => void }) {
  const active = useSiteStore((s) => s.activeModule);
  const setActive = useSiteStore((s) => s.setActiveModule);
  const anchors = useSiteStore((s) => s.anchors);
  return (
    <nav aria-label="Modules" className={`flex items-center gap-1 ${className}`}>
      {modules.map((m) => {
        const on = active === m.id;
        return (
          <button
            key={m.id}
            type="button"
            aria-current={on ? "true" : undefined}
            onClick={() => {
              setActive(m.id);
              useSphereStore.getState().pulseToward(0, 0, 0.5);
              onSelect?.(m.id);
              const el = anchors[m.id];
              if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "nearest" });
                const focusable = el.querySelector<HTMLElement>("button, a, [tabindex]");
                focusable?.focus({ preventScroll: true });
              }
            }}
            className={`label flex h-11 items-center gap-2 rounded-[2px] border px-3 transition-colors duration-[240ms] ${
              on ? "border-gold text-gold-hot" : "border-transparent text-steel hover:border-steel-line hover:text-fg"
            }`}
          >
            <span className="text-steel-dim">{m.index}</span>
            {m.title}
          </button>
        );
      })}
    </nav>
  );
}
