/**
 * Quality tier detection for the holographic sphere.
 * Runs on the client only. Cheap heuristics, no benchmarking.
 */
export type QualityTier = "high" | "medium" | "low" | "static";

export interface Capabilities {
  tier: QualityTier;
  reducedMotion: boolean;
  webgl: boolean;
  coarsePointer: boolean;
  dpr: number;
}

/** three r186 requires WebGL2; a WebGL1-only device gets the static poster. */
function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function detectCapabilities(): Capabilities {
  if (typeof window === "undefined") {
    return { tier: "static", reducedMotion: false, webgl: false, coarsePointer: false, dpr: 1 };
  }
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const webgl = hasWebGL();
  const dpr = window.devicePixelRatio || 1;

  if (!webgl || reducedMotion) {
    return { tier: "static", reducedMotion, webgl, coarsePointer, dpr };
  }

  // Safari does not expose these; undefined means unknown, not weak
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency;
  const memory = nav.deviceMemory;
  const weak = (cores !== undefined && cores <= 4) || (memory !== undefined && memory <= 4);
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  const longSide = Math.max(window.innerWidth, window.innerHeight);

  let tier: QualityTier;
  if (coarsePointer) {
    // Touch devices: phones are low, tablets are medium.
    const isPhone = shortSide < 600 || longSide < 900;
    tier = isPhone ? "low" : "medium";
    if (!isPhone && weak) tier = "low";
  } else {
    tier = weak ? "medium" : "high";
  }
  return { tier, reducedMotion, webgl, coarsePointer, dpr };
}

/** Allow ?tier=high|medium|low|static to force a tier for testing. */
export function tierOverrideFromUrl(): QualityTier | null {
  if (typeof window === "undefined") return null;
  const t = new URLSearchParams(window.location.search).get("tier");
  return t === "high" || t === "medium" || t === "low" || t === "static" ? t : null;
}
