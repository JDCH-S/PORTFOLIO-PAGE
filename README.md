# Core — AI portfolio

A portfolio site for **Projects**, **Agents** and **Systems** whose centrepiece is a volumetric
holographic sphere. The rest of the interface emerges from it.

Stack: Next.js (App Router) · TypeScript · Tailwind · React Three Fiber + drei ·
@react-three/postprocessing (bloom) · Framer Motion · leva (Phase 1 tweak panel).

## Status

**Phase 1 — the sphere.** Only the sphere on a blank page, with a debug panel to tune it.
Phases 2–4 (component structure and tokens, full site with load sequence and interactions,
mobile and performance pass) follow after review.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
```

Useful query parameters while reviewing:

| Query | Effect |
|---|---|
| `?tier=high` / `medium` / `low` | force a quality tier (default: detected from the device) |
| `?tier=static` | show the static poster fallback (what reduced-motion / no-WebGL users get) |
| `?t=8` | start the animation clocks at 8 s (handy for screenshots) |
| `?capture=1` | hide the panel and caption (used to capture the poster) |

## The tweak panel

Every slider maps to a value in `src/components/sphere/config.ts` (`DEFAULT_LOOK`).
Sliders marked **⟳** rebuild geometry (shell count, density, arc length, ragged, windows, cuts,
seed, ribbons, particle count); everything else updates live. **copy settings JSON** puts the
current values on the clipboard (and logs them to the console) so they can be pasted back as the
new defaults.

## How the sphere is built

- `buildFragments.ts` places thousands of fragments on concentric shells: broken arc chains,
  crisp dashes, rectangular data cards, right-angle circuit traces with pads, ladders, nested
  arcs, shard grids, long latitude ring arcs and two bold ticked "primary rings" per outer shell.
  Every fragment is an arc of a circle described by its centre and axis, so ring bands and
  ladder rails follow true latitude circles. Coverage is carved by a simplex patch mask (ragged
  edges), knife-straight sector/band cuts (shared across the outer cage as one wedge) and one
  see-through window per shell, all leaning the same way so the core shows through. The shell
  radii leave a void band between the inner "engine" and the outer cage.
- `Fragments.tsx` renders them all in **one instanced draw call**. The vertex shader bends a strip
  along its arc, extrudes it toward the camera (with a pixel floor so thin arcs never vanish),
  rotates each shell by a quaternion uniform, applies noise flicker and sparkle, pops outer
  fragments off the cage and back, fades arcs seen edge-on (they would project as straight
  chords), and dims the far side / brightens the limb for depth.
- `Vortex.tsx` is a second instanced draw: spiral ribbons (a quarter of them wider "hero"
  ribbons) with energy beads travelling inward, plus two ticked gyro rings; the vortex rotates
  rigidly and precesses so it never unwinds.
- `CoreGlow.tsx` is a camera-facing hot core with an ambient halo; `Particles.tsx` adds dust and
  sparks.
- `Effects.tsx` runs mipmap bloom on a half-float buffer followed by selectable tone mapping.
  The low tier skips the luminance pass.
- `SphereRig.tsx` handles pointer tilt (desktop), touch drag and device orientation (mobile),
  breathing, and the imperative targets in `sphereStore.ts` that later phases use to pulse the
  sphere toward a module or park it in a corner.
- `SphereStage.tsx` picks a tier (`src/lib/tier.ts`), lazy-loads the scene client-side, and shows
  the static poster (`public/sphere-static.webp`, a real capture blended with `screen`) before
  the scene is ready, for `prefers-reduced-motion`, and when WebGL2 is unavailable.
- `SphereScene.tsx` compiles the shaders before starting the render loop (so the first frame does
  not stall the page), cross-fades from the poster after the second frame, pauses the loop while
  the canvas is scrolled out of view, caps the pixel ratio to a ~4.5 Mpx budget on large retina
  screens, and steps the pixel ratio and then the tier down if frames drop.

Tier budgets (fragments / DPR cap / bloom mip levels): high 8000 / 2 / 7 · medium 6000 / 1.5 / 6 ·
low 4200 / 1.5 / 5 (luminance pass off). If frames drop, the pixel ratio steps down first, then
the tier; a forced `?tier=` pins it. Tone mapping defaults to ACES (AgX and Neutral were A/B'd
and lose the gold).
