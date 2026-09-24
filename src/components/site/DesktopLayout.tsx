"use client";

import { modules } from "@/content/content";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import Header from "@/components/hud/Header";
import Telemetry from "@/components/hud/Telemetry";
import ProjectsModule from "@/components/modules/ProjectsModule";
import AgentsModule from "@/components/modules/AgentsModule";
import SystemsModule from "@/components/modules/SystemsModule";
import Beams from "./Beams";
import SphereSlot from "./SphereSlot";
import OptionNode from "./OptionNode";

const MODULE: Record<ModuleId, React.ComponentType<{ className?: string; compact?: boolean }>> = {
  projects: ProjectsModule,
  agents: AgentsModule,
  systems: SystemsModule,
};

/**
 * Desktop. Menu view: the sphere in the centre with the three options around it
 * (left, right, below). Module view: the sphere and the two other options in the
 * left column, the open module filling the right.
 */
export default function DesktopLayout() {
  const view = useSiteStore((s) => s.view);
  const active = useSiteStore((s) => s.activeModule);
  const hint = view === "core" ? "enter opens the core" : view === "menu" ? "choose a module · esc closes" : "tab · enter · esc goes back";
  const Active = MODULE[active];
  const [projects, agents, systems] = modules;

  return (
    <div className="relative z-10 grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] gap-4 p-5 xl:gap-6 xl:p-7">
      <Header />

      {view === "module" ? (
        <div className="grid min-h-0 grid-cols-[minmax(280px,1fr)_minmax(560px,2.2fr)] gap-4 xl:gap-6">
          <div className="grid min-h-0 grid-rows-[minmax(0,1.3fr)_auto] gap-4">
            <SphereSlot className="min-h-0" fill={0.86} />
            <div className="flex flex-col gap-2">
              {modules
                .filter((m) => m.id !== active)
                .map((m, i) => (
                  <OptionNode key={m.id} id={m.id} index={m.index} title={m.title} count={m.items.length} blurb={m.blurb} compact order={i} />
                ))}
            </div>
          </div>
          <Active key={active} className="min-h-0" />
        </div>
      ) : (
        <div className="grid min-h-0 grid-cols-[minmax(260px,1fr)_minmax(420px,1.5fr)_minmax(260px,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-4 xl:gap-6">
          <div className="flex min-h-0 items-center">
            <OptionNode id={projects.id} index={projects.index} title={projects.title} count={projects.items.length} blurb={projects.blurb} order={0} className="w-full" />
          </div>
          <SphereSlot className="min-h-0" fill={0.9} />
          <div className="flex min-h-0 items-center">
            <OptionNode id={agents.id} index={agents.index} title={agents.title} count={agents.items.length} blurb={agents.blurb} order={1} className="w-full" />
          </div>
          <div className="col-start-2 row-start-2 flex justify-center">
            <OptionNode id={systems.id} index={systems.index} title={systems.title} count={systems.items.length} blurb={systems.blurb} order={2} className="w-full max-w-[420px]" />
          </div>
        </div>
      )}

      <footer className="flex items-center justify-between gap-6 border-t border-steel-line pt-3 transition-opacity duration-[480ms]" style={{ opacity: view === "core" ? 0.55 : 1 }}>
        <Telemetry />
        <p className="label hidden text-steel-dim md:block">{hint}</p>
      </footer>
      <Beams />
    </div>
  );
}
