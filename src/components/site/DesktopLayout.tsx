"use client";

import Header from "@/components/hud/Header";
import Telemetry from "@/components/hud/Telemetry";
import ProjectsModule from "@/components/modules/ProjectsModule";
import AgentsModule from "@/components/modules/AgentsModule";
import SystemsModule from "@/components/modules/SystemsModule";
import Beams from "./Beams";
import SphereSlot from "./SphereSlot";
import { useSiteStore } from "@/store/siteStore";

/** [Projects | core + Systems | Agents] with the header above and telemetry below. */
export default function DesktopLayout() {
  const open = useSiteStore((s) => s.view) === "modules";
  return (
    <div className="relative z-10 grid h-dvh grid-cols-[minmax(280px,1fr)_minmax(420px,1.35fr)_minmax(280px,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 p-5 xl:gap-6 xl:p-7">
      <Header className="col-span-3" />
      <ProjectsModule className="row-start-2 min-h-0" />
      <div className="row-start-2 grid min-h-0 grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4 xl:gap-6">
        <SphereSlot className="min-h-0" />
        <SystemsModule compact className="min-h-0" />
      </div>
      <AgentsModule className="col-start-3 row-start-2 min-h-0" />
      <footer
        className="col-span-3 flex items-center justify-between gap-6 border-t border-steel-line pt-3 transition-opacity duration-[480ms]"
        style={{ opacity: open ? 1 : 0.55 }}
      >
        <Telemetry />
        <p className="label hidden text-steel-dim md:block">{open ? "tab · enter · esc closes" : "enter opens the core"}</p>
      </footer>
      <Beams />
    </div>
  );
}
