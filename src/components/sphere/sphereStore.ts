import { create } from "zustand";

/**
 * Imperative control surface for the sphere, used by later phases
 * (pulse toward a hovered module, shrink into a corner, etc.).
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
  pulseToward: (x: number, y: number, strength?: number) => void;
  setScaleTarget: (s: number) => void;
  setOffsetTarget: (x: number, y: number) => void;
  setLeanTarget: (x: number, y: number) => void;
}

export const useSphereStore = create<SphereState>((set) => ({
  pulse: 0,
  pulseDir: [0, 0],
  scaleTarget: 1,
  offsetTarget: [0, 0],
  leanTarget: [0, 0],
  pulseToward: (x, y, strength = 1) => set({ pulse: Math.min(1, strength), pulseDir: [x, y] }),
  setScaleTarget: (scaleTarget) => set({ scaleTarget }),
  setOffsetTarget: (x, y) => set({ offsetTarget: [x, y] }),
  setLeanTarget: (x, y) => set({ leanTarget: [x, y] }),
}));
