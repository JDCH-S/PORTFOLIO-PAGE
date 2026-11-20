"use client";

import { sections } from "@/content/content";
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
import { rovingKeys } from "@/lib/roving";
import { navLink, up } from "@/lib/nav";

const MODULE: Record<ModuleId, React.ComponentType<{ className?: string; compact?: boolean }>> = {
  projects: ProjectsModule,
  agents: AgentsModule,
  skills: SkillsModule,
  systems: SystemsModule,
  about: AboutModule,
};

const HINT = {
  core: "click the sphere or press enter",
  menu: "pick a section · click the sphere or press esc to close",
  module: "← → next section · esc all sections",
} as const;

/**
 * Desktop. Home and sections: the sphere in the centre (the sections hang off its rim as
 * callouts, rendered by Site). A section: the sphere in the left column with all five
 * sections on a spine under it (the open one lit), the section itself on the right.
 */
export default function DesktopLayout() {
  const view = useSiteStore((s) => s.view);
  const step = useSiteStore((s) => s.step);
  const active = useSiteStore((s) => s.activeModule);
  // pointing at the parked sphere lights "all sections": that is what a click on it does
  const sphereHover = useSiteStore((s) => s.hover === "core");
  const Active = MODULE[active];

  return (
    <div className="relative z-10 grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] gap-4 p-5 xl:gap-6 xl:p-7">
      <Header />

      <main id="content" className="grid min-h-0">
        {view === "module" ? (
          <div className="grid min-h-0 grid-cols-[minmax(280px,1fr)_minmax(560px,2.2fr)] gap-4 xl:gap-6">
            <div className="grid min-h-0 grid-rows-[minmax(0,1.2fr)_auto] gap-2">
              <SphereSlot className="min-h-0" fill={0.84} />
              <nav aria-label="Sections" onKeyDown={rovingKeys("[data-option], [data-up]")} className="relative mx-auto flex w-full max-w-[440px] flex-col pt-2 pb-1">
                {/* spine: down from the sphere, through the head and every section */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -top-10 bottom-[22px] left-1/2 w-px bg-gradient-to-b from-transparent via-gold-line to-gold-line transition-opacity duration-[480ms]"
                  style={{ opacity: step >= 4 ? 1 : 0 }}
                />
                <a
                  {...navLink({ depth: 1 }, up)}
                  data-up
                  className={`group grid min-h-11 grid-cols-[1fr_auto_1fr] items-center gap-3 outline-none transition-opacity duration-[480ms] ${step >= 4 ? "opacity-100" : "opacity-0"}`}
                >
                  <span aria-hidden className="label text-right text-steel-dim">esc</span>
                  <span aria-hidden className={`h-[7px] w-[7px] rounded-full border transition-colors duration-[240ms] ${sphereHover ? "border-gold-hot bg-gold-hot/30" : "border-gold-line bg-bg group-hover:border-gold-hot group-focus-visible:border-gold-hot"}`} />
                  <span className="relative justify-self-start">
                    <span className={`label transition-colors duration-[240ms] ${sphereHover ? "text-gold-hot" : "text-steel group-hover:text-gold-hot group-focus-visible:text-gold-hot"}`}>
                      <span aria-hidden>‹ </span>all sections
                    </span>
                    <span
                      aria-hidden
                      className={`absolute -bottom-1 left-0 h-px w-full bg-gold transition-opacity duration-[240ms] ${sphereHover ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}
                    />
                  </span>
                </a>
                {sections.map((m, i) => (
                  <OptionRow key={m.id} layout="spine" id={m.id} index={m.index} title={m.title} count={m.count} order={i} current={m.id === active} />
                ))}
              </nav>
            </div>
            <Active key={active} className="min-h-0" />
          </div>
        ) : (
          <SphereSlot className="min-h-0" fill={view === "menu" ? 0.72 : 0.9} />
        )}
      </main>

      <footer className="flex items-center justify-between gap-6 border-t border-steel-line pt-3">
        <Telemetry />
        <p className="label hidden whitespace-nowrap text-steel min-[1200px]:block">{HINT[view]}</p>
      </footer>
      <Beams />
    </div>
  );
}
