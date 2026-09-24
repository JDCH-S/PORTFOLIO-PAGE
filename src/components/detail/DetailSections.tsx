"use client";

import type { Item } from "@/content/types";
import { agents } from "@/content/content";
import Tag from "@/components/ui/Tag";
import StatusDot from "@/components/ui/StatusDot";
import SystemDiagram from "@/components/modules/SystemDiagram";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 border-t border-steel-line pt-4 lg:grid-cols-[140px_1fr] lg:gap-6">
      <h3 className="label text-steel">{label}</h3>
      <div className="min-w-0 max-w-[68ch] text-[15px] leading-[24px] text-fg">{children}</div>
    </section>
  );
}

/** The body of the detail view, shared by the desktop overlay and the mobile sheet. */
export default function DetailSections({ item }: { item: Item }) {
  const code =
    item.category === "project" ? item.code : item.category === "agent" ? item.role : item.category === "skill" ? `v${item.version}` : `${item.nodes.length} nodes`;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="label flex flex-wrap items-center gap-3 text-gold">
          <span>{item.category}</span>
          <span className="text-steel-dim">·</span>
          <span className="text-steel">{code}</span>
          {item.category === "agent" ? <StatusDot status={item.status} /> : null}
        </div>
        <h2 id="detail-title" className="font-display text-h2 font-semibold tracking-[0.02em] text-gold-hot">
          {item.name}
        </h2>
        <p className="max-w-[68ch] text-[16px] leading-[26px] text-fg-dim">{item.tagline}</p>
      </header>

      <Section label="problem">{item.problem}</Section>
      {item.category === "skill" ? (
        <>
          <Section label="trigger">{item.trigger}</Section>
          <Section label="used by">
            {item.usedBy.map((id) => agents.find((a) => a.id === id)?.name ?? id).join(" · ")}
          </Section>
        </>
      ) : null}
      <Section label="what I built">{item.built}</Section>

      <Section label="architecture">
        {item.category === "system" ? (
          <div className="rounded-[2px] border border-steel-line bg-bg-2/60 p-2">
            <SystemDiagram system={item} height={220} />
            {item.architecture ? <p className="mt-2 text-[14px] leading-[22px] text-fg-dim">{item.architecture}</p> : null}
          </div>
        ) : (
          <p className={item.architecture ? "" : "text-fg-dim"}>{item.architecture ?? "Architecture notes to come."}</p>
        )}
      </Section>

      <Section label="stack">
        <div className="flex flex-wrap gap-1.5">
          {item.stack.map((s) => (
            <Tag key={s} tone="gold">
              {s}
            </Tag>
          ))}
          {item.category === "agent" || item.category === "skill"
            ? item.tools.map((t) => (
                <Tag key={`tool-${t}`}>{t}</Tag>
              ))
            : null}
        </div>
      </Section>

      <Section label="screenshots">
        {item.screenshots && item.screenshots.length > 0 ? (
          <ul className="grid grid-cols-2 gap-2">
            {item.screenshots.map((s) => (
              <li key={s.src} className="overflow-hidden rounded-[2px] border border-steel-line">
                {/* eslint-disable-next-line @next/next/no-img-element -- content images, sized by the grid */}
                <img src={s.src} alt={s.alt} loading="lazy" className="block h-auto w-full" />
              </li>
            ))}
          </ul>
        ) : (
          <div className="label flex h-24 items-center justify-center rounded-[2px] border border-dashed border-steel-line text-steel-dim">no captures yet</div>
        )}
      </Section>

      <Section label="links">
        {item.links.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {item.links.map((l) => (
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
        ) : (
          <p className="text-fg-dim">No public links.</p>
        )}
      </Section>

      <Section label="outcome">
        <p className="font-display text-[18px] leading-[26px] font-semibold text-gold-hot">{item.result}</p>
      </Section>
    </div>
  );
}
