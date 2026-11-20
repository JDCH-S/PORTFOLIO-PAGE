import { create } from "zustand";
import type { ModuleId } from "@/content/types";

export type SitePhase = "boot" | "intro" | "idle" | "detail";
/**
 * The view names are internal; the visitor sees them as:
 * core   = home: the hologram alone (default)
 * menu   = sections: the five sections revealed around the sphere
 * module = one section open
 * (an open item is `activeItem` over the module view, phase "detail")
 * URLs and history live in src/lib/nav.ts, which drives these actions.
 */
export type SiteView = "core" | "menu" | "module";

/** Reveal steps, in order. Components reveal when `step >= their step`. */
export type IntroStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;
// 0 black · 1 sphere assembling · 2 initialising text · 3 name decoded (bare core)
// 4 beams + options · 5 module panel · 6 items

export interface SiteState {
  phase: SitePhase;
  view: SiteView;
  step: IntroStep;
  /** true when the full intro was already seen on this device */
  introSeen: boolean;
  activeModule: ModuleId;
  /** id of the open item (detail view) */
  activeItem: string | null;
  /** id of the hovered/focused option, module or item, for the sphere lean */
  hover: string | null;
  /** DOM anchors (modules and options) so beams and the sphere lean can find them */
  anchors: Record<string, HTMLElement | null>;
  setPhase: (phase: SitePhase) => void;
  setStep: (step: IntroStep) => void;
  setIntroSeen: (seen: boolean) => void;
  /** click the sphere: the five sections emerge */
  openMenu: () => void;
  /** click a section: it opens fully */
  openModule: (module: ModuleId) => void;
  /** from a section back to the five sections */
  backToMenu: () => void;
  /** back to the hologram alone */
  closeToCore: () => void;
  setActiveModule: (m: ModuleId) => void;
  openItem: (id: string) => void;
  closeItem: () => void;
  setHover: (id: string | null) => void;
  setAnchor: (id: string, el: HTMLElement | null) => void;
  /** the section the visitor was last in: lit in the menu, and where keyboard focus returns */
  lastModule: ModuleId | null;
  /** the item last opened: focus returns to its card when it closes */
  lastItem: string | null;
  /** what drove the last change; focus only moves for keyboard and assistive-tech input */
  lastInput: "pointer" | "keyboard";
  setLastInput: (input: "pointer" | "keyboard") => void;
}

export const useSiteStore = create<SiteState>((set) => ({
  phase: "boot",
  view: "core",
  step: 0,
  introSeen: false,
  activeModule: "projects",
  activeItem: null,
  hover: null,
  anchors: {},
  lastModule: null,
  lastItem: null,
  lastInput: "pointer",
  setPhase: (phase) => set({ phase }),
  setStep: (step) => set({ step }),
  setIntroSeen: (introSeen) => set({ introSeen }),
  openMenu: () => set({ view: "menu", activeItem: null, phase: "idle" }),
  openModule: (activeModule) => set({ view: "module", activeModule, lastModule: activeModule, activeItem: null, phase: "idle", hover: null }),
  backToMenu: () => set({ view: "menu", activeItem: null, phase: "idle", hover: null }),
  closeToCore: () => set({ view: "core", activeItem: null, phase: "idle", hover: null }),
  setActiveModule: (activeModule) => set((s) => ({ activeModule, lastModule: s.view === "module" ? activeModule : s.lastModule })),
  openItem: (activeItem) => set({ activeItem, lastItem: activeItem, phase: "detail" }),
  closeItem: () => set({ activeItem: null, phase: "idle" }),
  setHover: (hover) => set({ hover }),
  setAnchor: (id, el) => set((s) => (s.anchors[id] === el ? s : { anchors: { ...s.anchors, [id]: el } })),
  setLastInput: (lastInput) => set((s) => (s.lastInput === lastInput ? s : { lastInput })),
}));
