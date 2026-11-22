/**
 * Tier budgets and the tweakable "look" of the face hologram (scene, rig and post).
 * The geometry itself is measured data (src/components/hologram); the debug panel on /sphere drives these values.
 */
export type Tier = "high" | "medium" | "low";

export interface TierBudget {
  /** device pixel ratio clamp */
  dpr: [number, number];
  /** bloom mip levels (fewer = cheaper) */
  bloomLevels: number;
}

/**
 * The hologram tiers have the same names: high ~240k-310k vertices (finest slice pitch, densest strands; the upper end once
 * the slice pitch reaches its minimum on large DPR-2 displays), medium ~185k,
 * low ~135k (phones ~115k). The slice pitch also follows the canvas DPR, so a lower DPR cap is part of each tier.
 */
export const TIER_BUDGETS: Record<Tier, TierBudget> = {
  high: { dpr: [1, 2], bloomLevels: 7 },
  medium: { dpr: [1, 1.5], bloomLevels: 6 },
  low: { dpr: [1, 1.25], bloomLevels: 4 },
};

export type ToneMode = "none" | "aces" | "agx" | "neutral";

export interface SphereLook {
  // --- hologram (live uniforms) ---
  gain: number;
  halo: number;
  nodes: number;
  // --- motion (live) ---
  breatheAmount: number;
  breatheSpeed: number;
  /** cursor / device-orientation lean */
  tilt: number;
  /** idle sway (yaw 6 deg, pitch 2.5 deg at 1) */
  sway: number;
  // --- colour ---
  colorBase: string;
  colorHot: string;
  colorDeep: string;
  // --- post ---
  bloom: boolean;
  bloomIntensity: number;
  bloomThreshold: number;
  bloomSmoothing: number;
  bloomRadius: number;
  toneMapping: ToneMode;
}

export const DEFAULT_LOOK: SphereLook = {
  gain: 1,
  halo: 1,
  nodes: 1,

  breatheAmount: 0.008,
  breatheSpeed: 0.22,
  tilt: 1,
  sway: 1,

  colorBase: "#ffb23f",
  colorHot: "#ffecc8",
  colorDeep: "#ff6a00",

  bloom: true,
  bloomIntensity: 1.6,
  bloomThreshold: 0.5,
  bloomSmoothing: 0.2,
  bloomRadius: 0.78,
  toneMapping: "aces",
};
