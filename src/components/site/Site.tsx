"use client";

import { useSyncExternalStore } from "react";
import { LazyMotion, MotionConfig } from "framer-motion";
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
import Emergence from "./Emergence";
import CoreButton from "./CoreButton";
import BootHeader from "./BootHeader";

const noop = () => () => {};
// the animation engine (with drag + layout) loads after the first paint; `m` components render statically until then
const loadFeatures = () => import("framer-motion").then((mod) => mod.domMax);

/** Client root: the sphere as a fixed layer, the HUD ground, the intro, and the layout for the viewport. */
export default function Site() {
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const isDesktop = useIsDesktop();
  const reduced = useReducedMotion();
  const view = useSiteStore((s) => s.view);
  // while an item is open the parked sphere rises above the detail backdrop (corner on desktop, header emblem on mobile);
  // on a phone the sphere also passes over the sticky header while it docks into the emblem
  const phase = useSiteStore((s) => s.phase);
  const detail = phase === "detail";
  const layer = detail ? "z-[55]" : !isDesktop && view === "module" ? "z-[25]" : "z-0";
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">
        <main className="relative">
          <Grid />
          {/* the renderer gives its canvas pointer-events: auto inline; nothing in this layer may take a tap */}
          <div className={`pointer-events-none fixed inset-0 mix-blend-screen [&_*]:pointer-events-none! ${layer}`} aria-hidden>
            <SphereStage blend={false} />
          </div>
          {/* server-rendered name so the largest text paints before any JavaScript */}
          {!mounted ? <BootHeader /> : null}
          {mounted ? (
            <>
              <IntroSequence desktop={isDesktop} reduced={reduced} />
              <Emergence desktop={isDesktop} />
              <SphereLean />
              <FragmentStream />
              <CoreButton coarse={!isDesktop} />
              {/* the page is inert during the load sequence and while the detail dialog is open */}
              <div inert={phase !== "idle"}>{isDesktop ? <DesktopLayout /> : <MobileLayout />}</div>
              <DetailView />
            </>
          ) : null}
        </main>
      </MotionConfig>
    </LazyMotion>
  );
}
