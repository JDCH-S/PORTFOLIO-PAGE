"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { makeStripGeometry } from "./buildFragments";
import { mulberry32 } from "./rng";
import { vortexFrag, vortexVert } from "./shaders";
import type { SphereLook, TierBudget } from "./config";
import { useSphereStore } from "./sphereStore";

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
      uPxWorld: { value: 0.001 },
      uMinPx: { value: 0.55 },
      uIgnite: { value: 1 },
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
      const hero = !isRing && i % 4 === 0; // a quarter of the spirals carry the light
      kind[i] = isRing ? 1 : 0;
      rib[i * 4 + 0] = rand() * Math.PI * 2;                                   // phase
      rib[i * 4 + 1] = 0.55 + rand() * 0.6;                                    // radius scale
      rib[i * 4 + 2] = rand();                                                 // seed
      rib[i * 4 + 3] = isRing ? 0.006 + rand() * 0.004 : hero ? 0.012 + rand() * 0.008 : 0.005 + rand() * 0.006; // width
      // spirals share one inclined disc (front ribbons cross in front of the core, back ones behind);
      // rings sit at two fixed tilts about the same axis, like gyro gimbals
      axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      const ringIndex = i - spirals;
      tiltQ.setFromAxisAngle(axis, isRing ? (ringIndex % 2 === 0 ? 0.35 : 1.35) : (rand() - 0.5) * 1.2);
      q.setFromAxisAngle(vortexAxis, 0.55).multiply(tiltQ);
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
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera);
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
    u.uIgnite.value = useSphereStore.getState().ignite;
  });

  const mesh = useRef<THREE.Mesh>(null);
  const yaw = useRef(timeOffset * 0.11 * 0.55);
  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    const step = Math.min(dt, 0.05);
    yaw.current += step * 0.11 * look.swirlSpeed;
    m.rotation.y = yaw.current;
    m.rotation.x = Math.sin(time.current * 0.13) * 0.18;
  });

  return (
    <mesh ref={mesh} geometry={geometry} frustumCulled={false}>
      <shaderMaterial ref={material} args={[params]} />
    </mesh>
  );
}
