import * as THREE from "three";
import { makeSimplex3, mulberry32 } from "./rng";
import { MAX_SHELLS } from "./shaders";

export interface ShellSpec {
  radius: number;
  /** relative share of the fragment budget */
  weight: number;
  /** noise threshold: higher = sparser, more ragged coverage */
  threshold: number;
  axis: THREE.Vector3;
  /** radians per second at rotationSpeed 1 */
  speed: number;
  brightness: number;
  /** 0..1 how much this shell's fragments break off and drift */
  drift: number;
  /** ring axes fragments align to (gives coherent ring structure) */
  rings: THREE.Vector3[];
  noiseOffset: number;
  /** direction of this shell's see-through window */
  window: THREE.Vector3;
  /** half-angle of the window (radians) */
  windowAngle: number;
}

export interface FragmentBuild {
  geometry: THREE.InstancedBufferGeometry;
  shells: ShellSpec[];
  count: number;
}

export const FRAG_ARC = 0;
export const FRAG_DASH = 1;
export const FRAG_SHARD = 2;
export const FRAG_TRACE = 3;

/* weight classes (world units at radius 1) */
const HAIRLINE = 0.003;
const STANDARD = 0.007;
const BOLD = 0.012;

/** shared direction every shell's window leans toward, so one cone of clearance shows the core */
const MASTER_WINDOW = new THREE.Vector3(-0.45, -0.3, 0.84).normalize();

function randomUnit(rand: () => number, out = new THREE.Vector3()) {
  const z = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), r * Math.sin(a), z);
}

function perpendicular(dir: THREE.Vector3, rand: () => number, out = new THREE.Vector3()) {
  const helper = randomUnit(rand, new THREE.Vector3());
  out.crossVectors(dir, helper);
  if (out.lengthSq() < 1e-6) out.crossVectors(dir, new THREE.Vector3(0, 1, 0));
  return out.normalize();
}

/** Rodrigues rotation of v about unit axis k by angle th. */
function rotateAbout(v: THREE.Vector3, k: THREE.Vector3, th: number, out: THREE.Vector3) {
  const c = Math.cos(th), s = Math.sin(th);
  const kx = k.y * v.z - k.z * v.y, ky = k.z * v.x - k.x * v.z, kz = k.x * v.y - k.y * v.x;
  const kd = k.dot(v) * (1 - c);
  return out.set(v.x * c + kx * s + k.x * kd, v.y * c + ky * s + k.y * kd, v.z * c + kz * s + k.z * kd);
}

/** shell radii: an inner "engine" cluster, a void band, then the outer cage */
function shellRadius(t: number) {
  return t < 0.45 ? THREE.MathUtils.lerp(0.34, 0.58, t / 0.45) : THREE.MathUtils.lerp(0.8, 1.0, (t - 0.45) / 0.55);
}

export function makeShells(count: number, seed: number, ragged: number, windows = 1): ShellSpec[] {
  const n = Math.max(1, Math.min(MAX_SHELLS, Math.round(count)));
  const rand = mulberry32(seed * 131 + 17);
  const shells: ShellSpec[] = [];
  const jitterAxis = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 1 : i / (n - 1); // 0 = innermost, 1 = outermost
    const radius = n === 1 ? 1 : shellRadius(t);
    const axis = randomUnit(rand);
    // keep axes away from the pure view axis so rotation is visible
    axis.y += 0.35;
    axis.normalize();
    const dirSign = i % 2 === 0 ? 1 : -1;
    const speed = dirSign * (0.035 + rand() * 0.05) * (1.25 - 0.45 * t);
    const rings: THREE.Vector3[] = [];
    const ringCount = 2 + Math.floor(rand() * 2);
    for (let k = 0; k < ringCount; k++) rings.push(randomUnit(rand));
    // window: master direction with a small per-shell jitter
    perpendicular(MASTER_WINDOW, rand, jitterAxis);
    const window = rotateAbout(MASTER_WINDOW, jitterAxis, rand() * 0.2, new THREE.Vector3());
    shells.push({
      radius,
      weight: 1.05 - 0.35 * t,
      threshold: (-0.25 + 0.65 * t) * ragged,
      axis,
      speed,
      brightness: 1.0 - 0.3 * t,
      drift: t > 0.55 ? (t - 0.55) / 0.45 : 0,
      rings,
      noiseOffset: rand() * 100,
      window,
      windowAngle: (0.28 + 0.5 * t) * windows,
    });
  }
  return shells;
}

