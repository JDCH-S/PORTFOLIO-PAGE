"use client";

import { sectionIds, sections } from "@/content/content";
import type { ModuleId } from "@/content/types";
import { navLink, stepSection } from "@/lib/nav";

const link = "label flex h-11 min-w-0 items-center gap-2 text-steel transition-colors duration-[240ms] hover:text-gold-hot focus-visible:text-gold-hot";

/** The end of a section: the previous and next section as plain text, no box. Sideways moves use ← →; "‹" only ever means up. */
export default function SectionPager({ id }: { id: ModuleId }) {
  const i = sectionIds.indexOf(id);
  const prev = i > 0 ? sections[i - 1] : null;
  const next = i < sections.length - 1 ? sections[i + 1] : null;
  return (
    <nav aria-label="Previous and next section" className="mt-4 flex items-center justify-between gap-4 border-t border-steel-line">
      {prev ? (
        <a {...navLink({ depth: 2, section: prev.id }, () => stepSection(-1))} className={link} aria-label={`${prev.index} ${prev.title}, previous section`}>
          <span aria-hidden>←</span>
          <span className="text-steel-dim">{prev.index}</span>
          <span className="truncate">{prev.title.toLowerCase()}</span>
        </a>
      ) : (
        <span />
      )}
      {next ? (
        <a {...navLink({ depth: 2, section: next.id }, () => stepSection(1))} className={`${link} justify-end`} aria-label={`${next.index} ${next.title}, next section`}>
          <span className="text-steel-dim">{next.index}</span>
          <span className="truncate">{next.title.toLowerCase()}</span>
          <span aria-hidden>→</span>
        </a>
      ) : null}
    </nav>
  );
}
