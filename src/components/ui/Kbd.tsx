/** Keyboard hint. */
export default function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="label inline-flex h-[18px] items-center rounded-[2px] border border-steel-line px-1.5 text-steel">{children}</kbd>;
}
