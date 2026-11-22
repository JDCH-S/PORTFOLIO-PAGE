# Core — AI portfolio

A portfolio site for **Projects**, **Agents** and **Systems** whose centrepiece is a holographic
3D portrait of the owner: his face, measured from a photograph, drawn in fine golden filaments.
The rest of the interface emerges from it.

Stack: Next.js (App Router) · TypeScript · Tailwind · React Three Fiber + drei ·
@react-three/postprocessing (bloom) · Framer Motion · leva (Phase 1 tweak panel).

## Status

- **Phase 1 — the centrepiece**: the original golden sphere has been replaced by the face hologram
  (`src/components/hologram`). It is available on its own at `/sphere` with the tweak panel.
- **Phase 2 — blueprint**: `docs/BLUEPRINT.md` (tokens, type, layouts, components, content schema,
  load sequence, interactions).
- **Phase 3 — the site**: built at `/`: load sequence, HUD, the three modules, beams, detail view,
  desktop and mobile layouts.
- **Phase 4 — mobile and performance pass**: headless checks done; real-device testing pending.

## Adding your content

Everything the modules show comes from `src/content/content.ts`. Replace the `PLACEHOLDER`
entries with your own projects, agents, skills and systems in the same shape (types in
`src/content/types.ts`), edit `profile` for your name, role, availability and links, and fill
`about` (intro paragraphs, what you are doing now, facts, timeline, optional `photo`).
Screenshots and the portrait go in `public/` and are referenced by path. Nothing else needs
touching.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
```

Useful query parameters while reviewing (they work on `/` and `/sphere`):

| Query | Effect |
|---|---|
| `?tier=high` / `medium` / `low` | force a quality tier (default: detected from the device) |
| `?tier=static` | show the static poster fallback (what reduced-motion / no-WebGL users get) |
| `?t=8` | start the animation clocks at 8 s (handy for screenshots) |
| `?capture=1` | hide the panel and caption (used to capture the poster) |
| `?capture&freeze&t=4` | also stop every clock at `t` and hold the head front-on, still (poster capture) |
| `?holo.neck=0` | no neck: the head ends at the jaw / beard line in a short fringe of embers (default `1`: the neck) |
| `?holo.<name>=<value>` | debug overrides of the hologram builder / shaders (e.g. `?holo.gain=1.2`, `?holo.worker=0` builds on the main thread, `?holo.hide=particles`) |

## How the site is built

- `src/components/site/Site.tsx` is the client root: the hologram as a fixed, screen-blended layer
  behind everything, the HUD ground, the load sequence, and the layout for the viewport
  (`DesktopLayout` from 1024px, `MobileLayout` below).
- The UI tells the hologram where to sit through a screen-space frame in `sphereStore.ts` (its unit
  circle, so callouts, the slot, the emblem and the corner all work as they did for the sphere)
  (`SphereSlot` on desktop, the hero and header emblem on mobile, the corner in the detail view).
- The page opens on the hologram alone. `IntroSequence.tsx` runs `src/lib/sequence.ts` once the head
  is built: dust converges, a scan plane draws the head top to bottom, the filaments light,
  `INITIALISING` types, the name decodes. Skippable; remembered in localStorage; a 1s version on later visits; no intro with
  reduced motion. The blurred poster stays up while the head builds; if that takes over 6 s the page
  is revealed and the head scans in on its own as soon as it is ready.
- Drag the hologram (mouse or finger) to turn the head: about ±55° of yaw and ±25° of pitch, with a
  rubber band near the limits; released, it coasts and springs back to front (`useSpinDrag.ts`,
  applied in `SphereRig.tsx`). It never spins freely: the data is a front half-shell. Click or tap it ("see my work") to reveal the
  five sections. Every level has a URL (`#sections`, `#projects`, `#projects/prj-01`), and
  `src/lib/nav.ts` is the only code that writes history: going deeper pushes, moving sideways
  replaces, and Esc, Back, the hologram and every "‹" control go up one level. `NavSync.tsx`
  applies Back/Forward and deep links; `src/lib/route.ts` parses and formats the hash.
  `Emergence.tsx` times the reveals and moves focus after keyboard actions.
