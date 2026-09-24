/**
 * The trained segmenter, run where the upload is: in the browser.
 *
 * WHY THIS REPLACED THE SCREEN. The upload path used to outline the largest
 * dark region an Otsu cut could find (`ingest.ts`, `extractRibbon`). On the
 * Part I scenes it outlined the sea: over 24 validation scenes the release
 * model, run through `backend/detect/yolo_lsk/infer.py`, marked oil with median
 * precision .915 and IoU .769 against the ground-truth masks, and the screen
 * with precision .045 and IoU .045. A threshold cannot tell a slick from a
 * patch of calmer water; a model trained on thousands of labelled slicks can.
 *
 * WHAT THIS IS. `weights/L1-ciou-research.pt` exported to ONNX by
 * `ml/export/onnx_export.py`, which checks the export against PyTorch before
 * writing it, run by `onnxruntime-web`. Everything around the network follows
 * `infer_scene` and ultralytics exactly, because a browser port that drifts
 * from the Python pipeline is a different detector wearing the same name:
 *
 *  - 1024 tiles, 10% overlap, both edges covered (`backend/ingest/sar/tiling.py`)
 *  - letterbox to the input size, pad 114, /255 (ultralytics `LetterBox`)
 *  - candidates over the release confidence, greedy NMS at its IoU
 *  - masks at NATIVE resolution: prototype logits upsampled bilinearly
 *    (align_corners false), cut at logit 0, cropped to the box -- ultralytics
 *    `process_mask_native`, which is what `retina_masks: true` selects
 *  - every tile's masks unioned into one scene mask, which is what the seam
 *    merge in `infer_scene` produces once its polygons are rasterised
 *
 * WHAT IT IS NOT. One class, `slick`, research-only. It outlines slick-like
 * regions; it cannot say whether a slick is oil or a natural film, and on the
 * consumed held-out test it scored mAP50 .364 with small-instance recall .11
 * (ISSUES.md Q1, Q4). The console classes its output `slick_unknown`.
 */

export interface SegmenterManifest {
  name: string;
  classes: string[];
  status: string;
  file: string;
  sha256: string;
  input: { size: number; channels: number; scale: number; pad_value: number };
  inference: { conf: number; iou: number; max_det: number };
  tiling: { tile_size: number; overlap: number };
}

/** The slice of an onnxruntime session this module needs. */
export interface SessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown; dims: readonly number[] }>>;
}
export type TensorFactory = (data: Float32Array, dims: number[]) => unknown;

export interface Segmenter {
  manifest: SegmenterManifest;
  session: SessionLike;
  tensor: TensorFactory;
  /** Which onnxruntime backend actually ran, for the panel to state. */
  backend: string;
}

export interface Detection {
  /** Box in scene pixels, xyxy. */
  box: [number, number, number, number];
  score: number;
  /** Mask pixels this detection contributed, before the union. */
  pixels: number;
}

export interface Segmentation {
  /** 1 where any detection's mask covers the pixel, scene resolution. */
  mask: Uint8Array;
  width: number;
  height: number;
  /** Per-tile detections, before seams are merged. */
  detections: Detection[];
  tiles: number;
  ms: number;
}

/** Tile origins along one axis. `backend/ingest/sar/tiling.py` `_starts`. */
export function tileStarts(length: number, tile: number, stride: number): number[] {
  if (length <= tile) return [0];
  const starts: number[] = [];
  for (let s = 0; s <= length - tile; s += stride) starts.push(s);
  const last = length - tile;
  if (starts[starts.length - 1] !== last) starts.push(last);
  return starts;
}

export interface Letterboxed {
  input: Float32Array;
  /** Scale from tile pixels to input pixels. */
  gain: number;
  padLeft: number;
  padTop: number;
}

/**
 * One tile of an RGBA scene as the network's CHW float input.
 *
 * ultralytics `LetterBox` with a fixed shape: scale so the long side fits
 * (upscaling allowed, as at predict time), centre it, pad with 114. A full
 * 1024 tile of a 2048 scene is copied through unchanged.
 */
