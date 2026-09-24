"use client";

import { agents } from "@/content/content";
import ModuleFrame from "./ModuleFrame";
import ItemList from "./ItemList";
import ItemButton from "./ItemButton";
import ActivityGraph from "./ActivityGraph";
import StatusDot from "@/components/ui/StatusDot";
import Tag from "@/components/ui/Tag";

/** Live units: name, role, status, tools and an activity graph. */
export default function AgentsModule({ className = "" }: { className?: string }) {
  const online = agents.filter((a) => a.status === "online").length;
  return (
    <ModuleFrame id="agents" index="02" title="Agents" count={agents.length} status={`${online} online`} className={className}>
      <ItemList>
        {agents.map((a, i) => (
          <ItemButton key={a.id} itemId={a.id} className="p-3" aria-label={`${a.name}, ${a.role}, ${a.status}`}>
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="label text-gold">unit {String(i + 1).padStart(2, "0")}</span>
              <StatusDot status={a.status} />
            </div>
            <h3 className="font-display text-[16px] leading-[22px] font-semibold text-fg">{a.name}</h3>
            <p className="mt-0.5 text-[13px] leading-[20px] text-fg-dim">{a.role}</p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {a.tools.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
              <ActivityGraph seed={i + 1} live={a.status === "online"} />
            </div>
          </ItemButton>
        ))}
      </ItemList>
    </ModuleFrame>
  );
}
