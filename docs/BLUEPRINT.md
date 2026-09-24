# Core — Phase 2 blueprint

Component structure and design tokens for the portfolio. Phase 3 builds exactly this.
The sphere (Phase 1, approved) is the source of every visual decision below: the UI
must look like it was emitted by the sphere.

## 1. Direction in one paragraph

A holographic instrument panel around a living core. Deep blue-black ground with a
faint perspective grid and scanlines; everything that glows is the sphere's gold;
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

## 2.4 The core is the default view; content emerges in two steps

The page opens on the hologram alone: the sphere, the name, the corner nav and an
"enter the core · drag to rotate" prompt. Dragging the sphere (mouse or finger) rotates it in
any direction (a drag across the diameter is three quarters of a turn at any size), with inertia
on release; a press catches a coasting sphere. Tapping it steps through three views:

1. **core**: the hologram alone.
2. **menu**: five callouts emerge on the sphere's rim, the way an instrument labels a specimen:
   a leader line from the rim to a text label (index, title, count; blurb on hover). No
   containers. Projects upper-left, Agents upper-right, Systems lower-left, Skills lower-right,
   About below. On mobile they hang off a spine that drops from the sphere: index, shard, title.
3. **module**: clicking a callout opens only that section. On desktop the sphere and the other
   options (on the same spine, under the sphere) move to the left column and the section fills
   the right, with one beam from the sphere to the section title; on mobile the sphere docks
   into the sticky header and the section is one of five swipeable tabs.

Sections: Projects, Agents, **Skills** (the reusable skills the agents load, in the shape of a
skill file: name, version, trigger, tools, used by) , Systems, and **About** (identity card,
bio, now, facts, timeline, links).

Tapping the sphere goes back one step (module → menu → core); Esc does the same. The corner
nav can jump straight to a module. The layouts below describe the menu and module states.

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
    sphere/               Phase 1 (unchanged API) + intro uniforms: uAssemble (0..shells), uIgnite (0..1)
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
      ProjectsModule.tsx  → ProjectCard.tsx (mission file: code, title, problem, built, stack tags, result)
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
| 0.0–1.1s | 0.0–0.5s | black; gold sparks drift in from the edges and converge (particles `uIntro`) |
| 0.5–1.9s | 0.3–1.0s | shells assemble outer → inner (`uAssemble` 0→N), then the vortex ignites (`uIgnite`) |
| 1.9–2.5s | 1.0–1.3s | `INITIALISING` types under the sphere; the name decodes (scramble → resolve) |
| 2.5–3.0s | 1.3–1.5s | the sequence ends on the bare hologram with the "enter the core" prompt |
| on open | on open | three beams draw (0.05s), modules materialise in turn (0.45s), items stagger 60ms (0.85s) |

Skippable (click, Esc, "skip" button). First visit plays in full; later visits play a 1s
version (assemble 0.4s, beams 0.2s, panels 0.4s). `prefers-reduced-motion`: no intro,
static sphere, panels fade in over 240ms.

## 7. Interaction map

| Event | UI | Sphere |
|---|---|---|
| hover module / item (desktop) | brightens, brackets expand 10→16px, border → `--gold` | leans toward it (`setLeanTarget`), one pulse |
| focus (keyboard) | same as hover | same |
| click / tap item | fragment stream sphere → item (240ms) then detail view expands; rest dims to 40% | shrinks to `scaleTarget 0.32`, moves to the top-left corner |
| close (Esc, ×, swipe down) | reverse | returns to centre |
| corner nav / tab | scrolls or switches module; sets `activeModule` | pulse toward that module |
| scroll (mobile) | sphere → 40px emblem in the sticky header | `scaleTarget`/`offsetTarget` follow scroll |

Keyboard: Tab through nav, modules and items; Enter opens; Esc closes; arrow keys move
between the options (menu and spine) and between items in a module. After a keyboard action
focus follows the view: the core button, the option you came from, the opened panel. Focus rings
are 1px `--gold`; the text-only options show focus as their hover state (hot title, rule) instead
of a box, so nothing draws a container around them.

## 8. Assumptions to confirm

- Real content is not in the brief; `content.ts` ships with three placeholder items per
  category, clearly marked `PLACEHOLDER`, in the exact shape you will fill in.
- Chakra Petch for display type; swap to Sora if you want it softer (one line in layout.tsx).
- Desktop breakpoint 1024px; tablets in portrait use the mobile layout.
