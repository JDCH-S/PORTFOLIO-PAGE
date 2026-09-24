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

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl =
      c.getContext("webgl2") ||
      c.getContext("webgl") ||
      c.getContext("experimental-webgl");
    return !!gl;
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

  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  const longSide = Math.max(window.innerWidth, window.innerHeight);

  let tier: QualityTier;
  if (coarsePointer) {
    // Touch devices: phones are low, tablets are medium.
    const isPhone = shortSide < 600 || longSide < 900;
    tier = isPhone ? "low" : "medium";
    if (!isPhone && (cores <= 4 || memory <= 4)) tier = "low";
  } else {
    tier = cores <= 4 || memory <= 4 ? "medium" : "high";
  }
  return { tier, reducedMotion, webgl, coarsePointer, dpr };
}

/** Allow ?tier=high|medium|low|static to force a tier for testing. */
export function tierOverrideFromUrl(): QualityTier | null {
  if (typeof window === "undefined") return null;
  const t = new URLSearchParams(window.location.search).get("tier");
  return t === "high" || t === "medium" || t === "low" || t === "static" ? t : null;
}
