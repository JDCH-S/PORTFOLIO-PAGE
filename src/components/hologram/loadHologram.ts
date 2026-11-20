/**
 * Page side of the hologram build: one worker per page, the maps fetched and decoded there, the geometry built there
 * and transferred back. Falls back to the main thread when workers are unavailable, fail or hang (the build then
 * blocks for about a second, but the head still appears).
 */
import { buildFaceGeometry, type BuildOutput, type FaceMeta, type FaceWorld, type HoloTier } from "./builder";
import { HOLO_DATA_PATH } from "./config";
import { createHologramWorker } from "./createWorker";
import { datasetTransfer, loadFaceData, mapViews, type FaceDataset } from "./faceData";
import type { WorkerReply, WorkerRequest } from "./protocol";

export interface BuiltHologram {
  out: BuildOutput;
  meta: FaceMeta;
  world: FaceWorld;
  where: "worker" | "main";
  loadMs: number;
  buildMs: number;
  /** wall time of this request, page side */
  wallMs: number;
  /** bytes downloaded for the maps + meta */
  bytes: number;
}

type Pending = { resolve: (r: WorkerReply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/** a worker request that has not answered by then is treated as a dead worker (e.g. killed for memory on a phone) */
const ASK_TIMEOUT_MS = 20000;
/** the worker holds ~20 MB of decoded maps: released this long after a successful build (a later rebuild re-decodes from the HTTP cache) */
const IDLE_RELEASE_MS = 30000;
/** ...and this long after the scene unmounts (short, so React's development double effects or a quick remount keep it) */
const UNMOUNT_RELEASE_MS = 4000;

let worker: Worker | null = null;
let workerBroken = false;
let datasetSent = false;
let seq = 0;
const pending = new Map<number, Pending>();
let mainData: Promise<FaceDataset> | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
/** identical requests in flight share one build (StrictMode's double effects, a remount during a build) */
const inflight = new Map<string, Promise<BuiltHologram>>();

class Cancelled extends Error {}
/** the worker itself is gone or unusable (failed to start, crashed, hung): build on the main thread from now on */
class WorkerFault extends Error {}

/** Debug overrides for the builder and the shaders: ?holo.<name>=<value> (e.g. ?holo.gain=1.2, ?holo.worker=0). */
export function holoParams(): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof window === "undefined") return out;
  new URLSearchParams(window.location.search).forEach((v, k) => {
    if (k.startsWith("holo.")) out[k.slice(5)] = v;
  });
  return out;
}

function dataBase() {
  return new URL(HOLO_DATA_PATH, window.location.href).href;
}

function failAll(err: Error) {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(err);
  }
  pending.clear();
}

function settle(id: number): Pending | undefined {
  const p = pending.get(id);
  if (!p) return undefined;
  pending.delete(id);
  clearTimeout(p.timer);
  return p;
}

/** a dead worker: never used again this session, its pending requests fail over to the main thread */
function breakWorker(w: Worker, err: Error) {
  workerBroken = true;
  w.terminate();
  if (worker === w) {
    worker = null;
    datasetSent = false;
  }
  failAll(err);
}

function cancelRelease() {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
}

function scheduleRelease(ms: number) {
  cancelRelease();
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (pending.size > 0) return; // a build is running: its own completion schedules the next release
    terminate();
    mainData = null;
  }, ms);
}

function getWorker(): Worker | null {
  cancelRelease();
  if (workerBroken || typeof Worker === "undefined" || holoParams().worker === "0") return null;
  if (worker) return worker;
  try {
    const w = createHologramWorker();
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const p = settle(e.data.id);
      if (!p) return;
      // an error the worker reports (a 404, an undecodable map) is about the data, not the worker: it stays usable
      if (e.data.type === "error") p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
    w.onmessageerror = () => breakWorker(w, new WorkerFault("hologram worker reply could not be deserialised"));
    w.onerror = (e) => {
      e.preventDefault?.();
      breakWorker(w, new WorkerFault(e.message || "hologram worker failed to start"));
    };
    worker = w;
  } catch (err) {
    console.warn("[hologram] no worker, building on the main thread", err);
    workerBroken = true;
    return null;
  }
  return worker;
}

