/** Small mono tag for stack and tool names. */
export default function Tag({ children, tone = "steel" }: { children: React.ReactNode; tone?: "steel" | "gold" }) {
  return (
    <span
      className={`label inline-flex h-[22px] items-center rounded-[2px] border px-2 ${
        tone === "gold" ? "border-gold-line text-gold" : "border-steel-line text-steel"
      }`}
    >
      {children}
    </span>
  );
}
