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
  /** shells this tier can afford before each one gets too thin to read */
  maxShells: number;
  /** scale on the straight sector cuts (fewer on tiers with fewer fragments) */
  cutScale: number;
  /** minimum on-screen half width of a strip in pixels */
  minPx: number;
}

export const TIER_BUDGETS: Record<Tier, TierBudget> = {
  high: { fragments: 9000, ribbons: 24, rings: 4, ribbonSegments: 64, particles: 1600, dpr: [1, 2], bloomLevels: 7, arcSegments: 6, maxShells: 8, cutScale: 1, minPx: 0.55 },
  medium: { fragments: 6200, ribbons: 20, rings: 4, ribbonSegments: 48, particles: 1000, dpr: [1, 1.5], bloomLevels: 6, arcSegments: 5, maxShells: 6, cutScale: 1, minPx: 0.65 },
  low: { fragments: 4200, ribbons: 16, rings: 3, ribbonSegments: 40, particles: 600, dpr: [1, 1.5], bloomLevels: 5, arcSegments: 4, maxShells: 4, cutScale: 0.5, minPx: 0.8 },
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
  shells: 6,
  density: 1,
  arcLength: 0.42,
  ragged: 1,
  windows: 1,
  cuts: 1,
  seed: 7,

  fragmentWidth: 1,
  drift: 1,
  innerBrightness: 0.9,
  outerBrightness: 0.85,
  depthFade: 0.22,
  limb: 0.2,

  rotationSpeed: 1,
  flickerSpeed: 1.6,
  flickerAmount: 0.75,
  breatheAmount: 0.025,
  breatheSpeed: 0.22,
  tilt: 1,

  ribbonDensity: 1,
  swirlSpeed: 0.55,
  vortexRadius: 0.56,
  vortexBrightness: 1.0,
  vortexWidth: 0.7,
  coreSize: 0.11,
  coreBrightness: 0.7,
  haloStrength: 0.12,

  particleDensity: 1,
  particleSize: 1,
  particleSpeed: 1,
  particleBrightness: 1,

  colorBase: "#ffb23f",
  colorHot: "#ffecc8",
  colorDeep: "#ff6a00",
  intensity: 1.0,

  bloom: true,
  bloomIntensity: 1.6,
  bloomThreshold: 0.52,
  bloomSmoothing: 0.22,
  bloomRadius: 0.78,
  toneMapping: "aces",
};

/** Keys whose change requires rebuilding fragment geometry. */
export const STRUCTURE_KEYS = ["shells", "density", "arcLength", "ragged", "windows", "cuts", "seed"] as const;