async function ask(w: Worker, req: Omit<WorkerRequest, "id" | "base" | "dataset">): Promise<WorkerReply> {
  let dataset: FaceDataset | undefined;
  // browsers whose workers cannot decode images (no OffscreenCanvas) decode here once and hand the maps over
  if (!datasetSent && typeof OffscreenCanvas === "undefined") {
    dataset = await loadFaceData(dataBase());
    datasetSent = true;
  }
  const id = ++seq;
  return new Promise<WorkerReply>((resolve, reject) => {
    // a worker that was killed silently (no error event) or stalls would otherwise leave the head unbuilt for good
    const timer = setTimeout(() => {
      if (pending.has(id)) breakWorker(w, new WorkerFault(`hologram worker did not answer within ${ASK_TIMEOUT_MS / 1000} s`));
    }, ASK_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    const msg: WorkerRequest = { ...req, id, base: dataBase(), dataset };
    w.postMessage(msg, dataset ? datasetTransfer(dataset) : []);
  });
}

/** Start downloading and decoding the maps before the scene asks for geometry. */
export function prefetchHologram(tier: HoloTier) {
  const w = getWorker();
  if (!w || typeof OffscreenCanvas === "undefined") return;
  ask(w, { type: "load", tier, devPerWorld: 1, params: {} }).catch(() => {});
}

async function buildMain(opts: { tier: HoloTier; devPerWorld: number }, params: Record<string, string>, t0: number): Promise<BuiltHologram> {
  const tl = performance.now();
  if (!mainData) mainData = loadFaceData(dataBase());
  let d: FaceDataset;
  try {
    d = await mainData;
  } catch (err) {
    mainData = null;
    throw err;
  }
  const loadMs = performance.now() - tl;
  const tb = performance.now();
  const out = buildFaceGeometry({ width: d.width, height: d.height, meta: d.meta, world: d.world, maps: mapViews(d), depth: d.depth, tier: opts.tier, seed: 7, view: { devPerCrop: opts.devPerWorld * d.world.scale }, params });
  return { out, meta: d.meta, world: d.world, where: "main", loadMs, buildMs: performance.now() - tb, wallMs: performance.now() - t0, bytes: d.bytes };
}

async function build(opts: { tier: HoloTier; devPerWorld: number }, params: Record<string, string>): Promise<BuiltHologram> {
  const t0 = performance.now();
  const w = getWorker();
  if (w) {
    try {
      const r = await ask(w, { type: "build", tier: opts.tier, devPerWorld: opts.devPerWorld, params });
      if (r.type === "built") {
        scheduleRelease(IDLE_RELEASE_MS);
        return { out: r.out, meta: r.meta, world: r.world, where: "worker", loadMs: r.loadMs, buildMs: r.buildMs, wallMs: performance.now() - t0, bytes: r.bytes };
      }
    } catch (err) {
      if (err instanceof Cancelled) throw err;
      // a dead worker is never asked again; a data error keeps the worker and is retried here once (a decode the
      // worker cannot do may still work on the main thread; a real 404 fails again and reaches the caller)
      console.warn(`[hologram] worker build failed${err instanceof WorkerFault ? "" : " (data)"}, building on the main thread`, err);
    }
  }
  const b = await buildMain(opts, params, t0);
  // the main-thread copy of the maps (~20 MB decoded) is only kept for a quick rebuild
  scheduleRelease(IDLE_RELEASE_MS);
  return b;
}

export function buildHologram(opts: { tier: HoloTier; devPerWorld: number; params?: Record<string, string> }): Promise<BuiltHologram> {
  const params = opts.params ?? holoParams();
  const key = JSON.stringify([opts.tier, opts.devPerWorld, params]);
  const hit = inflight.get(key);
  if (hit) return hit;
  const p = build(opts, params).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function terminate() {
  failAll(new Cancelled("hologram worker released"));
  worker?.terminate();
  worker = null;
  datasetSent = false;
}

/** Called when the scene unmounts: frees the worker (and its decoded maps) shortly after. */
export function releaseHologramWorker() {
  scheduleRelease(UNMOUNT_RELEASE_MS);
}

/** true for the rejection of a build whose worker was released (the scene unmounted): not an error */
export function isCancelled(err: unknown) {
  return err instanceof Cancelled;
}
