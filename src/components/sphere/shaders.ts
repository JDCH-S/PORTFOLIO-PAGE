/* GLSL for the holographic sphere. Kept as plain strings (no build plugin needed). */

export const MAX_SHELLS = 8;

const COMMON = /* glsl */ `
  vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
  float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float noise1(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash11(i), hash11(i + 1.0), f); }
`;

/* ---------------------------------------------------------------- fragments */

export const fragmentsVert = /* glsl */ `
  uniform float uTime;
  uniform float uWidth;
  uniform float uDrift;
  uniform float uFlickerSpeed;
  uniform float uFlickerAmount;
  uniform float uDepthFade;
  uniform float uLimb;
  uniform float uPxWorld;     // world units per pixel at distance 1
  uniform float uMinPx;       // minimum on-screen half width in pixels
  uniform float uAssemble;    // intro: 0 scattered .. 1 assembled (outer shells first)
  uniform float uShellCount;
  uniform vec4 uShellQuat[${MAX_SHELLS}];
  uniform float uShellBright[${MAX_SHELLS}];

  attribute vec3 iCenter;   // unit direction of the fragment centre on its shell
  attribute vec3 iAxis;     // axis of the circle the fragment follows (great circle: centre x tangent)
  attribute vec4 iParams;   // radius, arc angle (rad), width (world), seed
  attribute vec4 iStyle;    // type (0 arc,1 dash,2 shard,3 trace), base brightness, drift, shell index

  varying float vBright;
  varying vec2 vUvw;
  varying float vType;
  varying float vRadial;

  ${COMMON}

  void main() {
    float t = position.x;          // 0..1 along the fragment
    float side = position.y;       // -1..1 across the fragment
    int shell = int(iStyle.w + 0.5);
    vec4 q = uShellQuat[shell];

    float a = (t - 0.5) * iParams.y;
    vec3 c = iCenter;
    vec3 A = iAxis;
    // circle on the unit sphere around axis A through c (a great circle when A is perpendicular to c)
    vec3 C = A * dot(c, A);
    vec3 U = c - C;
    float rho = max(length(U), 1e-4);
    U /= rho;
    vec3 V = cross(A, U);
    vec3 p = C + (U * cos(a) + V * sin(a)) * rho;   // point on the circle
    vec3 tp = -U * sin(a) + V * cos(a);             // unit tangent at p
    vec3 bn = normalize(cross(p, tp));              // across direction, on the shell surface

    // outer-shell fragments break off and drift outward, then settle back
    float driftPhase = pow(0.5 + 0.5 * sin(uTime * 0.28 + iParams.w * 6.2831), 3.0);
    float drift = iStyle.z * uDrift * driftPhase * 0.22;
    float r = iParams.x + drift;
    float w = iParams.z * uWidth;

    // intro assembly: each shell flies in from far outside, outer shells first
    float order = (uShellCount - 1.0 - float(shell)) / max(uShellCount, 1.0);
    float aStart = order * 0.65;
    float assembled = smoothstep(aStart, aStart + 0.35, uAssemble);
    float asmEase = 1.0 - pow(1.0 - assembled, 3.0);
    vec3 scatterDir = normalize(vec3(hash11(iParams.w * 3.1) - 0.5, hash11(iParams.w * 5.7) - 0.5, hash11(iParams.w * 9.3) - 0.5) + 1e-3);
    vec3 scatter = scatterDir * (2.4 + 1.6 * hash11(iParams.w * 13.7));
    // centre line of the strip, then extrude across it in view space so thin arcs
    // never vanish edge-on (arcs face the camera, shards lie flat on the shell)
    vec3 centre = mix(scatter, qrot(q, p * r + tp * drift * 0.6), asmEase);
    vec3 tanW = qrot(q, tp);
    vec3 flatW = qrot(q, bn);
    vec4 cv4 = modelViewMatrix * vec4(centre, 1.0);
    vec3 cv = cv4.xyz;
    vec3 tv = normalize((modelViewMatrix * vec4(tanW, 0.0)).xyz);
    vec3 fv = normalize((modelViewMatrix * vec4(flatW, 0.0)).xyz);
    vec3 faceV = normalize(cross(tv, normalize(-cv)));
    if (dot(faceV, fv) < 0.0) faceV = -faceV;
    float flatness = iStyle.x > 1.5 && iStyle.x < 2.5 ? 1.0 : 0.72;
    vec3 across = normalize(mix(faceV, fv, flatness));
    float modelScale = length(modelViewMatrix[0].xyz);
    float halfW = w * 0.5 * modelScale;
    halfW = max(halfW, uMinPx * uPxWorld * max(-cv.z, 0.05));
    vec3 posV = cv + across * side * halfW;

    // per-fragment shimmer: smooth noise plus rare sparkles
    float n = noise1(uTime * uFlickerSpeed + iParams.w * 97.0);
    float sparkle = pow(noise1(uTime * uFlickerSpeed * 1.7 + iParams.w * 31.0), 20.0) * 0.8;
    float flick = mix(1.0, 0.3 + 0.7 * n + sparkle, uFlickerAmount);

    // depth cue: far side dims, silhouette brightens so the sphere reads as a volume
    vec3 nView = normalize((modelViewMatrix * vec4(qrot(q, p), 0.0)).xyz);
    float facing = nView.z;
    float depth = mix(uDepthFade, 1.0, smoothstep(-1.0, 0.7, facing));
    float limb = pow(1.0 - abs(facing), 4.0) * uLimb;

    // arcs whose circle plane contains the view direction project as straight chords: fade them
    float planeFacing = abs(dot(normalize((modelViewMatrix * vec4(qrot(q, A), 0.0)).xyz), normalize(-cv)));
    float chordFade = iStyle.x < 0.5 ? mix(0.5, 1.0, planeFacing) : 1.0;
    float asmFlash = assembled * (1.0 + 0.9 * sin(assembled * 3.14159));   // a bright arrival flash
    vBright = min(iStyle.y * uShellBright[shell] * flick * (depth + limb) * chordFade * (1.0 - drift * 1.5), 2.4) * asmFlash;
    vUvw = vec2(t, side);
    vType = iStyle.x;
    vRadial = iParams.x;
    gl_Position = projectionMatrix * vec4(posV, 1.0);
  }
`;

