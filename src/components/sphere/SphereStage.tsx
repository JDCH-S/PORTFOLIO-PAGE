"use client";

import dynamic from "next/dynamic";
import { useMemo, useSyncExternalStore } from "react";
import { detectCapabilities, tierOverrideFromUrl } from "@/lib/tier";
import StaticSphere from "./StaticSphere";

// The 3D scene is client-only and lazy: the page is usable before it loads.
const SphereScene = dynamic(() => import("./SphereScene"), {
  ssr: false,
  loading: () => <StaticSphere loading />,
});

export interface SphereStageProps {
  /** Show the leva tweak panel (Phase 1 review). */
  debug?: boolean;
  className?: string;
}

const noopSubscribe = () => () => {};

export default function SphereStage({ debug = false, className }: SphereStageProps) {
  // false during SSR and hydration, true once mounted on the client
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const caps = useMemo(() => {
    if (!mounted) return null;
    const detected = detectCapabilities();
    const override = tierOverrideFromUrl();
    return override ? { ...detected, tier: override } : detected;
  }, [mounted]);

  // Before hydration / detection: show the static emblem so there is never a blank hero.
  if (!caps) return <StaticSphere loading className={className} />;
  if (caps.tier === "static") return <StaticSphere className={className} />;

  return <SphereScene tier={caps.tier} coarsePointer={caps.coarsePointer} dpr={caps.dpr} debug={debug} className={className} />;
}