export function letterbox(
  rgba: Uint8ClampedArray, width: number,
  x0: number, y0: number, tw: number, th: number,
  size: number, padValue: number, scale: number,
): Letterboxed {
  const gain = Math.min(size / th, size / tw);
  const nw = Math.round(tw * gain);
  const nh = Math.round(th * gain);
  const dw = (size - nw) / 2;
  const dh = (size - nh) / 2;
  const padLeft = Math.round(dw - 0.1);
  const padTop = Math.round(dh - 0.1);
  const plane = size * size;
  const input = new Float32Array(3 * plane).fill(padValue * scale);
  for (let y = 0; y < nh; y++) {
    // Bilinear with half-pixel centres, as cv2.INTER_LINEAR; the identity when gain is 1.
    const sy = gain === 1 ? y : Math.min(th - 1, Math.max(0, (y + 0.5) / gain - 0.5));
    const iy = Math.floor(sy);
    const fy = sy - iy;
    const iy1 = Math.min(th - 1, iy + 1);
    for (let x = 0; x < nw; x++) {
      const sx = gain === 1 ? x : Math.min(tw - 1, Math.max(0, (x + 0.5) / gain - 0.5));
      const ix = Math.floor(sx);
      const fx = sx - ix;
      const ix1 = Math.min(tw - 1, ix + 1);
      const o = (y + padTop) * size + (x + padLeft);
      const p00 = ((y0 + iy) * width + x0 + ix) * 4;
      const p01 = ((y0 + iy) * width + x0 + ix1) * 4;
      const p10 = ((y0 + iy1) * width + x0 + ix) * 4;
      const p11 = ((y0 + iy1) * width + x0 + ix1) * 4;
      for (let c = 0; c < 3; c++) {
        const v =
          (rgba[p00 + c] * (1 - fx) + rgba[p01 + c] * fx) * (1 - fy) +
          (rgba[p10 + c] * (1 - fx) + rgba[p11 + c] * fx) * fy;
        input[c * plane + o] = v * scale;
      }
    }
  }
  return { input, gain, padLeft, padTop };
}

interface Candidate {
  x1: number; y1: number; x2: number; y2: number;
  score: number;
  anchor: number;
}

function iou(a: Candidate, b: Candidate): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter);
}

/**
 * Candidates over `conf`, then greedy NMS. ultralytics `non_max_suppression`
 * for one class: strictly greater than the threshold, at most 30,000 into NMS,
 * at most `maxDet` out.
 */
export function selectCandidates(
  out: Float32Array, anchors: number, conf: number, iouThreshold: number, maxDet: number,
): Candidate[] {
  const found: Candidate[] = [];
  for (let a = 0; a < anchors; a++) {
    const score = out[4 * anchors + a];
    if (!(score > conf)) continue;
    const cx = out[a], cy = out[anchors + a], w = out[2 * anchors + a], h = out[3 * anchors + a];
    found.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score, anchor: a });
  }
  found.sort((p, q) => q.score - p.score);
  if (found.length > 30000) found.length = 30000;
  const kept: Candidate[] = [];
  const suppressed = new Uint8Array(found.length);
  for (let i = 0; i < found.length && kept.length < maxDet; i++) {
    if (suppressed[i]) continue;
    kept.push(found[i]);
    for (let j = i + 1; j < found.length; j++)
      if (!suppressed[j] && iou(found[i], found[j]) > iouThreshold) suppressed[j] = 1;
  }
  return kept;
}

/**
 * Paint one detection's mask into the scene mask, at native resolution.
 *
 * ultralytics `process_mask_native`: coefficient x prototype logits, the
 * letterbox padding cut away, bilinear resize to the tile, logit > 0, then
 * cropped to the box. Only the box is evaluated -- outside it the crop zeroes
 * everything anyway -- so a tile costs its detections, not its area.
 */
