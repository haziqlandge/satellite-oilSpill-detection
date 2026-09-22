/**
 * The add-image panel: a real raster in, a real scene out.
 *
 * WHAT THIS USED TO DO. It fingerprinted the dropped file against three
 * supplied JPEGs at 48x24 grey and refused anything that did not match within
 * an MSE of 0.015. On a match it then built its "detection mask" from the
 * PRESET's clean image rather than from the pixels it had just been handed, and
 * advanced four captions on a five-second `setInterval` that measured nothing.
 * The upload reached the result in no way at all.
 *
 * WHAT IT DOES NOW. Any decodable raster is accepted. The pixels are screened
 * for a dark region by `sim/ingest.ts`, the outline is traced from THAT image,
 * and the geometry, bearing, length, widths and damping ratio measured off it
 * become a scene the whole console can run. The stage captions advance when the
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

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Flag, GroupHead, SCROLL } from "./components";
import { DEMO_PRESETS, DEMO_SAMPLE_KEYS, type DemoSampleKey } from "../site/demoData";
import { extractRibbon, parseAcquisitionTime, type Ribbon } from "../sim/ingest";
import { decodeGeoTiff, looksLikeTiff, type GeoRaster } from "../sim/geotiff";
import { buildUploadSpec } from "../sim/uploadSpec";
import { registerUpload } from "../sim/scenarios";
import { ensureLandmask } from "../sim/landmask";
import { PositionPicker } from "./PositionPicker";
import type { LngLat, ScenarioId } from "../sim/types";

const MASK_CANVAS_CACHE = new Map<string, string>();

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
 */
async function overlay(src: string, ribbon: Ribbon): Promise<string> {
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
  ctx.strokeStyle = "rgba(235, 36, 36, 0.95)";
  ctx.stroke();
  ctx.fillStyle = "rgba(235, 36, 36, 0.14)";
  ctx.fill();
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

export const SAMPLE_STAGES = [
  "Decoding raster",
  "Screening for dark regions",
  "Tracing the outline",
  "Ready for position and time",
] as const;

export interface Measured {
  width: number;
  height: number;
  coverage: number;
  threshold: number;
  separation: number;
  components: number;
  touchesEdge: boolean;
  splits: number;
  dampingDb: number;
  screenMs: number;
}

export interface SampleSession {
  /** Set only when the file NAMES one of the authored demo samples. */
  key: DemoSampleKey | null;
  state: "idle" | "processing" | "ready" | "complete";
  step: number;
  startedAt: number;
  completedAt: number | null;
  sourceName: string;
  sourceUrl: string | null;
  maskUrl: string | null;
  maskPresented: boolean;
  completed: DemoSampleKey[];
  error: string;
  /** The real screen's output, for any upload that is not an authored sample. */
  ribbon: Ribbon | null;
  measured: Measured | null;
  parsedAcquiredAt: number | null;
  /** Set only when the raster carried its own position. */
  geo: GeoRaster | null;
}

let session: SampleSession = {
  key: null, state: "idle", step: -1, startedAt: 0, completedAt: null,
  sourceName: "", sourceUrl: null, maskUrl: null, maskPresented: false, completed: [], error: "",
  ribbon: null, measured: null, parsedAcquiredAt: null, geo: null,
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

/** Only by name now. The pixel fingerprint was what refused every real tile. */
function namedSample(file: File): DemoSampleKey | null {
  const named = /^sample([1-3])(?:\.[^.]+)?$/i.exec(file.name);
  if (!named) return null;
  const key = ("sample" + named[1]) as DemoSampleKey;
  return DEMO_SAMPLE_KEYS.includes(key) ? key : null;
}

/** A readable pause, so a stage that finishes in 3 ms is still legible. */
const beat = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

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
    sourceName: file.name, sourceUrl: url, maskUrl: null, maskPresented: false, error: "",
    ribbon: null, measured: null, geo: null, parsedAcquiredAt: parseAcquisitionTime(file.name),
  });

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
    publish({ step: 1 });
    await beat(160);

    const screenStart = performance.now();
    const outcome = extractRibbon(pixels, width, height);
    const screenMs = Math.round(performance.now() - screenStart);
    if (sequence !== uploadSequence) return;

    if (!outcome.ok) {
      publish({ state: "idle", step: -1, error: outcome.detail });
      return;
    }
    publish({ step: 2 });
    await beat(160);

    const preview = await overlay(previewUrl, outcome.ribbon);
    if (sequence !== uploadSequence) return;
    MASK_CANVAS_CACHE.set(previewUrl, preview);

    const perGrey = 35 / 255;
    publish({
      step: 3,
      state: "ready",
      maskUrl: preview,
      ribbon: outcome.ribbon,
      measured: {
        width, height,
        coverage: outcome.ribbon.coverage,
        threshold: outcome.ribbon.threshold,
        separation: outcome.ribbon.separation,
        components: outcome.ribbon.components,
        touchesEdge: outcome.ribbon.touchesEdge,
        splits: outcome.ribbon.splits,
        dampingDb: +((outcome.ribbon.meanInside - outcome.ribbon.meanOutside) * perGrey).toFixed(2),
        screenMs,
      },
    });
  } catch {
    if (sequence !== uploadSequence) return;
    publish({ state: "idle", step: -1, error: "The image could not be decoded. Try another file." });
  }
}

