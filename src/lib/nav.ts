"use client";

import type { MouseEvent } from "react";
import { itemsOf, sectionIds, sectionOfItem } from "@/content/content";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { EMERGE } from "@/lib/sequence";
import { format, HOME, parentOf, parse, routeFromView, SECTIONS, titleFor, type Route } from "./route";

/**
 * The only code that writes browser history. Every way of moving around the site
 * (sphere, options, nav, Esc, Back, pagers, swipes) goes through here, so they all agree:
 *
 * - going one level deeper pushes an entry (Back undoes it);
 * - moving sideways at the same level replaces the entry (Back never walks siblings);
 * - going up pops the entry when the parent is directly below it, otherwise replaces it.
 *
 * Each entry we own carries `state.nav`:
 *   depth      0 home · 1 sections · 2 section · 3 item
 *   below      the URL hash of the entry directly below, or null when that entry is not ours
 *   homeOffset entries back to our home entry, or null when there is none
 *   base       entries back to the first entry we own (the one the page loaded on)
 *
 * After a pop we check where we actually landed: if it is not the level we meant to
 * reach (Forward and a sideways move can leave a stale entry below), that entry is
 * rewritten to the right one, so Esc and Back always end where they say.
 *
 * Next.js patches pushState/replaceState to copy its own markers into the state object,
 * so writes always pass a fresh `{ nav }` object and always call window.history at call
 * time (never a cached reference). Nothing is written before hydration: boot() runs once
 * the load sequence is over. A reload keeps the entries we wrote, so boot() reuses them.
 *
 * Screen readers hear each move once, from Next's route announcer, which reads the
 * document title; so every level has its own title.
 */

interface Entry {
  depth: number;
  below: string | null;
  homeOffset: number | null;
  base: number;
}

let booted = false;
let pending = false;
let pendingTimer = 0;
/** the route a pop is meant to land on */
let expected: Route | null = null;
const queue: (() => void)[] = [];
let itemTimer = 0;
let baseTitle = "";
/** the entry we last showed, and the history length then: a typed hash lands on top of it */
let lastEntry: Entry | null = null;
let lastLength = 0;
let lastHash = "";
/** Next's own markers, captured at boot, for entries the browser created without them (a typed hash) */
let nextMarkers: Record<string, unknown> = {};

const store = () => useSiteStore.getState();
const navOf = (): Entry | null => (window.history.state as { nav?: Entry } | null)?.nav ?? null;

/** What is on screen. Once booted the URL is the truth (an item named by a link opens a moment after its section). */
function currentRoute(): Route {
  if (booted) return parse(window.location.hash);
  const s = store();
  return routeFromView(s.view, s.activeModule, s.activeItem);
}

function currentEntry(): Entry {
  const nav = navOf();
  if (nav && "below" in nav) return nav;
  // an entry we did not write (a hand-typed hash): treat what is below it as foreign
  const depth = parse(window.location.hash).depth;
  return { depth, below: null, homeOffset: depth === 0 ? 0 : null, base: 0 };
}

function urlFor(r: Route): string {
  return window.location.pathname + window.location.search + format(r);
}

function write(kind: "push" | "replace", r: Route, entry: Entry) {
  if (!booted) return;
  // Next copies its markers from the current entry; an entry it never saw has none, and
  // a later Back onto an entry without them reloads the page, so supply them ourselves
  const hasMarkers = Boolean((window.history.state as { __NA?: boolean } | null)?.__NA);
  const data = hasMarkers ? { nav: entry } : { nav: entry, ...nextMarkers };
  if (kind === "push") window.history.pushState(data, "", urlFor(r));
  else window.history.replaceState(data, "", urlFor(r));
  remember();
}

function remember() {
  lastEntry = navOf();
  lastLength = window.history.length;
}

/** history.back()/go() land asynchronously: hold further moves until the popstate arrives. */
function go(delta: number, target: Route) {
  pending = true;
  expected = target;
  window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(settle, 700);
  window.history.go(delta);
}

function settle() {
  pending = false;
  expected = null;
  window.clearTimeout(pendingTimer);
  // run what was asked meanwhile, in order (three quick Esc presses go up three levels)
  while (queue.length && !pending) queue.shift()!();
}

/**
 * Runs `fn` now, or after a pending pop lands. A move to a fixed place (down, sideways) was
 * chosen for the page as it was when asked, so it is dropped if the page has moved since;
 * a relative move (up, home) still runs, so three quick Esc presses go up three levels.
 */
