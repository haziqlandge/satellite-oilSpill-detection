/**
 * The add-image panel: a real raster in, a real scene out.
 *
 * WHAT THIS USED TO DO. It fingerprinted the dropped file against three
 * supplied JPEGs at 48x24 grey and refused anything that did not match within
 * an MSE of 0.015. On a match it then built its "detection mask" from a stored
 * preset image rather than from the pixels it had just been handed, and
 * advanced four captions on a five-second `setInterval` that measured nothing.
 * The upload reached the result in no way at all.
 *
 * WHAT IT DOES NOW. Any decodable raster is accepted. The pixels go through
 * the project's trained segmenter in the browser (`sim/segmenter.ts`), the
 * slick is traced from ITS mask (`ribbonFromMask` in `sim/ingest.ts`), and the
 * geometry, bearing, length, widths and damping ratio measured off it become a
 * scene the whole console can run. This used to be an Otsu dark-region screen,
 * which on the Part I corpus outlined the sea rather than the slick. The stage captions advance when the
 * work they name has finished, and the panel reports how long it took, because
 * a real number is better than a spinner.
 *
 * The three demo samples keep their authored scenarios -- they carry hand-built
 * AIS and a known answer, which an arbitrary upload cannot -- but they are
 * matched by FILE NAME now, and even they are screened for real so the mask on
 * screen is the mask of the file in your hand.
 *
 * THREE THINGS THE OPERATOR MUST SUPPLY, and why they cannot be inferred:
 * acquisition time, scene centre and ground scale. The corpus tiles carry no
 * georeferencing (DATA.md) and no time in their names, and every one of wind,
 * AIS window and time axis depends on them. Asking is the honest option; the
 * run is stamped with the fact that they were asserted.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Flag, GroupHead, SCROLL } from "./components";
import { DEMO_PRESETS, DEMO_SAMPLE_KEYS, type DemoSampleKey } from "../site/demoData";
import { DB_WINDOW, parseAcquisitionTime, ribbonFromMask, type Ribbon } from "../sim/ingest";
import { decodeGeoTiff, looksLikeTiff, type GeoRaster } from "../sim/geotiff";
import { loadSegmenter, segment } from "../sim/segmenter";
import { despeckle } from "../sim/despeckle";
import { buildUploadSpec } from "../sim/uploadSpec";
import { registerUpload } from "../sim/scenarios";
import { ensureLandmask, isLand, LANDMASK_SOURCE, type LandmaskBuild } from "../sim/landmask";
import { PositionPicker } from "./PositionPicker";
import { RasterViewer } from "./RasterViewer";
import type { LngLat, ScenarioId } from "../sim/types";


function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}

/** Decoded pixels, capped so a 2048 tile does not cost a 16 MB ImageData twice. */
async function decode(src: string): Promise<{ data: ImageData; width: number; height: number }> {
  const image = await loadImage(src);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No 2D context");
  ctx.drawImage(image, 0, 0);
  return { data: ctx.getImageData(0, 0, width, height), width, height };
}

/**
 * The uploaded image with the traced outline drawn over it.
 *
 * Drawn from the ring the scene will actually be built on, not from a second
 * pass. If the outline on screen and the outline in the drift ever disagree,
 * the panel is lying about what it found.
 *
 * When the segmenter drew it, EVERY pixel the model marked is shaded too, not
 * only the slick being drifted: an operator should see all of what the model
 * found, and which part of it the run is built on.
 */
