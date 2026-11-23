/**
 * The phone section header's emblem: the slot at the start of the name row where the sphere
 * parks (docked by scrolling, or while an item is open), with the name beside it.
 */

/** the parked sphere's diameter (css px) */
export const EMBLEM = 40;
/** the gap between the emblem and the name */
export const EMBLEM_GAP = 12;

/**
 * The emblem's centre once its slot is fully open. Computed from the header (its px-4 / py-2
 * name row under the safe-area padding), not from the slot, which may still be opening.
 */
export function emblemCentre(head: HTMLElement): { x: number; y: number } {
  const r = head.getBoundingClientRect();
  const safeTop = parseFloat(getComputedStyle(head).paddingTop) || 0;
  return { x: r.left + 16 + EMBLEM / 2, y: r.top + safeTop + 8 + EMBLEM / 2 };
}
