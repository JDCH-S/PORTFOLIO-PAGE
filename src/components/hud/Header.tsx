"use client";

import { profile } from "@/content/content";
import { useSiteStore } from "@/store/siteStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import Decode from "@/components/ui/Decode";
import CornerNav from "./CornerNav";

/** Desktop header: name (decoded in), role, tick marks and the corner nav. */
export default function Header({ className = "" }: { className?: string }) {
  const step = useSiteStore((s) => s.step);
  const reduced = useReducedMotion();
  const show = step >= 3;
  return (
    <header
      className={`flex items-start justify-between gap-6 transition-opacity duration-[480ms] ease-[var(--ease-out)] ${className}`}
      style={{ opacity: step >= 2 ? 1 : 0.35 }}
    >
      <div className="min-w-0">
        <Decode as="h1" text={profile.name.toUpperCase()} active={show} reduced={reduced} className="font-display text-[26px] leading-[30px] font-semibold tracking-[0.06em] text-gold-hot" />
        <p className="label mt-1 text-steel">
          {profile.role} <span className="text-steel-dim">·</span> {profile.availability}
        </p>
      </div>
      <div aria-hidden className="hidden flex-1 items-center gap-[6px] self-center xl:flex">
        {Array.from({ length: 40 }, (_, i) => (
          <span key={i} className={`block w-px bg-steel-line ${i % 5 === 0 ? "h-3" : "h-1.5"}`} />
        ))}
      </div>
      <CornerNav />
    </header>
  );
}
