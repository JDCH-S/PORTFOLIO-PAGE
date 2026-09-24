"use client";

import { agents, skills } from "@/content/content";
import ModuleFrame from "./ModuleFrame";
import ItemList from "./ItemList";
import ItemButton from "./ItemButton";

const agentName = (id: string) => agents.find((a) => a.id === id)?.name.replace(/^PLACEHOLDER · /, "") ?? id;

/** Reusable agent skills, each rendered like the front matter of its skill file. */
export default function SkillsModule({ className = "" }: { className?: string; compact?: boolean }) {
  return (
    <ModuleFrame id="skills" index="03" title="Skills" count={skills.length} status="agent kit" className={className}>
      <ItemList>
        {skills.map((s) => {
          const rows: [string, string][] = [
            ["name", s.name.replace(/^PLACEHOLDER · /, "")],
            ["trigger", s.trigger],
            ["tools", s.tools.join(" · ")],
            ["used-by", s.usedBy.map(agentName).join(" · ")],
          ];
          return (
            <ItemButton key={s.id} itemId={s.id} className="p-3">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="label text-gold">skill.md</span>
                <span className="data text-steel-dim">v{s.version}</span>
              </div>
              <h3 className="font-display text-[16px] leading-[22px] font-semibold text-fg">{s.name}</h3>
              <p className="mt-1 text-[14px] leading-[22px] text-fg-dim">{s.tagline}</p>
              <dl className="my-3 grid grid-cols-[24px_76px_1fr] gap-x-3 gap-y-1 border-y border-steel-line py-2">
                {rows.map(([k, v], i) => (
                  <div key={k} className="contents">
                    <span aria-hidden className="data text-steel-dim/60">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <dt className="data text-steel">{k}:</dt>
                    <dd className="data text-fg-dim">{v}</dd>
                  </div>
                ))}
              </dl>
            </ItemButton>
          );
        })}
      </ItemList>
    </ModuleFrame>
  );
}
