"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { coreFrag, coreVert } from "./shaders";
import type { SphereLook } from "./config";

function makeMaterialParams(): THREE.ShaderMaterialParameters {
  return {
    vertexShader: coreVert,
    fragmentShader: coreFrag,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: 0.9 },
      uBright: { value: 1.2 },
      uCoreFrac: { value: 0.16 },
      uHalo: { value: 0.22 },
      uBreathe: { value: 0.22 * Math.PI * 2 },
      uColorBase: { value: new THREE.Color("#ffb23f") },
      uColorHot: { value: new THREE.Color("#fff3d6") },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  };
}

/** Camera-facing radial glow at the centre: the brightest point of the sphere. */
export default function CoreGlow({ look, timeOffset = 0 }: { look: SphereLook; timeOffset?: number }) {
  const params = useMemo(() => makeMaterialParams(), []);
  const material = useRef<THREE.ShaderMaterial>(null);

  useEffect(() => {
    const m = material.current;
    if (!m) return;
    const u = m.uniforms;
    const halo = 0.9; // quad half-size in world units
    u.uSize.value = halo;
    u.uCoreFrac.value = look.coreSize / halo;
    u.uHalo.value = look.haloStrength;
    u.uBreathe.value = look.breatheSpeed * Math.PI * 2;
    u.uBright.value = look.coreBrightness * look.intensity;
    (u.uColorBase.value as THREE.Color).set(look.colorBase);
    (u.uColorHot.value as THREE.Color).set(look.colorHot);
  }, [look.coreSize, look.coreBrightness, look.haloStrength, look.breatheSpeed, look.intensity, look.colorBase, look.colorHot]);

  const time = useRef(timeOffset);
  useFrame((_, dt) => {
    const m = material.current;
    if (!m) return;
    const u = m.uniforms;
    time.current = (time.current + Math.min(dt, 0.05)) % 3600;
    u.uTime.value = time.current;
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial ref={material} args={[params]} />
    </mesh>
  );
}
