"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { motion } from "framer-motion";
import { useSiteStore } from "@/store/siteStore";
import { itemVariants } from "./ItemList";
import Brackets from "@/components/hud/Brackets";

export interface ItemButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  itemId: string;
}

/**
 * The clickable shell of every card: 44px+ target, hover/focus brightening with expanding
 * brackets, and the open-item wiring (fragment stream, then the detail view).
 */
const ItemButton = forwardRef<HTMLButtonElement, ItemButtonProps>(function ItemButton({ itemId, className = "", children, onClick, ...rest }, ref) {
  const hover = useSiteStore((s) => s.hover);
  const setHover = useSiteStore((s) => s.setHover);
  const on = hover === itemId;
  return (
    <motion.li variants={itemVariants} className="list-none">
      <button
        ref={ref}
        type="button"
        data-item={itemId}
        onMouseEnter={() => setHover(itemId)}
        onMouseLeave={() => setHover(null)}
        onFocus={() => setHover(itemId)}
        onBlur={() => setHover(null)}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) {
            const rect = e.currentTarget.getBoundingClientRect();
            window.dispatchEvent(new CustomEvent("core:open-item", { detail: { id: itemId, rect } }));
          }
        }}
        className={`relative block min-h-11 w-full rounded-[4px] border text-left transition-[border-color,background-color,box-shadow] duration-[240ms] ease-[var(--ease-out)] ${
          on ? "border-gold bg-bg-3 shadow-glow" : "border-steel-line bg-transparent hover:bg-bg-3"
        } ${className}`}
        {...rest}
      >
        <Brackets size={on ? 14 : 8} />
        {children}
      </button>
    </motion.li>
  );
});

export default ItemButton;
