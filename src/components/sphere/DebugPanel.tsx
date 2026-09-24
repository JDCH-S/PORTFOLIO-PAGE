"use client";

import { useEffect, useRef } from "react";
import { button, folder, Leva, useControls } from "leva";
import { DEFAULT_LOOK, type SphereLook, type Tier, type ToneMode } from "./config";

export interface DebugPanelProps {
  tier: Tier;
  onLook: (look: SphereLook) => void;
  onTier: (tier: Tier) => void;
  stats: { fragments: number; fps: number };
}

const THEME = {
  colors: {
    elevation1: "rgba(6, 9, 20, 0.92)",
    elevation2: "rgba(10, 14, 28, 0.9)",
    elevation3: "rgba(255, 178, 63, 0.10)",
    accent1: "#ff8a1f",
    accent2: "#ffb23f",
    accent3: "#ffd27a",
    highlight1: "#6f7d99",
    highlight2: "#c9d2e3",
    highlight3: "#fff3d6",
    folderWidgetColor: "#ffb23f",
    folderTextColor: "#ffd27a",
    toolTipBackground: "#ffb23f",
    toolTipText: "#0a0e1c",
  },
  fonts: { mono: "var(--font-geist-mono), ui-monospace, monospace", sans: "var(--font-geist-mono), ui-monospace, monospace" },
  fontSizes: { root: "10.5px" },
  sizes: { rootWidth: "300px", controlWidth: "140px", rowHeight: "22px" },
  radii: { xs: "2px", sm: "2px", lg: "4px" },
};