async function overlay(
  src: string,
  ribbon: Ribbon,
  segmented?: { mask: Uint8Array; width: number; height: number },
): Promise<string> {
  const image = await loadImage(src);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const scale = Math.min(1, 720 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(image, 0, 0, w, h);
  if (segmented) {
    // Any marked source pixel marks its display pixel, so a thin streak
    // survives the downscale instead of being sampled away.
    const shade = ctx.getImageData(0, 0, w, h);
    const sx = w / segmented.width;
    const sy = h / segmented.height;
    for (let y = 0; y < segmented.height; y++)
      for (let x = 0; x < segmented.width; x++) {
        if (!segmented.mask[y * segmented.width + x]) continue;
        const p = (Math.min(h - 1, (y * sy) | 0) * w + Math.min(w - 1, (x * sx) | 0)) * 4;
        shade.data[p] = Math.round(shade.data[p] * 0.4 + 40 * 0.6);
        shade.data[p + 1] = Math.round(shade.data[p + 1] * 0.4 + 200 * 0.6);
        shade.data[p + 2] = Math.round(shade.data[p + 2] * 0.4 + 255 * 0.6);
      }
    ctx.putImageData(shade, 0, 0);
  }
  ctx.beginPath();
  // The ring is normalised by image WIDTH, so both axes scale by w.
  ribbon.ring.forEach(([x, y], i) => {
    const px = x * w;
    const py = y * w;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.lineWidth = Math.max(1.5, w / 400);
  if (segmented) {
    // Outline only: the shading underneath is the model's own mask, and a fill
    // here would paint water inside the ring as if the model had marked it.
    ctx.strokeStyle = "rgba(255, 196, 0, 0.95)";
    ctx.stroke();
  } else {
    ctx.strokeStyle = "rgba(235, 36, 36, 0.95)";
    ctx.stroke();
    ctx.fillStyle = "rgba(235, 36, 36, 0.14)";
    ctx.fill();
  }
  return canvas.toDataURL("image/png");
}

/**
 * The derived 8-bit raster as a PNG data URL.
 *
 * A browser cannot put a TIFF in an `<img>`, so a GeoTIFF has no preview unless
 * one is made. Making it from the very buffer the screen read means the picture
 * and the measurement cannot disagree.
 */
function greyToDataUrl(rgba: Uint8ClampedArray, width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  // Via createImageData rather than the ImageData constructor: the buffer is
  // typed ArrayBufferLike here and the constructor demands a plain ArrayBuffer.
  const frame = ctx.createImageData(width, height);
  frame.data.set(rgba);
  ctx.putImageData(frame, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * The model's mask as its own transparent layer, at the raster's size.
 *
 * The panel's composite (`overlay`) is capped at 720 px, which is right for a
 * thumbnail and wrong for looking: a streak a few pixels wide at 2048 is under
 * one pixel at 720. The full-resolution viewer lays this over either image
 * instead, so every pixel the model marked is shown where it marked it.
 */
function maskLayer(
  segmented: { mask: Uint8Array; width: number; height: number },
  ribbon: Ribbon,
): string {
  const { mask, width, height } = segmented;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const frame = ctx.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    frame.data[i * 4] = 40;
    frame.data[i * 4 + 1] = 200;
    frame.data[i * 4 + 2] = 255;
    frame.data[i * 4 + 3] = 140;
  }
  ctx.putImageData(frame, 0, 0);
  ctx.beginPath();
  // The ring is normalised by image WIDTH, so both axes scale by it.
  ribbon.ring.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * width, y * width) : ctx.lineTo(x * width, y * width)));
  ctx.closePath();
  ctx.lineWidth = Math.max(1.5, width / 700);
  ctx.strokeStyle = "rgba(255, 196, 0, 0.95)";
  ctx.stroke();
  return canvas.toDataURL("image/png");
}

export const SAMPLE_STAGES = [
  "Decoding raster",
  "Running the trained segmenter",
  "Tracing the outline",
  "Ready for position and time",
] as const;

export interface Measured {
  width: number;
  height: number;
  coverage: number;
  components: number;
  touchesEdge: boolean;
  dampingDb: number;
  /** Detections over the whole frame, per tile, before seams are merged. */
  detections: number;
  /** Best detection score over the traced slick. */
  score: number;
  /** Share of the frame the model marked, all detections together. */
  markedFraction: number;
  tiles: number;
  backend: string;
  inferMs: number;
}

export interface SampleSession {
  /** Set only when the file NAMES one of the authored demo samples. */
  key: DemoSampleKey | null;
  state: "idle" | "processing" | "ready" | "complete";
  step: number;
  startedAt: number;
  completedAt: number | null;
  sourceName: string;
  /** The raster exactly as the segmenter saw it. */
  sourceUrl: string | null;
  /** A Lee-despeckled copy, for reading only; the segmenter never sees it. */
  cleanUrl: string | null;
  maskUrl: string | null;
  /** The model's mask alone, transparent, at the raster's own size (`maskLayer`). */
  markUrl: string | null;
  maskPresented: boolean;
  completed: DemoSampleKey[];
  error: string;
  /** The real screen's output, for any upload that is not an authored sample. */
  ribbon: Ribbon | null;
  measured: Measured | null;
  parsedAcquiredAt: number | null;
  /** Set only when the raster carried its own position. */
  geo: GeoRaster | null;
  /** Segmenter progress, tiles done of total, while it runs. */
  tiles: [number, number] | null;
  /** Wall-clock time of every stage of THIS upload, measured, in order. */
  timings: StageTiming[];
  /** What the run is waiting on, while it prepares. */
  preparing: string;
  coastline: LandmaskBuild | null;
  /** Bumped each time an upload scene is registered, so the console can select it. */
  runs: number;
}

export type StageStatus = "pending" | "running" | "done" | "failed";

/** One stage of an upload, timed on the wall clock as it happens. */
export interface StageTiming {
  label: string;
  status: StageStatus;
  /** performance.now() when the stage began, while it runs. */
  startedAt: number | null;
  /** Final duration once done or failed. */
  durationMs: number;
  /** Live detail, e.g. which tile the segmenter is on. */
  detail: string;
}

/** Every stage an upload goes through, in order, listed before any of them start. */
export const UPLOAD_STAGES = [
  "Decode raster",
  "Load segmenter",
  "Segmenter inference",
  "Trace outline",
  "Despeckle (display only)",
  "Coastline tiles (GSHHG)",
  "Drift, traffic and scoring",
] as const;
export type UploadStage = (typeof UPLOAD_STAGES)[number];

const pendingStages = (): StageTiming[] =>
  UPLOAD_STAGES.map((label) => ({ label, status: "pending", startedAt: null, durationMs: 0, detail: "" }));

/**
 * Where an upload is run when nobody has said where it is.
 *
 * Open Gulf, far from any shore, so a run started without thinking about it is
 * at least in water. Only a PNG ever uses this -- a GeoTIFF carries its own
 * position -- and the run is stamped POSITION ASSERTED either way.
 */
export const DEFAULT_CENTRE: LngLat = [-90.1, 25.6];
export const DEFAULT_ACROSS_KM = 20;
export const DEFAULT_WHEN = "2026-09-10T06:00";

let session: SampleSession = {
  key: null, state: "idle", step: -1, startedAt: 0, completedAt: null,
  sourceName: "", sourceUrl: null, cleanUrl: null, maskUrl: null, markUrl: null, maskPresented: false, completed: [], error: "",
  ribbon: null, measured: null, parsedAcquiredAt: null, geo: null, tiles: null,
  timings: [], preparing: "", coastline: null, runs: 0,
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = (patch: Partial<SampleSession>) => {
  session = { ...session, ...patch };
  listeners.forEach(listener => listener());
};
export function useSampleSession() {
  return useSyncExternalStore(subscribe, () => session, () => session);
}

let uploadSequence = 0;

/**
 * Stage bookkeeping for the Model Timing panel.
 *
 * Each stage is started and finished on the wall clock as the work happens, so
 * the panel shows what is running now and how long everything before it took.
 * A stage run twice -- the coastline and drift of a re-run after the operator
 * moves the scene -- overwrites its earlier figure, so the panel always
 * describes the run on screen.
 */
function patchStage(label: UploadStage, patch: Partial<StageTiming>) {
  publish({ timings: session.timings.map((t) => (t.label === label ? { ...t, ...patch } : t)) });
}
export function stageStart(label: UploadStage, detail = "") {
  patchStage(label, { status: "running", startedAt: performance.now(), durationMs: 0, detail });
}
export function stageDetail(label: UploadStage, detail: string) {
  patchStage(label, { detail });
}
export function stageEnd(label: UploadStage, status: "done" | "failed" = "done", detail?: string) {
  const row = session.timings.find((t) => t.label === label);
  const durationMs = row?.startedAt != null ? Math.round(performance.now() - row.startedAt) : 0;
  patchStage(label, { status, durationMs, startedAt: null, ...(detail !== undefined ? { detail } : {}) });
}
/** The stage currently running, failed when the upload stops early. */
function failRunning() {
  const running = session.timings.find((t) => t.status === "running");
  if (running) stageEnd(running.label as UploadStage, "failed");
}
/** Yield a frame, so a stage marked running is painted before synchronous work blocks. */
export const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/**
 * Put the traced slick on the map and run it: coastline first, then the scene.
 *
 * Called automatically once the segmenter has finished, and again by the
 * button when the operator moves the scene. The coastline is the one piece of
 * data an upload run fetches -- GSHHG tiles for wherever the scene is, served
 * from `public/landmask/` -- and it must be in hand before the drift, or the
 * slick could be drifted across land. Wind, currents and AIS for an upload are
 * simulated, and the provenance says so.
 */
export async function runUpload(a: { centre: LngLat; acrossKm: number; acquiredAt: number }) {
  const ribbon = session.ribbon;
  if (!ribbon) return;
  const sequence = uploadSequence;
  publish({ error: "", preparing: "Loading the coastline for this area" });
  stageStart("Coastline tiles (GSHHG)");
  patchStage("Drift, traffic and scoring", { status: "pending", durationMs: 0, startedAt: null, detail: "" });
  try {
    // Lanes reach 110 km each way from an anchor up to 28 km off the centre,
    // plus their own width: 160 km covers all of it.
    const coast = await ensureLandmask(a.centre, Math.max(160, a.acrossKm * 2.5));
    if (sequence !== uploadSequence) return;
    publish({ coastline: coast });
    stageEnd("Coastline tiles (GSHHG)", "done",
      coast.fetched ? `${coast.tiles} coastal tile${coast.tiles === 1 ? "" : "s"} fetched` : "open water, nothing to fetch");
    if (isLand(a.centre[0], a.centre[1])) {
      // A slick cannot sit on dry ground. Running anyway would drift from a
      // position the physics refuses, so say where the problem is instead.
      publish({ preparing: "", error: "That position is on land in the GSHHG coastline. Move the marker onto water." });
      return;
    }
  } catch {
    if (sequence !== uploadSequence) return;
    // A missing coastline is worth saying, not worth blocking on: the run is
    // still honest, it simply cannot strand anything.
    stageEnd("Coastline tiles (GSHHG)", "failed", "unavailable; drift will not strand on land");
    publish({ coastline: null, preparing: "Coastline unavailable — drift will not strand on land" });
  }
  registerUpload(buildUploadSpec(ribbon, {
    centre: a.centre,
    acrossKm: a.acrossKm,
    acquiredAt: a.acquiredAt,
    acquisitionSource: session.parsedAcquiredAt ? "filename" : "operator",
    positionSource: session.geo ? "geotiff" : "operator",
    fileName: session.sourceName,
  }));
  publish({ state: "complete", completedAt: Date.now(), preparing: "", runs: session.runs + 1 });
}

/** Only by name now. The pixel fingerprint was what refused every real tile. */
function namedSample(file: File): DemoSampleKey | null {
  const named = /^sample([1-3])(?:\.[^.]+)?$/i.exec(file.name);
  if (!named) return null;
  const key = ("sample" + named[1]) as DemoSampleKey;
  return DEMO_SAMPLE_KEYS.includes(key) ? key : null;
}

export async function uploadSample(file: File) {
  const sequence = ++uploadSequence;
  const tiff = looksLikeTiff(file);
  // A TIFF's own type string is unreliable across platforms, so the extension
  // decides; everything else still has to declare itself an image.
  if (!tiff && !file.type.startsWith("image/")) {
    publish({ error: "Choose an image file, or a GeoTIFF." });
    return;
  }
  const url = URL.createObjectURL(file);
  if (session.sourceUrl) URL.revokeObjectURL(session.sourceUrl);
  const startedAt = Date.now();
  publish({
    key: namedSample(file), state: "processing", step: 0, startedAt, completedAt: null,
    sourceName: file.name, sourceUrl: url, cleanUrl: null, maskUrl: null, markUrl: null, maskPresented: false, error: "",
    ribbon: null, measured: null, geo: null, tiles: null, parsedAcquiredAt: parseAcquisitionTime(file.name),
    timings: pendingStages(), preparing: "", coastline: null,
  });
  stageStart("Decode raster", tiff ? "GeoTIFF" : file.type.replace("image/", "").toUpperCase());

  try {
    let pixels: Uint8ClampedArray;
    let width: number;
    let height: number;
    let geo: GeoRaster | null = null;
    let previewUrl = url;

    if (tiff) {
      const decoded = await decodeGeoTiff(file);
      if (sequence !== uploadSequence) return;
      if (!decoded.ok) {
        failRunning();
        publish({ state: "idle", step: -1, error: decoded.reason });
        return;
      }
      geo = decoded.raster;
      pixels = geo.rgba;
      width = geo.width;
      height = geo.height;
      // A browser cannot render a TIFF in an <img>, so the preview is the
      // 8-bit raster this panel just derived -- which is also exactly what the
      // screen saw, so the figure cannot disagree with the measurement.
      previewUrl = greyToDataUrl(geo.rgba, width, height);
      publish({ sourceUrl: previewUrl, geo, parsedAcquiredAt: geo.acquiredAt ?? session.parsedAcquiredAt });
      URL.revokeObjectURL(url);
    } else {
      const decoded = await decode(url);
      if (sequence !== uploadSequence) return;
      pixels = decoded.data.data;
      width = decoded.width;
      height = decoded.height;
    }
    stageEnd("Decode raster", "done", `${width} × ${height}${geo ? ` · band ${geo.band}` : ""}`);
    publish({ step: 1 });

    /*
      The trained segmenter, not the threshold screen. The screen outlined the
      sea on the Part I corpus (median precision .045 over 24 validation scenes,
      against .915 for this model). There is no silent fallback to it: if the
      model cannot run, the operator is told why rather than handed a worse
      answer that looks the same.
    */
    let model;
    stageStart("Load segmenter", "L1-ciou research release");
    try {
      model = await loadSegmenter();
    } catch (error) {
      if (sequence !== uploadSequence) return;
      failRunning();
      publish({
        state: "idle", step: -1,
        error: `The trained segmenter could not be loaded (${(error as Error).message}). ` +
          "Produce it with .venv/Scripts/python.exe -m ml.export.onnx_export.",
      });
      return;
    }
    if (sequence !== uploadSequence) return;
    stageEnd("Load segmenter", "done", model.backend);
    stageStart("Segmenter inference", "starting");
    const segmented = await segment(model, pixels, width, height, {
      valid: geo?.valid ?? null,
      onTile: (done, total) => {
        if (sequence !== uploadSequence) return;
        publish({ tiles: [done, total] });
        stageDetail("Segmenter inference", `tile ${done} of ${total} · ${model.backend}`);
      },
    });
    if (sequence !== uploadSequence) return;
    stageEnd("Segmenter inference", "done",
      `${segmented.detections.length} detection${segmented.detections.length === 1 ? "" : "s"} · ${segmented.tiles} tiles · ${model.backend}`);

    stageStart("Trace outline");
    await nextFrame();
    const outcome = ribbonFromMask(segmented.mask, pixels, width, height, segmented.detections);
    if (!outcome.ok) {
      stageEnd("Trace outline", "failed", outcome.reason);
      publish({ state: "idle", step: -1, tiles: null, error: outcome.detail });
      return;
    }
    stageEnd("Trace outline", "done", `${(outcome.ribbon.coverage * 100).toFixed(2)}% of frame`);
    publish({ step: 2 });

    // Despeckled for the eye, through the dB window the grey was rendered with:
    // the GeoTIFF's own mapping, or the corpus window a PNG was written through.
    stageStart("Despeckle (display only)", "Lee 7x7");
    await nextFrame();
    const [lowDb, highDb] = geo?.scaledThroughWindow ? [geo.mappedLow, geo.mappedHigh] : DB_WINDOW;
    const cleanUrl = greyToDataUrl(despeckle(pixels, width, height, lowDb, highDb, geo?.valid ?? null), width, height);
    if (sequence !== uploadSequence) return;
    stageEnd("Despeckle (display only)", "done", "Lee 7x7");
    publish({ cleanUrl });

    const preview = await overlay(cleanUrl, outcome.ribbon, segmented);
    if (sequence !== uploadSequence) return;
    const markUrl = maskLayer(segmented, outcome.ribbon);

    let marked = 0;
    for (let i = 0; i < segmented.mask.length; i++) marked += segmented.mask[i];
    const perGrey = 35 / 255;
    publish({
      step: 3,
      state: "ready",
      maskUrl: preview,
      markUrl,
      ribbon: outcome.ribbon,
      measured: {
        width, height,
        coverage: outcome.ribbon.coverage,
        components: outcome.ribbon.components,
        touchesEdge: outcome.ribbon.touchesEdge,
        dampingDb: +((outcome.ribbon.meanInside - outcome.ribbon.meanOutside) * perGrey).toFixed(2),
        detections: segmented.detections.length,
        score: outcome.ribbon.score ?? 0,
        markedFraction: marked / segmented.mask.length,
        tiles: segmented.tiles,
        backend: model.backend,
        inferMs: segmented.ms,
      },
    });

    /*
      Straight on to the run: nobody should have to press a button to see what
      the model found drift. A GeoTIFF brings its own position; a PNG does not,
      so it runs at the default and is stamped POSITION ASSERTED -- the operator
      can move it and re-run. The authored samples keep their own flow.
    */
    if (!session.key) {
      await runUpload({
        centre: geo?.centre ?? DEFAULT_CENTRE,
        acrossKm: geo?.acrossKm ?? DEFAULT_ACROSS_KM,
        acquiredAt: session.parsedAcquiredAt ?? Date.parse(DEFAULT_WHEN + ":00Z"),
      });
    }
  } catch {
    if (sequence !== uploadSequence) return;
    failRunning();
    publish({ state: "idle", step: -1, error: "The image could not be decoded. Try another file." });
  }
}

/**
 * One computation per sample image, shared by every copy of the figure on the
 * page (the dock and the panel reader both render it), rather than one each.
 */
const SAMPLE_EVIDENCE = new Map<string, Promise<{ url: string | null; note: string }>>();

function sampleEvidence(image: string) {
  let pending = SAMPLE_EVIDENCE.get(image);
  if (!pending) {
    pending = (async () => {
      try {
        const { data, width, height } = await decode(image);
        const model = await loadSegmenter();
        const segmented = await segment(model, data.data, width, height);
        const outcome = ribbonFromMask(segmented.mask, data.data, width, height, segmented.detections);
        if (!outcome.ok) return { url: null, note: outcome.detail };
        return { url: await overlay(image, outcome.ribbon, segmented), note: "" };
      } catch (error) {
        // Not cached: a model that failed to load should be retried next time.
        SAMPLE_EVIDENCE.delete(image);
        return { url: null, note: `The trained segmenter could not run (${(error as Error).message}).` };
      }
    })();
    SAMPLE_EVIDENCE.set(image, pending);
  }
  return pending;
}

/**
 * An authored sample's evidence: its SAR input, and what the trained segmenter
 * finds in it -- the same model as every upload, on the same image, drawn over
 * it. The scenario's own outline comes from this model too
 * (`scripts/extract-sample-geometry.ts`).
 */
export function SampleEvidenceImages({ sample }: { sample: DemoSampleKey }) {
  const preset = DEMO_PRESETS[sample];
  const [mask, setMask] = useState<string | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    let alive = true;
    void sampleEvidence(preset.sampleImage).then(({ url, note: why }) => {
      if (!alive) return;
      setMask(url);
      setNote(why);
    });
    return () => { alive = false; };
  }, [preset.sampleImage]);
  return <div className="grid gap-2 p-2" data-sample-evidence={sample}>
    {[["SAR input", preset.sampleImage], ["Segmented slick · trained model", mask]].map(([label, url]) =>
      <figure key={label} className="border" style={{ borderColor: "var(--line)" }}>
        <figcaption className="px-2 py-1 text-[10px] uppercase" style={{ color: "var(--ink-faint)" }}>{sample} · {label}</figcaption>
        {url && <img src={url} alt={sample + " " + label} className="mx-auto block max-h-56 object-contain"
          style={{ background: "var(--ink-void, #0b0f12)" }} />}
        {!url && label?.startsWith("Segmented") && note &&
          <p className="px-2 pb-2 text-[10px]" style={{ color: "var(--ink-faint)" }}>{note}</p>}
      </figure>)}
  </div>;
}