export const fragmentsFrag = /* glsl */ `
  precision highp float;
  uniform vec3 uColorBase;
  uniform vec3 uColorHot;
  uniform vec3 uColorDeep;
  uniform float uIntensity;

  varying float vBright;
  varying vec2 vUvw;
  varying float vType;
  varying float vRadial;

  void main() {
    float t = vUvw.x;
    float s = abs(vUvw.y);
    float soft = 1.0 - s * s;
    soft *= soft;                                   // glowing line profile
    float along;
    float across;
    if (vType < 0.5) {                              // arc: tapered ends
      along = smoothstep(0.0, 0.14, t) * smoothstep(1.0, 0.86, t);
      across = soft;
    } else if (vType < 1.5) {                       // dash: crisp ends
      along = smoothstep(0.0, 0.05, t) * smoothstep(1.0, 0.95, t);
      across = soft;
    } else if (vType < 2.5) {                       // shard: a data card with a frame and cells
      along = smoothstep(0.0, 0.03, t) * smoothstep(1.0, 0.97, t);
      float frame = step(0.7, s) * step(s, 0.85);
      float cells = step(0.18, fract(t * 3.0));
      across = 0.55 * step(s, 0.7) * cells + frame + 0.15 * soft;
    } else {                                        // trace: crisp thin circuit line
      along = smoothstep(0.0, 0.04, t) * smoothstep(1.0, 0.96, t);
      across = mix(soft, step(s, 0.6), 0.5);
    }
    // outer shells stay amber-to-deep-orange; near-white is reserved for the inner shells and the core
    float b = min(vBright, mix(2.4, 1.5, smoothstep(0.7, 1.0, vRadial)));
    vec3 col = mix(uColorBase, uColorDeep, smoothstep(0.35, 1.0, vRadial));
    float hotGate = (1.0 - smoothstep(0.62, 0.9, vRadial)) * (vType > 1.5 && vType < 2.5 ? 0.0 : 1.0);
    col = mix(col, uColorHot, clamp((b - 1.3) * 1.2, 0.0, 1.0) * hotGate);
    float alpha = across * along;
    gl_FragColor = vec4(col * b * uIntensity, alpha);
  }
`;

/* -------------------------------------------------------------------- vortex */

