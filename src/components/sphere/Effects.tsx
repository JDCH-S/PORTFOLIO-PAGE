"use client";

import { useEffect, useRef } from "react";
import { Bloom, EffectComposer, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode, type BloomEffect } from "postprocessing";
import type { SphereLook, TierBudget } from "./config";

function setLuminancePass(bloom: BloomEffect | null, enabled: boolean) {
  if (bloom) bloom.luminancePass.enabled = enabled;
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
  // the LOW tier skips the full-resolution luminance pass (cheaper bloom)
  const cheap = budget.bloomLevels <= 4;
  useEffect(() => {
    setLuminancePass(bloomRef.current, !cheap);
  }, [cheap, look.bloom, look.bloomThreshold, look.bloomSmoothing, look.bloomRadius, budget.bloomLevels]);
  if (!look.bloom && !tone) return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false} depthBuffer={false}>
      {look.bloom ? (
        <Bloom
          ref={bloomRef}
          mipmapBlur
          intensity={cheap ? look.bloomIntensity * 0.65 : look.bloomIntensity}
          luminanceThreshold={look.bloomThreshold}
          luminanceSmoothing={look.bloomSmoothing}
          radius={look.bloomRadius}
          levels={budget.bloomLevels}
        />
      ) : (
        <></>
      )}
      {tone ? <ToneMapping mode={tone} /> : <></>}
    </EffectComposer>
  );
}