/** The uploaded raster and what the segmenter made of it, for the detect pane. */
export function UploadEvidenceImages() {
  const current = useSampleSession();
  const [open, setOpen] = useState<ViewerTarget | null>(null);
  if (!current.sourceUrl) return null;
  const drawn = current.ribbon?.method === "segmenter" ? "Segmented slick · over the despeckled copy" : "Screened boundary";
  const figures: [string, string | null, ViewerTarget][] = [
    ["Uploaded raster · model input, as the segmenter saw it", current.sourceUrl, { layer: "input", mask: false }],
    ["Despeckled · Lee 7x7, display only", current.cleanUrl, { layer: "clean", mask: false }],
    [drawn, current.maskUrl, { layer: "clean", mask: true }],
  ];
  return <div className="grid gap-2 p-2" data-upload-evidence>
    {figures.map(([label, url, target]) =>
      url ? <figure key={label} className="border" style={{ borderColor: "var(--line)" }}>
        <figcaption className="px-2 py-1 text-[10px] uppercase" style={{ color: "var(--ink-faint)" }}>{label}</figcaption>
        <FullSizeButton label={label} onOpen={() => setOpen(target)}>
          <img src={url} alt={label} className="mx-auto block max-h-56 object-contain"
            style={{ background: "var(--ink-void, #0b0f12)" }} />
        </FullSizeButton>
      </figure> : null)}
    {open && <UploadViewer session={current} target={open} onClose={() => setOpen(null)} />}
  </div>;
}

