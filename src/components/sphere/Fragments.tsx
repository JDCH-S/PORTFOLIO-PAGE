"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { buildFragments } from "./buildFragments";
import { fragmentsFrag, fragmentsVert, MAX_SHELLS } from "./shaders";
import type { SphereLook, TierBudget } from "./config";
import { useSphereStore } from "./sphereStore";

export interface FragmentsProps {
  look: SphereLook;
  budget: TierBudget;
  onBuilt?: (count: number) => void;
  timeOffset?: number;
}

function makeMaterialParams(): THREE.ShaderMaterialParameters {
  const quats: THREE.Vector4[] = [];
  const bright: number[] = [];
  for (let i = 0; i < MAX_SHELLS; i++) {
    quats.push(new THREE.Vector4(0, 0, 0, 1));
    bright.push(1);
  }
  return {
    vertexShader: fragmentsVert,
    fragmentShader: fragmentsFrag,
    uniforms: {
      uTime: { value: 0 },
      uWidth: { value: 1 },
      uDrift: { value: 1 },
      uFlickerSpeed: { value: 1.6 },
      uFlickerAmount: { value: 0.75 },
      uDepthFade: { value: 0.42 },
      uLimb: { value: 0.6 },
      uPxWorld: { value: 0.001 },
      uMinPx: { value: 0.55 },
      uAssemble: { value: 1 },
      uShellCount: { value: 6 },
      uShellQuat: { value: quats },
      uShellBright: { value: bright },
      uColorBase: { value: new THREE.Color("#ffb23f") },
      uColorHot: { value: new THREE.Color("#fff3d6") },
      uColorDeep: { value: new THREE.Color("#ff6a00") },
      uIntensity: { value: 1.35 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  };
}

/** All shells of light fragments in one instanced draw call. */
export default function Fragments({ look, budget, onBuilt, timeOffset = 0 }: FragmentsProps) {
  const count = Math.round(budget.fragments * look.density);

  const built = useMemo(
    () => buildFragments(count, Math.min(look.shells, budget.maxShells), look.arcLength, look.ragged, look.seed, budget.arcSegments, look.windows, look.cuts * budget.cutScale),
    [count, look.shells, budget.maxShells, look.arcLength, look.ragged, look.seed, budget.arcSegments, look.windows, look.cuts, budget.cutScale],
  );
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    onBuilt?.(built.count);
  }, [built.count, onBuilt]);
  useEffect(() => () => built.geometry.dispose(), [built]);

  const params = useMemo(() => makeMaterialParams(), []);
  const material = useRef<THREE.ShaderMaterial>(null);

  // live uniforms
  useEffect(() => {
    const m = material.current;
    if (!m) return;
    const u = m.uniforms;
    // fewer fragments on lower tiers: slightly wider and brighter strips keep the glowing-volume read
    u.uWidth.value = look.fragmentWidth * Math.pow(9000 / Math.max(500, built.count), 0.35);
    u.uMinPx.value = budget.minPx;
    u.uDrift.value = look.drift;
    u.uFlickerSpeed.value = look.flickerSpeed;
    u.uFlickerAmount.value = look.flickerAmount;
    u.uDepthFade.value = look.depthFade;
    u.uLimb.value = look.limb;
    // fewer fragments on lower tiers keep the same overall luminance
    u.uIntensity.value = look.intensity * Math.pow(9000 / Math.max(500, built.count), 0.25);
    (u.uColorBase.value as THREE.Color).set(look.colorBase);
    (u.uColorHot.value as THREE.Color).set(look.colorHot);
    (u.uColorDeep.value as THREE.Color).set(look.colorDeep);
  }, [look.fragmentWidth, look.drift, look.flickerSpeed, look.flickerAmount, look.depthFade, look.limb, look.intensity, look.colorBase, look.colorHot, look.colorDeep, built.count, budget.minPx]);

  useEffect(() => {
    const m = material.current;
    if (!m) return;
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 40;
    m.uniforms.uPxWorld.value = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, size.height);
  }, [camera, size.height]);

  useEffect(() => {
    const m = material.current;
    if (!m) return;
    const u = m.uniforms;
    const bright = u.uShellBright.value as number[];
    const n = built.shells.length;
    built.shells.forEach((s, i) => {
      const t = n === 1 ? 0 : i / (n - 1);
      bright[i] = s.brightness * THREE.MathUtils.lerp(look.innerBrightness, look.outerBrightness, t);
    });
  }, [built, look.innerBrightness, look.outerBrightness]);

  const time = useRef(timeOffset);
  const angles = useRef<number[]>(built.shells.map((s) => s.speed * look.rotationSpeed * timeOffset).concat(new Array(MAX_SHELLS).fill(0)).slice(0, MAX_SHELLS));
  const tmpQ = useRef(new THREE.Quaternion());

  useFrame((_, dt) => {
    const m = material.current;
    if (!m) return;
    const u = m.uniforms;
    const step = Math.min(dt, 0.05);
    time.current = (time.current + step) % 3600;
    u.uTime.value = time.current;
    u.uAssemble.value = useSphereStore.getState().assemble;
    u.uShellCount.value = built.shells.length;
    const quats = u.uShellQuat.value as THREE.Vector4[];
    const q = tmpQ.current;
    built.shells.forEach((s, i) => {
      angles.current[i] += step * s.speed * look.rotationSpeed;
      q.setFromAxisAngle(s.axis, angles.current[i]);
      quats[i].set(q.x, q.y, q.z, q.w);
    });
  });

  return (
    <mesh geometry={built.geometry} frustumCulled={false}>
      <shaderMaterial ref={material} args={[params]} />
    </mesh>
  );
}
