/**
 * Corner brackets for panels: four L-shapes in gold. `size` is the arm length in px;
 * pass a larger size on hover/focus to make them expand.
 */
export default function Brackets({ size = 10, className = "" }: { size?: number; className?: string }) {
  const s = `${size}px`;
  const base = "pointer-events-none absolute border-gold transition-[width,height] duration-[240ms] ease-[var(--ease-out)]";
  return (
    <span aria-hidden className={`pointer-events-none absolute inset-0 ${className}`}>
      <span className={`${base} top-[-1px] left-[-1px] border-t border-l`} style={{ width: s, height: s }} />
      <span className={`${base} top-[-1px] right-[-1px] border-t border-r`} style={{ width: s, height: s }} />
      <span className={`${base} bottom-[-1px] left-[-1px] border-b border-l`} style={{ width: s, height: s }} />
      <span className={`${base} right-[-1px] bottom-[-1px] border-r border-b`} style={{ width: s, height: s }} />
    </span>
  );
}