interface ViewerTarget {
  layer: "input" | "clean";
  mask: boolean;
}

/** An image that opens the full-resolution viewer, and says so. */
function FullSizeButton({ label, onOpen, children }: { label: string; onOpen: () => void; children: ReactNode }) {
  return <button type="button" onClick={onOpen} aria-label={`${label}: open at full resolution`}
    className="group relative block w-full cursor-zoom-in" data-full-size>
    {children}
    <span className="pointer-events-none absolute bottom-1 right-1 border px-1 text-[9px] uppercase tracking-[0.14em] opacity-70 group-hover:opacity-100"
      style={{ borderColor: "var(--line)", background: "var(--base)", color: "var(--ink-dim)" }}>full size</span>
  </button>;
}

/** The viewer over this upload's images: the input, the despeckled copy, and the mask. */
function UploadViewer({ session: s, target, onClose }: { session: SampleSession; target: ViewerTarget; onClose: () => void }) {
  const known = s.measured ?? (s.geo ? { width: s.geo.width, height: s.geo.height } : null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (known || !s.sourceUrl) return;
    let alive = true;
    void loadImage(s.sourceUrl).then((image) => {
      if (alive) setNatural({ width: image.naturalWidth, height: image.naturalHeight });
    });
    return () => { alive = false; };
  }, [known, s.sourceUrl]);
  const dims = known ?? natural;
  if (!dims || !s.sourceUrl) return null;
  const layers = [{ key: "input", label: "model input", url: s.sourceUrl }];
  if (s.cleanUrl) layers.push({ key: "clean", label: "despeckled", url: s.cleanUrl });
  return <RasterViewer title={s.sourceName || "uploaded raster"} width={dims.width} height={dims.height}
    layers={layers} initial={layers.some((l) => l.key === target.layer) ? target.layer : "input"}
    maskUrl={s.markUrl} maskInitially={target.mask} onClose={onClose} />;
}

const formatMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

/**
 * The latest upload's pipeline, stage by stage, as it happens.
 *
 * Every figure is the wall clock of this browser for this upload: a running
 * stage shows a spinner and its elapsed time ticking, a finished one its final
 * time. The drift, traffic and scoring are simulated physics, but the time
 * they take to compute is real, and that is all this panel claims.
 */
export function UploadTimings() {
  const current = useSampleSession();
  const running = current.timings.some((t) => t.status === "running");
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 100);
    return () => window.clearInterval(timer);
  }, [running]);
  const now = performance.now();
  const elapsed = (t: StageTiming) =>
    t.status === "running" && t.startedAt !== null ? now - t.startedAt : t.durationMs;
  const total = current.timings.reduce((sum, t) => sum + elapsed(t), 0);
  return <>
    <p className="num mt-2 px-2 text-[10px]" style={{ color: "var(--ink-faint)" }}>
      pipeline timings for {current.sourceName || "this upload"}</p>
    <ul className="mt-2 border" style={{ borderColor: "var(--line)" }} data-upload-timings>
      {current.timings.map((t) =>
        <li key={t.label} data-stage-status={t.status}
          className="flex items-start justify-between gap-3 border-b px-2 py-2 text-[11px]" style={{ borderColor: "var(--line)" }}>
          <span className="flex min-w-0 items-start gap-2">
            <span className="mt-[2px] flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden>
              {t.status === "running"
                ? <span className="h-3 w-3 animate-spin rounded-full border-2"
                    style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                : t.status === "done" ? <span style={{ color: "var(--accent)" }}>✓</span>
                  : t.status === "failed" ? <span style={{ color: "var(--alarm)" }}>✕</span>
                    : <span className="h-2 w-2 rounded-full border" style={{ borderColor: "var(--ink-faint)" }} />}
            </span>
            <span className="min-w-0">
              <span style={{ color: t.status === "pending" ? "var(--ink-faint)" : undefined }}>{t.label}</span>
              {t.detail && <span className="block text-[9.5px]" style={{ color: "var(--ink-faint)" }}>{t.detail}</span>}
            </span>
          </span>
          <span className="num shrink-0" style={{
            color: t.status === "failed" ? "var(--alarm)" : t.status === "pending" ? "var(--ink-faint)" : "var(--accent)",
          }}>{t.status === "pending" ? "—" : formatMs(elapsed(t))}</span>
        </li>)}
      <li className="flex justify-between px-2 py-2 text-[11px] font-medium">
        <span>Total{running ? " so far" : ""}</span><span className="num">{formatMs(total)}</span></li>
    </ul>
    <p className="mt-2 px-2 text-[9.5px] leading-[1.5]" style={{ color: "var(--ink-faint)" }}>
      Measured in this browser for this upload, as it runs. Drift, traffic and scores are
      simulated physics; the time they take to compute is real.</p>
  </>;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="flex items-baseline justify-between gap-2 text-[11px]">
    <span style={{ color: "var(--ink-faint)" }}>{label}</span>
    <span className="num" style={{ color: tone ?? "inherit" }}>{value}</span>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-[10px] uppercase" style={{ color: "var(--ink-faint)" }}>
    {label}
    <div className="mt-1">{children}</div>
  </label>;
}

