"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { useSiteStore } from "@/store/siteStore";
import { useReducedMotion } from "@/lib/useMediaQuery";

/** Staggers its children in once the intro reaches the items step; arrow keys move between items. */
export default function ItemList({ children, className = "" }: { children: ReactNode; className?: string }) {
  const step = useSiteStore((s) => s.step);
  const reduced = useReducedMotion();
  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-item]"));
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = i;
    if (e.key === "ArrowDown") next = Math.min(items.length - 1, i + 1);
    if (e.key === "ArrowUp") next = Math.max(0, i - 1);
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = items.length - 1;
    if (next !== i) {
      e.preventDefault();
      items[next].focus();
    }
  };
  return (
    <motion.ul
      initial={false}
      animate={step >= 6 ? "shown" : "hidden"}
      variants={{ hidden: {}, shown: { transition: { staggerChildren: reduced ? 0 : 0.06 } } }}
      className={`flex flex-col gap-3 ${className}`}
      onKeyDown={onKeyDown}
    >
      {children}
    </motion.ul>
  );
}

export const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.24 } },
};