- Five sections: **Projects** (case studies), **Agents** (live units), **Skills** (the reusable
  skills the agents load: trigger, tools, which agents use them), **Systems** (architecture
  diagrams) and **About** (bio, facts, timeline, links; no items to open).
- `components/modules/*` render the three modules from `content.ts`; `ItemButton` handles hover,
  focus and the click that fires the fragment stream and opens `components/detail/DetailView`.

## The tweak panel (`/sphere`)

Every control maps to a value in `src/components/sphere/config.ts` (`DEFAULT_LOOK`), and all of
them are live: hologram brightness, halo and network nodes, idle sway, breathing and cursor lean,
the palette and the bloom / tone mapping. The tier selector rebuilds the head for that tier in the
worker. **copy settings JSON** puts the current values on the clipboard.

## How the hologram is built

- **Data** (`public/hologram/`, ~665 KB): derived maps of the owner's photograph (never the photo
  itself) made by the face pipeline and packed by `scripts/hologram/pack_maps.py`: 16-bit depth
  (R,G, exact), head matte, filament tone (half resolution, 32 grey levels: at full resolution it
  was in practice a clean greyscale portrait), feature edges, region probabilities (hair / skin /
  beard), feature masks (brows / eyes / lips), strand flow, plus a trimmed `meta.json`
  (landmarks, lip topology, catchlights). All lossless WebP except the flow field. The map names
  carry a content hash and are served `immutable` (`next.config.ts`); `meta.json` lists them and is
  revalidated. The loader checks the redundancy the packer writes (depth B = 0, grey maps R = G = B)
  to catch a canvas readback perturbed by anti-fingerprinting: light noise is repaired, heavy noise
  keeps the poster.
- **Geometry** (`hologram/builder.ts`, a pure function): horizontal contour slices of the measured
  depth surface whose width and brightness follow the tone like a line engraving, radial meridians
  and diagonals that turn the cheeks and forehead into a wireframe mesh, evenly spaced strands for
  the brows, and the hair as it is in the photo, near-black: a few thin filaments on black (long
  streamlines along the photo's own flow, sparse and dim in the dark body, closer and bright only in
  the photo's sheen bands, their spacing bounded in device pixels so they neither merge into a brown
  tone nor beat into moire) plus one thin contour on the silhouette, with a soft hairline where the
  skin slices fade under the hair. The beard is short stubble: a mipmapped texture of fine dark hairs,
  traced from the facial-hair map along the photo's own strand direction, that every skin filament
  is multiplied by, plus a sprinkle of lit ticks. Landmark lines for lids, limbal ring and lips; the
  eye sockets, irises and nostrils take their shading from the tone map (no under-eye retouch:
  `?holo.ueyelift=0.6` is the old lift); edge ridges; for the turned views, which the front strands
  cannot fill (head-on most of the hair is a steep wall seen edge-on), sweep strands combed straight
  back down those walls and on over a faint back-of-head shell of swept-back strands that ends
  raggedly at about the top of the ear, so the turned head keeps its hair as a dark coat of fine filaments
  (shown only when turned and only where they face the viewer; the front view never changes); a
  short neck in the photo's
  proportions (its outline is the skin mask's under the jaw, about 0.7 of the face width as in the
  photo, with straight sides that only widen a touch below the chin; shaded as a rounded column from
  the depth surface, with faint sternocleidomastoid cords and a larynx highlight; it is brightest
  just under the jaw, fades on the way down and breaks into dashes and dust along the T-shirt
  collar's U, with no clothing or shoulders; `?holo.neck=0` drops it and ends the head at the jaw in
  a short fringe of embers), dust / neck-dissolve / node particles. Every point is packed into a
  32-byte record (vertex pulling from an RGBA32UI texture), with precomputed horizon angles so the
  relief occludes itself without a depth buffer. The hair, the shell, the sweep strands, the stubble
  texture and the limbal rings draw from their own random sub-streams, so tuning one never moves
  another feature. The large sections (hair, stubble, back shell) are functions of their own inside
  `buildFaceGeometry`: V8 does not optimise a function whose bytecode is over 60 KB, and with those
  sections inline every loop in the body ran unoptimised (a 10-25 % slower build); keep its own
  body under that (`node --print-bytecode --print-bytecode-filter=buildFaceGeometry`).