const INPUT = "w-full border bg-transparent px-2 py-1 text-[11px]";

export function SampleImagePanel({ onSelect }: { onSelect: (id: ScenarioId) => void }) {
  const current = useSampleSession();
  const input = useRef<HTMLInputElement>(null);
  const processing = current.state === "processing";

  // Defaults an operator can accept or overwrite. Open Gulf, far from any
  // shore, so a run started without thinking about it is at least in water.
  const [lat, setLat] = useState(DEFAULT_CENTRE[1].toFixed(2));
  const [lon, setLon] = useState(DEFAULT_CENTRE[0].toFixed(2));
  const [acrossKm, setAcrossKm] = useState(String(DEFAULT_ACROSS_KM));
  const [when, setWhen] = useState(DEFAULT_WHEN);

  useEffect(() => {
    if (current.parsedAcquiredAt)
      setWhen(new Date(current.parsedAcquiredAt).toISOString().slice(0, 16));
  }, [current.parsedAcquiredAt]);

  // A georeferenced raster answers the position questions itself, so the
  // fields follow it rather than the operator.
  useEffect(() => {
    if (!current.geo) return;
    setLon(current.geo.centre[0].toFixed(4));
    setLat(current.geo.centre[1].toFixed(4));
    setAcrossKm(current.geo.acrossKm.toFixed(2));
  }, [current.geo]);

  const upload = (files: FileList | null) => { if (files?.[0]) void uploadSample(files[0]); };

  const { preparing, coastline } = current;
  const stage = SAMPLE_STAGES[Math.max(0, current.step)];
  const message = processing
    ? current.step === 1 && current.tiles ? `${stage} · tile ${current.tiles[0]} of ${current.tiles[1]}` : stage
    : current.state === "ready" ? (preparing || (current.key ? "Segmented — supply position and time" : "Segmented — starting the run"))
      : current.state === "complete" ? "Complete — running on the map" : "";

  const parsed = useMemo(() => {
    const centre: LngLat = [Number(lon), Number(lat)];
    const across = Number(acrossKm);
    const at = Date.parse(when + ":00Z");
    const valid = Number.isFinite(centre[0]) && Number.isFinite(centre[1])
      && Math.abs(centre[1]) <= 90 && Math.abs(centre[0]) <= 180
      && across > 0.2 && across < 2000 && Number.isFinite(at);
    // The picker must always have something drawable, even mid-keystroke when
    // a field is briefly "-" or empty. `valid` still gates the run button.
    const validCentre: LngLat = [
      Number.isFinite(centre[0]) && Math.abs(centre[0]) <= 180 ? centre[0] : -90.1,
      Number.isFinite(centre[1]) && Math.abs(centre[1]) <= 90 ? centre[1] : 25.6,
    ];
    const validAcross = across > 0.2 && across < 2000 ? across : 20;
    return { centre, across, at, valid, validCentre, validAcross };
  }, [lat, lon, acrossKm, when]);

  // The same path the automatic run takes; the console selects the new run
  // when `runs` moves, so a re-run after moving the scene lands on the map too.
  const run = async () => {
    if (!current.ribbon || !parsed.valid) return;
    await runUpload({ centre: parsed.centre, acrossKm: parsed.across, acquiredAt: parsed.at });
  };

  const m = current.measured;
  return <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" style={SCROLL} data-console-image-lab>
    <GroupHead right={<Flag tone="warn">trained segmenter · research</Flag>}>add image</GroupHead>

    <div className="mt-2 border border-dashed p-3" style={{ borderColor: "var(--accent)" }}
      tabIndex={0} aria-label="Drop images here"
      onDragOver={event => event.preventDefault()}
      onDrop={event => { event.preventDefault(); upload(event.dataTransfer.files); }}
      onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); upload(event.clipboardData.files); } }}>
      <p className="text-[11px]">Drop a SAR raster. A GeoTIFF brings its own position;
        a PNG or JPEG needs one stated.</p>
      <p className="mt-1 text-[10px]" style={{ color: "var(--ink-faint)" }}>
        Corpus tiles: <span className="num">data/processed/dataset/oos/images/train/</span> —
        prefer <span className="num">train</span> over <span className="num">test</span>, which is
        the consumed holdout. Georeferenced windows:
        <span className="num"> data/processed/sar/windows/</span>, cut by
        <span className="num"> scripts/cut_geotiff_window.py</span>.</p>
      <button type="button" onClick={() => input.current?.click()}
        className="mt-3 cursor-pointer border px-3 py-2 text-[11px] uppercase"
        style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>Upload image</button>
      <input ref={input} type="file" accept="image/*" className="hidden" aria-label="Image file"
        onChange={event => { upload(event.target.files); event.target.value = ""; }} />
      {current.error && <p role="alert" className="mt-2 text-[11px]" style={{ color: "var(--alarm)" }}>{current.error}</p>}
    </div>

    {current.sourceUrl && <div className="mt-3 space-y-3">
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-[11px]" data-sample-stage={current.step}>
        {processing && <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />}
        <span>{message}</span>
      </div>
      <p className="num text-[10px]" style={{ color: "var(--ink-faint)" }}>{current.sourceName}</p>

      {current.cleanUrl && <div className="grid grid-cols-2 gap-2" data-upload-pair>
        {[["Model input", "band 2 as the segmenter saw it", current.sourceUrl],
          ["Despeckled", "Lee 7x7 · display only", current.cleanUrl]].map(([title, note, url]) =>
          <figure key={title} className="border" style={{ borderColor: "var(--line)" }}>
            <figcaption className="px-2 py-1 text-[10px] uppercase">{title}
              <span className="block normal-case" style={{ color: "var(--ink-faint)" }}>{note}</span></figcaption>
            {url && <img src={url} alt={title ?? ""} className="mx-auto block max-h-40 object-contain"
              style={{ background: "var(--ink-void, #0b0f12)" }} />}
          </figure>)}
      </div>}
      {current.cleanUrl && current.geo && current.geo.noDataFraction > 0.001 &&
        <p className="text-[10px]" style={{ color: "var(--ink-faint)" }} data-no-data-note>
          {(current.geo.noDataFraction * 100).toFixed(0)}% of this frame is no data — outside the
          satellite's swath, stored as zeros in the file. The model is given it as white, exactly as
          in training, and is told to ignore it; the despeckled copy shows it hatched.</p>}

      {current.maskUrl && <figure className="border" style={{ borderColor: "var(--line)" }}>
        <figcaption className="px-2 py-1 text-[10px] uppercase">Segmented from your pixels · shaded: everything the model marked · outline: the slick drifted
          <span className="block normal-case" style={{ color: "var(--ink-faint)" }}>drawn over the despeckled copy; the model ran on the input</span></figcaption>
        <img src={current.maskUrl} alt="segmented slick" className="mx-auto block max-h-56 object-contain"
          style={{ background: "var(--ink-void, #0b0f12)" }} data-mask-ready />
      </figure>}

      {m && <div className="space-y-1 border p-2" style={{ borderColor: "var(--line)" }}>
        <p className="text-[10px] uppercase" style={{ color: "var(--ink-faint)" }}>measured from this raster</p>
        <Row label="raster" value={`${m.width} × ${m.height}`} />
        <Row label="model" value="L1-ciou · research release" />
        <Row label="detections" value={`${m.detections} over ${m.tiles} tile${m.tiles === 1 ? "" : "s"}`} />
        <Row label="best score" value={m.score.toFixed(2)} tone={m.score < 0.5 ? "var(--alarm)" : undefined} />
        <Row label="marked" value={`${(m.markedFraction * 100).toFixed(2)} % of frame`} />
        <Row label="drifted slick" value={`${(m.coverage * 100).toFixed(2)} % of frame · ${m.components} group${m.components === 1 ? "" : "s"} found`} />
        <Row label="damping" value={`${m.dampingDb.toFixed(2)} dB`} />
        <Row label="inference" value={`${(m.inferMs / 1000).toFixed(1)} s · ${m.backend}`} />
        {m.touchesEdge && <p className="text-[10px]" style={{ color: "var(--alarm)" }}>
          Slick reaches the frame edge; its true extent is cut off by the tile.</p>}
        <p className="pt-1 text-[10px]" style={{ color: "var(--ink-faint)" }}>
          The project's trained segmenter, run in your browser. It marks slick-like
          regions; it cannot tell oil from a natural film, so this is classed
          <span className="num"> slick_unknown</span>. On the held-out test it scored
          mAP50 0.36 and missed most small slicks, so an empty result is not proof of
          clean water.</p>
      </div>}

      {(current.state === "ready" || (current.state === "complete" && !current.key)) &&
        <div className="space-y-2 border p-2" style={{ borderColor: "var(--accent)" }}>
        <p className="text-[10px] uppercase" style={{ color: "var(--accent)" }}>
          {current.geo ? "read from the raster" : "asserted, not measured"}</p>
        <p className="text-[10px]" style={{ color: "var(--ink-faint)" }}>
          {current.geo
            ? "This GeoTIFF carries its own geotransform, so the position and scale below are measured, not stated. Edit them only if you know the file is wrong."
            : "This raster carries no georeferencing, so position and scale cannot be read from it. It was run at the default position below; move it and re-run. The run is stamped POSITION ASSERTED either way."}</p>
        {current.geo && <div className="space-y-1 pb-1">
          <Row label="band" value={current.geo.bandCount > 1 ? `${current.geo.band} of ${current.geo.bandCount}` : "single"} />
          <Row label="source range" value={`${current.geo.lowDb.toFixed(1)} to ${current.geo.highDb.toFixed(1)} dB`} />
          {current.geo.noDataFraction > 0.001 &&
            <Row label="no data" value={`${(current.geo.noDataFraction * 100).toFixed(0)}% · outside the swath`} />}
          <Row
            label="mapped from"
            value={current.geo.scaledThroughWindow
              ? `${current.geo.mappedLow.toFixed(1)} to ${current.geo.mappedHigh.toFixed(1)} dB`
              : "already 8-bit"}
            tone={current.geo.windowFallback ? "var(--alarm)" : undefined} />
          {current.geo.bandCount > 1 && <p className="text-[10px]" style={{ color: "var(--ink-faint)" }}>
            {current.geo.bandNote}. The bands carry no names (DATA.md D5); over the sea the
            co-polarised return is the brighter one, and it is the band oil damping shows in.</p>}
          {current.geo.windowFallback && <p className="text-[10px]" style={{ color: "var(--alarm)" }}>
            This scene sits outside the corpus window of -35 to 0 dB, which would have clipped most
            of it to black. Its own range was used instead, so greys here are NOT comparable with
            other tiles.</p>}
        </div>}
        <Field label={current.geo ? "position from the raster — move only if it is wrong" : "click or drag to place the scene"}>
          <PositionPicker
            centre={parsed.validCentre}
            acrossKm={parsed.validAcross}
            onChange={([nextLon, nextLat]) => { setLon(String(nextLon)); setLat(String(nextLat)); }}
          />
        </Field>
        <Field label="image width (km) — the green box is this much ground">
          <input className={INPUT} style={{ borderColor: "var(--line)" }} value={acrossKm}
            onChange={e => setAcrossKm(e.target.value)} inputMode="decimal" />
        </Field>
        <details>
          <summary className="cursor-pointer text-[10px] uppercase" style={{ color: "var(--ink-faint)" }}>
            type coordinates instead
          </summary>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <Field label="centre lat"><input className={INPUT} style={{ borderColor: "var(--line)" }} value={lat} onChange={e => setLat(e.target.value)} inputMode="decimal" /></Field>
            <Field label="centre lon"><input className={INPUT} style={{ borderColor: "var(--line)" }} value={lon} onChange={e => setLon(e.target.value)} inputMode="decimal" /></Field>
          </div>
        </details>
        <Field label={`acquisition UTC${current.parsedAcquiredAt ? " · parsed from file name" : " · not in the file name"}`}>
          <input className={INPUT} style={{ borderColor: "var(--line)" }} type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} />
        </Field>
        <button type="button" disabled={!parsed.valid || !!preparing} onClick={() => void run()}
          className="w-full cursor-pointer border px-3 py-2 text-[11px] uppercase disabled:cursor-not-allowed disabled:opacity-40"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
          {preparing ? "Preparing…" : current.state === "complete" ? "Re-run at this position" : "Run this image"}</button>
        {preparing && <p className="text-[10px]" style={{ color: "var(--ink-faint)" }}>{preparing}</p>}
        {current.key && <button type="button" onClick={() => onSelect(current.key!)}
          className="w-full cursor-pointer border px-3 py-2 text-[11px] uppercase"
          style={{ borderColor: "var(--line)" }}>Or open the authored {current.key} scenario</button>}
      </div>}

      {current.state === "complete" && <>
        <p className="text-[11px]" style={{ color: "var(--accent)" }}>Running your raster on the map · hindcast, forecast, traffic and evidence available.</p>
        <button type="button" className="cursor-pointer border px-3 py-2 text-[11px] uppercase"
          style={{ borderColor: "var(--line)" }} onClick={() => onSelect("upload")}>Back to this run</button>
        <p className="text-[10px]" style={{ color: "var(--ink-faint)" }}>−36 h hindcast · +72 h forecast · drift, AIS and scores simulated</p>
        {coastline && <p className="text-[10px]" style={{ color: "var(--ink-faint)" }} data-coastline>
          Coastline: {LANDMASK_SOURCE.split(" (")[0]}, the shoreline OpenDrift uses · {coastline.tiles} coastal
          tile{coastline.tiles === 1 ? "" : "s"} · {(coastline.landFraction * 100).toFixed(0)}% land nearby
          {coastline.fetched ? ` · loaded in ${coastline.ms} ms` : ""}</p>}
      </>}
    </div>}
  </div>;
}
