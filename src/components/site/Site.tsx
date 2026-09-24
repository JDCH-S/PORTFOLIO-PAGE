"use client";

import { useSyncExternalStore } from "react";
import SphereStage from "@/components/sphere/SphereStage";
import Grid from "@/components/hud/Grid";
import DetailView from "@/components/detail/DetailView";
import { useIsDesktop, useReducedMotion } from "@/lib/useMediaQuery";
import { useSiteStore } from "@/store/siteStore";
import IntroSequence from "./IntroSequence";
import SphereLean from "./SphereLean";
import FragmentStream from "./FragmentStream";
import DesktopLayout from "./DesktopLayout";
import MobileLayout from "./MobileLayout";

const noop = () => () => {};

/** Client root: the sphere as a fixed layer, the HUD ground, the intro, and the layout for the viewport. */
export default function Site() {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const isDesktop = useIsDesktop();
  const reduced = useReducedMotion();
  const detail = useSiteStore((s) => s.phase) === "detail";
  return (
    <main className="relative">
      <Grid />
      {/* the sphere layer rises above the detail backdrop so the parked sphere stays lit */}
      <div className={`pointer-events-none fixed inset-0 mix-blend-screen ${detail ? "z-[55]" : "z-0"}`} aria-hidden>
        <SphereStage blend={false} />
      </div>
      {mounted ? (
        <>
          <IntroSequence desktop={isDesktop} reduced={reduced} />
          <SphereLean />
          <FragmentStream />
          {isDesktop ? <DesktopLayout /> : <MobileLayout />}
          <DetailView />
        </>
      ) : null}
    </main>
  );
}