export function SampleEvidenceImages({ sample }: { sample: DemoSampleKey }) {
  const preset = DEMO_PRESETS[sample];
  const [mask, setMask] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const cached = MASK_CANVAS_CACHE.get(preset.cleanImage);
      if (cached) { if (alive) setMask(cached); return; }
      try {
        const { data, width, height } = await decode(preset.cleanImage);
        const outcome = extractRibbon(data.data, width, height);
        if (!outcome.ok) return;
        const url = await overlay(preset.cleanImage, outcome.ribbon);
        MASK_CANVAS_CACHE.set(preset.cleanImage, url);
        if (alive) setMask(url);
      } catch { /* the figure simply stays at two panels */ }
    })();
    return () => { alive = false; };
  }, [preset.cleanImage]);
  return <div className="grid gap-2 p-2" data-sample-evidence={sample}>
    {[["SAR input", preset.sampleImage], ["Cleaned image", preset.cleanImage], ["Screened boundary", mask]].map(([label, url]) =>
      <figure key={label} className="border" style={{ borderColor: "var(--line)" }}>
        <figcaption className="px-2 py-1 text-[10px] uppercase" style={{ color: "var(--ink-faint)" }}>{sample} · {label}</figcaption>
        {url && <img src={url} alt={sample + " " + label} className="mx-auto block max-h-56 object-contain"
          style={{ background: "var(--ink-void, #0b0f12)" }} />}
      </figure>)}
  </div>;
}

