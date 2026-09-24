"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { detectCapabilities, tierOverrideFromUrl, type Capabilities } from "@/lib/tier";
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

export default function SphereStage({ debug = false, className }: SphereStageProps) {
  const [caps, setCaps] = useState<Capabilities | null>(null);

  useEffect(() => {
    const detected = detectCapabilities();
    const override = tierOverrideFromUrl();
    setCaps(override ? { ...detected, tier: override } : detected);
  }, []);

  // Before hydration / detection: show the static emblem so there is never a blank hero.
  if (!caps) return <StaticSphere loading className={className} />;
  if (caps.tier === "static") return <StaticSphere className={className} />;

  return <SphereScene tier={caps.tier} coarsePointer={caps.coarsePointer} dpr={caps.dpr} debug={debug} className={className} />;
}
