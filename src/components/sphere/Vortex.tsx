"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { makeStripGeometry } from "./buildFragments";
import { mulberry32 } from "./rng";
import { vortexFrag, vortexVert } from "./shaders";
import type { SphereLook, TierBudget } from "./config";

function makeMaterialParams(): THREE.ShaderMaterialParameters {
  return {
    vertexShader: vortexVert,
    fragmentShader: vortexFrag,
    uniforms: {
      uTime: { value: 0 },
      uSwirl: { value: 0.55 },
      uRadius: { value: 0.42 },
      uWidth: { value: 1 },
      uBright: { value: 1.4 },
      uColorBase: { value: new THREE.Color("#ffb23f") },
      uColorHot: { value: new THREE.Color("#fff3d6") },
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

/** Swirling ribbons of light converging on the core. One instanced draw call. */
export default function Vortex({ look, budget, timeOffset = 0 }: { look: SphereLook; budget: TierBudget; timeOffset?: number }) {
  const spirals = Math.max(2, Math.round(budget.ribbons * look.ribbonDensity));
  const ringCount = Math.max(1, Math.round(budget.rings * look.ribbonDensity));
  const ribbons = spirals + ringCount;

  const geometry = useMemo(() => {
    const g = makeStripGeometry(budget.ribbonSegments);
    const rand = mulberry32(look.seed * 53 + 9);
    const rib = new Float32Array(ribbons * 4);
    const quat = new Float32Array(ribbons * 4);
    const kind = new Float32Array(ribbons);
    const axis = new THREE.Vector3();
    const vortexAxis = new THREE.Vector3(1, 0.35, 0.2).normalize();
    const q = new THREE.Quaternion();
    const tiltQ = new THREE.Quaternion();
    for (let i = 0; i < ribbons; i++) {
      const isRing = i >= spirals;
      const thin = rand() < 0.55;
      kind[i] = isRing ? 1 : 0;
      rib[i * 4 + 0] = rand() * Math.PI * 2;                                   // phase
      rib[i * 4 + 1] = 0.55 + rand() * 0.6;                                    // radius scale
      rib[i * 4 + 2] = rand();                                                 // seed
      rib[i * 4 + 3] = thin || isRing ? 0.006 + rand() * 0.008 : 0.016 + rand() * 0.02; // width
      // spirals: around a shared vortex axis, each tilted a little; rings: strongly tilted, crossing
      axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      tiltQ.setFromAxisAngle(axis, isRing ? 0.45 + rand() * 0.6 : (rand() - 0.5) * 1.7);
      q.setFromAxisAngle(vortexAxis, 0.9).multiply(tiltQ);
      quat[i * 4 + 0] = q.x; quat[i * 4 + 1] = q.y; quat[i * 4 + 2] = q.z; quat[i * 4 + 3] = q.w;
    }
    g.setAttribute("iRib", new THREE.InstancedBufferAttribute(rib, 4));
    g.setAttribute("iQuat", new THREE.InstancedBufferAttribute(quat, 4));
    g.setAttribute("iKind", new THREE.InstancedBufferAttribute(kind, 1));
    g.instanceCount = ribbons;
    return g;
  }, [ribbons, spirals, budget.ribbonSegments, look.seed]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const params = useMemo(() => makeMaterialParams(), []);
  const material = useRef<THREE.ShaderMaterial>(null);

  useEffect(() => {
    const m = material.current;
    if (!m) return;
    const u = m.uniforms;
    u.uSwirl.value = look.swirlSpeed;
    u.uRadius.value = look.vortexRadius;
    u.uWidth.value = look.vortexWidth;
    u.uBright.value = look.vortexBrightness;
    u.uIntensity.value = look.intensity;
    (u.uColorBase.value as THREE.Color).set(look.colorBase);
    (u.uColorHot.value as THREE.Color).set(look.colorHot);
  }, [look.swirlSpeed, look.vortexRadius, look.vortexWidth, look.vortexBrightness, look.intensity, look.colorBase, look.colorHot]);

  const time = useRef(timeOffset);
  useFrame((_, dt) => {
    const m = material.current;
    if (!m) return;
    const u = m.uniforms;
    time.current = (time.current + Math.min(dt, 0.05)) % 3600;
    u.uTime.value = time.current;
  });

  const mesh = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    const step = Math.min(dt, 0.05);
    m.rotation.y += step * 0.11 * look.swirlSpeed;
    m.rotation.x = Math.sin(time.current * 0.13) * 0.35;
  });

  return (
    <mesh ref={mesh} geometry={geometry} frustumCulled={false}>
      <shaderMaterial ref={material} args={[params]} />
    </mesh>
  );
}