function guarded(fn: () => void, relative = false) {
  if (pending) {
    const asked = window.location.hash;
    if (queue.length < 4) queue.push(() => (relative || window.location.hash === asked ? fn() : undefined));
    return;
  }
  fn();
}

/**
 * Makes the store show `r`. Idempotent (popstate and hashchange can both fire for one
 * entry), and it only calls the store's existing actions, so every animation, beam and
 * reveal step behaves exactly as it does for a click.
 */
export function applyRoute(r: Route) {
  window.clearTimeout(itemTimer);
  const s = store();
  switch (r.depth) {
    case 0:
      if (s.activeItem) s.closeItem();
      if (s.view !== "core") s.closeToCore();
      break;
    case 1:
      if (s.activeItem) s.closeItem();
      if (s.view !== "menu") s.backToMenu();
      break;
    case 2:
      if (s.activeItem) s.closeItem();
      if (s.view !== "module" || s.activeModule !== r.section) store().openModule(r.section);
      break;
    case 3: {
      if (s.view === "module" && s.activeModule === r.section) {
        if (s.activeItem !== r.item) s.openItem(r.item);
      } else {
        // open the section first, then the item once its cards are in (the sheet needs its emblem)
        if (s.activeItem) s.closeItem();
        store().openModule(r.section);
        const wait = Math.max(EMERGE.desktop.items, EMERGE.mobile.items) * 1000 + 80;
        itemTimer = window.setTimeout(() => store().openItem(r.item), wait);
      }
      break;
    }
  }
  if (!baseTitle) baseTitle = document.title;
  document.title = titleFor(r, baseTitle);
}

/** One level deeper (or a jump down from home): a new history entry. */
export function down(r: Route) {
  guarded(() => {
    const c = currentEntry();
    write("push", r, {
      depth: r.depth,
      below: format(currentRoute()),
      homeOffset: c.homeOffset == null ? null : c.homeOffset + 1,
      base: c.base + 1,
    });
    applyRoute(r);
  });
}

/** A sibling at the same level (tab, swipe, pager, next item): the entry is replaced. */
export function lateral(r: Route) {
  guarded(() => {
    write("replace", r, { ...currentEntry(), depth: r.depth });
    applyRoute(r);
  });
}

/** Up one level: Esc, Back, the sphere, every "‹" control and every close button. */
export function up() {
  guarded(() => {
    const r = currentRoute();
    if (r.depth === 0) return;
    const p = parentOf(r);
    const c = currentEntry();
    if (booted && c.below === format(p)) {
      // the parent is the entry right below: pop it, so Back and Forward stay in step
      go(-1, p);
      return;
    }
    write("replace", p, { ...c, depth: p.depth, homeOffset: p.depth === 0 ? 0 : c.homeOffset });
    applyRoute(p);
  }, true);
}

/** Straight home (the name, the "home" link). */
export function home() {
  guarded(() => {
    if (currentRoute().depth === 0) return;
    const c = currentEntry();
    // back to our home entry, or else to the first entry we own (it becomes home), so
    // Back from home always leaves the site instead of reopening a section
    const back = c.homeOffset ?? c.base;
    if (booted && back > 0) {
      go(-back, HOME);
      return;
    }
    write("replace", HOME, { ...c, depth: 0, homeOffset: 0 });
    applyRoute(HOME);
  }, true);
}

export function openSections() {
  if (currentRoute().depth === 0) down(SECTIONS);
}

/** Open a section: one level down from home or sections, sideways from another section. */
export function openSection(id: ModuleId) {
  const r = currentRoute();
  const target: Route = { depth: 2, section: id };
  if (r.depth === 3) {
    // only reachable in the moment before a linked item opens: close it, then move
    up();
    // runs once the item is closed, whatever the URL then says
    if (r.section !== id) guarded(() => lateral(target), true);
    return;
  }
  if (r.depth === 2) {
    if (r.section !== id) lateral(target);
  } else down(target);
}

export function stepSection(delta: number) {
  const r = currentRoute();
  if (r.depth !== 2) return;
  const i = sectionIds.indexOf(r.section) + delta;
  if (i < 0 || i >= sectionIds.length) return;
  lateral({ depth: 2, section: sectionIds[i] });
}

export function openItem(id: string) {
  const section = sectionOfItem(id);
  if (!section) return;
  const r = currentRoute();
  if (r.depth === 3) lateral({ depth: 3, section, item: id });
  else down({ depth: 3, section, item: id });
}

