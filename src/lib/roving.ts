import type { KeyboardEvent } from "react";

const KEYS = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];

/** Arrow, Home and End keys move focus between the container's matching (visible) elements. */
export function rovingKeys(selector: string) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (!KEYS.includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(selector)).filter((el) => !el.closest("[inert]") && el.tabIndex >= 0);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (items.length === 0 || i < 0) return;
    e.preventDefault();
    const n = items.length;
    const next = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n;
    items[next].focus({ preventScroll: true });
  };
}
