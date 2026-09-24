/**
 * Tier budgets and the tweakable "look" of the holographic sphere.
 * Everything in SphereLook is driven by the debug panel in Phase 1 and will be
 * frozen into design tokens once approved.
 */
export type Tier = "high" | "medium" | "low";

export interface TierBudget {
  /** target number of light fragments across all shells (density 1.0) */
  fragments: number;
  /** vortex spiral ribbons */
  ribbons: number;
  /** closed bright rings inside the vortex */
  rings: number;
  ribbonSegments: number;
  /** floating sparks */
  particles: number;
  /** device pixel ratio clamp */
  dpr: [number, number];
  /** bloom mip levels (fewer = cheaper) */
  bloomLevels: number;
  /** strip subdivisions along each fragment arc */
  arcSegments: number;
}

export const TIER_BUDGETS: Record<Tier, TierBudget> = {
  high: { fragments: 9000, ribbons: 24, rings: 4, ribbonSegments: 64, particles: 1600, dpr: [1, 2], bloomLevels: 7, arcSegments: 6 },
  medium: { fragments: 5200, ribbons: 16, rings: 3, ribbonSegments: 48, particles: 900, dpr: [1, 1.5], bloomLevels: 6, arcSegments: 5 },
  low: { fragments: 2800, ribbons: 10, rings: 2, ribbonSegments: 32, particles: 400, dpr: [1, 1.5], bloomLevels: 4, arcSegments: 4 },
};

export type ToneMode = "none" | "aces" | "agx" | "neutral";

export interface SphereLook {
  // --- structure (changing these rebuilds geometry) ---
  shells: number;
  density: number;
  arcLength: number;
  ragged: number;
  /** 0..1 size of the see-through window each shell gets */
  windows: number;
  /** 0..1 how many straight sector/band cuts are carved out */
  cuts: number;
  seed: number;
  // --- fragments (live uniforms) ---
  fragmentWidth: number;
  drift: number;
  innerBrightness: number;
  outerBrightness: number;
  depthFade: number;
  limb: number;
  // --- motion (live) ---
  rotationSpeed: number;
  flickerSpeed: number;
  flickerAmount: number;
  breatheAmount: number;
  breatheSpeed: number;
  tilt: number;
  // --- vortex ---
  ribbonDensity: number; // rebuild
  swirlSpeed: number;
  vortexRadius: number;
  vortexBrightness: number;
  vortexWidth: number;
  coreSize: number;
  coreBrightness: number;
  haloStrength: number;
  // --- particles ---
  particleDensity: number; // rebuild
  particleSize: number;
  particleSpeed: number;
  particleBrightness: number;
  // --- colour ---
  colorBase: string;
  colorHot: string;
  colorDeep: string;
  intensity: number;
  // --- post ---
  bloom: boolean;
  bloomIntensity: number;
  bloomThreshold: number;
  bloomSmoothing: number;
  bloomRadius: number;
  toneMapping: ToneMode;
}

export const DEFAULT_LOOK: SphereLook = {
  shells: 5,
  density: 1,
  arcLength: 0.42,
  ragged: 1,
  windows: 1,
  cuts: 1,
  seed: 7,

  fragmentWidth: 1,
  drift: 1,
  innerBrightness: 1.0,
  outerBrightness: 0.85,
  depthFade: 0.3,
  limb: 0.5,

  rotationSpeed: 1,
  flickerSpeed: 1.6,
  flickerAmount: 0.75,
  breatheAmount: 0.025,
  breatheSpeed: 0.22,
  tilt: 1,

  ribbonDensity: 1,
  swirlSpeed: 0.55,
  vortexRadius: 0.5,
  vortexBrightness: 0.9,
  vortexWidth: 0.8,
  coreSize: 0.14,
  coreBrightness: 0.85,
  haloStrength: 0.14,

  particleDensity: 1,
  particleSize: 1,
  particleSpeed: 1,
  particleBrightness: 1,

  colorBase: "#ffb23f",
  colorHot: "#fff3d6",
  colorDeep: "#ff6a00",
  intensity: 1.1,

  bloom: true,
  bloomIntensity: 1.3,
  bloomThreshold: 0.45,
  bloomSmoothing: 0.3,
  bloomRadius: 0.72,
  toneMapping: "aces",
};

/** Keys whose change requires rebuilding fragment geometry. */
export const STRUCTURE_KEYS = ["shells", "density", "arcLength", "ragged", "windows", "cuts", "seed"] as const;
