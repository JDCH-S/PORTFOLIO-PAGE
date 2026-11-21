# Core — Phase 2 blueprint

Component structure and design tokens for the portfolio. Phase 3 builds exactly this.
The hologram is the source of every visual decision below: the UI must look like it was
emitted by it. (Phase 1 approved a golden sphere; it has since been replaced by a holographic
portrait of the owner, his face measured from a photograph and drawn in golden filaments, in the
same palette, slot and unit circle: the head and a short neck in the photo's proportions that
dissolves into gold dust above the collar, with no clothing or shoulders; `?holo.neck=0` ends the
head at the jaw instead. "Sphere" in the component names below means that slot.)

## 1. Direction in one paragraph

A holographic instrument panel around a living core. Deep blue-black ground with a
faint perspective grid and scanlines; everything that glows is the hologram's gold;
everything that is merely labelled is cool steel. Panels are dark glass with 1px gold
edges and corner brackets, never solid boxes. Labels, data and status text are
monospace; headings are a squared geometric face; body copy is a quiet sans with
strong contrast. Motion is purposeful: things assemble from fragments, beams connect,
values tick. Nothing bounces.

## 2. Design tokens

All tokens live in `src/app/globals.css` (`:root` + Tailwind `@theme inline`) and are
the only source of colour, type, spacing and motion values in the codebase.

### 2.1 Colour

| Token | Value | Use |
|---|---|---|
| `--bg` | `#04060f` | page ground |
| `--bg-2` | `#070b19` | raised ground, sticky header |
| `--bg-3` | `#0b1124` | hover ground, inputs |
| `--grid` | `rgba(143,179,217,0.07)` | perspective grid lines |
| `--scan` | `rgba(255,255,255,0.025)` | scanlines |
| `--fg` | `#e9e4d8` | body text (warm off-white, 17:1 on bg) |
| `--fg-dim` | `#8f9bb3` | secondary text (6.9:1 on bg) |
| `--gold` | `#ffb23f` | primary glow: titles, borders, active states, beams |
| `--gold-hot` | `#ffecc8` | highlights, hovered text, the name |
| `--gold-deep` | `#ff6a00` | deep edge of any gold gradient, warnings |
| `--gold-line` | `rgba(255,178,63,0.32)` | 1px panel borders |
| `--gold-glow` | `rgba(255,178,63,0.22)` | outer glow of panels and beams |
| `--steel` | `#8fb3d9` | secondary labels, coordinates, tick marks |
| `--steel-dim` | `#7b8ba8` | dividers, inactive tabs, faint labels (5.9:1 on bg) |
| `--steel-line` | `rgba(143,179,217,0.22)` | secondary 1px lines |
| `--online` | `#6cf0a8` | status ok (agents ONLINE) |
| `--standby` | `#ffb23f` | status standby |
| `--offline` | `#ff5c5c` | status offline / alert |
| `--glass` | `rgba(7,11,25,0.58)` | panel fill (with `backdrop-filter: blur(14px)`) |

Rule: gold is for things that glow (borders, titles, active states, data that matters).
Steel is for things that orient (labels, coordinates, dividers). Body text is never
gold; effects live on borders and decoration only.

### 2.2 Type

| Role | Face | Fallback | Where |
|---|---|---|---|
| display | Chakra Petch 600/700 | system-ui | module titles, the name, section eyebrows (uppercase, +0.18em) |
| body | Geist 400/500 | system-ui, sans-serif | descriptions, detail text (max 65ch) |
| mono | Geist Mono 400/500 | ui-monospace | labels, data, status, telemetry, tags, coordinates |

Scale (px / line-height): label 11/16 (mono, uppercase, +0.18em) · data 12/18 (mono) ·
small 14/22 · body 16/26 · h3 20/28 (display) · h2 28/34 (display) · h1 40/44 desktop,
32/36 mobile (display). Digits in data are `tabular-nums`.

### 2.3 Space, edges, glow, motion

- Spacing scale (4px base): 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96. Panel padding 16
  (mobile) / 24 (desktop). Touch targets ≥ 44px.