/**
 * Builds one InstancedBufferGeometry containing every fragment of every shell.
 * Each fragment is an arc of a circle on its shell described by its centre point
 * (unit vector) and the circle's axis: great circles have axis = centre x tangent,
 * latitude rings share their shell's ring axis so bands and ladders stay parallel.
 * A single draw call renders the whole cage; per-shell rotation happens in the
 * vertex shader from a quaternion uniform array.
 */
export function buildFragments(
  targetCount: number,
  shellCount: number,
  baseArcLength: number,
  ragged: number,
  seed: number,
  arcSegments: number,
  windows = 1,
  cuts = 1,
): FragmentBuild {
  const shells = makeShells(shellCount, seed, ragged, windows);
  const rand = mulberry32(seed * 7 + 3);
  const noise = makeSimplex3(seed);

  const centers: number[] = [];
  const axes: number[] = [];
  const params: number[] = [];
  const styles: number[] = [];

  const dir = new THREE.Vector3();
  const tg = new THREE.Vector3();
  const ax = new THREE.Vector3();
  const bn = new THREE.Vector3();
  const c2 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  const c3 = new THREE.Vector3();
  const m = new THREE.Vector3();
  const tmpU = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const hash2 = (a: number, b: number) => {
    const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  const push = (
    c: THREE.Vector3, axis: THREE.Vector3, radius: number, angle: number, width: number, fseed: number,
    type: number, bright: number, drift: number, shell: number,
  ) => {
    centers.push(c.x, c.y, c.z);
    axes.push(axis.x, axis.y, axis.z);
    params.push(radius, angle, width, fseed);
    styles.push(type, bright, drift, shell);
  };

  /** great-circle fragment from a centre + tangent (surface length in radians) */
  const pushGreat = (
    c: THREE.Vector3, t: THREE.Vector3, radius: number, len: number, width: number, fseed: number,
    type: number, bright: number, drift: number, shell: number,
  ) => {
    ax.crossVectors(c, t);
    if (ax.lengthSq() < 1e-8) return false;
    ax.normalize();
    push(c, ax, radius, len, width, fseed, type, bright, drift, shell);
    return true;
  };

  /** small-circle (latitude) fragment around `axis`; `len` is surface length in radians */
  const pushRing = (
    c: THREE.Vector3, axis: THREE.Vector3, radius: number, len: number, width: number, fseed: number,
    type: number, bright: number, drift: number, shell: number,
  ) => {
    const rho = Math.sqrt(Math.max(0, 1 - c.dot(axis) ** 2));
    if (rho < 0.2) return false;
    push(c, axis, radius, len / rho, width, fseed, type, bright, drift, shell);
    return true;
  };

  // move a (centre, tangent) pair along its great circle by `offset` radians
  const advance = (c: THREE.Vector3, t: THREE.Vector3, offset: number, outC: THREE.Vector3, outT: THREE.Vector3) => {
    const ca = Math.cos(offset), sa = Math.sin(offset);
    outC.set(c.x * ca + t.x * sa, c.y * ca + t.y * sa, c.z * ca + t.z * sa);
    outT.set(-c.x * sa + t.x * ca, -c.y * sa + t.y * ca, -c.z * sa + t.z * ca);
  };
  // slide a (centre, tangent) pair sideways across the shell by `offset` radians
  const sideStep = (c: THREE.Vector3, t: THREE.Vector3, offset: number, outC: THREE.Vector3, outT: THREE.Vector3) => {
    bn.crossVectors(c, t).normalize();
    const ca = Math.cos(offset), sa = Math.sin(offset);
    outC.set(c.x * ca + bn.x * sa, c.y * ca + bn.y * sa, c.z * ca + bn.z * sa);
    outT.copy(t).addScaledVector(outC, -outC.dot(t)).normalize();
  };
  // move along a latitude ring (surface distance `len` radians) / across latitudes by `delta`
  const alongRing = (c: THREE.Vector3, axis: THREE.Vector3, len: number, out: THREE.Vector3) => {
    const rho = Math.sqrt(Math.max(1e-4, 1 - c.dot(axis) ** 2));
    return rotateAbout(c, axis, len / rho, out);
  };
  const acrossRing = (c: THREE.Vector3, axis: THREE.Vector3, delta: number, out: THREE.Vector3) => {
    m.crossVectors(axis, c);
    if (m.lengthSq() < 1e-8) return out.copy(c);
    m.normalize();
    return rotateAbout(c, m, delta, out);
  };
  /** meridian direction at c (toward the axis pole), tangent to the sphere */
  const meridian = (c: THREE.Vector3, axis: THREE.Vector3, out: THREE.Vector3) =>
    out.copy(axis).addScaledVector(c, -c.dot(axis)).normalize();

  const totalWeight = shells.reduce((s, sh) => s + sh.weight, 0);
  const n = shells.length;
  const outerRingAxis = shells[n - 1].rings[0];

  shells.forEach((shell, si) => {
    const budget = Math.round((targetCount * shell.weight) / totalWeight);
    let placed = 0;
    let guard = 0;
    const r = shell.radius;
    const st = n === 1 ? 1 : si / (n - 1); // 0 inner .. 1 outer
    // outer shells: longer, thinner arcs; inner shells: finer, denser detail
    const widthScale = (0.55 + 0.45 * r) * (1 - 0.3 * st);
    const arcLength = baseArcLength * (1 + 0.4 * st);
    const ringAxis = shell.rings[0];

    // --- skeleton: two primary latitude rings on each outer shell, with ruler ticks
    if (st >= 0.5 && n > 1) {
      for (const lat of [0.25, -0.25]) {
        // start point at the given latitude about ringAxis
        perpendicular(ringAxis, rand, tmpU);
        rotateAbout(tmpU, tmpV.crossVectors(ringAxis, tmpU).normalize(), lat, c2);
        const pieces = 10;
        const pieceLen = (Math.PI * 2 * Math.sqrt(1 - Math.sin(lat) ** 2)) / pieces;
        const fseed = rand();
        for (let k = 0; k < pieces && placed < budget; k++) {
          alongRing(c2, ringAxis, pieceLen * (k + 0.5), c3);
          if (pushRing(c3, ringAxis, r, pieceLen * 0.92, BOLD * widthScale, fseed + k * 0.004, FRAG_ARC, 1.3, 0, si)) placed++;
        }
        const ticks = Math.floor((Math.PI * 2 * Math.cos(lat)) / 0.15);
        for (let k = 0; k < ticks && placed < budget; k++) {
          alongRing(c2, ringAxis, 0.15 * k, c3);
          meridian(c3, ringAxis, tmpV);
          if (pushGreat(c3, tmpV, r, 0.022, HAIRLINE * 1.3 * widthScale, fseed + 0.1 + k * 0.002, FRAG_DASH, 0.9, 0, si)) placed++;
        }
      }
    }

    while (placed < budget && guard++ < budget * 40) {
      randomUnit(rand, dir);
      // patchy coverage: simplex mask with clean edges; outer shells are sparser
      const mask = noise(dir.x * 2.3 + shell.noiseOffset, dir.y * 2.3, dir.z * 2.3 - shell.noiseOffset)
        + 0.5 * noise(dir.x * 5.1, dir.y * 5.1 + shell.noiseOffset, dir.z * 5.1);
      if (mask < shell.threshold) continue;
      const edge = Math.min(1, (mask - shell.threshold) / 0.25); // near patch edges fragments are dimmer/sparser
      if (rand() > 0.35 + 0.65 * edge) continue;
      // see-through window: one hole per shell (all leaning the same way) with a soft rim
      if (shell.windowAngle > 0) {
        const ang = Math.acos(THREE.MathUtils.clamp(dir.dot(shell.window), -1, 1));
        if (ang < shell.windowAngle) continue;
        if (ang < shell.windowAngle + 0.12 && rand() < 0.6) continue;
      }
      // knife-straight cuts: whole sectors / bands vanish; the outer cage shares one cutaway wedge
      if (cuts > 0) {
        const outer = st >= 0.5;
        const axis = outer ? outerRingAxis : ringAxis;
        tmpU.copy(dir).addScaledVector(axis, -dir.dot(axis));
        tmpV.crossVectors(axis, tmpU);
        const lon = Math.atan2(tmpV.length() * Math.sign(tmpV.dot(shell.rings[1] ?? tmpV)), tmpU.length());
        const lat = Math.asin(THREE.MathUtils.clamp(dir.dot(axis), -1, 1));
        const sector = Math.floor(((lon + Math.PI) / (Math.PI * 2)) * 24);
        const band = Math.floor(((lat + Math.PI / 2) / Math.PI) * 14);
        const cutScale = cuts * (0.3 + 0.7 * st);
        const salt = outer ? 0 : si;
        if (hash2(sector + 3, salt * 17 + seed) < 0.16 * cutScale) continue;
        if (hash2(band + 41, salt * 29 + seed) < 0.13 * cutScale) continue;
      }

      // orientation for great-circle pieces: mostly aligned to the shell's ring axes, sometimes free
      const useRing = rand() < 0.72;
      if (useRing) {
        const axis = shell.rings[Math.floor(rand() * shell.rings.length)];
        tg.crossVectors(axis, dir);
        if (tg.lengthSq() < 1e-4) perpendicular(dir, rand, tg);
        else tg.normalize();
      } else {
        perpendicular(dir, rand, tg);
      }

      const fseed = rand();
      const kindRoll = rand();
      // hierarchy: most fragments are quiet, a few carry the light
      const u = rand();
      const baseBright = (0.45 + 1.1 * u * u) * (0.6 + 0.4 * edge);
      const drift = shell.drift * (rand() < 0.35 ? rand() : 0);

      if (kindRoll < 0.09) {
        // ladder: two parallel latitude rails with ticks between them
        const len = arcLength * (0.6 + rand() * 1.2);
        const gapAng = 0.02 + rand() * 0.016;
        const width = STANDARD * widthScale;
        if (!pushRing(dir, ringAxis, r, len, width, fseed, FRAG_ARC, baseBright * 0.9, drift, si)) continue;
        placed++;
        acrossRing(dir, ringAxis, gapAng, c2);
        if (pushRing(c2, ringAxis, r, len, width, fseed + 0.005, FRAG_ARC, baseBright * 0.9, drift, si)) placed++;
        const ticks = 3 + Math.floor(rand() * 5);
        for (let k = 0; k < ticks && placed < budget; k++) {
          alongRing(dir, ringAxis, (k / (ticks - 1) - 0.5) * len * 0.9, c2);
          acrossRing(c2, ringAxis, gapAng / 2, c3);
          meridian(c3, ringAxis, tmpV);
          if (pushGreat(c3, tmpV, r, gapAng, HAIRLINE * 1.4 * widthScale, fseed + 0.01 + k * 0.003, FRAG_DASH, baseBright * 1.05, drift, si)) placed++;
        }
      } else if (kindRoll < 0.14) {
        // nested arcs: concentric latitude arcs shrinking toward the inside
        const count = 3 + Math.floor(rand() * 2);
        const len0 = arcLength * (0.7 + rand() * 1.0);
        for (let k = 0; k < count && placed < budget; k++) {
          acrossRing(dir, ringAxis, k * 0.018, c2);
          if (pushRing(c2, ringAxis, r, len0 * (1 - k * 0.2), STANDARD * (1 - k * 0.15) * widthScale, fseed + k * 0.004, FRAG_ARC, baseBright * (1 - k * 0.12), drift, si)) placed++;
        }
      } else if (kindRoll < 0.19) {
        // shard grid: a small block of data cells, one of them hot
        const cols = 2 + Math.floor(rand() * 2);
        const rows = 2 + Math.floor(rand() * 2);
        const pitch = 0.045;
        const hot = Math.floor(rand() * cols * rows);
        let cell = 0;
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows && placed < budget; j++, cell++) {
            if (rand() < 0.3) continue;
            advance(dir, tg, (i - (cols - 1) / 2) * pitch, c2, t2);
            sideStep(c2, t2, (j - (rows - 1) / 2) * pitch, c3, tmpV);
            if (pushGreat(c3, tmpV, r, pitch * 0.6, pitch * 0.55 * r, fseed + cell * 0.002, FRAG_SHARD, baseBright * (cell === hot ? 1.8 : 0.7), drift, si)) placed++;
          }
        }
      } else if (kindRoll < 0.27) {
        // long thin latitude arc: the structural "ring bands" of the cage
        const total = arcLength * (2.2 + rand() * 3.2);
        const pieces = Math.max(2, Math.ceil(total / 0.3));
        let cursor = -total / 2;
        const width = (rand() < 0.3 ? BOLD * 0.8 : HAIRLINE * 1.5) * widthScale;
        const ringBright = baseBright * (0.55 + rand() * 0.35);
        for (let k = 0; k < pieces && placed < budget; k++) {
          const len = (total / pieces) * (0.82 + rand() * 0.18);
          const gap = (total / pieces) - len;
          alongRing(dir, ringAxis, cursor + len / 2, c2);
          if (pushRing(c2, ringAxis, r, len, width, fseed + k * 0.007, FRAG_ARC, ringBright, 0, si)) placed++;
          cursor += len + gap;
        }
      } else if (kindRoll < 0.55) {
        // broken arc: a chain of dashes with gaps along one great circle
        const total = arcLength * (0.45 + rand() * 1.1);
        const pieces = 1 + Math.floor(rand() * 4);
        let cursor = -total / 2;
        const width = STANDARD * (0.8 + rand() * 0.5) * widthScale;
        for (let k = 0; k < pieces && placed < budget; k++) {
          const len = (total / pieces) * (0.45 + rand() * 0.55);
          const gap = (total / pieces) - len;
          advance(dir, tg, cursor + len / 2, c2, t2);
          if (pushGreat(c2, t2, r, len, width, fseed + k * 0.013, FRAG_ARC, baseBright * (0.85 + rand() * 0.3), drift, si)) placed++;
          cursor += len + gap;
        }
      } else if (kindRoll < 0.7) {
        // single crisp dash
        const len = arcLength * (0.08 + rand() * 0.22);
        if (pushGreat(dir, tg, r, len, HAIRLINE * (1 + rand()) * widthScale, fseed, FRAG_DASH, baseBright * 1.15, drift, si)) placed++;
      } else if (kindRoll < 0.86) {
        // rectangular data shard: small, dense data cards
        const len = arcLength * (0.05 + rand() * 0.08);
        const width = (0.012 + rand() * 0.022) * widthScale;
        if (pushGreat(dir, tg, r, len, width, fseed, FRAG_SHARD, baseBright * (0.7 + rand() * 0.6), drift, si)) placed++;
      } else {
        // circuit trace: an L of crisp lines with a pad at the corner
        const width = STANDARD * (0.9 + rand() * 0.5) * widthScale;
        const l1 = arcLength * (0.2 + rand() * 0.45);
        const l2 = arcLength * (0.08 + rand() * 0.2);
        advance(dir, tg, l1 / 2, c2, t2);
        if (pushGreat(c2, t2, r, l1, width, fseed, FRAG_TRACE, baseBright * 1.3, drift, si)) placed++;
        advance(dir, tg, l1, c2, t2);
        bn.crossVectors(c2, t2).normalize();
        if (rand() < 0.5) bn.negate();
        const corner = c2.clone();
        advance(corner, bn, l2 / 2, c2, t2);
        if (pushGreat(c2, t2, r, l2, width, fseed + 0.01, FRAG_TRACE, baseBright * 1.3, drift, si)) placed++;
        if (rand() < 0.6 && placed < budget) {
          if (pushGreat(corner, bn, r, arcLength * 0.03, width * 4.0, fseed + 0.02, FRAG_SHARD, baseBright * 1.2, drift, si)) placed++;
        }
      }
    }
  });

  const count = params.length / 4;

  // base strip: (arcSegments + 1) x 2 vertices, position = (t, side, 0)
  const geometry = makeStripGeometry(Math.max(1, arcSegments));
  geometry.setAttribute("iCenter", new THREE.InstancedBufferAttribute(new Float32Array(centers), 3));
  geometry.setAttribute("iAxis", new THREE.InstancedBufferAttribute(new Float32Array(axes), 3));
  geometry.setAttribute("iParams", new THREE.InstancedBufferAttribute(new Float32Array(params), 4));
  geometry.setAttribute("iStyle", new THREE.InstancedBufferAttribute(new Float32Array(styles), 4));
  geometry.instanceCount = count;

  return { geometry, shells, count };
}

/** Simple strip geometry shared by ribbon-style meshes: position = (t, side, 0). */
export function makeStripGeometry(segments: number): THREE.InstancedBufferGeometry {
  const verts: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    verts.push(t, -1, 0, t, 1, 0);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    index.push(a, b, c, b, d, c);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(index);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.4);
  return g;
}
