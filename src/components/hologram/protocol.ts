import type { BuildOutput, FaceMeta, FaceWorld, HoloTier } from "./builder";
import type { FaceDataset } from "./faceData";

/** Messages between the page and the hologram worker. */
export interface WorkerRequest {
  type: "load" | "build";
  id: number;
  /** absolute URL of the data directory (a worker made from a Blob URL cannot resolve relative ones) */
  base: string;
  tier: HoloTier;
  /** device px per world unit at the hero size (the worker turns it into px per crop px) */
  devPerWorld: number;
  params: Record<string, string>;
  /** maps decoded on the main thread, for browsers whose workers cannot decode images */
  dataset?: FaceDataset;
}

export type WorkerReply =
  | { type: "loaded"; id: number; loadMs: number; bytes: number }
  | { type: "built"; id: number; out: BuildOutput; meta: FaceMeta; world: FaceWorld; loadMs: number; buildMs: number; bytes: number }
  | { type: "error"; id: number; error: string };
