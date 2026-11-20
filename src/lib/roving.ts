import type { KeyboardEvent } from "react";

const KEYS = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];

/**
 * Arrow, Home and End keys move focus between the container's matching (visible) elements.
 * `order` (values of data-option) sets the arrow order when it differs from the DOM order,
 * e.g. clockwise around the sphere; Home and End always go to the first and last in it.
 */
export function rovingKeys(selector: string, order?: string[]) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (!KEYS.includes(e.key) || e.altKey || e.metaKey || e.ctrlKey) return;
    let items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(selector)).filter((el) => !el.closest("[inert]") && el.tabIndex >= 0);
    if (order) items = items.sort((a, b) => order.indexOf(a.dataset.option ?? "") - order.indexOf(b.dataset.option ?? ""));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (items.length === 0 || i < 0) return;
    e.preventDefault();
    const n = items.length;
    const next = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n;
    items[next].focus({ preventScroll: true });
  };
}
