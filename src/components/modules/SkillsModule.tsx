"use client";

import { agents, skills } from "@/content/content";
import ModuleFrame from "./ModuleFrame";
import ItemList from "./ItemList";
import ItemButton from "./ItemButton";
import Tag from "@/components/ui/Tag";

const agentName = (id: string) => agents.find((a) => a.id === id)?.name.replace(/^PLACEHOLDER · /, "") ?? id;

/** Reusable agent skills: packaged instructions plus the tools they wrap, and who loads them. */
export default function SkillsModule({ className = "" }: { className?: string; compact?: boolean }) {
  return (
    <ModuleFrame id="skills" index="03" title="Skills" count={skills.length} status="agent kit" className={className}>
      <ItemList>
        {skills.map((s) => (
          <ItemButton key={s.id} itemId={s.id} className="p-3">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="label text-gold">skill.md</span>
              <span className="label text-steel-dim">v{s.version}</span>
            </div>
            <h3 className="font-display text-[16px] leading-[22px] font-semibold text-fg">{s.name}</h3>
            <p className="mt-1 text-[14px] leading-[22px] text-fg-dim">{s.tagline}</p>
            <dl className="mt-3 grid grid-cols-[64px_1fr] gap-x-3 gap-y-1 text-[13px] leading-[20px]">
              <dt className="label text-steel">trigger</dt>
              <dd className="text-fg-dim">{s.trigger}</dd>
              <dt className="label text-steel">used by</dt>
              <dd className="text-fg-dim">{s.usedBy.map(agentName).join(" · ")}</dd>
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {s.tools.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          </ItemButton>
        ))}
      </ItemList>
    </ModuleFrame>
  );
}
