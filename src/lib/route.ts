import { findItem, itemsOf, profile, sectionById, sectionIds, sectionOfItem } from "@/content/content";
import type { ContentModuleId, ModuleId } from "@/content/types";

/**
 * The four levels of the site and their URLs (hash only, so the server route stays "/"):
 *   0 home      ""                 the hologram alone
 *   1 sections  "#sections"        the five sections revealed around the sphere
 *   2 section   "#projects"        one section open
 *   3 item      "#projects/prj-01" one item open over its section
 */
export type Route = { depth: 0 } | { depth: 1 } | { depth: 2; section: ModuleId } | { depth: 3; section: ContentModuleId; item: string };

export const HOME: Route = { depth: 0 };
export const SECTIONS: Route = { depth: 1 };

const isSection = (s: string): s is ModuleId => (sectionIds as string[]).includes(s);

/** Reads a location hash. Unknown words fall back to home; an item under the wrong section is corrected. */
export function parse(hash: string): Route {
  let raw = hash.replace(/^#/, "");
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // a cut-off or stray "%": read the hash as it is
  }
  raw = raw.trim().toLowerCase();
  if (!raw) return HOME;
  const [head, tail] = raw.split("/");
  if (head === "sections") return SECTIONS;
  if (tail) {
    const owner = sectionOfItem(tail);
    if (owner) return { depth: 3, section: owner, item: tail };
  }
  if (isSection(head)) return { depth: 2, section: head };
  return HOME;
}

export function format(r: Route): string {
  switch (r.depth) {
    case 0:
      return "";
    case 1:
      return "#sections";
    case 2:
      return `#${r.section}`;
    case 3:
      return `#${r.section}/${r.item}`;
  }
}

export function same(a: Route, b: Route): boolean {
  return format(a) === format(b);
}

export function parentOf(r: Route): Route {
  switch (r.depth) {
    case 3:
      return { depth: 2, section: r.section };
    case 2:
      return SECTIONS;
    default:
      return HOME;
  }
}

/** The route the store is showing right now. */
export function routeFromView(view: "core" | "menu" | "module", activeModule: ModuleId, activeItem: string | null): Route {
  if (view === "core") return HOME;
  if (view === "menu") return SECTIONS;
  const owner = activeItem ? sectionOfItem(activeItem) : null;
  if (activeItem && owner) return { depth: 3, section: owner, item: activeItem };
  return { depth: 2, section: activeModule };
}

/** Browser tab title per level. */
export function titleFor(r: Route, base: string): string {
  if (r.depth === 1) return `Sections · ${profile.name}`;
  if (r.depth === 2) return `${sectionById(r.section).title} · ${profile.name}`;
  if (r.depth === 3) {
    const item = findItem(r.item);
    return `${item?.name.replace(/^PLACEHOLDER · /, "") ?? r.item} · ${sectionById(r.section).title} · ${profile.name}`;
  }
  return base;
}

/** Words the hash may hold. No element id may equal one, or the browser would scroll-jump to it. */
export function routeWords(): string[] {
  return ["sections", ...sectionIds, ...sectionIds.flatMap((id) => itemsOf(id).map((i) => i.id))];
}
