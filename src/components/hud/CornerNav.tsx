"use client";

import { aboutEntry, modules } from "@/content/content";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";

/** Jump between modules. Desktop: top-right corner; mobile: the tab bar. */
export default function CornerNav({ className = "", onSelect }: { className?: string; onSelect?: (id: ModuleId) => void }) {
  const active = useSiteStore((s) => s.activeModule);
  const view = useSiteStore((s) => s.view);
  const openModule = useSiteStore((s) => s.openModule);
  const closeToCore = useSiteStore((s) => s.closeToCore);
  const open = view === "module";
  return (
    <nav aria-label="Modules" className={`flex items-center gap-1 ${className}`}>
      <button
        type="button"
        aria-pressed={view === "core"}
        onClick={() => closeToCore()}
        className={`label flex h-11 items-center gap-2 rounded-[2px] border px-3 transition-colors duration-[240ms] ${
          view === "core" ? "border-gold text-gold-hot" : "border-transparent text-steel hover:border-steel-line hover:text-fg"
        }`}
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold" />
        core
      </button>
      {[...modules, aboutEntry].map((m) => {
        const on = open && active === m.id;
        return (
          <button
            key={m.id}
            type="button"
            aria-current={on ? "true" : undefined}
            onClick={() => {
              openModule(m.id);
              useSphereStore.getState().pulseToward(0, 0, 0.5);
              onSelect?.(m.id);
              // focus the module once it has emerged
              window.setTimeout(() => {
                const el = useSiteStore.getState().anchors[m.id];
                if (!el) return;
                el.scrollIntoView({ behavior: "smooth", block: "nearest" });
                el.querySelector<HTMLElement>("button, a, [tabindex]")?.focus({ preventScroll: true });
              }, open ? 0 : 800);
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
