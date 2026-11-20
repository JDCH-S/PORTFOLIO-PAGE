"use client";

import { useEffect, useRef } from "react";
import { button, folder, Leva, useControls } from "leva";
import { type SphereLook, type Tier, type ToneMode } from "./config";
import { useSphereStore } from "./sphereStore";

export interface DebugPanelProps {
  tier: Tier;
  initialLook: SphereLook;
  onLook: (look: SphereLook) => void;
  onTier: (tier: Tier) => void;
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

function sameLook(a: SphereLook, b: SphereLook): boolean {
  for (const k of Object.keys(a) as (keyof SphereLook)[]) if (a[k] !== b[k]) return false;
  return true;
}

/** Tweak panel of the /sphere review page. Every value maps 1:1 onto SphereLook (all live). */
export default function DebugPanel({ tier, initialLook, onLook, onTier }: DebugPanelProps) {
  const latest = useRef<SphereLook>(initialLook);
  const lastTier = useRef<Tier>(tier);
  const fps = useSphereStore((s) => s.fps);
  const filaments = useSphereStore((s) => s.filaments);
  const D = initialLook;

  const [values, set] = useControls(
    () => ({
      Quality: folder(
        {
          tier: { value: tier, options: ["high", "medium", "low"] as Tier[], label: "tier" },
          fps: { value: 0, disabled: true, label: "fps" },
          filaments: { value: 0, disabled: true, label: "filament pts" },
        },
        { collapsed: false },
      ),
      Hologram: folder(
        {
          gain: { value: D.gain, min: 0, max: 2.5, step: 0.01, label: "brightness" },
          halo: { value: D.halo, min: 0, max: 4, step: 0.05, label: "halo" },
          nodes: { value: D.nodes, min: 0, max: 3, step: 0.05, label: "network nodes" },
        },
        { collapsed: false },
      ),
      Motion: folder(
        {
          sway: { value: D.sway, min: 0, max: 2, step: 0.05, label: "idle sway" },
          breatheAmount: { value: D.breatheAmount, min: 0, max: 0.05, step: 0.001, label: "breathe amt" },
          breatheSpeed: { value: D.breatheSpeed, min: 0, max: 1.5, step: 0.01, label: "breathe speed" },
          tilt: { value: D.tilt, min: 0, max: 3, step: 0.05, label: "cursor lean" },
        },
        { collapsed: true },
      ),
      Colour: folder(
        {
          colorBase: { value: D.colorBase, label: "base" },
          colorHot: { value: D.colorHot, label: "hot" },
          colorDeep: { value: D.colorDeep, label: "deep" },
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

  // telemetry rows follow the store; the runtime tier (performance fallback) is pushed into the panel
  useEffect(() => {
    set({ fps, filaments });
  }, [set, fps, filaments]);
  useEffect(() => {
    if (lastTier.current !== tier) {
      lastTier.current = tier;
      set({ tier });
    }
  }, [set, tier]);

  useEffect(() => {
    const v = values as unknown as SphereLook & { tier: Tier };
    const next: SphereLook = { ...initialLook };
    (Object.keys(initialLook) as (keyof SphereLook)[]).forEach((k) => {
      (next as unknown as Record<string, unknown>)[k] = v[k];
    });
    if (!sameLook(next, latest.current)) {
      latest.current = next;
      onLook(next);
    }
    // only a change made in the panel is forwarded; store ticks must not re-assert a stale tier
    if (v.tier !== lastTier.current) {
      lastTier.current = v.tier;
      onTier(v.tier);
    }
  }, [values, initialLook, onLook, onTier]);

  const small = typeof window !== "undefined" && window.innerWidth < 768;
  return <Leva theme={THEME} titleBar={{ title: "HOLOGRAM // TWEAKS", filter: false, drag: true, position: { x: 0, y: 0 } }} collapsed={small} />;
}