export const vortexVert = /* glsl */ `
  uniform float uTime;
  uniform float uSwirl;
  uniform float uRadius;
  uniform float uWidth;
  uniform float uBright;
  uniform float uPxWorld;
  uniform float uMinPx;
  uniform float uIgnite;  // intro: 0 dark .. 1 lit

  attribute vec4 iRib;   // phase, radius scale, seed, width
  attribute vec4 iQuat;  // ribbon orientation

  varying vec2 vUvw;
  varying float vGlow;
  varying float vKind;

  ${COMMON}

  attribute float iKind;  // 0 spiral ribbon, 1 closed ring

  vec3 spiral(float t, float seed, float phase, float rs) {
    if (iKind > 0.5) {
      // closed gyro ring, tilted per instance, slowly counter-rotating
      float rr = uRadius * rs * (0.22 + 0.34 * seed);
      float ang = phase + t * 6.2831 + uTime * uSwirl * 0.55 * sign(seed - 0.5);
      return vec3(cos(ang) * rr, sin(ang) * rr, 0.0);
    }
    float turns = 1.3 + seed * 1.0;
    float ang = phase + t * turns * 6.2831 - uTime * uSwirl * (0.8 + 0.5 * seed) + 0.25 * t * sin(uTime * uSwirl * 0.6);
    float rr = uRadius * rs * pow(max(1.0 - t, 0.0), 0.85) + 0.012;
    float z = (sin(ang * 0.5 + seed * 6.28) * 0.4 + sin(t * 9.0 + uTime * 0.7 + seed * 3.0) * 0.18) * uRadius * rs * (1.0 - t);
    return vec3(cos(ang) * rr, sin(ang) * rr, z);
  }

  void main() {
    float t = position.x;
    float side = position.y;
    float seed = iRib.z;
    vec3 p = spiral(t, seed, iRib.x, iRib.y);
    vec3 p2 = spiral(min(t + 0.012, 1.0), seed, iRib.x, iRib.y);
    vec3 pw = qrot(iQuat, p);
    vec3 tw = qrot(iQuat, p2 - p);

    vec3 pv = (modelViewMatrix * vec4(pw, 1.0)).xyz;
    vec3 tv = normalize((modelViewMatrix * vec4(tw, 0.0)).xyz);
    vec3 across = normalize(cross(tv, normalize(-pv)));   // face the camera
    float modelScale = length(modelViewMatrix[0].xyz);
    // energy beads travelling inward along each ribbon: brighter and slightly wider
    float packet = pow(0.5 + 0.5 * sin(t * 3.0 - uTime * 1.8 + seed * 6.28), 24.0) * 2.5;
    float w = iRib.w * uWidth * modelScale * (iKind > 0.5 ? 0.45 : (0.35 + 0.65 * (1.0 - t))) * (1.0 + 0.6 * packet);
    w = max(w, 2.0 * uMinPx * uPxWorld * max(-pv.z, 0.05));
    vec3 posV = pv + across * side * w * 0.5;

    float flow = 0.7 + 0.3 * sin(t * 22.0 - uTime * 5.5 + seed * 12.0);
    float shimmer = 0.75 + 0.25 * noise1(uTime * 2.0 + seed * 40.0);
    float profile = iKind > 0.5 ? 0.55 : (0.4 + 1.0 * t * t);      // spirals brightest at the core
    float ignite = smoothstep(0.0, 1.0, uIgnite) * (1.0 + 1.2 * sin(clamp(uIgnite, 0.0, 1.0) * 3.14159));
    vGlow = min(uBright * flow * shimmer * profile * (1.0 + packet), 2.0) * ignite;
    vUvw = vec2(t, side);
    vKind = iKind;
    gl_Position = projectionMatrix * vec4(posV, 1.0);
  }
`;

export const vortexFrag = /* glsl */ `
  precision highp float;
  uniform vec3 uColorBase;
  uniform vec3 uColorHot;
  uniform float uIntensity;
  varying vec2 vUvw;
  varying float vGlow;
  varying float vKind;
  void main() {
    float t = vUvw.x;
    float s = abs(vUvw.y);
    float soft = 1.0 - s * s;
    soft *= soft;
    // spirals fade in from their tail; rings are ticked like a gyro scale
    float along = vKind > 0.5 ? (0.5 + 0.5 * step(0.35, fract(t * 36.0))) : smoothstep(0.0, 0.18, t);
    vec3 col = mix(uColorBase, uColorHot, vKind > 0.5 ? 0.0 : smoothstep(0.78, 1.0, t));
    float alpha = soft * along;
    gl_FragColor = vec4(col * vGlow * uIntensity, alpha);
  }
`;

/* ---------------------------------------------------------------- core glow */

