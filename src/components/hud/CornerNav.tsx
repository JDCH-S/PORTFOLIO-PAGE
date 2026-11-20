"use client";

import { sectionById, sections } from "@/content/content";
import { useSiteStore } from "@/store/siteStore";
import { home, navLink, openSection, up } from "@/lib/nav";
import { rovingKeys } from "@/lib/roving";

const item = "label relative flex h-11 items-center gap-2 px-3 transition-colors duration-[240ms]";
const rule = "absolute inset-x-3 bottom-2 h-px bg-gold transition-opacity duration-[240ms]";

/**
 * The desktop header's right side. At home it lists the five sections (the two-click way
 * in); everywhere else it is a one-line trail, "home / sections / 02 agents", because the
 * page already shows the section list once.
 */
export default function CornerNav({ className = "" }: { className?: string }) {
  const view = useSiteStore((s) => s.view);
  const active = useSiteStore((s) => s.activeModule);
  const phase = useSiteStore((s) => s.phase);
  // nothing visible is ever inert: hidden, not dimmed, until the load sequence is over
  const style = { visibility: phase === "boot" || phase === "intro" ? ("hidden" as const) : ("visible" as const) };

  if (view === "core") {
    return (
      <nav aria-label="Sections" className={`flex items-center gap-1 ${className}`} style={style} onKeyDown={rovingKeys("a")}>
        <span aria-current="page" className={`${item} text-gold-hot`}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold shadow-[0_0_8px_var(--gold)]" />
          home
        </span>
        {sections.map((s) => (
          <a key={s.id} {...navLink({ depth: 2, section: s.id }, () => openSection(s.id))} className={`group ${item} text-steel hover:text-gold-hot focus-visible:text-gold-hot`}>
            <span className="hidden text-steel-dim xl:inline">{s.index}</span>
            {s.title}
            <span aria-hidden className={`${rule} opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100`} />
          </a>
        ))}
      </nav>
    );
  }

  const current = sectionById(active);
  return (
    <nav aria-label="Breadcrumb" className={className} style={style}>
      <ol className="flex items-center">
        <li>
          <a {...navLink({ depth: 0 }, home)} className={`group ${item} text-steel hover:text-gold-hot focus-visible:text-gold-hot`}>
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold opacity-60" />
            home
            <span aria-hidden className={`${rule} opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100`} />
          </a>
        </li>
        <li aria-hidden className="label text-steel-dim">
          /
        </li>
        <li>
          {view === "menu" ? (
            <span aria-current="page" className={`${item} text-gold-hot`}>
              sections
            </span>
          ) : (
            <a {...navLink({ depth: 1 }, up)} className={`group ${item} text-steel hover:text-gold-hot focus-visible:text-gold-hot`}>
              sections
              <span aria-hidden className={`${rule} opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100`} />
            </a>
          )}
        </li>
        {view === "module" ? (
          <>
            <li aria-hidden className="label text-steel-dim">
              /
            </li>
            <li>
              <span aria-current="page" className={`${item} text-gold-hot`}>
                <span aria-hidden className="text-steel-dim">
                  {current.index}
                </span>{" "}
                {current.title}
                <span aria-hidden className={`${rule} opacity-100`} />
              </span>
            </li>
          </>
        ) : null}
      </ol>
    </nav>
  );
}