- Radii: 2px on everything HUD-like; 4px on cards; 0 on brackets. No pills.
- Borders: 1px `--gold-line`; hover/active `--gold`; secondary `--steel-line`.
- Glow: `0 0 0 1px var(--gold-line), 0 0 18px var(--gold-glow)`; hover doubles the blur.
- Corner brackets: 10×10px L-shapes at each panel corner, `--gold`; expand to 16px on hover.
- Motion: durations 120 (micro) · 240 (state) · 480 (panel) · 900 (sequence step) ms;
  easing out `cubic-bezier(.2,.8,.2,1)`, in-out `cubic-bezier(.65,0,.35,1)`; stagger 60ms;
  `prefers-reduced-motion` removes all movement and keeps opacity fades ≤ 240ms.

## 2.4 Navigation: four levels, one meaning for back, real URLs

The page opens on the hologram alone: the head, the name, the header's section list and a
"click to see my work · drag to turn" prompt (the prompt itself is clickable). Dragging the
head (mouse or finger) turns it, never further than about ±55° of yaw and ±25° of pitch (a
rubber band near the limits; half the circle's width reaches the yaw limit at any size); on
release it coasts and springs back to front, and a press catches a coasting head. Between
interactions it sways a few degrees and leans slightly toward the cursor.

The site has four levels, each with its own URL (hash only; the server route stays `/`):

| level | URL | what is on screen |
|---|---|---|
| home | `/` | the hologram alone |
| sections | `#sections` | five callouts on the sphere's rim (desktop) or a spine of rows under it (phone) |
| section | `#projects` … `#about` | one section open |
| item | `#projects/prj-01` | one item over its section (overlay on desktop, bottom sheet on phones) |

- **Back means up one level, everywhere.** Esc, the browser or phone Back gesture, a click on
  the sphere and every visible "‹" control go item → section → sections → home. Going deeper
  pushes a history entry; moving sideways (tabs, swipes, pagers, prev/next) replaces it, so Back
  never walks through siblings. A shared link to an item plays the short intro, opens it, and
  Back goes to its section and then off the site. Refresh keeps the place and the history
  (Back after a reload walks the same steps). A pop that lands on a stale entry (Forward after
  a sideways move) is corrected, so Esc always ends on the parent. Hand-typed or capitalised
  hashes work; an unreadable one falls back to home. All history writes live in
  `src/lib/nav.ts`.
- **One section list per view, always 01–05 in the same order**, the current one lit:
  desktop shows it in the header at home, as callouts in the sections view and as a spine under
  the parked sphere in a section (headed by "‹ all sections"); elsewhere the header shows a
  one-line trail, "home / sections / 02 agents". Phones show the spine in the sections view and
  tabs in a section. The section the visitor was last in stays lit.
- **Visible ways out, in plain words**: "‹ all sections" (desktop spine), the trail, "× close"
  at the end of the phone list, "‹ sections" with ← 02 / 05 → at the bottom of the phone screen
  (thumb zone), the item breadcrumb "‹ 01 projects / prj-01" with ← prev / n / next →, and a
  pager at the end of every section. "‹" only ever means up a level; sideways moves use ← →.
  The name in the header always goes home, and "email ↗" sits in the header on both layouts.
- **Phones**: a stray tap anywhere on the sphere inside a section (docked or mid-dock) does not
  navigate; it pulses the sphere and lights "‹ sections". Swipes switch at 22% of the width (or a flick), the tab underline
  slides under the finger and 12px of the next section peeks in. The sheet closes with a
  downward pull from anywhere once its content is at the top.
- **Words**: "home", "sections", "see my work"; never "core" or "module" in the interface.
  Each section has a few plain words under its name ("case studies", "agent skill files").

Sections: Projects, Agents, **Skills** (the reusable skills the agents load, in the shape of a
skill file: name, version, trigger, tools, used by), Systems, and **About** (identity card,
bio, now, facts, timeline, links; the header also carries a direct "email ↗" link).

## 3. Layouts

### Desktop (≥ 1024px)

Three-column grid: `[Projects | core | Agents]` with Systems under the core.

```
┌──────────────────────────────────────────────────────────────┐
│ NAME · role                 ticks / coords         corner nav │
├──────────────┬────────────────────────────┬──────────────────┤
│  PROJECTS    │                            │      AGENTS      │
│  mission     │      ◉ sphere (hero)       │      units       │
│  files       │   beams to each module     │                  │
│              ├────────────────────────────┤                  │
│              │        SYSTEMS             │                  │
│              │   architecture diagrams    │                  │
├──────────────┴────────────────────────────┴──────────────────┤
│ telemetry: fps · tier · time · status                         │
└──────────────────────────────────────────────────────────────┘
```

Beams are SVG paths from the sphere's edge to each module's anchor, drawn once in the
intro and kept as thin animated lines (dashes flowing outward).

### Mobile (< 1024px, designed separately)

- Sphere as a compact hero at the top (low tier), ~72% of the width.
- On scroll the sphere shrinks into a 40px emblem in a sticky header (same canvas,
  `scaleTarget` + `offsetTarget`), with the name and the active tab.
- Three swipeable tabs (Projects · Agents · Systems) with sticky tab headers; horizontal
  swipe changes tab, vertical scroll scrolls the list.
- Detail view is a full-height bottom sheet; swipe down or the close button dismisses.
- Nothing depends on hover; every target ≥ 44px.

## 4. Component structure

```
src/
  app/
    layout.tsx            fonts (Chakra Petch, Geist, Geist Mono), metadata, tokens
    page.tsx              server component → <Site />
    globals.css           tokens + base styles
  content/
    types.ts              Project / Agent / System / Profile types
    content.ts            THE single data file (profile + items); no components import anything else
  store/
    siteStore.ts          zustand: phase (intro|idle|detail), activeModule, activeItem, hover, introSeen
  lib/
    tier.ts, useMediaQuery.ts, useReducedMotion.ts, introStorage.ts, sequence.ts (timeline helper)
  components/
    sphere/               the hologram's stage, scene, rig, store and poster (same API as Phase 1)
    hologram/             face hologram: pure geometry builder, worker, THREE objects (intro: uAssemble scan front, uIgnite)
    site/
      Site.tsx            client root: picks DesktopLayout / MobileLayout, runs the intro, owns Beams + DetailView
      DesktopLayout.tsx   the grid above
      MobileLayout.tsx    hero + sticky header + tabs + sheet
      IntroSequence.tsx   drives sphereStore intro values + panel reveal phases; skippable; localStorage
      Beams.tsx           SVG beams sphere → modules (draw-on in intro, flowing dashes after)
      FragmentStream.tsx  DOM particles that fly from the sphere to a clicked item
    hud/
      Grid.tsx            perspective grid + scanlines (CSS, one fixed layer)
      Header.tsx          name (Decode), role, coordinate labels, corner nav
      CornerNav.tsx       jump to module; keyboard: Tab/Enter/Esc; also the mobile tab bar
      Telemetry.tsx       ticking numbers (fps, tier, uptime, coords)
      Brackets.tsx        corner brackets used by Panel
      Panel.tsx           glass panel: border, brackets, header row, expand on hover
    modules/
      ModuleFrame.tsx     title, index, status line, beam anchor ref, materialise animation
      ProjectsModule.tsx  → ProjectCard.tsx (case study: code, title, problem, built, stack tags, result)
      AgentsModule.tsx    → AgentUnit.tsx (name, role, ONLINE pulse, tools, ActivityGraph.tsx)
      SystemsModule.tsx   → SystemDiagram.tsx (nodes + FlowLines.tsx animated SVG edges)
    detail/
      DetailView.tsx      desktop full-screen overlay / mobile bottom sheet; Esc, swipe-down
      DetailSections.tsx  description, architecture, stack, screenshots, links, outcome
    ui/
      Decode.tsx          scramble-to-text
      Typewriter.tsx      "INITIALISING"
      Tag.tsx, StatusDot.tsx, Kbd.tsx, VisuallyHidden.tsx
```

Sphere ↔ UI contract (already in `sphereStore.ts`): `pulseToward(x, y)`, `setLeanTarget`,
`setScaleTarget`, `setOffsetTarget`; Phase 3 adds `assemble` (0..N) and `ignite` (0..1)
uniforms for the intro and reads `hover` from `siteStore` to lean toward a module.

Hologram data choices (`scripts/hologram/pack_maps.py`): the flow map is lossy WebP (q 90; it only
steers strands after a 16 px blur). The tone map ships at half resolution, box-filtered and quantised
to 32 grey levels, and is upsampled bilinearly by the loader: at full resolution it was in practice a
clean greyscale portrait, while the builder only samples it 2.6-7.5 crop px apart. Front captures at
1440x900 DPR 2 with the full and the reduced map differ by 0.5/255 on average (no visible change to
eyes, brows, lips or beard). Whether to go further (bake the geometry offline per tier and drop the
maps from `public/`) is the owner's call: a baked head is several MB per tier against ~665 KB of maps.

## 5. Content schema (`src/content/content.ts`)

```ts
interface Link { label: string; href: string }
interface Screenshot { src: string; alt: string }
interface BaseItem {
  id: string; name: string; tagline: string;          // one-line description
  problem: string; built: string; result: string;     // mission file fields
  stack: string[]; links: Link[]; screenshots?: Screenshot[]; architecture?: string;
}
interface Project extends BaseItem { category: "project"; code: string }            // PRJ-01
interface Agent   extends BaseItem { category: "agent"; role: string; status: "online"|"standby"|"offline"; tools: string[] }
interface System  extends BaseItem { category: "system"; nodes: SystemNode[]; edges: SystemEdge[] }
interface SystemNode { id: string; label: string; kind: "source"|"service"|"model"|"store"|"sink"; x: number; y: number } // 0..100
interface SystemEdge { from: string; to: string; label?: string }
export const profile = { name, role, tagline, location, links, availability }
export const projects: Project[]; export const agents: Agent[]; export const systems: System[]
```

Adding an item = adding an object to the right array. Components never hard-code items.

## 6. Load sequence

| t desktop | t mobile | what |
|---|---|---|
| 0.0–1.1s | 0.0–0.5s | black; gold dust drifts in and converges (`uConverge`); starts only once the head is built |
| 0.5–1.9s | 0.3–1.0s | a scan plane draws the head top → bottom (`uAssemble` 0→1), then the filaments light (`uIgnite`) |
| 1.9–2.5s | 1.0–1.3s | `INITIALISING` types under the hologram; the name decodes (scramble → resolve) |
| 2.5–3.0s | 1.3–1.5s | the sequence ends on the bare hologram with the "enter the core" prompt |
| on open | on open | three beams draw (0.05s), modules materialise in turn (0.45s), items stagger 60ms (0.85s) |

Skippable (click, Esc, "skip" button). First visit plays in full; later visits play a 1s
version (assemble 0.4s, beams 0.2s, panels 0.4s). `prefers-reduced-motion`: no intro,
static poster of the hologram, panels fade in over 240ms.

## 7. Interaction map

| Event | UI | Sphere |
|---|---|---|
| hover module / item (desktop) | brightens, brackets expand 10→16px, border → `--gold` | leans toward it (`setLeanTarget`), one pulse |
| focus (keyboard) | same as hover | same |
| click / tap item | fragment stream sphere → item (240ms) then detail view expands; rest dims to 40% | shrinks to `scaleTarget 0.32`, moves to the top-left corner |
| close (Esc, ×, swipe down) | reverse | returns to centre |
| corner nav / tab | scrolls or switches module; sets `activeModule` | pulse toward that module |
| scroll (mobile) | sphere → 40px emblem in the sticky header | `scaleTarget`/`offsetTarget` follow scroll |

Keyboard: Enter on the page opens the sections; Esc goes up one level; ← → step between
sections in a section and between items in an open item; arrow keys move within any list
(clockwise around the callout ring). A skip link jumps to the open section. After a keyboard
action focus follows the view: the sphere, the section you came from, the opened section, the
card of the item you closed. Focus is a 1px gold ring on ordinary controls, gold corner ticks
on the sphere, and the hover state (hot title, rule) on the text-only sections, so nothing draws
a container around them. Every level has its own document title, so Next's route announcer
says each move once. Opening a section by keyboard focuses its scroller: ↑ ↓, Space and Page
keys scroll it, ← → change section.

## 8. Assumptions to confirm

- Real content is not in the brief; `content.ts` ships with three placeholder items per
  category, clearly marked `PLACEHOLDER`, in the exact shape you will fill in.
- Chakra Petch for display type; swap to Sora if you want it softer (one line in layout.tsx).
- Desktop breakpoint 1024px; tablets in portrait use the mobile layout.
