"use client";

import { motion } from "framer-motion";
import { about, profile } from "@/content/content";
import { useSiteStore } from "@/store/siteStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import ModuleFrame from "./ModuleFrame";

const initials = profile.name
  .split(/\s+/)
  .map((w) => w[0])
  .slice(0, 3)
  .join("");

/** About: who is behind the core. Bio, facts, timeline and links; no items to open. */
export default function AboutModule({ className = "" }: { className?: string; compact?: boolean }) {
  const step = useSiteStore((s) => s.step);
  const reduced = useReducedMotion();
  const shown = step >= 6;
  return (
    <ModuleFrame id="about" index="05" title="About" status={profile.availability} className={className}>
      <motion.div
        initial={false}
        animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
        transition={{ duration: reduced ? 0.2 : 0.4, ease: [0.2, 0.8, 0.2, 1] }}
        className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]"
      >
        {/* identity card */}
        <div className="flex flex-col gap-4">
          <div className="relative aspect-square w-full max-w-[220px] overflow-hidden rounded-[2px] border border-gold-line bg-bg-2">
            {about.photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- content image
              <img src={about.photo} alt={profile.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <span className="font-display text-[40px] font-semibold tracking-[0.1em] text-gold">{initials}</span>
              </div>
            )}
            <span aria-hidden className="label absolute right-2 bottom-2 text-steel-dim">
              id · {profile.name.split(" ")[0].toLowerCase()}
            </span>
          </div>
          <dl className="grid grid-cols-[104px_1fr] gap-x-3 gap-y-1.5 text-[13px] leading-[20px]">
            {about.facts.map((f) => (
              <div key={f.label} className="contents">
                <dt className="label text-steel">{f.label}</dt>
                <dd className="text-fg">{f.value}</dd>
              </div>
            ))}
          </dl>
          <ul className="flex flex-wrap gap-2">
            {profile.links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  className="label inline-flex h-11 items-center gap-2 rounded-[2px] border border-gold-line px-3 text-gold transition-colors hover:border-gold hover:text-gold-hot"
                >
                  {l.label} <span aria-hidden>↗</span>
                </a>
              </li>
            ))}
          </ul>
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
            <ol className="flex flex-col gap-3">
              {about.timeline.map((t) => (
                <li key={`${t.year}-${t.title}`} className="grid grid-cols-[56px_1fr] gap-3">
                  <span className="data pt-0.5 text-gold">{t.year}</span>
                  <div>
                    <p className="font-display text-[15px] leading-[22px] font-semibold text-fg">{t.title}</p>
                    <p className="text-[13px] leading-[20px] text-fg-dim">{t.note}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </motion.div>
    </ModuleFrame>
  );
}
