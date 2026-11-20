"use client";

import type { MouseEvent } from "react";
import { itemsOf, sectionIds, sectionOfItem } from "@/content/content";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import { EMERGE } from "@/lib/sequence";
import { announceFor, format, HOME, parentOf, parse, routeFromView, same, SECTIONS, titleFor, type Route } from "./route";

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
 *   prevDepth  depth of the entry directly below, or -1 when that entry is not ours
 *   homeOffset entries back to our home entry, or null when there is none
 *
 * Next.js patches pushState/replaceState to copy its own markers into the state object,
 * so writes always pass a fresh `{ nav }` object and always call window.history at call
 * time (never a cached reference). Nothing is written before hydration: boot() runs once
 * the load sequence is over.
 */

interface Entry {
  depth: number;
  prevDepth: number;
  homeOffset: number | null;
}

let booted = false;
let pending = false;
let pendingTimer = 0;
let queued: (() => void) | null = null;
let itemTimer = 0;
let baseTitle = "";
/** Next's own markers, captured at boot, for entries the browser created without them (a typed hash) */
let nextMarkers: Record<string, unknown> = {};

const store = () => useSiteStore.getState();

function currentRoute(): Route {
  const s = store();
  return routeFromView(s.view, s.activeModule, s.activeItem);
}

function currentEntry(): Entry {
  const nav = (window.history.state as { nav?: Entry } | null)?.nav;
  if (nav) return nav;
  // an entry we did not write (a hand-typed hash): treat what is below it as foreign
  const depth = parse(window.location.hash).depth;
  return { depth, prevDepth: -1, homeOffset: depth === 0 ? 0 : null };
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
}

/** history.back()/go() land asynchronously: hold further moves until the popstate arrives. */
function go(delta: number) {
  pending = true;
  window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(settle, 700);
  window.history.go(delta);
}

function settle() {
  pending = false;
  window.clearTimeout(pendingTimer);
  const next = queued;
  queued = null;
  next?.();
}

function guarded(fn: () => void) {
  if (pending) {
    queued = fn; // the latest request wins
    return;
  }
  fn();
}

/**
 * Makes the store show `r`. Idempotent (popstate and hashchange can both fire for one
 * entry), and it only calls the store's existing actions, so every animation, beam and
 * reveal step behaves exactly as it does for a click.
 */
export function applyRoute(r: Route, opts: { fromHistory?: boolean } = {}) {
  window.clearTimeout(itemTimer);
  const s = store();
  const before = currentRoute();
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
  if (!same(before, r) || opts.fromHistory) {
    const text = announceFor(r, store().lastInput === "pointer");
    if (text) window.setTimeout(() => store().setAnnounce(text), 300);
  }
}

/** One level deeper (or a jump down from home): a new history entry. */
export function down(r: Route) {
  guarded(() => {
    const c = currentEntry();
    write("push", r, { depth: r.depth, prevDepth: c.depth, homeOffset: c.homeOffset == null ? null : c.homeOffset + 1 });
    applyRoute(r);
  });
}

/** A sibling at the same level (tab, swipe, pager, next item): the entry is replaced. */
export function lateral(r: Route) {
  guarded(() => {
    const c = currentEntry();
    write("replace", r, { ...c, depth: r.depth });
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
    if (booted && c.depth === r.depth && c.prevDepth === r.depth - 1) {
      // the parent is the entry right below: pop it, so Back and Forward stay in step
      go(-1);
      return;
    }
    write("replace", p, { depth: p.depth, prevDepth: c.prevDepth, homeOffset: p.depth === 0 ? 0 : c.homeOffset });
    applyRoute(p);
  });
}

/** Straight home (the name, the "home" link). */
export function home() {
  guarded(() => {
    if (currentRoute().depth === 0) return;
    const c = currentEntry();
    if (booted && c.homeOffset != null && c.homeOffset > 0) {
      go(-c.homeOffset);
      return;
    }
    write("replace", HOME, { depth: 0, prevDepth: c.prevDepth, homeOffset: 0 });
    applyRoute(HOME);
  });
}

export function openSections() {
  if (currentRoute().depth === 0) down(SECTIONS);
}

/** Open a section: one level down from home or sections, sideways from another section. */
export function openSection(id: ModuleId) {
  const r = currentRoute();
  const target: Route = { depth: 2, section: id };
  if (r.depth >= 2) {
    if (r.depth === 2 && r.section === id) return;
    lateral(target);
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
  const r = parse(window.location.hash);
  const ours = Boolean((window.history.state as { nav?: Entry } | null)?.nav);
  // a typed hash, or a corrected one (wrong section for an item, unknown word), is stamped in place
  if (booted && (!ours || format(r) !== window.location.hash)) {
    write("replace", r, ours ? currentEntry() : { depth: r.depth, prevDepth: -1, homeOffset: r.depth === 0 ? 0 : null });
  }
  applyRoute(r, { fromHistory: true });
  if (pending) settle();
}

/**
 * Runs once, when the load sequence is over. Stamps the entry we were loaded on, seeds
 * history for a deep link (section, then item: Back from a shared item goes to its
 * section, then off the site), and opens what the URL names.
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
    if (linked.depth === 0) {
      // a bare load; the visitor may already have opened the sections during the intro
      const shown = currentRoute();
      write("replace", HOME, { depth: 0, prevDepth: -1, homeOffset: 0 });
      if (shown.depth > 0) write("push", shown, { depth: shown.depth, prevDepth: 0, homeOffset: 1 });
      return;
    }
    if (linked.depth === 3) {
      write("replace", { depth: 2, section: linked.section }, { depth: 2, prevDepth: -1, homeOffset: null });
      write("push", linked, { depth: 3, prevDepth: 2, homeOffset: null });
    } else {
      write("replace", linked, { depth: linked.depth, prevDepth: -1, homeOffset: null });
    }
    applyRoute(linked);
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