export const coreVert = /* glsl */ `
  uniform float uSize;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * uSize;
    gl_Position = projectionMatrix * mv;
  }
`;

export const coreFrag = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uBright;
  uniform float uCoreFrac;   // hot core radius as a fraction of the quad half-size
  uniform float uHalo;       // ambient halo strength
  uniform float uBreathe;    // breathing angular speed, shared with the rig
  uniform float uIgnite;     // intro: 0 dark .. 1 lit
  uniform vec3 uColorBase;
  uniform vec3 uColorHot;
  varying vec2 vUv;
  ${COMMON}
  void main() {
    vec2 c = vUv - 0.5;
    float d = length(c) * 2.0;                 // 0 at centre, 1 at quad edge
    float ang = atan(c.y, c.x);
    float rays = 0.85 + 0.15 * sin(ang * 7.0 + uTime * 0.9) * sin(ang * 3.0 - uTime * 0.6);
    float pulse = 0.9 + 0.1 * sin(uTime * uBreathe) + 0.06 * noise1(uTime * 6.0);
    float dc = d / max(uCoreFrac, 0.01);
    float hot = (exp(-dc * dc * 2.2) * 1.4 + exp(-dc * dc * 0.5) * 0.5) * rays;
    float halo = uHalo * exp(-d * d * 3.0);
    float ignite = smoothstep(0.0, 1.0, uIgnite) * (1.0 + 1.5 * sin(clamp(uIgnite, 0.0, 1.0) * 3.14159));
    float g = (hot * pulse + halo) * uBright * ignite;
    vec3 col = mix(uColorBase, uColorHot, clamp(hot * 0.6, 0.0, 1.0));
    gl_FragColor = vec4(col * g, clamp(g, 0.0, 1.0));
  }
`;

/* ---------------------------------------------------------------- particles */

export const particlesVert = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uSpeed;
  uniform float uPixelRatio;
  uniform float uConverge;  // intro: 0 scattered at the edges .. 1 in place
  attribute vec3 aSeed;
  attribute float aKind;   // 0 dust, 1 spark
  varying float vBright;
  varying float vKind;
  ${COMMON}
  void main() {
    float t = uTime * uSpeed;
    vec3 p = position;
    // slow orbit + gentle wander
    float orb = t * 0.06 * (0.6 + aSeed.x);
    float cs = cos(orb), sn = sin(orb);
    p.xz = mat2(cs, -sn, sn, cs) * p.xz;
    p += 0.08 * vec3(sin(t * 0.7 + aSeed.x * 20.0), sin(t * 0.5 + aSeed.y * 20.0), sin(t * 0.6 + aSeed.z * 20.0));
    // intro: drift in from far outside, each spark on its own schedule
    float cStart = aSeed.x * 0.5;
    float cv = smoothstep(cStart, cStart + 0.5, uConverge);
    cv = 1.0 - pow(1.0 - cv, 2.0);
    vec3 far = normalize(p + vec3(aSeed.y - 0.5, aSeed.z - 0.5, aSeed.x - 0.5)) * (3.0 + 2.5 * aSeed.z);
    p = mix(far, p, cv);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float n = noise1(t * 2.5 + aSeed.y * 50.0);
    float spark = pow(noise1(t * 3.0 + aSeed.z * 70.0), 18.0) * 2.2;
    float outside = 1.0 - 0.5 * smoothstep(1.0, 1.5, length(position));
    vBright = min(mix(0.25 + 0.75 * n, 0.15 + spark, aKind), 2.0) * outside * (0.6 + 0.4 * cv);
    vKind = aKind;
    float size = mix(1.2, 2.2, aSeed.z) * uSize * uPixelRatio * (1.0 + spark * 0.12);
    gl_PointSize = min(size * (5.0 / max(-mv.z, 2.0)), 3.2 * uPixelRatio);
    gl_Position = projectionMatrix * mv;
  }
`;

export const particlesFrag = /* glsl */ `
  precision highp float;
  uniform vec3 uColorBase;
  uniform vec3 uColorHot;
  uniform float uIntensity;
  varying float vBright;
  varying float vKind;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float a = smoothstep(1.0, 0.45, d);
    a *= a;
    vec3 col = mix(uColorBase, uColorHot, clamp((vBright - 1.2) * 0.6, 0.0, 1.0));
    gl_FragColor = vec4(col * vBright * uIntensity, a);
  }
`;
