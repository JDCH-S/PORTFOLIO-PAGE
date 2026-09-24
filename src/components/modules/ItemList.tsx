"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { useSiteStore } from "@/store/siteStore";
import { useReducedMotion } from "@/lib/useMediaQuery";

/** Staggers its children in once the intro reaches the items step. */
export default function ItemList({ children, className = "" }: { children: ReactNode; className?: string }) {
  const step = useSiteStore((s) => s.step);
  const reduced = useReducedMotion();
  return (
    <motion.ul
      initial={false}
      animate={step >= 6 ? "shown" : "hidden"}
      variants={{ hidden: {}, shown: { transition: { staggerChildren: reduced ? 0 : 0.06 } } }}
      className={`flex flex-col gap-3 ${className}`}
    >
      {children}
    </motion.ul>
  );
}

export const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.24 } },
};