function paintDetection(
  c: Candidate, out: Float32Array, anchors: number,
  protos: Float32Array, pc: number, ph: number, pw: number,
  lb: Letterboxed, tw: number, th: number,
  scene: Uint8Array, sceneWidth: number, x0: number, y0: number,
  valid: Uint8Array | null,
): Detection | null {
  // Box back to tile pixels (ultralytics `scale_boxes`), clipped to the tile.
  const bx1 = Math.min(tw, Math.max(0, (c.x1 - lb.padLeft) / lb.gain));
  const by1 = Math.min(th, Math.max(0, (c.y1 - lb.padTop) / lb.gain));
  const bx2 = Math.min(tw, Math.max(0, (c.x2 - lb.padLeft) / lb.gain));
  const by2 = Math.min(th, Math.max(0, (c.y2 - lb.padTop) / lb.gain));
  const colStart = Math.ceil(bx1), colEnd = Math.ceil(bx2); // r >= x1 && r < x2
  const rowStart = Math.ceil(by1), rowEnd = Math.ceil(by2);
  if (colEnd <= colStart || rowEnd <= rowStart) return null;

  // The prototype window with the letterbox padding removed (`scale_masks`).
  const pgain = Math.min(ph / th, pw / tw);
  const ppadW = (pw - Math.round(tw * pgain)) / 2;
  const ppadH = (ph - Math.round(th * pgain)) / 2;
  const top = Math.round(ppadH - 0.1), left = Math.round(ppadW - 0.1);
  const cropH = ph - Math.round(ppadH + 0.1) - top;
  const cropW = pw - Math.round(ppadW + 0.1) - left;
  const sy = cropH / th, sx = cropW / tw;
  const source = (dst: number, s: number, n: number) => Math.min(n - 1, Math.max(0, (dst + 0.5) * s - 0.5));

  // Logits only over the prototype cells the box can sample.
  const cy0 = Math.floor(source(rowStart, sy, cropH));
  const cy1 = Math.min(cropH - 1, Math.floor(source(rowEnd - 1, sy, cropH)) + 1);
  const cx0 = Math.floor(source(colStart, sx, cropW));
  const cx1 = Math.min(cropW - 1, Math.floor(source(colEnd - 1, sx, cropW)) + 1);
  const lw = cx1 - cx0 + 1, lh = cy1 - cy0 + 1;
  const logits = new Float32Array(lw * lh);
  const plane = ph * pw;
  for (let k = 0; k < pc; k++) {
    const coeff = out[(5 + k) * anchors + c.anchor];
    const base = k * plane;
    for (let y = 0; y < lh; y++) {
      const row = base + (top + cy0 + y) * pw + left + cx0;
      const o = y * lw;
      for (let x = 0; x < lw; x++) logits[o + x] += coeff * protos[row + x];
    }
  }

  let pixels = 0;
  for (let r = rowStart; r < rowEnd; r++) {
    const fyAbs = source(r, sy, cropH);
    const iy = Math.floor(fyAbs);
    const fy = fyAbs - iy;
    const ly0 = iy - cy0, ly1 = Math.min(cropH - 1, iy + 1) - cy0;
    const sceneRow = (y0 + r) * sceneWidth + x0;
    for (let q = colStart; q < colEnd; q++) {
      const fxAbs = source(q, sx, cropW);
      const ix = Math.floor(fxAbs);
      const fx = fxAbs - ix;
      const lx0 = ix - cx0, lx1 = Math.min(cropW - 1, ix + 1) - cx0;
      const v =
        (logits[ly0 * lw + lx0] * (1 - fx) + logits[ly0 * lw + lx1] * fx) * (1 - fy) +
        (logits[ly1 * lw + lx0] * (1 - fx) + logits[ly1 * lw + lx1] * fx) * fy;
      // `mask & valid` in infer_scene: nothing is detected on no-data.
      if (v > 0 && (!valid || valid[sceneRow + q])) {
        scene[sceneRow + q] = 1;
        pixels++;
      }
    }
  }
  // ultralytics drops a detection whose mask came out empty.
  if (!pixels) return null;
  return { box: [x0 + bx1, y0 + by1, x0 + bx2, y0 + by2], score: c.score, pixels };
}

/** A tile with no valid pixel at all, which `infer_scene` skips without inference. */
function tileEmpty(valid: Uint8Array, width: number, x0: number, y0: number, tw: number, th: number): boolean {
  for (let y = y0; y < y0 + th; y++) {
    const row = y * width;
    for (let x = x0; x < x0 + tw; x++) if (valid[row + x]) return false;
  }
  return true;
}

export interface SegmentOptions {
  onTile?: (done: number, total: number) => void;
  /** 1 where the source holds data (`GeoRaster.valid`); null when all of it does. */
  valid?: Uint8Array | null;
  /**
   * Stops the run between tiles, rejecting with an `AbortError`: the operator
   * chose the precomputed result. A tile already in `session.run` finishes
   * first -- onnxruntime cannot be interrupted -- so the queue frees within a tile.
   */
  signal?: AbortSignal;
}

/** The rejection `segment` gives when its signal aborts it. */
export const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/**
 * One scene at a time per session.
 *
 * onnxruntime-web's WebGPU session DEADLOCKS on overlapping `run` calls: two
 * `segment` calls started together never finish, and take the page's main
 * thread with them. Measured: one call alone 1.15 s; two together still
 * pending after 30 s, with the page frozen. The console rendered the authored
 * samples' evidence figure twice at once (dock and panel reader), and that was
 * enough to hang the tab. So every call queues behind the previous one on the
 * same session, whoever makes it.
 */
const queues = new WeakMap<object, Promise<unknown>>();

