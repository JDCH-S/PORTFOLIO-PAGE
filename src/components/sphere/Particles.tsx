"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mulberry32 } from "./rng";
import { particlesFrag, particlesVert } from "./shaders";
import type { SphereLook, TierBudget } from "./config";

function makeMaterialParams(): THREE.ShaderMaterialParameters {
  return {
    vertexShader: particlesVert,
    fragmentShader: particlesFrag,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: 1 },
      uSpeed: { value: 1 },
      uPixelRatio: { value: 1 },
      uColorBase: { value: new THREE.Color("#ffb23f") },
      uColorHot: { value: new THREE.Color("#fff3d6") },
      uIntensity: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  };
}

/** Floating dust and sparks inside and around the sphere. */
export default function Particles({ look, budget, timeOffset = 0 }: { look: SphereLook; budget: TierBudget; timeOffset?: number }) {
  const count = Math.max(10, Math.round(budget.particles * look.particleDensity));
  const dpr = useThree((s) => s.viewport.dpr);

  const geometry = useMemo(() => {
    const rand = mulberry32(look.seed * 91 + 5);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 3);
    const kind = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // volume: dense near the core, thinning out beyond the outer shell
      const r = 0.15 + Math.pow(rand(), 1.4) * 1.35;
      const z = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(1 - z * z);
      pos[i * 3 + 0] = rr * Math.cos(a) * r;
      pos[i * 3 + 1] = rr * Math.sin(a) * r;
      pos[i * 3 + 2] = z * r;
      seed[i * 3 + 0] = rand();
      seed[i * 3 + 1] = rand();
      seed[i * 3 + 2] = rand();
      kind[i] = rand() < 0.22 ? 1 : 0;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    g.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.8);
    return g;
  }, [count, look.seed]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const params = useMemo(() => makeMaterialParams(), []);
  const material = useRef<THREE.ShaderMaterial>(null);

  useEffect(() => {
    const m = material.current;
    if (!m) return;
    const u = m.uniforms;
    u.uSize.value = look.particleSize;
    u.uSpeed.value = look.particleSpeed;
    u.uPixelRatio.value = dpr;
    u.uIntensity.value = look.particleBrightness * look.intensity;
    (u.uColorBase.value as THREE.Color).set(look.colorBase);
    (u.uColorHot.value as THREE.Color).set(look.colorHot);
  }, [dpr, look.particleSize, look.particleSpeed, look.particleBrightness, look.intensity, look.colorBase, look.colorHot]);

  const time = useRef(timeOffset);
  useFrame((_, dt) => {
    const m = material.current;
    if (!m) return;
    const u = m.uniforms;
    time.current = (time.current + Math.min(dt, 0.05)) % 3600;
    u.uTime.value = time.current;
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial ref={material} args={[params]} />
    </points>
  );
}