/** Phase-1 tweak panel. Every value maps 1:1 onto SphereLook. */
export default function DebugPanel({ tier, onLook, onTier, stats }: DebugPanelProps) {
  const latest = useRef<SphereLook>(DEFAULT_LOOK);
  const D = DEFAULT_LOOK;

  const [values, set] = useControls(
    () => ({
      Quality: folder(
        {
          tier: { value: tier, options: ["high", "medium", "low"] as Tier[], label: "tier" },
          fps: { value: stats.fps, editable: false, label: "fps" },
          fragments: { value: stats.fragments, editable: false, label: "fragments" },
        },
        { collapsed: false },
      ),
      Shells: folder(
        {
          shells: { value: D.shells, min: 1, max: 8, step: 1, label: "shell count ⟳" },
          density: { value: D.density, min: 0.2, max: 2, step: 0.05, label: "density ⟳" },
          arcLength: { value: D.arcLength, min: 0.1, max: 1.2, step: 0.01, label: "arc length ⟳" },
          ragged: { value: D.ragged, min: 0, max: 2, step: 0.05, label: "ragged ⟳" },
          windows: { value: D.windows, min: 0, max: 1.5, step: 0.05, label: "windows ⟳" },
          cuts: { value: D.cuts, min: 0, max: 2, step: 0.05, label: "cuts ⟳" },
          seed: { value: D.seed, min: 1, max: 99, step: 1, label: "seed ⟳" },
          fragmentWidth: { value: D.fragmentWidth, min: 0.3, max: 3, step: 0.05, label: "width" },
          drift: { value: D.drift, min: 0, max: 3, step: 0.05, label: "drift" },
          innerBrightness: { value: D.innerBrightness, min: 0, max: 3, step: 0.05, label: "inner bright" },
          outerBrightness: { value: D.outerBrightness, min: 0, max: 3, step: 0.05, label: "outer bright" },
          depthFade: { value: D.depthFade, min: 0, max: 1, step: 0.01, label: "far-side fade" },
          limb: { value: D.limb, min: 0, max: 3, step: 0.05, label: "limb glow" },
        },
        { collapsed: false },
      ),
      Motion: folder(
        {
          rotationSpeed: { value: D.rotationSpeed, min: 0, max: 5, step: 0.05, label: "rotation" },
          flickerSpeed: { value: D.flickerSpeed, min: 0, max: 8, step: 0.05, label: "flicker speed" },
          flickerAmount: { value: D.flickerAmount, min: 0, max: 1, step: 0.01, label: "flicker amount" },
          breatheAmount: { value: D.breatheAmount, min: 0, max: 0.15, step: 0.001, label: "breathe amt" },
          breatheSpeed: { value: D.breatheSpeed, min: 0, max: 1.5, step: 0.01, label: "breathe speed" },
          tilt: { value: D.tilt, min: 0, max: 3, step: 0.05, label: "cursor tilt" },
        },
        { collapsed: true },
      ),
      Vortex: folder(
        {
          ribbonDensity: { value: D.ribbonDensity, min: 0, max: 3, step: 0.05, label: "ribbons ⟳" },
          swirlSpeed: { value: D.swirlSpeed, min: 0, max: 3, step: 0.01, label: "swirl speed" },
          vortexRadius: { value: D.vortexRadius, min: 0.05, max: 1, step: 0.01, label: "radius" },
          vortexBrightness: { value: D.vortexBrightness, min: 0, max: 4, step: 0.05, label: "brightness" },
          vortexWidth: { value: D.vortexWidth, min: 0.2, max: 3, step: 0.05, label: "ribbon width" },
          coreSize: { value: D.coreSize, min: 0.02, max: 0.6, step: 0.01, label: "core size" },
          coreBrightness: { value: D.coreBrightness, min: 0, max: 4, step: 0.05, label: "core bright" },
          haloStrength: { value: D.haloStrength, min: 0, max: 1.5, step: 0.01, label: "halo" },
        },
        { collapsed: true },
      ),
      Particles: folder(
        {
          particleDensity: { value: D.particleDensity, min: 0, max: 3, step: 0.05, label: "count ⟳" },
          particleSize: { value: D.particleSize, min: 0.2, max: 4, step: 0.05, label: "size" },
          particleSpeed: { value: D.particleSpeed, min: 0, max: 4, step: 0.05, label: "speed" },
          particleBrightness: { value: D.particleBrightness, min: 0, max: 3, step: 0.05, label: "brightness" },
        },
        { collapsed: true },
      ),
      Colour: folder(
        {
          colorBase: { value: D.colorBase, label: "base" },
          colorHot: { value: D.colorHot, label: "hot" },
          colorDeep: { value: D.colorDeep, label: "deep" },
          intensity: { value: D.intensity, min: 0.2, max: 4, step: 0.05, label: "intensity" },
        },
        { collapsed: true },
      ),
      Bloom: folder(
        {
          bloom: { value: D.bloom, label: "enabled" },
          bloomIntensity: { value: D.bloomIntensity, min: 0, max: 5, step: 0.05, label: "intensity" },
          bloomThreshold: { value: D.bloomThreshold, min: 0, max: 1.5, step: 0.01, label: "threshold" },
          bloomSmoothing: { value: D.bloomSmoothing, min: 0, max: 1, step: 0.01, label: "smoothing" },
          bloomRadius: { value: D.bloomRadius, min: 0.1, max: 1, step: 0.01, label: "radius" },
          toneMapping: { value: D.toneMapping, options: ["aces", "agx", "neutral", "none"] as ToneMode[], label: "tone map" },
        },
        { collapsed: true },
      ),
      "copy settings JSON": button(() => {
        const json = JSON.stringify(latest.current, null, 2);
        void navigator.clipboard?.writeText(json);
        console.log(json);
      }),
    }),
    [],
  );

  useEffect(() => {
    set({ fps: stats.fps, fragments: stats.fragments });
  }, [set, stats.fps, stats.fragments]);

  useEffect(() => {
    const v = values as unknown as SphereLook & { tier: Tier; fps: number; fragments: number };
    const next: SphereLook = { ...DEFAULT_LOOK };
    (Object.keys(DEFAULT_LOOK) as (keyof SphereLook)[]).forEach((k) => {
      (next as unknown as Record<string, unknown>)[k] = v[k];
    });
    latest.current = next;
    onLook(next);
    onTier(v.tier);
  }, [values, onLook, onTier]);

  const small = typeof window !== "undefined" && window.innerWidth < 768;
  return <Leva theme={THEME} titleBar={{ title: "SPHERE // TWEAKS", filter: false, drag: true, position: { x: 0, y: 0 } }} collapsed={small} />;
}
