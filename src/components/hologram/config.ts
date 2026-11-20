/**
 * Constants of the face hologram that the scene, the rig and the loader share.
 */
import type { HoloTier } from "./builder";

/** warm gold, hot highlight, deep amber (the sphere's palette, kept) */
export const HOLO_PALETTE = { base: "#ffb23f", hot: "#ffecc8", deep: "#ff6a00" } as const;

/** Where the shipped maps live (public/hologram, written by scripts/hologram/pack_maps.py). */
export const HOLO_DATA_PATH = "/hologram/";

/** Head height (top of hair to the end of the neck fade) as it appears, in world units: the head fills the unit circle. */
export const HEAD_HEIGHT = 1.8;
/** Where the rig's pivot (world z = 0) sits in the depth range: 0 = silhouette plane, 1 = nose tip. */
export const PIVOT_DEPTH = 0.3;
/** Scene camera: fov 40, radius 1 fills 72 % of the limiting viewport side on desktops (see CameraFit). */
export const SCENE_FOV = 40;
export const HERO_FILL = 0.72;
export const HERO_FILL_PORTRAIT = 0.88;
/** The perspective compensation of the data is computed for the desktop hero camera distance. */
export const HERO_CAM_DIST = 1 / (HERO_FILL * Math.tan((SCENE_FOV * Math.PI) / 360));

/** Fill of the unit circle for a viewport: the same rule as CameraFit, SphereFraming and useSpinDrag. */
export function fillFor(width: number, height: number) {
  return width / Math.max(1, height) < 0.8 ? HERO_FILL_PORTRAIT : HERO_FILL;
}

/** Motion contract: a front half-shell head can only turn so far. Radians. */
export const DEG = Math.PI / 180;
export const YAW_LIMIT = 55 * DEG;
export const PITCH_LIMIT = 25 * DEG;
/** Where the rubber band starts to resist (fraction of the limit). */
export const SOFT_START = 0.7;
/** Idle sway: yaw 6 deg * sin(0.35 t), pitch 2.5 deg * sin(0.27 t). */
export const SWAY = { yaw: 6 * DEG, yawRate: 0.35, pitch: 2.5 * DEG, pitchRate: 0.27 } as const;

export type { HoloTier };
