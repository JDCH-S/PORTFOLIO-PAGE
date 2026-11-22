import { create } from "zustand";

/**
 * Drag-to-turn state of the head (clamped to about +-55 deg yaw / +-25 deg pitch, springing back to front), shared between the pointer handlers (useSpinDrag) and the rig.
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
 * The rig's current pose without the camera-facing correction (pointer lean + idle sway + drag), radians.
 * Written by SphereRig every frame; the hologram counter-rotates its orbitals against it.
 */
export const rigPose = { yaw: 0, pitch: 0 };

/**
 * Imperative control surface for the hologram (the store keeps its old name), used by later phases
 * (pulse toward a hovered module, shrink into a corner, etc.), plus
 * live telemetry for the debug panel and caption.
 * Values are read every frame by the rig, so they are plain numbers.
 */
export interface SphereState {
  /** transient pulse energy 0..1, decays each frame */
  pulse: number;
  /** direction (normalised screen x,y) the head leans toward while pulsing */
  pulseDir: [number, number];
  /** target uniform scale of the whole hologram */
  scaleTarget: number;
  /** target offset of the hologram in world units (x, y) */
  offsetTarget: [number, number];
  /** extra lean applied by the UI (e.g. hover), added to pointer tilt */
  leanTarget: [number, number];
  /** telemetry (updated about once per second) */
  fps: number;
  /** filament points of the built head */
  filaments: number;
  tier: "high" | "medium" | "low" | "static";
  /** true once the scene has rendered its first frames (or the static poster is what we show) */
  ready: boolean;
  /** intro: head scanned in top-down (0..1), filaments lit (0..1), dust converged (0..1) */
  assemble: number;
  ignite: number;
  converge: number;
  /**
   * Where the hologram (its unit circle) should sit on screen, in CSS pixels (centre + diameter), or null for the
   * default centred framing. The scene converts this into scale and offset targets.
   */
  frame: { x: number; y: number; size: number } | null;
  /** the live scene is mounted and its head is still being built (the intro waits for it) */
  building: boolean;
  pulseToward: (x: number, y: number, strength?: number) => void;
  setScaleTarget: (s: number) => void;
  setOffsetTarget: (x: number, y: number) => void;
  setLeanTarget: (x: number, y: number) => void;
  setStats: (fps: number, filaments: number) => void;
  setTier: (tier: "high" | "medium" | "low" | "static") => void;
  setReady: (ready: boolean) => void;
  setIntro: (v: Partial<{ assemble: number; ignite: number; converge: number }>) => void;
  setFrame: (frame: { x: number; y: number; size: number } | null) => void;
  setBuilding: (building: boolean) => void;
}

export const useSphereStore = create<SphereState>((set) => ({
  pulse: 0,
  pulseDir: [0, 0],
  scaleTarget: 1,
  offsetTarget: [0, 0],
  leanTarget: [0, 0],
  fps: 0,
  filaments: 0,
  tier: "high",
  ready: false,
  assemble: 1,
  ignite: 1,
  converge: 1,
  frame: null,
  building: false,
  // (the rig integrates these with springs: one non-finite target would latch it at NaN for good, a NaN transform
  // for every shader, so such a value is dropped here)
  pulseToward: (x, y, strength = 1) =>
    Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(strength) ? set({ pulse: Math.min(1, strength), pulseDir: [x, y] }) : undefined,
  setScaleTarget: (scaleTarget) => (Number.isFinite(scaleTarget) && scaleTarget > 0 ? set({ scaleTarget }) : undefined),
  setOffsetTarget: (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? set({ offsetTarget: [x, y] }) : undefined),
  setLeanTarget: (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? set({ leanTarget: [x, y] }) : undefined),
  setStats: (fps, filaments) => set((s) => (s.fps === fps && s.filaments === filaments ? s : { fps, filaments })),
  setTier: (tier) => set({ tier }),
  setReady: (ready) => set({ ready }),
  setIntro: (v) => set(v),
  setFrame: (frame) => set({ frame }),
  setBuilding: (building) => set({ building }),
}));
