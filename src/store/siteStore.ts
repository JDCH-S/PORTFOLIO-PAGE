import { create } from "zustand";
import type { ModuleId } from "@/content/types";

export type SitePhase = "boot" | "intro" | "idle" | "detail";
/**
 * core   = the hologram alone (default)
 * menu   = the three options have emerged around the sphere
 * module = one module is fully open; the other two stay as chips
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
  /** click the core: the three options emerge */
  openMenu: () => void;
  /** click an option: that module opens fully */
  openModule: (module: ModuleId) => void;
  /** from a module back to the three options */
  backToMenu: () => void;
  /** back to the hologram alone */
  closeToCore: () => void;
  setActiveModule: (m: ModuleId) => void;
  openItem: (id: string) => void;
  closeItem: () => void;
  setHover: (id: string | null) => void;
  setAnchor: (id: string, el: HTMLElement | null) => void;
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
  setPhase: (phase) => set({ phase }),
  setStep: (step) => set({ step }),
  setIntroSeen: (introSeen) => set({ introSeen }),
  openMenu: () => set({ view: "menu", activeItem: null, phase: "idle" }),
  openModule: (activeModule) => set({ view: "module", activeModule, activeItem: null, phase: "idle" }),
  backToMenu: () => set({ view: "menu", activeItem: null, phase: "idle", hover: null }),
  closeToCore: () => set({ view: "core", activeItem: null, phase: "idle", hover: null }),
  setActiveModule: (activeModule) => set({ activeModule }),
  openItem: (activeItem) => set({ activeItem, phase: "detail" }),
  closeItem: () => set({ activeItem: null, phase: "idle" }),
  setHover: (hover) => set({ hover }),
  setAnchor: (id, el) => set((s) => (s.anchors[id] === el ? s : { anchors: { ...s.anchors, [id]: el } })),
}));
