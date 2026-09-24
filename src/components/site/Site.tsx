"use client";

import { useSyncExternalStore } from "react";
import SphereStage from "@/components/sphere/SphereStage";
import Grid from "@/components/hud/Grid";
import DetailView from "@/components/detail/DetailView";
import { useIsDesktop, useReducedMotion } from "@/lib/useMediaQuery";
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
  return (
    <div className="relative">
      <Grid />
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
        <SphereStage />
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
    </div>
  );
}
