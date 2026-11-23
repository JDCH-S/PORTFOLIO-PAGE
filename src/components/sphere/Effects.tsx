"use client";

import { useCallback, useEffect, useState } from "react";
import { Bloom, EffectComposer, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode, type BloomEffect } from "postprocessing";
import type { SphereLook, TierBudget } from "./config";

const TONE: Record<SphereLook["toneMapping"], ToneMappingMode | null> = {
  none: null,
  aces: ToneMappingMode.ACES_FILMIC,
  agx: ToneMappingMode.AGX,
  neutral: ToneMappingMode.NEUTRAL,
};

/**
 * Everything the panel changes goes through setters on the live effect: the
 * <Bloom> props are constructor args, and changing them rebuilds the effect,
 * its render targets and its shaders.
 */
function tuneBloom(bloom: BloomEffect, look: SphereLook, cheap: boolean) {
  bloom.intensity = cheap ? look.bloomIntensity * 0.85 : look.bloomIntensity;
  bloom.luminanceMaterial.threshold = look.bloomThreshold;
  // smoothstep(threshold, threshold + smoothing, l): equal edges (smoothing 0, the panel's minimum) are 0 / 0 = NaN at
  // l == threshold, straight into the bloom's mip chain (black squares); the floor never shows
  bloom.luminanceMaterial.smoothing = Math.max(1e-3, look.bloomSmoothing);
  // the cheap tier has fewer mip levels, so a wider radius keeps the halo spreading
  bloom.mipmapBlurPass.radius = cheap ? Math.min(1, look.bloomRadius + 0.13) : look.bloomRadius;
  // cheap tier: keep the threshold (it defines the look) but run the luminance pass at half resolution
  const res = (bloom.luminancePass as unknown as { resolution?: { scale: number } }).resolution;
  if (res) res.scale = cheap ? 0.5 : 1;
}

/**
 * Sizes the bloom's mip chain at `scale` of the canvas (see Effects' glowScale); returns the undo.
 * BloomEffect.setSize (every canvas resize, through the composer) sizes the chain from the canvas: an own setSize on
 * the instance runs it, then re-sizes the chain. The luminance pass keeps its own scale of the full canvas, so the
 * chain's first downsample (a 13-tap filter) reads the finer picture.
 */
function scaleGlow(bloom: BloomEffect, scale: number) {
  const base = Object.getPrototypeOf(bloom).setSize as (w: number, h: number) => void;
  const scaled = (w: number, h: number) => {
    base.call(bloom, w, h);
    bloom.mipmapBlurPass.setSize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  };
  bloom.setSize = scaled;
  const { baseWidth, baseHeight } = bloom.resolution;
  if (baseWidth > 0 && baseHeight > 0) scaled(baseWidth, baseHeight);
  return () => {
    Reflect.deleteProperty(bloom, "setSize");
    if (bloom.resolution.baseWidth > 0) base.call(bloom, bloom.resolution.baseWidth, bloom.resolution.baseHeight);
  };
}

/**
 * Bloom (mipmap blur, HDR half-float buffer) followed by optional filmic tone mapping.
 * `glowScale` < 1 (a sharpening canvas, SphereScene): the canvas renders above the display DPR the look is drawn for,
 * and the glow's reach is a number of mip texels, so a mip chain started from the larger canvas would shrink the glow
 * in CSS px. The chain is sized at `glowScale` of the canvas instead: the same sizes as at the display DPR, the same glow.
 */
export default function Effects({ look, budget, glowScale = 1 }: { look: SphereLook; budget: TierBudget; glowScale?: number }) {
  const tone = TONE[look.toneMapping];
  const cheap = budget.bloomLevels <= 4;
  // the effect mounts one commit after the composer, so hold it in state and tune when it arrives
  const [bloom, setBloom] = useState<BloomEffect | null>(null);
  const bloomRef = useCallback((b: BloomEffect | null) => setBloom(b), []);
  useEffect(() => {
    if (bloom) tuneBloom(bloom, look, cheap);
  }, [bloom, cheap, look]);
  useEffect(() => (bloom && glowScale < 1 ? scaleGlow(bloom, glowScale) : undefined), [bloom, glowScale]);
  if (!look.bloom && !tone) return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false} depthBuffer={false} stencilBuffer={false}>
      {look.bloom ? <Bloom ref={bloomRef} mipmapBlur levels={budget.bloomLevels} /> : <></>}
      {tone ? <ToneMapping mode={tone} /> : <></>}
    </EffectComposer>
  );
}
