"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import Brackets from "./Brackets";

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  /** expanded brackets + gold border */
  active?: boolean;
  as?: "section" | "div" | "article" | "li";
  children: ReactNode;
  /** no glass fill (for nested items) */
  flat?: boolean;
}

/** Dark glass panel with a 1px gold edge and corner brackets. */
const Panel = forwardRef<HTMLElement, PanelProps>(function Panel({ active = false, as = "section", flat = false, className = "", children, ...rest }, ref) {
  const Tag = as as "section";
  return (
    <Tag
      ref={ref as never}
      data-active={active || undefined}
      className={`relative rounded-[2px] border transition-[border-color,box-shadow] duration-[240ms] ease-[var(--ease-out)] ${
        flat ? "" : "glass"
      } ${active ? "border-gold shadow-glow-strong" : "border-gold-line shadow-glow"} ${className}`}
      {...rest}
    >
      <Brackets size={active ? 16 : 10} />
      {children}
    </Tag>
  );
});

export default Panel;
