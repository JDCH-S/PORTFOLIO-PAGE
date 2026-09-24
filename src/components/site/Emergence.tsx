"use client";

import { useEffect } from "react";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import { EMERGE, INTRO_LAST_STEP } from "@/lib/sequence";

/**
 * Drives the reveal steps for each view: core (bare sphere), menu (beams + options),
 * module (panel, then items). Also the global keys: Enter opens, Esc steps back.
 */
export default function Emergence({ desktop }: { desktop: boolean }) {
  const view = useSiteStore((s) => s.view);
  const phase = useSiteStore((s) => s.phase);
  const activeModule = useSiteStore((s) => s.activeModule);
  const setStep = useSiteStore((s) => s.setStep);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (phase === "boot" || phase === "intro") return;
    const t = reduced ? EMERGE.quick : desktop ? EMERGE.desktop : EMERGE.mobile;
    const sphere = useSphereStore.getState();
    if (view === "core") {
      setStep(INTRO_LAST_STEP);
      return;
    }
    if (view === "menu") {
      sphere.pulseToward(0, 0, 1);
      // collapse a module first so its panel re-materialises next time
      setStep(3);
      const id = window.setTimeout(() => setStep(4), t.options * 1000);
      return () => window.clearTimeout(id);
    }
    // module: options stay (as chips), the panel materialises, then its items
    sphere.pulseToward(0, 0, 0.6);
    setStep(4);
    const ids = [window.setTimeout(() => setStep(5), t.panel * 1000), window.setTimeout(() => setStep(6), t.items * 1000)];
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [view, activeModule, phase, desktop, reduced, setStep]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useSiteStore.getState();
      if (s.phase !== "idle") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") {
        if (s.view === "module") {
          e.preventDefault();
          s.backToMenu();
        } else if (s.view === "menu") {
          e.preventDefault();
          s.closeToCore();
        }
      }
      if (e.key === "Enter" && s.view === "core" && (!target || target === document.body)) {
        e.preventDefault();
        s.openMenu();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
