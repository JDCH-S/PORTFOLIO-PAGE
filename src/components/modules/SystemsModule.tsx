"use client";

import { systems } from "@/content/content";
import ModuleFrame from "./ModuleFrame";
import ItemList from "./ItemList";
import ItemButton from "./ItemButton";
import SystemDiagram from "./SystemDiagram";
import Tag from "@/components/ui/Tag";

/** Architecture diagrams with animated flow lines. */
export default function SystemsModule({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <ModuleFrame id="systems" index="03" title="Systems" count={systems.length} status="architecture" className={className}>
      <ItemList className={compact ? "" : "lg:grid lg:grid-cols-2 lg:gap-3"}>
        {systems.map((s) => (
          <ItemButton key={s.id} itemId={s.id} className="p-3">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h3 className="font-display text-[16px] leading-[22px] font-semibold text-fg">{s.name}</h3>
              <span className="label text-steel-dim">{s.nodes.length} nodes</span>
            </div>
            <p className="text-[13px] leading-[20px] text-fg-dim">{s.tagline}</p>
            <div className="mt-2 rounded-[2px] border border-steel-line bg-bg-2/60 p-1">
              <SystemDiagram system={s} height={compact ? 120 : 140} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.stack.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          </ItemButton>
        ))}
      </ItemList>
    </ModuleFrame>
  );
}
