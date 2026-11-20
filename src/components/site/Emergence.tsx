"use client";

import { useEffect, useRef } from "react";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { spin, useSphereStore } from "@/components/sphere/sphereStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import { EMERGE, INTRO_LAST_STEP } from "@/lib/sequence";
import { openSections, stepSection, up } from "@/lib/nav";

const focus = (el: Element | null | undefined) => (el as HTMLElement | null)?.focus({ preventScroll: true });
/** the visible option button for a module (the hidden copy sits under an inert ancestor) */
/** the focus target inside an open section: its scroller (falls back to the panel) */
export const sectionScroller = (id: ModuleId) => {
  const panel = document.getElementById(`module-${id}`);
  return panel?.querySelector<HTMLElement>("[data-scroll]") ?? panel;
};
const optionButton = (id: ModuleId) => Array.from(document.querySelectorAll<HTMLElement>(`[data-option="${id}"]`)).find((el) => !el.closest("[inert]"));

/**
 * Drives the reveal steps for each view: core (bare sphere), menu (beams + options),
 * module (panel, then items). Also the global keys: Enter opens, Esc steps back. After a
 * keyboard-driven change, focus moves with the view.
 */
export default function Emergence({ desktop }: { desktop: boolean }) {
  const view = useSiteStore((s) => s.view);
  // opening and closing an item must not replay the module's emergence, so only
  // "has the intro finished" matters here, not idle vs detail
  const started = useSiteStore((s) => s.phase === "idle" || s.phase === "detail");
  const activeModule = useSiteStore((s) => s.activeModule);
  const setStep = useSiteStore((s) => s.setStep);
  const reduced = useReducedMotion();
  const lastInput = useRef<"pointer" | "keyboard">("pointer");
  const lastModule = useRef<ModuleId | null>(null);
  const lastView = useRef<string | null>(null);

  // which input drove the last change decides whether focus is moved
  useEffect(() => {
    let lastPointer = 0;
    const mark = (input: "pointer" | "keyboard") => {
      lastInput.current = input;
      useSiteStore.getState().setLastInput(input);
    };
    const onPointer = () => {
      lastPointer = performance.now();
      mark("pointer");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab" || e.key === "Enter" || e.key === "Escape" || e.key === " " || e.key.startsWith("Arrow")) mark("keyboard");
    };
    // screen readers, voice control and switch access activate with a synthetic click (detail 0)
    const onClick = (e: MouseEvent) => {
      // (a cancelled touch press also yields detail 0, hence the pointer check)
      if (e.detail === 0 && performance.now() - lastPointer > 500) mark("keyboard");
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("click", onClick, true);
    };
  }, []);

  useEffect(() => {
    if (!started) return;
    const t = reduced ? EMERGE.quick : desktop ? EMERGE.desktop : EMERGE.mobile;
    const sphere = useSphereStore.getState();
    const byKeyboard = lastInput.current === "keyboard";
    const entered = lastView.current !== view;
    lastView.current = view;
    // a coasting sphere is braked while it glides to the view's frame
    spin.brakeUntil = performance.now() + 700;
    if (view === "core") {
      setStep(INTRO_LAST_STEP);
      if (byKeyboard) focus(document.querySelector("[data-core]"));
      return;
    }
    if (view === "menu") {
      sphere.pulseToward(0, 0, 1);
      // collapse a module first so its panel re-materialises next time
      setStep(3);
      const ids = [window.setTimeout(() => setStep(4), t.options * 1000)];
      // back from a module: focus returns to that module's option
      if (byKeyboard) ids.push(window.setTimeout(() => focus(optionButton(useSiteStore.getState().lastModule ?? lastModule.current ?? "projects")), t.options * 1000 + 60));
      return () => ids.forEach((id) => window.clearTimeout(id));
    }
    // module: the panel materialises, then its items. On desktop a module switch remounts the
    // panel, so it materialises again; on a phone all panes stay mounted and a tab swipe keeps them.
    lastModule.current = activeModule;
    sphere.pulseToward(0, 0, 0.6);
    const replay = entered || desktop;
    const ids: number[] = [];
    if (replay) {
      setStep(4);
      ids.push(window.setTimeout(() => setStep(5), t.panel * 1000), window.setTimeout(() => setStep(6), t.items * 1000));
    } else if (useSiteStore.getState().step < 6) {
      // a tab change while the section was still appearing: finish the reveal, never leave it half drawn
      setStep(5);
      ids.push(window.setTimeout(() => setStep(6), Math.max(0, t.items - t.panel) * 1000));
    }
    // the section's scroller takes focus once its items are in: arrows and Space scroll it, Tab reaches the first item
    if (byKeyboard) ids.push(window.setTimeout(() => focus(sectionScroller(activeModule)), replay ? t.items * 1000 + 80 : 0));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [view, activeModule, started, desktop, reduced, setStep]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useSiteStore.getState();
      if (s.phase !== "idle" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      // one meaning for Esc everywhere: up one level (the dialog handles its own Esc)
      if (e.key === "Escape" && s.view !== "core") {
        e.preventDefault();
        up();
        return;
      }
      if (e.key === "Enter" && s.view === "core" && (!target || target === document.body)) {
        e.preventDefault();
        openSections();
        return;
      }
      // in a section, left/right step to the neighbouring section (arrow groups handle their own keys first;
      // up/down, Page keys and Space keep scrolling the content)
      if (s.view === "module") {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          stepSection(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          stepSection(-1);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
