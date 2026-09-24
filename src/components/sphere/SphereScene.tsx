"use client";

import type { QualityTier } from "@/lib/tier";

export interface SphereSceneProps {
  tier: Exclude<QualityTier, "static">;
  coarsePointer: boolean;
  dpr: number;
  debug?: boolean;
  className?: string;
}

// Placeholder until the sphere implementation lands (replaced in the next step).
export default function SphereScene({ tier, className = "" }: SphereSceneProps) {
  return <div className={`absolute inset-0 ${className}`} data-tier={tier} />;
}
