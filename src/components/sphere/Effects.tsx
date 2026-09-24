"use client";

import { useEffect, useRef, useState } from "react";
import { Bloom, EffectComposer, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode, type BloomEffect } from "postprocessing";
import type { SphereLook, TierBudget } from "./config";

function setLuminancePass(bloom: BloomEffect | null, enabled: boolean) {
  if (bloom) bloom.luminancePass.enabled = enabled;
}

/** threshold / smoothing / radius are constructor args on <Bloom>; set them live through the effect instead of rebuilding it. */
function tuneBloom(bloom: BloomEffect | null, threshold: number, smoothing: number, radius: number) {
  if (!bloom) return;
  bloom.luminanceMaterial.threshold = threshold;
  bloom.luminanceMaterial.smoothing = smoothing;
  bloom.mipmapBlurPass.radius = radius;
}

const TONE: Record<SphereLook["toneMapping"], ToneMappingMode | null> = {
  none: null,
  aces: ToneMappingMode.ACES_FILMIC,
  agx: ToneMappingMode.AGX,
  neutral: ToneMappingMode.NEUTRAL,
};

/** Bloom (mipmap blur, HDR half-float buffer) followed by optional filmic tone mapping. */
export default function Effects({ look, budget }: { look: SphereLook; budget: TierBudget }) {
  const tone = TONE[look.toneMapping];
  const bloomRef = useRef<BloomEffect>(null);
  // constructor args are captured once; later changes go through the setters below
  const [initial] = useState(() => ({ threshold: look.bloomThreshold, smoothing: look.bloomSmoothing, radius: look.bloomRadius }));
  // the LOW tier skips the full-resolution luminance pass (cheaper bloom)
  const cheap = budget.bloomLevels <= 4;
  useEffect(() => {
    setLuminancePass(bloomRef.current, !cheap);
  }, [cheap, look.bloom, budget.bloomLevels]);
  useEffect(() => {
    tuneBloom(bloomRef.current, look.bloomThreshold, look.bloomSmoothing, look.bloomRadius);
  }, [look.bloom, look.bloomThreshold, look.bloomSmoothing, look.bloomRadius, budget.bloomLevels]);
  if (!look.bloom && !tone) return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false} depthBuffer={false}>
      {look.bloom ? (
        <Bloom
          ref={bloomRef}
          mipmapBlur
          intensity={cheap ? look.bloomIntensity * 0.65 : look.bloomIntensity}
          luminanceThreshold={initial.threshold}
          luminanceSmoothing={initial.smoothing}
          radius={initial.radius}
          levels={budget.bloomLevels}
        />
      ) : (
        <></>
      )}
      {tone ? <ToneMapping mode={tone} /> : <></>}
    </EffectComposer>
  );
}
