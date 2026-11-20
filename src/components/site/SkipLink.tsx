"use client";

import { useSiteStore } from "@/store/siteStore";

/** First stop for keyboard users in a section: jump past the sphere and nav straight to it. */
export default function SkipLink() {
  const view = useSiteStore((s) => s.view);
  const active = useSiteStore((s) => s.activeModule);
  const phase = useSiteStore((s) => s.phase);
  if (view !== "module" || phase !== "idle") return null;
  return (
    <a
      href={`#${active}`}
      onClick={(e) => {
        // never touches the URL: it only moves focus
        e.preventDefault();
        document.getElementById(`module-${active}`)?.focus();
      }}
      className="label sr-only z-[80] text-gold-hot focus:not-sr-only focus:fixed focus:top-3 focus:left-4 focus:flex focus:h-11 focus:items-center focus:bg-bg focus:px-2"
    >
      skip to section
    </a>
  );
}
