"use client";

import { useEffect } from "react";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import { EMERGE, INTRO_LAST_STEP } from "@/lib/sequence";

/**
 * Drives the reveal steps when the core is opened (beams -> panels -> items) and
 * collapses them when it is closed. Also the global keys: Enter opens, Esc closes.
 */
export default function Emergence({ desktop }: { desktop: boolean }) {
  const view = useSiteStore((s) => s.view);
  const phase = useSiteStore((s) => s.phase);
  const setStep = useSiteStore((s) => s.setStep);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (phase === "boot" || phase === "intro") return;
    if (view === "core") {
      setStep(INTRO_LAST_STEP);
      return;
    }
    const t = reduced ? EMERGE.quick : desktop ? EMERGE.desktop : EMERGE.mobile;
    useSphereStore.getState().pulseToward(0, 0, 1);
    const ids = [
      window.setTimeout(() => setStep(4), t.beams * 1000),
      window.setTimeout(() => setStep(5), t.panels * 1000),
      window.setTimeout(() => setStep(6), t.items * 1000),
    ];
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [view, phase, desktop, reduced, setStep]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useSiteStore.getState();
      if (s.phase !== "idle") return;
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (typing) return;
      if (e.key === "Escape" && s.view === "modules" && !s.activeItem) {
        e.preventDefault();
        s.closeModules();
      }
      if (e.key === "Enter" && s.view === "core" && (!target || target === document.body)) {
        e.preventDefault();
        s.openModules();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
