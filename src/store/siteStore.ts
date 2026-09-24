import { create } from "zustand";
import type { ModuleId } from "@/content/types";

export type SitePhase = "boot" | "intro" | "idle" | "detail";

/** Intro reveal steps, in order. Components reveal when `step >= their step`. */
export type IntroStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;
// 0 black · 1 sphere assembling · 2 initialising text · 3 name decoded · 4 beams · 5 panels · 6 items

export interface SiteState {
  phase: SitePhase;
  step: IntroStep;
  /** true when the full intro was already seen on this device */
  introSeen: boolean;
  activeModule: ModuleId;
  /** id of the open item (detail view) */
  activeItem: string | null;
  /** id of the hovered/focused module or item, for the sphere lean */
  hover: string | null;
  setPhase: (phase: SitePhase) => void;
  setStep: (step: IntroStep) => void;
  setIntroSeen: (seen: boolean) => void;
  setActiveModule: (m: ModuleId) => void;
  openItem: (id: string) => void;
  closeItem: () => void;
  setHover: (id: string | null) => void;
  /** DOM anchors modules register so beams and the sphere lean can find them */
  anchors: Partial<Record<ModuleId, HTMLElement | null>>;
  setAnchor: (id: ModuleId, el: HTMLElement | null) => void;
}

export const useSiteStore = create<SiteState>((set) => ({
  phase: "boot",
  step: 0,
  introSeen: false,
  activeModule: "projects",
  activeItem: null,
  hover: null,
  setPhase: (phase) => set({ phase }),
  setStep: (step) => set({ step }),
  setIntroSeen: (introSeen) => set({ introSeen }),
  setActiveModule: (activeModule) => set({ activeModule }),
  openItem: (activeItem) => set({ activeItem, phase: "detail" }),
  closeItem: () => set({ activeItem: null, phase: "idle" }),
  setHover: (hover) => set({ hover }),
  anchors: {},
  setAnchor: (id, el) => set((s) => ({ anchors: { ...s.anchors, [id]: el } })),
}));
