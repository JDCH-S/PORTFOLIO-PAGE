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
  bloom.luminanceMaterial.smoothing = look.bloomSmoothing;
  // the cheap tier has fewer mip levels, so a wider radius keeps the halo spreading
  bloom.mipmapBlurPass.radius = cheap ? Math.min(1, look.bloomRadius + 0.13) : look.bloomRadius;
  // cheap tier: keep the threshold (it defines the look) but run the luminance pass at half resolution
  const res = (bloom.luminancePass as unknown as { resolution?: { scale: number } }).resolution;
  if (res) res.scale = cheap ? 0.5 : 1;
}

/** Bloom (mipmap blur, HDR half-float buffer) followed by optional filmic tone mapping. */
export default function Effects({ look, budget }: { look: SphereLook; budget: TierBudget }) {
  const tone = TONE[look.toneMapping];
  const cheap = budget.bloomLevels <= 4;
  // the effect mounts one commit after the composer, so hold it in state and tune when it arrives
  const [bloom, setBloom] = useState<BloomEffect | null>(null);
  const bloomRef = useCallback((b: BloomEffect | null) => setBloom(b), []);
  useEffect(() => {
    if (bloom) tuneBloom(bloom, look, cheap);
  }, [bloom, cheap, look]);
  if (!look.bloom && !tone) return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false} depthBuffer={false} stencilBuffer={false}>
      {look.bloom ? <Bloom ref={bloomRef} mipmapBlur levels={budget.bloomLevels} /> : <></>}
      {tone ? <ToneMapping mode={tone} /> : <></>}
    </EffectComposer>
  );
}