/** Run the segmenter over a whole RGBA scene, tile by tile. */
export function segment(
  model: Segmenter,
  rgba: Uint8ClampedArray, width: number, height: number,
  options: SegmentOptions = {},
): Promise<Segmentation> {
  const key = model.session as object;
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(() => segmentNow(model, rgba, width, height, options));
  // A failed scene must not block the next one.
  queues.set(key, run.catch(() => undefined));
  return run;
}

async function segmentNow(
  model: Segmenter,
  rgba: Uint8ClampedArray, width: number, height: number,
  { onTile, valid = null, signal }: SegmentOptions,
): Promise<Segmentation> {
  const started = performance.now();
  const { manifest, session, tensor } = model;
  const size = manifest.input.size;
  const tile = manifest.tiling.tile_size;
  const stride = Math.max(1, Math.round(tile * (1 - manifest.tiling.overlap)));
  const rows = tileStarts(height, tile, stride);
  const cols = tileStarts(width, tile, stride);
  const total = rows.length * cols.length;
  const mask = new Uint8Array(width * height);
  const detections: Detection[] = [];
  const [inputName] = session.inputNames;
  const [boxesName, protosName] = session.outputNames;

  let done = 0;
  for (const y0 of rows) {
    for (const x0 of cols) {
      if (signal?.aborted) throw new DOMException("segmentation stopped", "AbortError");
      const tw = Math.min(tile, width - x0);
      const th = Math.min(tile, height - y0);
      if (valid && tileEmpty(valid, width, x0, y0, tw, th)) {
        done++;
        onTile?.(done, total);
        continue;
      }
      const lb = letterbox(rgba, width, x0, y0, tw, th, size, manifest.input.pad_value, manifest.input.scale);
      const result = await session.run({ [inputName]: tensor(lb.input, [1, 3, size, size]) });
      const boxes = result[boxesName];
      const protos = result[protosName];
      const anchors = boxes.dims[2];
      const out = boxes.data as Float32Array;
      const [, pc, ph, pw] = protos.dims;
      const candidates = selectCandidates(
        out, anchors, manifest.inference.conf, manifest.inference.iou, manifest.inference.max_det,
      );
      for (const c of candidates) {
        const d = paintDetection(
          c, out, anchors, protos.data as Float32Array, pc, ph, pw, lb, tw, th, mask, width, x0, y0, valid,
        );
        if (d) detections.push(d);
      }
      done++;
      onTile?.(done, total);
    }
  }
  return { mask, width, height, detections, tiles: total, ms: Math.round(performance.now() - started) };
}

let loading: Promise<Segmenter> | null = null;
let manifestLoading: Promise<SegmenterManifest> | null = null;

/**
 * The release manifest alone: the model's name and hash, without the 13 MB
 * model. A precomputed result is checked against this hash before anything
 * decides whether the model needs loading at all.
 */
export function loadManifest(): Promise<SegmenterManifest> {
  if (manifestLoading) return manifestLoading;
  manifestLoading = (async () => {
    const response = await fetch("models/L1-ciou-research.json");
    if (!response.ok) throw new Error(`model manifest not found (${response.status})`);
    return (await response.json()) as SegmenterManifest;
  })();
  manifestLoading.catch(() => { manifestLoading = null; });
  return manifestLoading;
}

/**
 * The release model, fetched and started once per page.
 *
 * WebGPU when the browser has it, WASM otherwise. The WebGPU runtime is twice
 * the size of the WASM one, so it is only fetched where it can be used.
 */
export function loadSegmenter(): Promise<Segmenter> {
  if (loading) return loading;
  loading = (async () => {
    // Relative, like `landmask/` and `runs/`: served from `public/models/`.
    const base = "models/";
    const manifest = await loadManifest();
    const gpu = typeof navigator !== "undefined" && "gpu" in navigator;
    const ort = gpu ? await import("onnxruntime-web/webgpu") : await import("onnxruntime-web/wasm");
    const url = `${base}${manifest.file}`;
    let session;
    let backend = "wasm";
    if (gpu) {
      try {
        session = await ort.InferenceSession.create(url, { executionProviders: ["webgpu"] });
        backend = "webgpu";
      } catch {
        session = undefined;
      }
    }
    session ??= await ort.InferenceSession.create(url, { executionProviders: ["wasm"] });
    return {
      manifest,
      session: session as unknown as SessionLike,
      tensor: (data, dims) => new ort.Tensor("float32", data, dims),
      backend,
    };
  })();
  // A failed load must not be cached: the next upload should try again.
  loading.catch(() => { loading = null; });
  return loading;
}
