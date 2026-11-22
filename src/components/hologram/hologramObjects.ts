import * as THREE from "three";
import type { BuildOutput, FaceMeta, FaceWorld } from "./builder";
import { HOLO_PALETTE } from "./config";

/**
 * The THREE layer of the face hologram (ported from face-lab proto-a/hologram.js): wraps the builder's packed arrays
 * in four objects (filaments, particles, orbitals + marks, halo: 4 draw calls) and drives them from update(state).
 * The filament material also samples the builder's stubble texture (one mipmapped R8 texture).
 *
 * Site changes against the prototype: every width / size that the shaders add in view space is multiplied by the
 * model-view scale (objS), so the head can be parked small by scaling the rig (the prototype only ever zoomed the
 * camera); the tangent is normalised before the edge-on test for the same reason; dispose() frees the GPU objects
 * (tier rebuilds, unmount).
 */
export interface HoloFrameState {
  time: number;
  dt: number;
  assemble: number;
  ignite: number;
  converge: number;
  pulse: number;
  /** object-space units per CSS pixel on the head's plane (LOD) */
  pxWorld: number;
  /** view-space units per CSS pixel at view distance 1 */
  pxWorldPerDist: number;
  /** render DPR of the canvas */
  dpr: number;
  /** render px per display px (> 1 when the canvas supersamples a low-DPR display): every px-sized footprint scales by it */
  ss: number;
  /** the rig's pose (drag + sway + tilt), radians: the orbitals counter-rotate against it */
  yaw: number;
  pitch: number;
  camera: THREE.Camera;
}

/** Live look values (debug panel): brightness gain, halo, network nodes, palette. */
export interface HoloTune {
  gain: number;
  halo: number;
  nodes: number;
  colorBase: string;
  colorHot: string;
  colorDeep: string;
}

/** the builder's counts plus what the GPU gets */
export type HologramCounts = BuildOutput["info"]["counts"] & {
  scanStep: number;
  devPerCrop: number;
  /** record texture + index buffer */
  gpuBytes: number;
  /** what three submits per frame (the harness's count) */
  vertices: number;
  drawCalls: number;
};

export interface HologramObjects {
  group: THREE.Group;
  update: (state: HoloFrameState) => void;
  tune: (t: Partial<HoloTune>) => void;
  dispose: () => void;
  counts: HologramCounts;
}

type Params = Record<string, string | undefined>;

