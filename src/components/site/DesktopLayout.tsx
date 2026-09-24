"use client";

import { aboutEntry, modules } from "@/content/content";
import type { ModuleId } from "@/content/types";
import { useSiteStore } from "@/store/siteStore";
import Header from "@/components/hud/Header";
import Telemetry from "@/components/hud/Telemetry";
import ProjectsModule from "@/components/modules/ProjectsModule";
import AgentsModule from "@/components/modules/AgentsModule";
import SkillsModule from "@/components/modules/SkillsModule";
import SystemsModule from "@/components/modules/SystemsModule";
import AboutModule from "@/components/modules/AboutModule";
import Beams from "./Beams";
import SphereSlot from "./SphereSlot";
import OptionRow from "./OptionRow";
import MenuCallouts from "./MenuCallouts";

const MODULE: Record<ModuleId, React.ComponentType<{ className?: string; compact?: boolean }>> = {
  projects: ProjectsModule,
  agents: AgentsModule,
  skills: SkillsModule,
  systems: SystemsModule,
  about: AboutModule,
};

/**
 * Desktop. Core and menu: the sphere in the centre (the menu's callouts hang off its rim).
 * Module: the sphere and the other options in the left column, the open module on the right.
 */
export default function DesktopLayout() {
  const view = useSiteStore((s) => s.view);
  const active = useSiteStore((s) => s.activeModule);
  const hint = view === "core" ? "enter opens the core" : view === "menu" ? "choose a module · esc closes" : "tab · enter · esc goes back";
  const Active = MODULE[active];
  const others = [...modules.map((m) => ({ id: m.id as ModuleId, index: m.index, title: m.title, count: m.items.length })), { id: aboutEntry.id as ModuleId, index: aboutEntry.index, title: aboutEntry.title, count: undefined }].filter(
    (m) => m.id !== active,
  );

  return (
    <div className="relative z-10 grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] gap-4 p-5 xl:gap-6 xl:p-7">
      <Header />

      {view === "module" ? (
        <div className="grid min-h-0 grid-cols-[minmax(280px,1fr)_minmax(560px,2.2fr)] gap-4 xl:gap-6">
          <div className="grid min-h-0 grid-rows-[minmax(0,1.2fr)_auto] gap-4">
            <SphereSlot className="min-h-0" fill={0.84} />
            <nav aria-label="Other modules" className="flex flex-col gap-1 pb-1">
              {others.map((m, i) => (
                <OptionRow key={m.id} id={m.id} index={m.index} title={m.title} count={m.count} order={i} muted={m.id === "about"} />
              ))}
            </nav>
          </div>
          <Active key={active} className="min-h-0" />
        </div>
      ) : (
        <SphereSlot className="min-h-0" fill={view === "menu" ? 0.72 : 0.9} />
      )}

      <footer className="flex items-center justify-between gap-6 border-t border-steel-line pt-3 transition-opacity duration-[480ms]" style={{ opacity: view === "core" ? 0.55 : 1 }}>
        <Telemetry />
        <p className="label hidden text-steel-dim md:block">{hint}</p>
      </footer>
      <Beams />
      <MenuCallouts />
    </div>
  );
}