export function stepItem(delta: number) {
  const r = currentRoute();
  if (r.depth !== 3) return;
  const list = itemsOf(r.section);
  const i = list.findIndex((it) => it.id === r.item) + delta;
  if (i < 0 || i >= list.length) return;
  lateral({ depth: 3, section: r.section, item: list[i].id });
}

/** popstate / hashchange: the URL is the truth; make the view match it. */
export function onHistory() {
  let r = parse(window.location.hash);
  const nav = navOf();
  const ours = Boolean(nav && "below" in nav);
  if (booted) {
    if (expected && format(expected) !== format(r) && ours) {
      // a pop landed on a stale entry (a sideways move was made over forward history): fix it
      r = expected;
      write("replace", r, { ...nav!, depth: r.depth, homeOffset: r.depth === 0 ? 0 : nav!.homeOffset });
    } else if (!ours) {
      // a typed hash pushes a new entry on top of the one we were showing
      const fresh = lastEntry && window.history.length > lastLength;
      const below = fresh ? lastEntry! : null;
      write("replace", r, {
        depth: r.depth,
        below: below ? lastHash : null,
        homeOffset: r.depth === 0 ? 0 : below?.homeOffset != null ? below.homeOffset + 1 : null,
        base: below ? below.base + 1 : 0,
      });
    } else if (format(r) !== window.location.hash) {
      // a corrected hash (wrong section for an item, an unknown word)
      write("replace", r, { ...nav!, depth: r.depth });
    }
  }
  applyRoute(r);
  lastHash = format(r);
  remember();
  if (pending) settle();
}

/**
 * Runs once, when the load sequence is over. Reuses the entry after a reload, otherwise
 * stamps the entry we were loaded on and seeds history for a deep link (section, then
 * item: Back from a shared item goes to its section, then off the site), and opens what
 * the URL names.
 */
export function boot() {
  if (booted) return;
  let tries = 0;
  const attempt = () => {
    // wait for Next to put its marker on the entry, or a later Back would reload the page
    if (!(window.history.state as { __NA?: boolean } | null)?.__NA && tries++ < 10) {
      requestAnimationFrame(attempt);
      return;
    }
    booted = true;
    const st = (window.history.state ?? {}) as Record<string, unknown>;
    nextMarkers = Object.fromEntries(Object.entries(st).filter(([k]) => k === "__NA" || k.startsWith("__PRIVATE_NEXTJS")));
    window.history.scrollRestoration = "manual";
    const linked = parse(window.location.hash);
    const kept = navOf();
    const shown = routeFromView(store().view, store().activeModule, store().activeItem);
    if (kept && "below" in kept && kept.depth === linked.depth) {
      // a reload (or a restore) of an entry we wrote: history is already right
      if (format(linked) !== window.location.hash) write("replace", linked, kept);
      if (linked.depth === 0 && shown.depth > 0) {
        // the visitor opened the sections during the intro
        write("push", shown, { depth: shown.depth, below: "", homeOffset: 1, base: kept.base + 1 });
      } else applyRoute(linked);
    } else if (linked.depth === 0) {
      // a bare load; the visitor may already have opened the sections during the intro
      write("replace", HOME, { depth: 0, below: null, homeOffset: 0, base: 0 });
      if (shown.depth > 0) write("push", shown, { depth: shown.depth, below: "", homeOffset: 1, base: 1 });
    } else if (linked.depth === 3) {
      const section: Route = { depth: 2, section: linked.section };
      write("replace", section, { depth: 2, below: null, homeOffset: null, base: 0 });
      write("push", linked, { depth: 3, below: format(section), homeOffset: null, base: 1 });
      applyRoute(linked);
    } else {
      write("replace", linked, { depth: linked.depth, below: null, homeOffset: null, base: 0 });
      applyRoute(linked);
    }
    lastHash = window.location.hash;
    remember();
  };
  attempt();
}

/** The route a URL names on load, for the intro to choose its length. */
export function linkedRoute(): Route {
  return typeof window === "undefined" ? HOME : parse(window.location.hash);
}

/**
 * Props for a real link: copy-link, middle-click and new tab give a deep link, while a
 * plain left click goes through nav (no page jump, the right history entry).
 */
export function navLink(r: Route, onNav: () => void) {
  return {
    href: format(r) || "#",
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      onNav();
    },
  };
}

export { HOME, SECTIONS };
