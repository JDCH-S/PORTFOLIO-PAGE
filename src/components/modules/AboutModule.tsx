"use client";

import { m } from "framer-motion";
import { about, profile } from "@/content/content";
import { useSiteStore } from "@/store/siteStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import ModuleFrame from "./ModuleFrame";
import Brackets from "@/components/hud/Brackets";

const initials = profile.name
  .split(/\s+/)
  .map((w) => w[0])
  .slice(0, 3)
  .join("");

/** About: who is behind the core. Identity card, bio, now, timeline and links; no items to open. */
export default function AboutModule({ className = "" }: { className?: string; compact?: boolean }) {
  const step = useSiteStore((s) => s.step);
  const reduced = useReducedMotion();
  const shown = step >= 6;
  return (
    <ModuleFrame id="about" index="05" title="About" className={className}>
      <m.div
        initial={false}
        animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
        transition={{ duration: reduced ? 0.2 : 0.4, ease: [0.2, 0.8, 0.2, 1] }}
        className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]"
      >
        {/* identity: a row on small screens, a column beside the bio on large ones */}
        <div className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-[72px_minmax(0,1fr)] lg:grid-cols-1">
          <div className="relative aspect-square w-[72px] bg-bg-2/60 lg:w-full lg:max-w-[220px]">
            <Brackets size={10} />
            {about.photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- content image
              <img src={about.photo} alt={profile.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1">
                <span className="font-display text-[20px] font-semibold tracking-[0.1em] text-gold lg:text-[40px]">{initials}</span>
                <span className="label hidden text-steel lg:block">{profile.role}</span>
              </div>
            )}
            <span aria-hidden className="label absolute bottom-2 left-2 hidden items-center gap-2 text-steel lg:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-online" />
              {profile.availability.replace(/^PLACEHOLDER · /, "")}
            </span>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px] leading-[20px]">
              {about.facts
                .filter((f) => f.label !== "availability")
                .map((f) => (
                  <div key={f.label} className="contents">
                    <dt className="label text-steel">{f.label}</dt>
                    <dd className="text-fg">{f.value}</dd>
                  </div>
                ))}
            </dl>
            <ul className="flex flex-col gap-0.5">
              {profile.links.map((l) => (
                <li key={l.href}>
                  <a href={l.href} target="_blank" rel="noreferrer" className="label flex h-11 items-center gap-3 text-gold transition-colors hover:text-gold-hot">
                    <span aria-hidden className="h-px w-4 bg-gold-line" />
                    {l.label} <span aria-hidden>↗</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* bio, now, timeline */}
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-3">
            {about.intro.map((p) => (
              <p key={p} className="max-w-[62ch] text-[16px] leading-[26px] text-fg">
                {p}
              </p>
            ))}
          </div>
          <div className="grid gap-2 border-t border-steel-line pt-4 lg:grid-cols-[88px_1fr] lg:gap-4">
            <h3 className="label text-steel">now</h3>
            <p className="max-w-[62ch] text-[15px] leading-[24px] text-gold-hot">{about.now}</p>
          </div>
          <div className="border-t border-steel-line pt-4">
            <h3 className="label mb-3 text-steel">timeline</h3>
            <ol className="relative ml-[56px] flex flex-col gap-3 border-l border-steel-line pl-4">
              {about.timeline.map((t) => (
                <li key={`${t.year}-${t.title}`} className="relative">
                  <span className="data absolute -left-[72px] top-0.5 w-12 text-right text-gold">{t.year}</span>
                  <span aria-hidden className="absolute top-2 -left-[calc(1rem+2px)] h-[3.5px] w-[3.5px] rotate-45 bg-gold" />
                  <p className="font-display text-[15px] leading-[22px] font-semibold text-fg">{t.title}</p>
                  <p className="text-[13px] leading-[20px] text-fg-dim">{t.note}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </m.div>
    </ModuleFrame>
  );
}