/** The uploaded raster and what the screen made of it, for the detect pane. */
export function UploadEvidenceImages() {
  const current = useSampleSession();
  if (!current.sourceUrl) return null;
  return <div className="grid gap-2 p-2" data-upload-evidence>
    {[["Uploaded raster", current.sourceUrl], ["Screened boundary", current.maskUrl]].map(([label, url]) =>
      url ? <figure key={label} className="border" style={{ borderColor: "var(--line)" }}>
        <figcaption className="px-2 py-1 text-[10px] uppercase" style={{ color: "var(--ink-faint)" }}>{label}</figcaption>
        <img src={url} alt={label ?? ""} className="mx-auto block max-h-56 object-contain"
          style={{ background: "var(--ink-void, #0b0f12)" }} />
      </figure> : null)}
  </div>;
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
  const [lat, setLat] = useState("25.60");
  const [lon, setLon] = useState("-90.10");
  const [acrossKm, setAcrossKm] = useState("20");
  const [when, setWhen] = useState("2026-09-10T06:00");

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

  const message = processing ? SAMPLE_STAGES[Math.max(0, current.step)]
    : current.state === "ready" ? "Screened — supply position and time"
      : current.state === "complete" ? "Complete" : "";

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

  const [preparing, setPreparing] = useState("");

  const run = async () => {
    if (!current.ribbon || !parsed.valid) return;
    /*
      Fetch the coastline for wherever this scene actually is, before drifting.

      The generated land mask covers three coasts. An upload can be anywhere --
      the corpus alone spans the Gulf of Guinea, the Red Sea, the Mediterranean
      and Borneo -- and outside a known box everything reads as water, so the
      hindcast reconstructs inland and the shipping lanes cross continents.
      This pulls the basemap tiles for the region and classifies them, which
      takes a moment and is worth saying so rather than freezing the button.

      The radius covers the whole envelope, not the slick: the backward field is
      widest at the far end of the horizon and the AIS lanes are wider still.
    */
    setPreparing("Fetching the coastline for this area");
    try {
      const radiusKm = Math.max(90, parsed.across * 2.5);
      const built = await ensureLandmask(parsed.centre, radiusKm);
      if (built.built) {
        setPreparing(
          `Coastline ready — ${built.tiles} tiles, ${(built.landFraction * 100).toFixed(0)}% land`,
        );
      }
    } catch {
      // A missing coastline is worth saying, not worth blocking on: the run is
      // still honest, it simply cannot strand anything.
      setPreparing("Coastline unavailable — drift will not strand on land");
    }
    registerUpload(buildUploadSpec(current.ribbon, {
      centre: parsed.centre,
      acrossKm: parsed.across,
      acquiredAt: parsed.at,
      acquisitionSource: current.parsedAcquiredAt ? "filename" : "operator",
      positionSource: current.geo ? "geotiff" : "operator",
      fileName: current.sourceName,
    }));
    publish({ state: "complete", completedAt: Date.now() });
    setPreparing("");
    onSelect("upload");
  };

  const m = current.measured;
  return <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" style={SCROLL} data-console-image-lab>
    <GroupHead right={<Flag tone="warn">threshold screen</Flag>}>add image</GroupHead>

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

      {current.maskUrl && <figure className="border" style={{ borderColor: "var(--line)" }}>
        <figcaption className="px-2 py-1 text-[10px] uppercase">Screened boundary · traced from your pixels</figcaption>
        <img src={current.maskUrl} alt="screened detection boundary" className="mx-auto block max-h-56 object-contain"
          style={{ background: "var(--ink-void, #0b0f12)" }} data-mask-ready />
      </figure>}

      {m && <div className="space-y-1 border p-2" style={{ borderColor: "var(--line)" }}>
        <p className="text-[10px] uppercase" style={{ color: "var(--ink-faint)" }}>measured from this raster</p>
        <Row label="raster" value={`${m.width} × ${m.height}`} />
        <Row label="otsu cut" value={`grey ${m.threshold}${m.splits ? ` · split ${m.splits}x` : ""}`} />
        {m.splits > 0 && <p className="text-[10px]" style={{ color: "var(--ink-faint)" }}>
          The first cut found the sea, so it was re-applied inside the dark class.
          A real scene is mostly water; what survived is a darker population within it.</p>}
        <Row label="coverage" value={`${(m.coverage * 100).toFixed(2)} % of frame`}
          tone={m.coverage > 0.2 ? "var(--alarm)" : undefined} />
        <Row label="dark components" value={String(m.components)} />
        <Row label="separation" value={m.separation.toFixed(2)} />
        <Row label="damping" value={`${m.dampingDb.toFixed(2)} dB`} />
        <Row label="screened in" value={`${m.screenMs} ms`} />
        {m.touchesEdge && <p className="text-[10px]" style={{ color: "var(--alarm)" }}>
          Region reaches the frame edge; its true extent is cut off by the tile.</p>}
        <p className="pt-1 text-[10px]" style={{ color: "var(--ink-faint)" }}>
          A dark-region threshold screen, not the trained segmenter. Intensity alone
          cannot separate oil from a natural film, so this is classed
          <span className="num"> slick_unknown</span>.</p>
      </div>}

      {current.state === "ready" && <div className="space-y-2 border p-2" style={{ borderColor: "var(--accent)" }}>
        <p className="text-[10px] uppercase" style={{ color: "var(--accent)" }}>
          {current.geo ? "read from the raster" : "asserted by you"}</p>
        <p className="text-[10px]" style={{ color: "var(--ink-faint)" }}>
          {current.geo
            ? "This GeoTIFF carries its own geotransform, so the position and scale below are measured, not stated. Edit them only if you know the file is wrong."
            : "This raster carries no georeferencing, so position and scale cannot be read from it. The run is stamped with the fact that you stated them."}</p>
        {current.geo && <div className="space-y-1 pb-1">
          <Row label="band" value={current.geo.bandCount > 1 ? `${current.geo.band} of ${current.geo.bandCount}` : "single"} />
          <Row label="source range" value={`${current.geo.lowDb.toFixed(1)} to ${current.geo.highDb.toFixed(1)} dB`} />
          <Row
            label="mapped from"
            value={current.geo.scaledThroughWindow
              ? `${current.geo.mappedLow.toFixed(1)} to ${current.geo.mappedHigh.toFixed(1)} dB`
              : "already 8-bit"}
            tone={current.geo.windowFallback ? "var(--alarm)" : undefined} />
          {current.geo.bandCount > 1 && <p className="text-[10px]" style={{ color: "var(--ink-faint)" }}>
            {current.geo.bandNote}. The corpus band order is an unverified assumption
            (DATA.md D5), so the band that carries more contrast is used rather than a fixed one.</p>}
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
          {preparing ? "Preparing…" : "Run this image"}</button>
        {preparing && <p className="text-[10px]" style={{ color: "var(--ink-faint)" }}>{preparing}</p>}
        {current.key && <button type="button" onClick={() => onSelect(current.key!)}
          className="w-full cursor-pointer border px-3 py-2 text-[11px] uppercase"
          style={{ borderColor: "var(--line)" }}>Or open the authored {current.key} scenario</button>}
      </div>}

      {current.state === "complete" && <>
        <p className="text-[11px]" style={{ color: "var(--accent)" }}>Running your raster · hindcast, forecast, traffic and evidence available.</p>
        <button type="button" className="cursor-pointer border px-3 py-2 text-[11px] uppercase"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }} onClick={() => onSelect("upload")}>View the animation</button>
        <p className="text-[10px]" style={{ color: "var(--ink-faint)" }}>−36 h hindcast · +72 h forecast · drift, AIS and scores simulated</p>
      </>}
    </div>}
  </div>;
}
