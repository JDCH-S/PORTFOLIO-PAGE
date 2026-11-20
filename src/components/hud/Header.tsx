"use client";

import { emailHref, profile } from "@/content/content";
import { useSiteStore } from "@/store/siteStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import { home, navLink } from "@/lib/nav";
import Decode from "@/components/ui/Decode";
import CornerNav from "./CornerNav";

const availability = profile.availability.replace(/^PLACEHOLDER · /, "");

/**
 * Desktop header: the name (a way home from anywhere but home), the role with a direct
 * email link, tick marks, and the section list or trail.
 */
export default function Header({ className = "" }: { className?: string }) {
  const step = useSiteStore((s) => s.step);
  const view = useSiteStore((s) => s.view);
  const reduced = useReducedMotion();
  const show = step >= 3;
  const name = (
    <Decode as="h1" text={profile.name.toUpperCase()} active={show} reduced={reduced} className="font-display text-[26px] leading-[30px] font-semibold tracking-[0.06em] whitespace-nowrap text-gold-hot" />
  );
  return (
    <header
      className={`flex items-start justify-between gap-6 transition-opacity duration-[480ms] ease-[var(--ease-out)] ${className}`}
      style={{ opacity: step >= 2 ? 1 : 0.35 }}
    >
      <div className="shrink-0">
        {view === "core" ? (
          name
        ) : (
          <a {...navLink({ depth: 0 }, home)} className="group relative block outline-none" aria-label={`${profile.name}, home`}>
            {name}
            <span aria-hidden className="absolute -bottom-0.5 left-0 h-px w-full bg-gold opacity-0 transition-opacity duration-[240ms] group-hover:opacity-100 group-focus-visible:opacity-100" />
          </a>
        )}
        <p className="label mt-1 flex items-center gap-x-2 whitespace-nowrap text-steel">
          <span>{profile.role}</span>
          <span aria-hidden className="text-steel-dim">
            ·
          </span>
          {emailHref ? (
            <a href={emailHref} className="group relative inline-flex min-h-6 items-center text-steel transition-colors hover:text-gold-hot focus-visible:text-gold-hot">
              {availability} · email<span aria-hidden> ↗</span>
              <span aria-hidden className="absolute bottom-0.5 left-0 h-px w-full bg-gold opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </a>
          ) : (
            <span>{availability}</span>
          )}
        </p>
      </div>
      <div aria-hidden className="hidden min-w-0 flex-1 items-center gap-[6px] self-center overflow-hidden xl:flex">
        {Array.from({ length: 40 }, (_, i) => (
          <span key={i} className={`block w-px bg-steel-line ${i % 5 === 0 ? "h-3" : "h-1.5"}`} />
        ))}
      </div>
      <CornerNav />
    </header>
  );
}