- **Worker** (`hologram.worker.ts`, started by `createWorker.ts`): fetches and decodes the maps once
  (OffscreenCanvas), builds the tier's geometry (~1-2 s) and transfers the typed arrays back; it is
  released 30 s after a build (a later rebuild re-decodes from the HTTP cache). Without workers, or if
  one fails or does not answer within 20 s, the build runs on the main thread.
- **Scene** (`hologram/hologramObjects.ts`, `FaceHologram.tsx`): four draw calls (filaments,
  particles, orbitals + scan marks, halo), additive gold on black, driven every frame by the intro
  values, the pulse, the rig's pose and the on-screen size (slice LOD and band-limit, so a parked
  120 px head or a 40 px emblem reads as continuous tone instead of moire). On low-DPR displays the
  high and medium tiers render the canvas at the tier's DPR cap and let the browser filter it down
  (the slice pitch still follows the display), so the ~1 px filaments do not break into staircase
  dashes or moire. Turned views take the extra line density near the silhouette out of the
  brightness, so the profile does not burn white at the yaw limit; the ear is laid on a regularised
  depth with a rim that fades as the head turns, and the self-occlusion test narrows its soft band
  and follows the view's own direction when yaw and pitch combine. Once a parked head's slices have
  blended into tone (the 355 px section view; a phone whose canvas resolution was stepped down) the
  skin stays a wire mesh, not a toned photograph: the diagonals and nodes go (alone with the
  meridians they knit a herringbone), the meridians stay a little dimmer, and every 2nd or 4th scan
  slice keeps a thin lit core over its tone, so the face carries a fine lat / long net at about the
  meridian pitch (quieter on the coarser medium and low nets, and at twice the pitch once it would
  close up under about 3.5 px); the hair of the turned views (shell and sweep strands) is drawn at
  every size.
  The halo fades behind the hair through a face-shaped window that follows the face as the head
  turns, so the hair stays black.
- `Effects.tsx` runs mipmap bloom on a half-float buffer followed by selectable tone mapping.
- `SphereRig.tsx` carries the head: a small cursor / device-orientation lean, the clamped drag with
  its spring back, an idle sway (yaw 6° · sin 0.35t, pitch 2.5° · sin 0.27t), faint breathing, the
  pulse, and the scale / offset targets from `sphereStore.ts`. A head parked off-centre is turned to
  face the camera, so it always reads front-on.
- `SphereStage.tsx` picks a tier (`src/lib/tier.ts`), lazy-loads the scene client-side, and shows
  the static poster (`public/sphere-static.webp`, a real front capture of the hologram on black,
  blended with `screen`) until the head is built and rendering, for `prefers-reduced-motion`, and
  when WebGL2 is unavailable or the maps fail to load. Recapture the poster after any change to the
  head: `/sphere?capture&freeze&t=4&tier=high` at 1200x1200 on a pure black page, and
  `sphere-static-600.webp` as a Lanczos downsample of it.
- `SphereScene.tsx` compiles the shaders and waits for the built head before starting the render
  loop (frames rendered into the hidden canvas while the worker builds only queue GPU work: on
  software GL that stalled the first head frame by 13-50 s), flips readiness (which
  starts the intro) only after the head exists and two frames of it have rendered, pauses the loop
  while the canvas is scrolled out of view, caps the pixel ratio to a ~4.5 Mpx budget, and steps the
  pixel ratio and then the tier down if frames drop (the tier drop rebuilds in the worker while the
  old head stays on screen). The head also rebuilds once when the canvas grows past the next
  slice-pitch bucket (a window maximised, a move to a DPR-2 screen); a failed build unmounts the
  canvas and keeps the poster.

Tiers (vertices at 1440x900 / DPR cap / bloom mip levels): high ~241k (~308k on a DPR-2 display) /
2 / 7 · medium ~186k / 1.5 / 6 · low ~134k (phones ~114k) / 1.25 / 4. The slice pitch is chosen at build from the device pixels of
the hero framing. A forced `?tier=` pins the tier. Tone mapping defaults to ACES.
