/**
 * The hologram worker: downloads and decodes the face maps once, then builds the hologram geometry for a tier and hands
 * the typed arrays back (transferred, no copies). The page releases it about 30 s after a build (loadHologram.ts).
 */
import { buildFaceGeometry } from "./builder";
import { loadFaceData, mapViews, type FaceDataset } from "./faceData";
import type { WorkerReply, WorkerRequest } from "./protocol";

let data: Promise<FaceDataset> | null = null;
let loadMs = 0;

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (msg: WorkerReply, transfer?: Transferable[]) => void;
};

ctx.onmessage = async (e) => {
  const req = e.data;
  try {
    if (req.dataset) data = Promise.resolve(req.dataset);
    if (!data) {
      const t0 = performance.now();
      data = loadFaceData(req.base).then((d) => {
        loadMs = performance.now() - t0;
        return d;
      });
    }
    const d = await data;
    if (req.type === "load") {
      ctx.postMessage({ type: "loaded", id: req.id, loadMs, bytes: d.bytes });
      return;
    }
    const t0 = performance.now();
    const out = buildFaceGeometry({
      width: d.width,
      height: d.height,
      meta: d.meta,
      world: d.world,
      maps: mapViews(d),
      depth: d.depth,
      tier: req.tier,
      seed: 7,
      view: { devPerCrop: req.devPerWorld * d.world.scale },
      params: req.params,
    });
    ctx.postMessage({ type: "built", id: req.id, out, meta: d.meta, world: d.world, loadMs, buildMs: performance.now() - t0, bytes: d.bytes }, out.transfer);
  } catch (err) {
    data = null;
    ctx.postMessage({ type: "error", id: req.id, error: String((err as Error)?.stack || err) });
  }
};