export function createHologramObjects(out: BuildOutput, world: FaceWorld, meta: FaceMeta, params: Params = {}): HologramObjects {
  const P = params;
  const dbg = (k: string, d: number): number => (P[k] !== undefined && P[k] !== "" && Number.isFinite(+(P[k] as string)) ? +(P[k] as string) : d);
  const group = new THREE.Group();
  group.name = "face-hologram";
  const S = world.scale;
  const info = out.info;
  const PALETTE = HOLO_PALETTE;
  const colors = {
    uBase: { value: new THREE.Color(PALETTE.base) },
    uHot: { value: new THREE.Color(PALETTE.hot) },
    uDeep: { value: new THREE.Color(PALETTE.deep) },
  };
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false };
  const common = {
    uExpMask: { value: 0x7f800000 }, // float exponent bits, for holoSafe (a uniform so the test cannot be folded)
    uTime: { value: 0 }, uAssemble: { value: 1 }, uIgnite: { value: 1 }, uConverge: { value: 1 }, uPulse: { value: 0 },
    uPxWorldPerDist: { value: 0.001 }, uDpr: { value: 1 }, uCamObj: { value: new THREE.Vector3(0, 0, 4) },
    uSweepY: { value: 2 }, uZ0: { value: -world.cz * S }, uRimW: { value: dbg('rimw', 0.035) }, uSS: { value: 1 },
  };
  // (polish pass, turned views) TURN_VIS = [occlusion soft band at full turn, shell facing fade from / to, shell limb
  // compensation, shell turn gate from / to, ear-zone edge strokes fade from / to, steep-wall hair strands' handover
  // from / to] (see horizonVis and the shell branch)
  const TURN_VIS = [dbg('horsoft', 0.1), dbg('shellf0', 0.0), dbg('shellf1', 0.25), dbg('shelllimb', 0.45), dbg('shellturn0', 0.02), dbg('shellturn1', 0.14), dbg('earedge0', 0.02), dbg('earedge1', 0.14),
    dbg('hairturn0', 0.02), dbg('hairturn1', 0.13)].map((v) => v.toFixed(4));
  // Every fragment output goes through holoSafe. One NaN or Inf pixel (a degenerate normalize, a 0 / 0 at some pose,
  // an overflow) is spread by the bloom's mip chain into black squares that flicker for a frame or two (seen on
  // iPhones: Apple GPUs keep NaNs where software GL and most desktop drivers happen to flush them). Best effort: the
  // test is on the bit pattern (exponent all ones = NaN or Inf) rather than isnan() / isinf(), which a fast-math
  // compiler (ANGLE's Metal backend) may fold to false, and the mask is a uniform (uExpMask = 0x7f800000) so the
  // compiler cannot pattern-match the test either. The bad value is replaced first (a select; min / max / clamp of a
  // NaN are undefined under fast math), then the finite rest is clamped. The cap is far above any real fragment
  // (additive light, ~0 to 4), so it never changes the image. The real fix is at the sources (clamped pow bases,
  // finite uniforms); this only keeps a missed one from reaching the bloom.
  const GLSL_SAFE = /* glsl */ `
    uniform uint uExpMask;
    vec3 holoSafe(vec3 c) {
      bvec3 bad = equal(floatBitsToUint(c) & uvec3(uExpMask), uvec3(uExpMask));
      return clamp(mix(c, vec3(0.0), bad), vec3(0.0), vec3(64.0));
    }`;
  const GLSL_VIS = /* glsl */ `
    uniform vec3 uCamObj;
    uniform float uZ0, uRimW;
    float sq(float x) { return x * x; } // never pow(x, 2.0): undefined (NaN) for x < 0
    // horizon visibility: h = (toward +x, toward -x, toward up, toward down) elevation angles of the relief
    float horizonVis(vec3 p, vec4 h) {
      // (finishing pass) view DIRECTION (camera treated as distant): the data is a perspective-compensated front view,
      // so front-on every surface point the photo shows must be visible; the per-point ray (uCamObj - p) tilted ~9 deg
      // for the neck and the chin occluded it (the black band under the jaw)
      vec3 v = uCamObj;
      float hx = v.x >= 0.0 ? h.x : h.y, hy = v.y >= 0.0 ? h.z : h.w;
      float ex = atan(v.z, abs(v.x)) - hx;
      float ey = atan(v.z, abs(v.y)) - hy;
      // (polish pass) head-on the soft band is 0.22 rad wide (nothing the photo shows is dimmed by a noisy horizon);
      // turned, that width dimmed everything within 13 degrees of an occluder's edge: a dark wedge between the nose
      // bridge and the far eye's inner corner at yaw 20-35. The band narrows with the turn (head-on it is unchanged).
      float turn = smoothstep(0.03, 0.3, 1.0 - normalize(v).z);
      float soft = mix(0.22, ${TURN_VIS[0]}, turn);
      float vis = smoothstep(-0.02, soft, ex) * smoothstep(-0.02, soft, ey);
      // Yaw and pitch together: the two tests above take the view's elevation in the xz and yz planes one at a time,
      // so a bump straight below a point (the alar wing under the nose flank) hid it from a camera that is below AND to
      // the side, where the ray passes beside the bump: blocky black holes on the nose flank and under the lip at the
      // drag limits. For such views the horizon along the view's own azimuth is estimated from the two axis horizons
      // (slopes weighted by the squared direction cosines) and tested against the true elevation; it only ever adds
      // visibility, and only when turned.
      vec2 w = v.xy * v.xy;
      float l2 = max(w.x + w.y, 1e-9);
      float haz = atan((tan(clamp(hx, -1.5, 1.5)) * w.x + tan(clamp(hy, -1.5, 1.5)) * w.y) / l2);
      float visAz = smoothstep(-0.02, soft, atan(v.z, sqrt(l2)) - haz);
      // (what is hidden head-on, under an overhang steeper than ~77 degrees, stays hidden)
      visAz *= smoothstep(-0.02, 0.22, 1.5708 - hx) * smoothstep(-0.02, 0.22, 1.5708 - hy);
      return mix(vis, max(vis, visAz), turn);
    }
    // turned views: the half-shell's back rim (near the z = 0 silhouette plane) tapers out smoothly (ears exempt)
    float rimTaper(vec3 p, float ear) {
      float side = smoothstep(0.03, 0.3, 1.0 - normalize(uCamObj).z);
      // (finishing pass) the back-of-head shell now continues the surface behind z = 0, so the rim only tapers in the
      // last few px instead of over 0.13 world units (that left a black gap between the ear and the back of the head)
      float r = smoothstep(uZ0 - 0.005, uZ0 + uRimW, p.z);
      return mix(1.0, mix(mix(0.35, 1.0, r), 1.0, ear), side);
    }`;

  // ------------------------------------------------------------------ filaments: vertex pulling from packed records
  const F = out.fil;
  const recTex = new THREE.DataTexture(F.rec, F.texW, F.texH, THREE.RGBAIntegerFormat, THREE.UnsignedIntType);
  recTex.internalFormat = 'RGBA32UI';
  recTex.magFilter = recTex.minFilter = THREE.NearestFilter;
  recTex.generateMipmaps = false;
  recTex.needsUpdate = true;
  // (polish pass) the stubble: a darkening texture over the facial hair (builder 3b), sampled by every skin filament at
  // its own crop position; mipmapped, so the hairs average into their tone when the head is small
  const SB = out.stub;
  const stubTex = new THREE.DataTexture(SB ? SB.px : new Uint8Array(1), SB ? SB.w : 1, SB ? SB.h : 1, THREE.RedFormat, THREE.UnsignedByteType);
  stubTex.unpackAlignment = 1;
  stubTex.magFilter = THREE.LinearFilter;
  stubTex.minFilter = THREE.LinearMipmapLinearFilter;
  stubTex.generateMipmaps = true;
  stubTex.needsUpdate = true;
  const filGeo = new THREE.BufferGeometry();
  // 2-byte stub per vertex: three wants a position attribute to count vertices; the shader reads gl_VertexID instead
  filGeo.setAttribute('position', new THREE.BufferAttribute(new Uint8Array(F.count * 2), 1));
  filGeo.setIndex(new THREE.BufferAttribute(F.index, 1));
  filGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);

  // (polish pass) hair filaments (kinds 2.8 strands, 2.9 outline, and the back-of-head shell). His hair is near-black,
  // so it is a few thin filaments on black; the dim
  // deep amber the other strand kinds use comes out red-brown after tone mapping (the hair read auburn), so the hair runs
  // from gold (dim) to a lighter gold (sheen): the base colour's green raised toward the hot colour's by HAIR_COL[0]
  // .. [1] over lum HAIR_COL[2] .. [3], its blue only by HAIR_COL[4] of that (a paler mix came out grey-beige once the
  // strands blend into a tone at parked sizes: grey hair).
  const glf = (v: number) => v.toFixed(4);
  const HAIR_COL = [dbg('hcol0', 0.14), dbg('hcol1', 0.3), dbg('hcole0', 0.05), dbg('hcole1', 0.6), dbg('hcolb', 0.45)].map(glf);
  // (fix pass) parked sizes. Once the head is small enough that the scan slices have blended into continuous tone, the
  // skin must still be a wire mesh, not a gold-toned photograph. The first polish pass switched the whole network off
  // there (with the slices gone, meridians plus diagonals were a herringbone knit). Now only the diagonals and the nodes
  // go; the meridians stay, and every 2^GRID_RANK-th scan slice (the pitch nearest the meridians') keeps a thin lit
  // core on top of its tone: together a fine lat / long net at about the meridian pitch. Where that pitch falls under
  // ~3.5 px (the phone's 193 px section view once its canvas has stepped down to DPR 1) the net drops a rank of both families (twice the pitch) instead of
  // closing up into pinstripes, and at emblem sizes it is gone (uSmall). The coarse low-tier net has boosted meridians
  // (they are what shows the mesh on a phone at full size); parked they give that boost back.
  // (The coarser a tier's net, the quieter its lines: at the high tier's pitch the net is fine enough to carry more
  // light; at the low tier's the same light read as a grid printed over a toned photograph.)
  const NET_PITCH = info.merWorld / S;
  const PARK_MER = NET_PITCH > 14.5 ? 0.42 : NET_PITCH > 12 ? 0.5 : 0.65, PARK_GRID = NET_PITCH > 14.5 ? 0.19 : NET_PITCH > 12 ? 0.2 : 0.24;
  const GRID_RANK = Math.min(4, Math.max(1, Math.round(dbg('parkrank', Math.log2(info.merWorld / Math.max(1e-9, info.scanWorld))))));
  const filMat = new THREE.ShaderMaterial({
    ...additive,
    side: THREE.DoubleSide,
    uniforms: {
      ...colors, ...common,
      uGain: { value: dbg('gain', 1.0) }, uScanW: { value: info.scanWorld }, uMerW: { value: info.merWorld }, uCropW: { value: info.cropWorld },
      uLod: { value: 0 }, uMerLod: { value: 0 }, uRec: { value: recTex }, uRecW: { value: F.texW }, uFeatPx: { value: dbg('featpx', 0.55) }, uVisOff: { value: dbg('visoff', 0) }, uEdgeOn: { value: new THREE.Vector2(dbg('eon0', 0.08), dbg('eon1', 0.35)) }, uCap: { value: dbg('cap', 0.8) }, uMeshFloor: { value: dbg('meshfloor', 0.75) }, uSmall: { value: 0 }, uCrowd: { value: dbg('crowd', 0.7) }, uMinHalf: { value: 0.55 }, uBand: { value: new THREE.Vector2(1.8, 2.8) }, dbgBL: { value: new THREE.Vector2(dbg('blmin', 0.9), dbg('blk', 1.0)) },
      // stubble texture: its box in crop px (x0, y0, 1 / width, 1 / height), the crop <- object mapping (cx, cy, 1 / camDist)
      // and (how dark a hair is, mip bias)
      uStub: { value: stubTex }, uStubRect: { value: SB ? new THREE.Vector4(SB.x0, SB.y0, SB.k / SB.w, SB.k / SB.h) : new THREE.Vector4(0, 0, 0, 0) },
      uStubMap: { value: new THREE.Vector3(world.cx, world.cy, world.camDist > 0 ? 1 / world.camDist : 0) }, uStubA: { value: new THREE.Vector2(SB ? dbg('stubk', 1.0) : 0, dbg('stubbias', -0.4)) },
      // parked sizes (see update): x = how far the slice stack has blended into tone at this size, y = what a slice
      // that runs toward the eye keeps of its light there, z = what the meridians keep, w = the wire slices' gain;
      // uGrid = (rank from which a slice is a wire slice, the wire's half width in device px, the net's level: each
      // level drops one more rank of meridians and wire slices, doubling the net's pitch)
      uParked: { value: new THREE.Vector4(0, dbg('parkfloor', 0.62), dbg('parkmer', PARK_MER), dbg('parkgrid', PARK_GRID)) },
      uGrid: { value: new THREE.Vector3(GRID_RANK, 0.55, 0) },
    },
    vertexShader: /* glsl */ `
      uniform highp usampler2D uRec;
      uniform int uRecW;
      uniform float uTime, uAssemble, uIgnite, uPulse, uPxWorldPerDist, uDpr, uSweepY, uGain, uScanW, uMerW, uCropW;
      uniform float uLod, uMerLod, uFeatPx, uCap, uVisOff, uMeshFloor, uSmall, uCrowd, uMinHalf, uSS;
      uniform vec2 uEdgeOn, uBand;
      uniform vec2 dbgBL;
      uniform vec4 uStubRect;
      uniform vec3 uStubMap;
      uniform vec2 uStubA;
      uniform vec4 uParked;
      uniform vec3 uGrid;
      ${GLSL_VIS}
      varying float vSide, vI, vU, vM, vSeed, vComp, vKind, vFront;
      varying vec3 vStub;
      varying vec2 vWire;
      float lo16s(uint w) { return max(float(int(w << 16u) >> 16) / 32767.0, -1.0); }
      float hi16s(uint w) { return max(float(int(w) >> 16) / 32767.0, -1.0); }
      float lo16u(uint w) { return float(w & 65535u) / 65535.0; }
      float hi16u(uint w) { return float(w >> 16u) / 65535.0; }
      float s8(uint w, uint sh) { return max(float(int(w << (24u - sh)) >> 24) / 127.0, -1.0); }
      float u8(uint w, uint sh) { return float((w >> sh) & 255u); }
      void main() {
        // vertex pulling: vertex 2i / 2i+1 = the two sides of point i, its 32-byte record = texels 2i, 2i+1
        int pid = gl_VertexID >> 1;
        float side = (gl_VertexID & 1) == 1 ? 1.0 : -1.0;
        int tx = (pid * 2) % uRecW, ty = (pid * 2) / uRecW;
        uvec4 r0 = texelFetch(uRec, ivec2(tx, ty), 0);
        uvec4 r1 = texelFetch(uRec, ivec2(tx + 1, ty), 0);
        vec3 p = vec3(lo16s(r0.x), hi16s(r0.x), lo16s(r0.y)) * 1.25;
        float key = hi16u(r0.y);
        vec3 tng = vec3(s8(r0.z, 0u), s8(r0.z, 8u), s8(r0.z, 16u));
        float kind = u8(r0.z, 24u) / 20.0;
        vec4 hor = vec4(s8(r0.w, 0u), s8(r0.w, 8u), s8(r0.w, 16u), s8(r0.w, 24u)) * 1.6;
        vec3 gapv = vec3(s8(r1.x, 0u), s8(r1.x, 8u), s8(r1.x, 16u)) * 0.04;
        float mb = u8(r1.x, 24u);
        float earF = step(127.5, mb);
        float mk = (mb - 128.0 * earF) / 127.0;
        float I0 = lo16u(r1.y) * 4.0;
        float halfCrop = hi16u(r1.y) * 16.0;
        float arcU = lo16u(r1.z) * 4096.0;
        float seed = hi16u(r1.z);
        float rank = u8(r1.w, 0u);
        vSide = side; vI = 0.0; vU = arcU; vM = mk; vSeed = seed; vComp = 1.0; vKind = kind; vFront = 0.0; vWire = vec2(0.0, 1.0);
        // stubble lookup: the point's crop position (the builder's toWorld inverted) in the texture's box; skin filaments
        // only (scan, meridians, edge strokes, diagonals)
        float cropK = uCropW * (1.0 - p.z * uStubMap.z);
        vStub = vec3((vec2(uStubMap.x + p.x / cropK, uStubMap.y - p.y / cropK) - uStubRect.xy) * uStubRect.zw, (kind < 1.5 || (kind > 5.95 && kind < 7.5)) ? uStubA.x : 0.0);

        float rim = rimTaper(p, earF);
        float vis = horizonVis(p, hor) * rim;
        // (integration pass) how far the head is turned SIDEWAYS (1 - cos yaw; 0 for a pure pitch): the hair's handover
        // to the turned views' strands (shell and sweep in, steep-wall strands out) is for the side views. Looking down
        // on the head the photo's own strands stay: over the top they run sideways from the parting, the sweep runs
        // straight back, and the two crossed there.
        vec3 cdir = normalize(uCamObj);
        float yawTurn = 1.0 - sqrt(max(0.0, 1.0 - cdir.x * cdir.x));
        // (polish pass) the hair's outline (kind 2.9) lies in the silhouette plane: front view only
        // (it goes with a pitch as well: kept there, it floats above the crown as a loose wire)
        if (kind > 2.85 && kind < 2.975) vis *= 1.0 - smoothstep(0.012, 0.07, 1.0 - cdir.z);
        if (kind > 7.5) {
          // back-of-head shell: the gap slot holds the outward normal; front-facing part only, and only when turned
          vec3 nrm = normalize(vec3(s8(r1.x, 0u), s8(r1.x, 8u), s8(r1.x, 16u)) + 1e-6);
          float facing = dot(nrm, normalize(uCamObj - p));
          // (polish pass) toward the shell's limb the strands crowd on screen as 1 / facing: their light is taken down
          // with it (no bright outline around the back of the head). (integration pass) It comes in early in the turn
          // (from ~11 degrees, whole by ~30, beyond the idle sway): the sweep strands on the side of the head must be
          // there before the front strands they replace have gone (those hand over across the same range)
          vis = smoothstep(${TURN_VIS[1]}, ${TURN_VIS[2]}, facing) * clamp(facing / ${TURN_VIS[3]}, 0.0, 1.0) * smoothstep(${TURN_VIS[4]}, ${TURN_VIS[5]}, yawTurn);
          rim = 1.0;
          if (uVisOff > 1.5) vis = 1.0; // debug ?visoff=2: whole shell
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // (site) the rig scales the head to park it small: widths are object-space, the expansion is view-space
        float objS = length(modelViewMatrix[0].xyz);
        vec3 t = (modelViewMatrix * vec4(tng, 0.0)).xyz;
        t = length(t) > 1e-9 ? normalize(t) : vec3(1.0, 0.0, 0.0);
        vec3 eye = normalize(mv.xyz);
        vec3 sd = cross(t, eye);
        float sl = length(sd);
        sd = sl > 1e-5 ? sd / sl : vec3(1.0, 0.0, 0.0);
        float edgeOn = smoothstep(uEdgeOn.x, uEdgeOn.y, sl);
        if (uVisOff > 0.5 && kind < 7.5) vis = rim;
        // (polish pass) edge strokes in the ear zone trace the photo's front-view edges (tragus, sideburn, helix fold)
        // over the steep wall between cheek and ear: head-on they are right, turned they smear into S-shaped scribbles
        // in front of the ear, so they fade out with the turn
        if (kind > 5.95 && kind < 6.5) vis *= 1.0 - earF * smoothstep(${TURN_VIS[6]}, ${TURN_VIS[7]}, 1.0 - normalize(uCamObj).z);
        // and the slice ends that run along the ear's outer rim stack up there into a heavy drawn outline: the builder
        // marks them (turn fade, record word 7 bits 8-15) and they go out with the turn (a soft rear edge; the thin rim
        // filament is the helix line)
        // (integration pass) the hair strands on the relief's steep walls carry it too: turned, they hand over to the
        // sweep strands (shell kind), which are laid for those views
        float turnFade = u8(r1.w, 8u) / 255.0; // the share of its light a point gives up when the head is turned
        // (fix pass: the hair's handover is over by ~30 degrees of yaw, as the sweep's arrival is; while it ran on to 45
        // the two sets of strands crossed on the far upper side of the head at yaw 30)
        vis *= 1.0 - turnFade * (kind > 2.5 && kind < 3.0 ? smoothstep(${TURN_VIS[8]}, ${TURN_VIS[9]}, yawTurn) : smoothstep(0.03, 0.3, 1.0 - cdir.z));
        float dist = max(-mv.z, 0.05);
        float half_ = halfCrop * uCropW * objS * mix(0.35, 1.0, smoothstep(0.2, 0.95, mk)) * mix(0.55, 1.0, rim);
        float wpp = uPxWorldPerDist * dist / uDpr; // world units per device pixel here

        // ---- LOD (decided in JS with hysteresis, crossfaded in time): slices of rank < uLod are dropped only when the
        // spacing falls below ~1.5 device px (parked / emblem sizes); between ~1.5 and 2.8 px the band-limit below
        // blends the stack toward continuous tone instead (no thick venetian-blind bars). Meridians likewise with
        // uMerLod; the diagonal family and the network nodes fade out with the meridian LOD.
        float lodGain = 1.0;
        float famMul = 1.0;
        bool isScan = kind < 0.5;
        bool isMer = kind > 0.5 && kind < 1.5;
        if (isScan || isMer) {
          float Lf = isScan ? uLod : uMerLod;
          float Li = floor(Lf), fr = Lf - Li;
          float keep = rank >= Li + 1.0 ? 1.0 : (rank >= Li ? 1.0 - fr : 0.0);
          float G = isScan ? exp2(Lf) : 1.0; // meridians: dropped ranks simply go (no widened survivors: wide vertical bars)
          famMul = G;
          // energy-conserving: a survivor carries the energy of the slices it replaces through its (virtual) width;
          // the drawn width / vComp below turn that into width first, brightness never rises (no hot forehead)
          half_ *= G;
          // meridians: at full size none below MER_DOWN px; parked, the net's ranks at uParked.z of their light
          float Ln = floor(uGrid.z), fn = uGrid.z - Ln;
          float keepN = rank >= Ln + 1.0 ? 1.0 : (rank >= Ln ? 1.0 - fn : 0.0);
          // (a coarser net is drawn on a smaller head: a quarter dimmer from the first level on)
          lodGain = isMer ? mix(keep * (1.0 - smoothstep(0.0, 1.0, uMerLod)), keepN * uParked.z * (1.0 - 0.25 * min(uGrid.z, 1.0)) * (1.0 - uSmall), uParked.x) : keep;
        } else if (kind > 6.5 && kind < 7.5) {
          // the diagonals go with the meridian LOD and wherever the slices have blended to tone (parked): without the
          // slices they knit a herringbone with the meridians. (fix pass) NOT the back shell and the sweep strands
          // (kind 8.x): they are the hair of the turned views at every size; culled here, a head turned in the parked
          // section view had a bald side and back.
          lodGain = (1.0 - smoothstep(0.0, 1.0, uMerLod)) * (1.0 - uParked.x);
        }
        // ---- band-limit from the PROJECTED local spacing (per vertex): where slices crowd below ~2.8 device px
        // (bunched under the nose / jaw, cheeks turning away at pitch) the line widens toward the spacing with energy
        // compensation, so the stack blends to tone there instead of beating against the pixel grid (moire)
        float spPx = 0.0;
        if (isScan) {
          vec3 g = (modelViewMatrix * vec4(gapv, 0.0)).xyz;
          vec2 t2 = length(t.xy) > 1e-6 ? normalize(t.xy) : vec2(1.0, 0.0);
          vec2 gp = g.xy - dot(g.xy, t2) * t2;
          spPx = length(gp) * famMul / wpp;
          if (length(gapv) < 1e-5) spPx = uScanW * objS * famMul / wpp;
        } else if (isMer) {
          spPx = uMerW * objS * exp2(floor(uMerLod)) / wpp;
        }
        // turned views: where the surface turns away (forehead and nose profile at the yaw limit) the slices crowd on
        // screen and their additive sum burns to a white-hot rim; beyond uCrowd of the built spacing the extra density
        // is taken out of the brightness (front-on the projected spacing is the built one, so nothing changes there)
        // Two compressions: across the lines (scan slices crowding) and along them (a line running toward the eye: its
        // light per screen px grows as 1 / sin(angle)); both measured against the front view
        float crowd = 1.0;
        // (the spacing across a line is only measurable while the line runs across the screen: on a nose flank it runs
        // toward the eye, its screen tangent is degenerate and the measured spacing meaningless)
        if (isScan && length(gapv) >= 1e-5) crowd = mix(1.0, clamp(spPx / max(1e-4, uScanW * objS * famMul / wpp * uCrowd), 0.0, 1.0), smoothstep(0.5, 0.8, length(t.xy)));
        // (only on surfaces that face the camera front-on, e.g. the forehead turning edge-on: lines on steep flanks, like
        // the nose's, already run toward the eye front-on and a small sway would otherwise darken one flank)
        if (kind < 7.5) {
          vec3 tn0 = normalize(tng + vec3(1e-6));
          float slFront = length(tn0.xy);
          float tc = clamp(sl / max(1e-3, slFront * uCrowd), 0.0, 1.0);
          crowd = min(crowd, mix(1.0, tc, smoothstep(0.55, 0.85, slFront)));
        }
        float blend = spPx > 0.0 ? 1.0 - smoothstep(uBand.x, uBand.y, spPx) : 0.0;
        // (fix pass) parked, the whole stack is tone: a slice whose neighbours happen to project further away than the
        // band (the shelf of the lower lid, where the slices fan out) blends to its spacing like the rest. Left a crisp
        // line among blended ones it was a lit dash under each iris. (Not a slice that runs toward the eye, the wall
        // between nose and cheek: its spacing across the screen means nothing there, and widened to it the few sub-pixel
        // quads it is drawn with became a row of lit dots down one side of the nose on a phone.)
        if (isScan && spPx > 0.0) blend = max(blend, uParked.x * ${glf(dbg('parkblend', 1))} * smoothstep(0.25, 0.7, sl));
        // identity feature lines (lids, iris, catchlight, lips) keep a fixed minimum device-px width; at hero size they
        // dim linearly like everything else (tone unchanged), only when the head is parked small do they keep more of
        // their brightness (floor 0.5 * sqrt), so the eyes still read at 120 px
        bool feat = kind > 4.5 && kind < 5.95;
        float minHalfPx = feat ? uFeatPx * uSS : max(uMinHalf, blend * max(dbgBL.x * uSS, dbgBL.y * spPx));
        float drawn = max(half_, minHalfPx * wpp);
        // LOD survivors: the virtual width is capped at the survivor spacing (energy beyond it is folded into a little
        // brightness, max 1.6x); at full resolution a line is never brighter than its own tone (vComp <= 1)
        // (finishing pass) ranks are only dropped below ~0.45 device px (emblem sizes, to bound overdraw); every survivor
        // then still overlaps its neighbours (min half 0.55 px = ~1.2 px effective width), so parked heads read as
        // continuous tone instead of thick venetian-blind bars
        if (famMul > 1.0 && spPx > 0.0) drawn = min(drawn, max(1.0 * spPx * wpp, minHalfPx * wpp));
        // emblem sizes (uSmall -> 1): no brightness floor on the feature lines and no LOD brightness boost, so no single
        // hot pixel on the catchlights / nose at 40 px
        vComp = feat ? max(half_ / drawn, (1.0 - uSmall) * 0.5 * sqrt(half_ / drawn)) : min(half_ / drawn, famMul > 1.0 ? mix(1.6, 1.0, uSmall) : 1.0);
        // (finishing pass) the wireframe families (meridians, diagonals) keep most of their brightness at DPR 1 / 1.25,
        // where their true width is below the 1.1 px minimum: otherwise the mesh only shows at DPR 2 and the skin reads
        // as a plain horizontal hatch
        if (isMer || (kind > 6.5 && kind < 7.5)) vComp = max(vComp, uMeshFloor); // (polish pass: not the shell, it thins like the hair strands)
        // (fix pass) parked: the wire slices (rank >= uGrid.x + the net's level) carry a thin lit core inside their blended ribbon (see
        // the fragment shader); not where they crowd closer than ~3 px on screen (under the nose, a cheek turning away)
        float wireR = uGrid.x + floor(uGrid.z);
        if (isScan && uParked.x > 0.0 && rank >= wireR) {
          float gsp = spPx * exp2(wireR) / uSS;
          float wk = rank >= wireR + 1.0 ? 1.0 : 1.0 - fract(uGrid.z);
          vWire = vec2(uParked.w * uParked.x * wk * (1.0 - 0.25 * min(uGrid.z, 1.0)) * smoothstep(2.4, 4.0, gsp) * (1.0 - uSmall), clamp(uGrid.y * uSS * wpp / (drawn * 1.6), 0.04, 1.0));
        }
        mv.xyz += sd * side * drawn * 1.6;
        gl_Position = projectionMatrix * mv;

        // intro: a scan plane descends and draws the filaments behind it
        float a = uAssemble * 1.12 - 0.04;
        float built = smoothstep(key - 0.004, key + 0.012, a);
        vFront = exp(-sq((key - a) / 0.018)) * step(0.001, uAssemble) * step(uAssemble, 0.999);
        float sw = exp(-sq((p.y - uSweepY) / 0.022)) + 0.35 * exp(-sq((p.y - uSweepY - 0.05) / 0.06));
        float rip = exp(-sq((length(p.xy - vec2(0.0, 0.05)) - (1.0 - uPulse) * 1.25) / 0.08)) * uPulse;
        float flick = 0.94 + 0.06 * sin(uTime * (1.3 + seed * 2.0) + seed * 60.0);
        float ign = mix(0.25, 1.0, uIgnite) + 0.6 * uIgnite * (1.0 - uIgnite) * 4.0 * step(uAssemble, 0.999);
        float base = I0 * vis * edgeOn * flick * built * ign * uGain * lodGain;
        // sweep, pulse ripple and the intro front are tone-weighted and capped: they light up the darker filaments
        // and never push an already bright one (forehead, nose) past uCap, so nothing burns out
        float room = 1.0 - smoothstep(0.25, 0.75, I0);
        float boost = (1.6 * sw + 0.4 * uPulse + 0.75 * rip) * mix(0.3, 1.0, room); // pulse more visible, still capped by uCap
        float full = base * (1.0 + boost) + 0.4 * vFront * I0 * vis * edgeOn * uGain * lodGain;
        vI = min(full, max(base, uCap));
        vI = min(vI, mix(4.0, 0.55, uSmall)); // per-filament peak clamp when parked tiny
        // a whole feature ring (catchlight, iris) collapses into one or two pixels when parked tiny and its segments add
        // up there (a hot pixel on the eye / nose at 76 px): the feature lines give up half their light at emblem sizes
        if (feat) vI *= 1.0 - 0.5 * uSmall;
        vI *= crowd;
        // (polish pass) parked sizes (uParked -> 1 with the mesh fade): slices that run toward the eye (the wall between
        // nose and cheek, the ear's rim) are a few sub-pixel quads there and rasterise as stray bright pixels down the
        // side of the nose; they give up part of their light with their foreshortening (not all of it: the flank keeps
        // its tone). Nothing changes at hero size.
        if (isScan) vI *= mix(1.0, mix(uParked.y, 1.0, smoothstep(0.12, 0.8, sl)), uParked.x);
        if (lodGain < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_SAFE}
      uniform vec3 uBase, uHot, uDeep;
      uniform float uTime;
      uniform sampler2D uStub;
      uniform vec2 uStubA;
      varying float vSide, vI, vU, vM, vSeed, vComp, vKind, vFront;
      varying vec3 vStub;
      varying vec2 vWire;
      float sq(float x) { return x * x; }
      // integer hash (PCG output permutation) of a dash cell and a filament seed, 0..1: a float sin() hash of
      // arguments up to ~2e4 is range-reduced coarsely on mobile GPUs (patterned dash keep/drop in the neck dissolve)
      float hash(int cell, uint seed, uint salt) {
        uint h = uint(cell) * 747796405u + seed * 2891336453u + salt;
        h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
        h = (h >> 22u) ^ h;
        return float(h) * (1.0 / 4294967295.0);
      }
      void main() {
        float edge = 1.0 - smoothstep(0.3, 1.0, abs(vSide));
        // (every pow base below is clamped to 0..1: GLSL leaves pow undefined for a base < 0, and an approximate sin /
        // cos at large arguments can land a hair below -1, so 0.5 + 0.5 * sin a hair below 0: NaN on Apple GPUs)
        float run = pow(clamp(0.5 + 0.5 * sin(vU * 0.03 - uTime * 0.9 + vSeed * 40.0), 0.0, 1.0), 6.0);
        float i = vI * (0.96 + 0.1 * run);
        // stubble: fine dark hairs cut out of the skin filaments (sampled outside any branch: implicit derivatives)
        i *= 1.0 - vStub.z * texture2D(uStub, vStub.xy, uStubA.y).r;
        // the neck dissolves: filaments break into shorter and shorter dashes, then soft dots, where the mask fades
        if (vM < 0.98) {
          float q = vU * 0.45 + vSeed * 17.0;
          float cell = floor(q), cf = fract(q);
          float pk = pow(max(vM, 0.0), 1.5); // (vM can interpolate a hair below 0 on a triangle's edge)
          int ic = int(cell);
          uint sd = uint(vSeed * 65535.0);
          float h = hash(ic, sd, 0u);
          float hp = hash(ic - 1, sd, 0u);
          float hn = hash(ic + 1, sd, 0u);
          float h2 = hash(ic, sd, 0x9e3779b9u);
          float keep = step(h, pk);
          float dash = 1.0 - (1.0 - step(hn, pk)) * smoothstep(0.55, 1.0, cf) - (1.0 - step(hp, pk)) * (1.0 - smoothstep(0.0, 0.45, cf)); // (never reversed edges: undefined)
          float dotc = 0.25 + 0.5 * h2;
          float dotv = exp(-sq((cf - dotc) / mix(0.08, 0.3, vM)));
          i *= keep * mix(dotv, max(dash, 0.0), smoothstep(0.55, 0.92, vM)) * mix(0.5, 1.0, vM);
        }
        float lum = clamp(i, 0.0, 2.0);
        float strandK = max(step(1.5, vKind) * step(vKind, 3.95), step(7.5, vKind));
        vec3 lowCol = mix(mix(uDeep, uBase, 0.6), mix(uDeep, uBase, 0.55), strandK);
        vec3 col = mix(lowCol, uBase, smoothstep(0.02, 0.3, lum) * (1.0 - 0.6 * strandK));
        float deepK = vKind > 1.5 ? clamp((fract(vKind + 0.001) - 0.2) * 1.25, 0.0, 1.0) : 0.0;
        // (polish pass) the back-of-head shell (kind 8.x) is hair: kept clear of the deep-amber tint, it takes the
        // hair's gold below
        float shellK = step(7.5, vKind);
        deepK *= 1.0 - shellK;
        col = mix(col, mix(uDeep, uBase, 0.4), deepK * (1.0 - smoothstep(0.25, 0.7, lum)));
        // the network family (diagonals) leans a touch more amber than the scan so it reads as its own filaments
        col = mix(col, mix(uDeep, uBase, 0.55), step(6.5, vKind) * step(vKind, 7.5) * 0.5);
        // hair (kinds 2.8, 2.9) and the shell: gold to a lighter gold, never the red-brown of a dim deep amber
        float hairT = mix(${HAIR_COL[0]}, ${HAIR_COL[1]}, smoothstep(${HAIR_COL[2]}, ${HAIR_COL[3]}, lum));
        col = mix(col, mix(uBase, uHot, vec3(0.0, hairT, hairT * ${HAIR_COL[4]})), max(step(2.7, vKind) * step(vKind, 2.975), shellK));
        col = mix(col, uHot, clamp(smoothstep(0.8, 1.5, lum) + 0.12 * vFront, 0.0, 1.0));
        // parked wire slices: a thin core at the ribbon's centre line, on top of the tone the ribbon carries
        float wire = vWire.x * (1.0 - smoothstep(0.5 * vWire.y, vWire.y, abs(vSide)));
        gl_FragColor = vec4(holoSafe(col * lum * edge * vComp + col * lum * wire), 1.0);
      }`,
  });
  const filaments = new THREE.Mesh(filGeo, filMat);
  filaments.name = 'filaments';
  filaments.frustumCulled = false;
  group.add(filaments);

  // ------------------------------------------------------------------ particles: dust, neck dissolve, network nodes
  const PT = out.pts;
  const ptGeo = new THREE.BufferGeometry();
  ptGeo.setAttribute('position', new THREE.BufferAttribute(PT.pos, 3));
  ptGeo.setAttribute('aInfo', new THREE.BufferAttribute(PT.info, 4));
  ptGeo.setAttribute('aHor', new THREE.BufferAttribute(PT.hor, 4));
  ptGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  const ptMat = new THREE.ShaderMaterial({
    ...additive,
    uniforms: {
      ...colors, ...common, uMerLod: filMat.uniforms.uMerLod, uParked: filMat.uniforms.uParked, uNode: { value: dbg('gnode', 1.0) },
      // neck dust: (axis world x, how far it is drawn in toward the axis by the end of its fall, fall length scale)
      // (no neck, ?holo.neck=0: the embers under the jaw drift almost straight down, a little further)
      uNeck: { value: dbg('neck', 1) > 0.5 ? new THREE.Vector3(info.neckX, dbg('neckin', 0.12), dbg('neckfall', 0.5)) : new THREE.Vector3(info.neckX, dbg('neckin', 0.03), dbg('neckfall', 1.2)) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aInfo;
      attribute vec4 aHor;
      uniform float uTime, uConverge, uAssemble, uIgnite, uPxWorldPerDist, uDpr, uPulse, uMerLod, uNode, uSS;
      uniform vec3 uNeck;
      uniform vec4 uParked;
      ${GLSL_VIS}
      varying float vA, vHot;
      void main() {
        float kind = aInfo.x;
        vec3 p = position;
        float a = 0.0;
        float size = 0.004;
        vHot = 0.0;
        if (kind < 0.5) {
          float ang = uTime * (0.025 + 0.04 * aInfo.y) * (aInfo.z > 0.5 ? 1.0 : -1.0);
          float c = cos(ang), s = sin(ang);
          p = vec3(c * p.x + s * p.z, p.y + 0.025 * sin(uTime * 0.3 + aInfo.y * 31.0), -s * p.x + c * p.z);
          p *= mix(2.3 + aInfo.z, 1.0, smoothstep(0.0, 1.0, uConverge));
          size = 0.0035 + 0.006 * aInfo.y * aInfo.y;
          // (base clamped: a NaN here makes the whole point sprite a NaN square, see the filaments' run)
          a = aInfo.w * (0.25 + 0.75 * pow(clamp(0.5 + 0.5 * sin(uTime * (0.5 + aInfo.z) + aInfo.y * 50.0), 0.0, 1.0), 3.0)) * 0.55;
          a *= smoothstep(0.0, 0.3, uConverge);
          float inFace = (1.0 - smoothstep(0.75, 1.05, length(vec2(p.x / 0.5, (p.y - 0.06) / 0.78)))) * step(0.0, p.z);
          a *= 1.0 - 0.8 * inFace;
        } else if (kind < 1.5) {
          float ph = fract(uTime * (0.05 + 0.06 * aInfo.y) + aInfo.z);
          // neck dust falls a short way and is drawn in toward the neck's axis as it goes (no skirt below the column)
          p.y -= ph * (0.035 + 0.045 * aInfo.z) * uNeck.z;
          p.x += 0.012 * sin(uTime * 0.7 + aInfo.y * 20.0) * ph + (uNeck.x - position.x) * uNeck.y * ph;
          vec3 from = position * (2.0 + aInfo.y);
          p = mix(from, p, smoothstep(0.0, 1.0, uConverge));
          size = 0.003 + 0.0045 * aInfo.z;
          a = aInfo.w * sin(3.14159 * ph) * 0.9 * horizonVis(position, aHor) * smoothstep(0.2, 0.8, uConverge);
        } else if (kind < 2.75) {
          // network nodes at real filament crossings: a steady faint node, hubs a little brighter, rare short flashes
          float hub = step(2.25, kind);
          float tw = pow(max(0.0, sin(uTime * (0.35 + 0.5 * aInfo.y) + aInfo.z * 80.0)), 40.0);
          size = mix(0.0042, 0.0062, hub);
          a = aInfo.w * (mix(0.16, 0.42, hub) + 1.3 * tw) * horizonVis(position, aHor) * rimTaper(position, 0.0);
          a *= smoothstep(0.7, 1.0, uAssemble) * uNode * (1.0 - smoothstep(0.0, 1.0, uMerLod)) * (1.0 - uParked.x); // (with the diagonals)
          vHot = tw;
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float px = size * length(modelViewMatrix[0].xyz) / (uPxWorldPerDist * max(-mv.z, 0.05)) * uDpr;
        float drawn = max(px, 1.6 * uSS);
        vA = a * (px * px) / (drawn * drawn) * (0.4 + 0.6 * uIgnite) * (1.0 + 0.5 * uPulse);
        gl_PointSize = drawn;
        gl_Position = projectionMatrix * mv;
        // parked neck dust (kind 9) is never drawn: moved outside the clip volume so it rasterizes no fragments
        if (kind > 8.5) { vA = 0.0; gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_SAFE}
      uniform vec3 uBase, uHot;
      varying float vA, vHot;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = 1.0 - smoothstep(0.0, 1.0, d);
        a *= a;
        gl_FragColor = vec4(holoSafe(mix(uBase, uHot, clamp(a * 0.6 + vHot, 0.0, 1.0)) * vA * a), 1.0);
      }`,
  });
  const particles = new THREE.Points(ptGeo, ptMat);
  particles.name = 'particles';
  particles.frustumCulled = false;
  group.add(particles);

  // ------------------------------------------------------------------ orbitals + scan line + biometric marks (one mesh)
  // kinds: 0 ring (rotated by uRot[id]), 1 ring tick, 2 scan line (follows uMarkY), 3 static mark
  const mp: number[] = [], mt: number[] = [], mi: number[] = [], mj: number[] = [];
  const mIdx: number[] = [];
  let mv0 = 0;
  function mLine(points: number[][], tangents: number[][], kind: number, id: number, I: number, half: number) {
    const n = points.length;
    let L = 0;
    for (let i = 0; i < n; i++) {
      if (i) L += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
      for (let k = 0; k < 2; k++) {
        mp.push(...points[i]);
        mt.push(...tangents[i]);
        mi.push(k ? 1 : -1, kind, id, L);
        mj.push(I, half, i / (n - 1), 0);
      }
      if (i) { const a = mv0 + (i - 1) * 2, b = mv0 + i * 2; mIdx.push(a, a + 1, b, a + 1, b + 1, b); }
    }
    mv0 += n * 2;
  }
  interface Ring { r: number; tilt?: number; roll?: number; prec: number; ph: number; arc: number; I: number; swing?: number; face?: boolean }
  const rings: Ring[] = [
    { r: 0.965, tilt: 1.31, roll: 0.1, prec: 0.035, ph: 0.3, arc: 1.0, I: 0.32 },
    { r: 0.9, tilt: -1.42, roll: 0.0, prec: -0.026, ph: 2.0, arc: 1.0, I: 0.2, swing: 0.2 },
    { r: 0.99, face: true, prec: 0.05, ph: 4.1, arc: 0.42, I: 0.26 }, // outermost: clearly its own arc, not a second copy of ring 1
  ];
  rings.forEach((R, id) => {
    const NR = 220;
    const pts: number[][] = [], tg: number[][] = [];
    for (let i = 0; i <= NR; i++) {
      const a = (i / NR) * Math.PI * 2 * R.arc;
      if (R.face) { pts.push([R.r * Math.cos(a), R.r * Math.sin(a), 0]); tg.push([-Math.sin(a), Math.cos(a), 0]); }
      else { pts.push([R.r * Math.cos(a), 0, R.r * Math.sin(a)]); tg.push([-Math.sin(a), 0, Math.cos(a)]); }
    }
    mLine(pts, tg, 0, id, R.I, 0.0011);
    const nt = id === 0 ? 72 : id === 2 ? 24 : 0;
    for (let i = 0; i < nt; i++) {
      const a = (i / nt) * Math.PI * 2 * R.arc;
      const major = i % 6 === 0;
      const l = major ? 0.028 : 0.012;
      const c = Math.cos(a), s = Math.sin(a);
      if (R.face) mLine([[(R.r - l * 0.3) * c, (R.r - l * 0.3) * s, 0], [(R.r + l) * c, (R.r + l) * s, 0]], [[c, s, 0], [c, s, 0]], 1, id, major ? 0.5 : 0.3, 0.0012);
      else mLine([[(R.r - l * 0.3) * c, 0, (R.r - l * 0.3) * s], [(R.r + l) * c, 0, (R.r + l) * s]], [[c, 0, s], [c, 0, s]], 1, id, major ? 0.5 : 0.3, 0.0012);
    }
  });
  {
    const pts: number[][] = [], tg: number[][] = [];
    for (let i = 0; i <= 64; i++) { const x = -0.9 + 1.8 * (i / 64); pts.push([x, 0, 0.05]); tg.push([1, 0, 0]); }
    mLine(pts, tg, 2, 0, 0.12, 0.0009);
    for (const sx of [-1, 1]) mLine([[sx * 0.9, -0.025, 0.05], [sx * 0.9, 0.025, 0.05]], [[0, 1, 0], [0, 1, 0]], 2, 1, 0.45, 0.0012);
  }
  for (const { p: P0, sx, sy } of out.frame) {
    const Ph = [P0[0] + sx * 0.06, P0[1], P0[2]];
    const Pv = [P0[0], P0[1] - sy * 0.06, P0[2]];
    mLine([Ph, P0], [[1, 0, 0], [1, 0, 0]], 3, 0, 0.11, 0.0009);
    mLine([P0, Pv], [[0, 1, 0], [0, 1, 0]], 3, 0, 0.11, 0.0009);
  }
  const mkGeo = new THREE.BufferGeometry();
  mkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mp), 3));
  mkGeo.setAttribute('aTan', new THREE.BufferAttribute(new Float32Array(mt), 3));
  mkGeo.setAttribute('aInfo', new THREE.BufferAttribute(new Float32Array(mi), 4));
  mkGeo.setAttribute('aInfo2', new THREE.BufferAttribute(new Float32Array(mj), 4));
  mkGeo.setIndex(new THREE.BufferAttribute(new Uint16Array(mIdx), 1));
  mkGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
  const rotU = rings.map(() => new THREE.Matrix3());
  const mkMat = new THREE.ShaderMaterial({
    ...additive,
    side: THREE.DoubleSide,
    uniforms: { ...colors, ...common, uRot: { value: rotU }, uScanA: { value: 0 }, uMarkY: { value: 5 }, uFaceAx: { value: new THREE.Vector2(0.6, 0.92) } },
    vertexShader: /* glsl */ `
      attribute vec3 aTan;
      attribute vec4 aInfo;  // side, kind, id, arc length
      attribute vec4 aInfo2; // intensity, half width, t, -
      uniform mat3 uRot[3];
      uniform vec2 uFaceAx;
      uniform float uTime, uAssemble, uIgnite, uPxWorldPerDist, uDpr, uMarkY, uScanA, uSS;
      varying float vSide, vI, vT, vComp, vKind, vId;
      void main() {
        float kind = aInfo.y;
        int id = int(aInfo.z + 0.5);
        vec3 p = position;
        vec3 t = aTan;
        float I = aInfo2.x;
        if (kind < 1.5) {
          mat3 R = id == 0 ? uRot[0] : (id == 1 ? uRot[1] : uRot[2]);
          p = R * p;
          t = R * t;
          I *= smoothstep(0.0, 0.5, uAssemble);
        } else if (kind < 2.5) {
          p.y += uMarkY;
          I *= uScanA * mix(0.15, 1.0, smoothstep(0.42, 0.62, abs(p.x)));
        } else {
          I *= smoothstep(0.6, 1.0, uAssemble);
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float objS = length(modelViewMatrix[0].xyz);
        if (kind < 1.5) {
          // rings never cross the face: screen-space ellipse around the head (proto-b), front AND back arcs
          vec4 o = modelViewMatrix * vec4(0.0, 0.05, 0.0, 1.0);
          vec2 rel = (mv.xy / -mv.z - o.xy / -o.z) * -o.z / objS;
          float e = length(rel / uFaceAx);
          I *= smoothstep(0.86, 1.04, e);
        }
        vec3 tv = (modelViewMatrix * vec4(t, 0.0)).xyz;
        vec3 sd = cross(tv, normalize(mv.xyz));
        float sl = length(sd);
        sd = sl > 1e-5 ? sd / sl : vec3(0.0, 1.0, 0.0);
        float dist = max(-mv.z, 0.05);
        float half_ = aInfo2.y * objS;
        float minHalf = (0.55 * uSS / uDpr) * uPxWorldPerDist * dist;
        float drawn = max(half_, minHalf);
        vComp = half_ / drawn;
        mv.xyz += sd * aInfo.x * drawn * 1.6;
        gl_Position = projectionMatrix * mv;
        vSide = aInfo.x;
        vI = I * (kind > 1.5 && kind < 2.5 ? 1.0 : uIgnite);
        vT = aInfo2.z;
        vKind = kind;
        vId = aInfo.z;
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_SAFE}
      uniform vec3 uBase, uHot, uDeep;
      uniform float uTime;
      varying float vSide, vI, vT, vComp, vKind, vId;
      void main() {
        float edge = 1.0 - smoothstep(0.3, 1.0, abs(vSide));
        float i = vI;
        vec3 col = uBase;
        if (vKind < 0.5) {
          float run = pow(clamp(0.5 + 0.5 * cos((vT - uTime * (0.03 + 0.01 * vId) - vId * 0.31) * 6.2831853), 0.0, 1.0), 60.0); // (clamped base, see the filaments)
          float dash = mix(1.0, 0.35 + 0.65 * step(0.5, fract(vT * 140.0)), step(0.55, fract(vT * 2.0 + vId * 0.2)));
          i = i * (0.5 * dash + 3.0 * run);
          col = mix(uDeep * 0.6 + uBase * 0.4, uHot, run);
        } else if (vKind > 1.5 && vKind < 2.5) {
          col = mix(uBase, uHot, 0.4);
        }
        gl_FragColor = vec4(holoSafe(col * i * edge * vComp), 1.0);
      }`,
  });
  const marks = new THREE.Mesh(mkGeo, mkMat);
  marks.name = 'orbitals-marks';
  marks.frustumCulled = false;
  group.add(marks);

  // ------------------------------------------------------------------ halo behind the head
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  haloGeo.setIndex([0, 1, 2, 0, 2, 3]);
  haloGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  // (polish pass) the halo sat behind the whole head and veiled the dark hair maroon: behind the hair it now fades to
  // HALO_TOP of its strength. It stays behind the face (it carries ~5 % of the forehead's light), the jaw and the neck:
  // the face is a superellipse window in the halo's own frame, HALO_FACE = half width at the temples, height of the
  // hairline above the eye line (both from the photo, in halo units); below the ears nothing fades. (integration pass)
  // The window follows the face when the head turns (HALO_FACE[2] = the face's depth in front of the pivot, world
  // units): fixed in the halo's frame it ended up behind the ear and the back of the head at the yaw limit.
  const HALO_TOP = glf(dbg('halotop', 0.12));
  const HALO_FACE = [dbg('halofw', 0.325), dbg('halofh', 0.36), dbg('halofz', 0.2)].map(glf);
  const haloMat = new THREE.ShaderMaterial({
    ...additive,
    uniforms: { ...colors, ...common, uHalo: { value: dbg('halo', 1.0) } },
    vertexShader: /* glsl */ `
      varying vec2 vP, vFace;
      void main() {
        vec4 c = modelViewMatrix * vec4(0.0, 0.08, -0.3, 1.0);
        vP = position.xy;
        vec2 sz = vec2(1.15, 1.3) * length(modelViewMatrix[0].xyz);
        // (integration pass) where the face is in the halo's frame: the halo sits behind the head's pivot, the face in
        // front of it, so when the head turns they part on screen and the face window has to follow the face
        vFace = ((modelViewMatrix * vec4(0.0, 0.08, ${HALO_FACE[2]}, 1.0)).xy - c.xy) / sz;
        c.xy += position.xy * sz;
        gl_Position = projectionMatrix * c;
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_SAFE}
      uniform vec3 uBase, uDeep;
      uniform float uIgnite, uPulse, uTime, uHalo, uAssemble;
      varying vec2 vP, vFace;
      void main() {
        float r = length(vP);
        float g = exp(-r * r * 4.6) * 0.75 + exp(-r * r * 10.0) * 0.25;
        g *= 1.0 - smoothstep(0.85, 1.0, r);
        float hd = pow(abs(vP.x - vFace.x) / ${HALO_FACE[0]}, 2.5) + pow(max(vP.y, 0.0) / ${HALO_FACE[1]}, 2.5);
        g *= mix(1.0, ${HALO_TOP}, smoothstep(0.8, 1.25, hd) * smoothstep(-0.04, 0.1, vP.y));
        float breathe = 0.92 + 0.08 * sin(uTime * 0.5);
        vec3 col = mix(uDeep, uBase, 0.35);
        // the halo only appears once the head is built (no glow ahead of the scan front during the intro)
        float gate = smoothstep(0.75, 1.0, uAssemble);
        gl_FragColor = vec4(holoSafe(col * g * 0.05 * uHalo * breathe * (uIgnite * 0.85 + 0.15) * (1.0 + 0.8 * uPulse) * gate), 1.0);
      }`,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.name = 'halo';
  halo.frustumCulled = false;
  halo.renderOrder = -1;
  group.add(halo);

  if (typeof P.hide === 'string') for (const n of P.hide.split(',')) { const o = group.getObjectByName(n); if (o) o.visible = false; } // debug
  const counts: HologramCounts = {
    ...info.counts,
    scanStep: +info.scanStep.toFixed(3),
    devPerCrop: +info.devPerCrop.toFixed(3),
    gpuBytes: info.bytes.texture + info.bytes.index + (SB ? Math.round(SB.px.length * 1.34) : 0),
    // what three submits per frame (the harness's count): 2 ribbon sides per filament point, particles, marks, halo
    vertices: F.count * 2 + PT.count + mp.length / 3 + 4,
    drawCalls: 4,
  };

  // ------------------------------------------------------------------ per-frame
  const mats = [filMat, ptMat, mkMat, haloMat];
  const camLocal = new THREE.Vector3();
  // the last camera position in the head's frame that was usable (finite, not at the pivot): every visibility term
  // normalizes it, and a NaN or zero uCamObj would poison every filament of the frame
  const camObj = new THREE.Vector3(0, 0, 4);
  const inv = new THREE.Matrix4();
  const m4 = new THREE.Matrix4();
  const mc = new THREE.Matrix4();
  const ex = new THREE.Euler();
  const exc = new THREE.Euler();
  const SWEEP_PERIOD = 7.0;
  const head = meta.head;
  // LOD state: integer target with hysteresis (drop a rank below LOD_DOWN device px, take it back above LOD_UP),
  // crossfaded over LOD_FADE seconds. Decided from the camera framing only (the pulse scale is ignored).
  // (finishing pass) the scan family never drops ranks by default: at parked sizes all slices overlap into continuous
  // tone (no venetian blinds) and the overdraw of a <= 120 px head is trivial; LOD survivors with energy compensation
  // made hot pixels at 40 px. ?loddown=1.5 restores the old behaviour.
  const LOD_DOWN = dbg('loddown', 0.0), LOD_UP = dbg('lodup', 0.15), LOD_FADE = 0.4;
  const MER_DOWN = 3.2, MER_UP = 3.8;
  // [at DPR 1, at DPR 2]: minimum line half-width (device px) and the band-limit ramp (projected slice spacing, px)
  const AA = { minHalf: [dbg('aamin', 0.75), 0.55], band0: [dbg('aab0', 2.2), 1.8], band1: [dbg('aab1', 3.4), 2.8] };
  // (fix pass) "parked" = the scan slices have blended into tone at this size: PARK[0] .. PARK[1] of the band-limit's
  // blend at the nominal slice spacing (0 at every tier's full size; 1 at the 355 px section view, and on a phone whose
  // canvas resolution was stepped down under a head built for the higher one)
  const PARK = [dbg('park0', 0.35), dbg('park1', 0.85)];
  const sstep = (a: number, b: number, v: number) => {
    if (!(b > a)) return v >= b ? 1 : 0; // (equal debug edges: no 0 / 0)
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  // the net's pitch (meridians, wire slices) doubles while it would be under NET_DOWN display px (hysteresis, crossfaded)
  const NET_DOWN = dbg('netdown', 3.5), NET_UP = dbg('netup', 4.0), PARK_WIRE = dbg('parkwire', 1.0);
  const lod = { scan: -1, scanF: 0, mer: -1, merF: 0, net: -1, netF: 0, parked: 0 };
  function lodTarget(cur: number, spacing: number, down: number, up: number, max: number) {
    let L = cur < 0 ? 0 : cur;
    while (L < max && spacing * 2 ** L < down) L++;
    while (L > 0 && spacing * 2 ** (L - 1) >= up) L--;
    return L;
  }
  // A non-finite input (a degenerate transform, a bad debug value) must never reach a uniform: one NaN uniform makes
  // every fragment of a draw NaN, which the bloom spreads into black squares. Normal values pass through unchanged.
  const fin = (v: number, d: number) => (Number.isFinite(v) ? v : d);
  function sanitize(s: HoloFrameState) {
    s.time = fin(s.time, 0);
    s.dt = fin(s.dt, 0);
    s.assemble = fin(s.assemble, 1);
    s.ignite = fin(s.ignite, 1);
    s.converge = fin(s.converge, 1);
    s.pulse = fin(s.pulse, 0);
    s.pxWorld = fin(s.pxWorld, 1e-3);
    s.pxWorldPerDist = Math.max(1e-9, fin(s.pxWorldPerDist, 1e-3)); // a divisor in every width / point-size term
    s.dpr = Math.max(1e-3, fin(s.dpr, 1));
    s.ss = fin(s.ss, 1);
    s.yaw = fin(s.yaw, 0);
    s.pitch = fin(s.pitch, 0);
  }
  function update(state: HoloFrameState) {
    sanitize(state);
    const ph = ((state.time + 2.2) % SWEEP_PERIOD) / SWEEP_PERIOD;
    const sweepT = ph / 0.45;
    const sweepY = sweepT <= 1 ? 1.0 - 2.05 * sweepT : 5.0;
    const scanA = sweepT <= 1 ? Math.sin(Math.PI * Math.min(1, sweepT)) ** 0.5 : 0;
    const ss = Math.max(1, state.ss || 1);
    const dispDpr = state.dpr / ss;
    group.updateWorldMatrix(true, false);
    inv.copy(group.matrixWorld).invert();
    camLocal.copy(state.camera.position).applyMatrix4(inv);
    if (Number.isFinite(camLocal.x + camLocal.y + camLocal.z) && camLocal.lengthSq() > 1e-8) camObj.copy(camLocal);
    for (const m of mats) {
      const u = m.uniforms;
      u.uTime.value = state.time;
      u.uAssemble.value = state.assemble;
      u.uIgnite.value = state.ignite;
      u.uConverge.value = state.converge;
      u.uPulse.value = state.pulse;
      u.uPxWorldPerDist.value = state.pxWorldPerDist;
      u.uDpr.value = state.dpr;
      u.uSS.value = ss;
      u.uCamObj.value.copy(camObj);
      u.uSweepY.value = state.assemble < 1 ? 5.0 : sweepY;
    }
    // intro: the marks' scan line rides the scan front, so the head is visibly scanned into existence
    if (state.assemble < 1) {
      const a = state.assemble * 1.12 - 0.04;
      const yCrop = head.top + (a / 0.86) * (head.bottom - head.top);
      mkMat.uniforms.uMarkY.value = (world.cy - yCrop) * S;
      mkMat.uniforms.uScanA.value = state.assemble > 0.001 ? 1.6 * Math.min(1, (1 - state.assemble) * 8) : 0;
    } else {
      mkMat.uniforms.uMarkY.value = sweepY;
      mkMat.uniforms.uScanA.value = scanA;
    }
    // LOD (device px spacing at the origin plane, without the pulse scale)
    const pxw = Math.max(1e-6, state.pxWorld);
    // (in display px: a supersampled canvas keeps the display's LOD)
    const scanPx = (info.scanWorld / pxw) * dispDpr, merPx = (info.merWorld / pxw) * dispDpr;
    lod.scan = lodTarget(lod.scan, scanPx, LOD_DOWN, LOD_UP, 5);
    lod.mer = lodTarget(lod.mer, merPx, MER_DOWN, MER_UP, 4);
    if (P.lod !== undefined) lod.scan = +P.lod;
    const step = state.dt > 0 ? state.dt / LOD_FADE : 1e9;
    lod.scanF += Math.max(-step, Math.min(step, lod.scan - lod.scanF));
    lod.merF += Math.max(-step, Math.min(step, lod.mer - lod.merF));
    lod.net = lodTarget(lod.net, merPx, NET_DOWN, NET_UP, 3);
    lod.netF += Math.max(-step, Math.min(step, lod.net - lod.netF));
    filMat.uniforms.uGrid.value.z = lod.netF;
    filMat.uniforms.uLod.value = lod.scanF;
    filMat.uniforms.uMerLod.value = lod.merF;
    filMat.uniforms.uSmall.value = Math.min(1, Math.max(0, (1.0 - scanPx) / 0.6));
    // anti-aliasing at DPR 1: a ~1.1 px line sampled at pixel centres breaks into staircase dashes, and slices ~2-3 px
    // apart beat against the pixel grid (moire). A supersampled canvas (high / medium tiers, SphereScene) keeps the
    // designed footprints in display px and lets the browser's downscale filter them. Without it (low tier, ?holo.ss=0)
    // every line gets a wider minimum footprint below DPR 2 (energy compensated, so tone is unchanged) and the
    // band-limit starts blending crowded slices toward tone earlier.
    const lowDpr = ss > 1.01 ? 0 : Math.min(1, Math.max(0, 2 - dispDpr));
    const minHalf = AA.minHalf[1] + (AA.minHalf[0] - AA.minHalf[1]) * lowDpr;
    const band0 = AA.band0[1] + (AA.band0[0] - AA.band0[1]) * lowDpr, band1 = AA.band1[1] + (AA.band1[0] - AA.band1[1]) * lowDpr;
    filMat.uniforms.uMinHalf.value = minHalf * ss;
    filMat.uniforms.uBand.value.set(band0 * ss, band1 * ss);
    // parked (display px against the band-limit ramp, which is in display px too before the supersampling factor)
    lod.parked = P.parked !== undefined ? +P.parked : sstep(PARK[0], PARK[1], 1 - sstep(band0, band1, scanPx));
    filMat.uniforms.uParked.value.x = lod.parked;
    filMat.uniforms.uGrid.value.y = PARK_WIRE * minHalf;
    group.userData.lod = lod;
    // rings: counter-rotated 80 % against the rig (drag / pose), so the orbit system stays put while the head turns
    exc.set(-(state.pitch || 0) * 0.8, -(state.yaw || 0) * 0.8, 0, 'YXZ');
    mc.makeRotationFromEuler(exc);
    const halfW = 0.6 + 0.14 * Math.abs(Math.sin(state.yaw || 0));
    mkMat.uniforms.uFaceAx.value.set(halfW, 0.92 + 0.06 * Math.abs(Math.sin(state.pitch || 0)));
    for (let i = 0; i < rings.length; i++) {
      const R = rings[i];
      if (R.face) ex.set(0.07 * Math.sin(state.time * 0.07 + R.ph), 0.09 * Math.cos(state.time * 0.05 + R.ph), R.ph + state.time * R.prec, 'XYZ');
      else ex.set(R.tilt ?? 0, (R.swing ?? 0.6) * Math.sin(R.ph + state.time * R.prec * 1.6), R.roll ?? 0, 'YXZ'); // ring 2: small swing, stays concentric
      m4.makeRotationFromEuler(ex);
      m4.premultiply(mc);
      rotU[i].setFromMatrix4(m4);
    }
  }

  function tune(t: Partial<HoloTune>) {
    if (t.gain !== undefined) filMat.uniforms.uGain.value = dbg('gain', 1.0) * t.gain;
    if (t.halo !== undefined) haloMat.uniforms.uHalo.value = dbg('halo', 1.0) * t.halo;
    if (t.nodes !== undefined) ptMat.uniforms.uNode.value = dbg('gnode', 1.0) * t.nodes;
    if (t.colorBase) colors.uBase.value.set(t.colorBase);
    if (t.colorHot) colors.uHot.value.set(t.colorHot);
    if (t.colorDeep) colors.uDeep.value.set(t.colorDeep);
  }

  function dispose() {
    for (const o of [filaments, particles, marks, halo]) o.geometry.dispose();
    for (const m of mats) m.dispose();
    recTex.dispose();
    stubTex.dispose();
  }

  return { group, update, tune, dispose, counts };
}
