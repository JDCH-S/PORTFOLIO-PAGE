"use client";

import { projects } from "@/content/content";
import ModuleFrame from "./ModuleFrame";
import ItemList from "./ItemList";
import ItemButton from "./ItemButton";
import Tag from "@/components/ui/Tag";

/** Mission-file cards. */
export default function ProjectsModule({ className = "" }: { className?: string }) {
  return (
    <ModuleFrame id="projects" index="01" title="Projects" count={projects.length} status="mission files" className={className}>
      <ItemList>
        {projects.map((p) => (
          <ItemButton key={p.id} itemId={p.id} className="p-3" aria-label={`${p.code} ${p.name}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="label text-gold">{p.code}</span>
              <span className="label text-steel-dim">mission file</span>
            </div>
            <h3 className="font-display text-[16px] leading-[22px] font-semibold text-fg">{p.name}</h3>
            <p className="mt-1 text-[14px] leading-[22px] text-fg-dim">{p.tagline}</p>
            <dl className="mt-3 grid grid-cols-[64px_1fr] gap-x-3 gap-y-1 text-[13px] leading-[20px]">
              <dt className="label text-steel">problem</dt>
              <dd className="text-fg-dim">{p.problem}</dd>
              <dt className="label text-steel">built</dt>
              <dd className="text-fg-dim">{p.built}</dd>
              <dt className="label text-steel">result</dt>
              <dd className="text-gold-hot">{p.result}</dd>
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.stack.map((s) => (
                <Tag key={s}>{s}</Tag>
              ))}
            </div>
          </ItemButton>
        ))}
      </ItemList>
    </ModuleFrame>
  );
}
