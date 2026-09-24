import { create } from "zustand";

/**
 * Drag-to-rotate state, shared between the pointer handlers (useSpinDrag) and the rig.
 * A plain object on purpose: it changes every pointer move and every frame, and nothing
 * in React needs to re-render for it.
 */
export const spin = {
  active: false,
  /** accumulated rotation, radians */
  yaw: 0,
  pitch: 0,
  /** inertia after release, radians per second */
  vYaw: 0,
  vPitch: 0,
  /** until this time (performance.now ms) the coast is braked hard: set on view changes */
  brakeUntil: 0,
};

/**
 * Imperative control surface for the sphere, used by later phases
 * (pulse toward a hovered module, shrink into a corner, etc.), plus
 * live telemetry for the debug panel and caption.
 * Values are read every frame by the rig, so they are plain numbers.
 */
export interface SphereState {
  /** transient pulse energy 0..1, decays each frame */
  pulse: number;
  /** direction (normalised screen x,y) the sphere leans toward while pulsing */
  pulseDir: [number, number];
  /** target uniform scale of the whole sphere */
  scaleTarget: number;
  /** target offset of the sphere in world units (x, y) */
  offsetTarget: [number, number];
  /** extra lean applied by the UI (e.g. hover), added to pointer tilt */
  leanTarget: [number, number];
  /** telemetry (updated about once per second) */
  fps: number;
  fragments: number;
  tier: "high" | "medium" | "low" | "static";
  /** true once the scene has rendered its first frames (or the static poster is what we show) */
  ready: boolean;
  /** intro: shells assembled (0..1, outer to inner), vortex ignition (0..1), sparks converged (0..1) */
  assemble: number;
  ignite: number;
  converge: number;
  /**
   * Where the sphere should sit on screen, in CSS pixels (centre + diameter), or null for the
   * default centred framing. The scene converts this into scale and offset targets.
   */
  frame: { x: number; y: number; size: number; clipTop?: number } | null;
  /** the intro wants a black start: keep the loading poster hidden */
  hidePoster: boolean;
  pulseToward: (x: number, y: number, strength?: number) => void;
  setScaleTarget: (s: number) => void;
  setOffsetTarget: (x: number, y: number) => void;
  setLeanTarget: (x: number, y: number) => void;
  setStats: (fps: number, fragments: number) => void;
  setTier: (tier: "high" | "medium" | "low" | "static") => void;
  setReady: (ready: boolean) => void;
  setIntro: (v: Partial<{ assemble: number; ignite: number; converge: number }>) => void;
  setFrame: (frame: { x: number; y: number; size: number; clipTop?: number } | null) => void;
  setHidePoster: (hide: boolean) => void;
}

export const useSphereStore = create<SphereState>((set) => ({
  pulse: 0,
  pulseDir: [0, 0],
  scaleTarget: 1,
  offsetTarget: [0, 0],
  leanTarget: [0, 0],
  fps: 0,
  fragments: 0,
  tier: "high",
  ready: false,
  assemble: 1,
  ignite: 1,
  converge: 1,
  frame: null,
  hidePoster: false,
  pulseToward: (x, y, strength = 1) => set({ pulse: Math.min(1, strength), pulseDir: [x, y] }),
  setScaleTarget: (scaleTarget) => set({ scaleTarget }),
  setOffsetTarget: (x, y) => set({ offsetTarget: [x, y] }),
  setLeanTarget: (x, y) => set({ leanTarget: [x, y] }),
  setStats: (fps, fragments) => set((s) => (s.fps === fps && s.fragments === fragments ? s : { fps, fragments })),
  setTier: (tier) => set({ tier }),
  setReady: (ready) => set({ ready }),
  setIntro: (v) => set(v),
  setFrame: (frame) => set({ frame }),
  setHidePoster: (hidePoster) => set({ hidePoster }),
}));
