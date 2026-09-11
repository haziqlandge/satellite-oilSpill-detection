import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Flag, GroupHead, SCROLL } from "./components";
import { DEMO_PRESETS, DEMO_SAMPLE_KEYS, PROCESS_MESSAGE_MS, type DemoSampleKey } from "../site/demoData";

const MASK_CANVAS_CACHE = new Map<string, string>();
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}


async function buildMaskedFrame(src: string): Promise<string> {
  const cached = MASK_CANVAS_CACHE.get(src);
  if (cached) return cached;

  const image = await loadImage(src);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;

  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const pixelCount = width * height;
  const darkLuma: number[] = [];

  for (let i = 0; i < pixelCount; i += 1) {
    const p = i * 4;
    const alpha = data[p + 3];
    if (alpha < 16) continue;

    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    darkLuma.push(lum);
  }

  if (darkLuma.length === 0) return src;
  darkLuma.sort((l, r) => l - r);
  const threshold = Math.max(20, Math.min(90, darkLuma[Math.floor(darkLuma.length * 0.08)] + 20));

  const isCandidate = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const p = i * 4;
    const alpha = data[p + 3];
    if (alpha < 16) continue;

    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum <= threshold && r <= threshold + 25 && g <= threshold + 25 && b <= threshold + 25) {
      isCandidate[i] = 1;
    }
  }

  const component = new Int32Array(pixelCount);
  component.fill(-1);
  const componentSize: number[] = [];
  const componentTouchesBorder: boolean[] = [];
  let nextComponent = 0;

  const queue: number[] = [];
  const queueX: number[] = [];
  const queueY: number[] = [];
  const minArea = Math.max(90, Math.floor(pixelCount * 0.00015));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (!isCandidate[idx] || component[idx] !== -1) continue;

      let size = 0;
      let touchesBorder = false;
      queue.length = 0;
      queueX.length = 0;
      queueY.length = 0;
      queue.push(idx);
      queueX.push(x);
      queueY.push(y);
      component[idx] = nextComponent;
      let head = 0;

      while (head < queue.length) {
        const cx = queueX[head];
        const cy = queueY[head];
        head += 1;
        size += 1;

        if (cx === 0 || cy === 0 || cx === width - 1 || cy === height - 1) {
          touchesBorder = true;
        }

        for (let ny = cy - 1; ny <= cy + 1; ny += 1) {
          if (ny < 0 || ny >= height) continue;
          const rowBase = ny * width;
          for (let nx = cx - 1; nx <= cx + 1; nx += 1) {
            if (nx < 0 || nx >= width) continue;
            const next = rowBase + nx;
            if (!isCandidate[next] || component[next] !== -1) continue;
            component[next] = nextComponent;
            queue.push(next);
            queueX.push(nx);
            queueY.push(ny);
          }
        }
      }

      componentSize.push(size);
      componentTouchesBorder.push(touchesBorder);
      nextComponent += 1;
    }
  }

  if (componentSize.length === 0) return src;

  let targetComponent = -1;
  for (let i = 0; i < componentSize.length; i += 1) {
    if (componentSize[i] < minArea) continue;
    if (componentTouchesBorder[i]) continue;
    if (targetComponent === -1 || componentSize[i] > componentSize[targetComponent]) {
      targetComponent = i;
    }
  }

  if (targetComponent === -1) {
    for (let i = 0; i < componentSize.length; i += 1) {
      if (componentSize[i] < minArea) continue;
      if (targetComponent === -1 || componentSize[i] > componentSize[targetComponent]) {
        targetComponent = i;
      }
    }
  }

  if (targetComponent === -1) return src;

  const boundary = new Uint8Array(pixelCount);
  for (let y = 0; y < height; y += 1) {
    const rowBase = y * width;
    for (let x = 0; x < width; x += 1) {
      const idx = rowBase + x;
      if (component[idx] !== targetComponent) continue;

      let isEdge = false;
      for (let ny = y - 1; ny <= y + 1 && !isEdge; ny += 1) {
        if (ny < 0 || ny >= height) {
          isEdge = true;
          break;
        }
        const nRow = ny * width;
        for (let nx = x - 1; nx <= x + 1; nx += 1) {
          if (nx < 0 || nx >= width) {
            isEdge = true;
            break;
          }
          const nIdx = nRow + nx;
          if (component[nIdx] !== targetComponent) {
            isEdge = true;
            break;
          }
        }
      }

      if (isEdge) {
        boundary[idx] = 1;
      }
    }
  }

  let hasBoundary = false;
  for (let i = 0; i < pixelCount; i += 1) {
    if (!boundary[i]) continue;
    hasBoundary = true;
    const y = Math.floor(i / width);
    const x = i - y * width;
    for (let ny = y - 1; ny <= y + 1; ny += 1) {
      if (ny < 0 || ny >= height) continue;
      const nRow = ny * width;
      for (let nx = x - 1; nx <= x + 1; nx += 1) {
        if (nx < 0 || nx >= width) continue;
        const dataIndex = (nRow + nx) * 4;
        if (data[dataIndex + 3] < 20) continue;
        data[dataIndex] = 235;
        data[dataIndex + 1] = 36;
        data[dataIndex + 2] = 36;
        data[dataIndex + 3] = 255;
      }
    }
  }

  if (!hasBoundary) return src;

  ctx.putImageData(imageData, 0, 0);
  const out = canvas.toDataURL("image/png");
  MASK_CANVAS_CACHE.set(src, out);
  return out;
}



export const SAMPLE_STAGES = [
  "Processing image",
  "Cleaning image and extracting detection mask",
  "Predicting hindcast and forecast",
  "Checking vessel information and composing evidence",
] as const;

export interface SampleSession {
  key: DemoSampleKey | null;
  state: "idle" | "processing" | "complete";
  step: number;
  startedAt: number;
  completedAt: number | null;
  sourceName: string;
  sourceUrl: string | null;
  maskUrl: string | null;
  maskPresented: boolean;
  completed: DemoSampleKey[];
  error: string;
}
let session: SampleSession = {
  key: null, state: "idle", step: -1, startedAt: 0, completedAt: null,
  sourceName: "", sourceUrl: null, maskUrl: null, maskPresented: false, completed: [], error: "",
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
let timer: ReturnType<typeof setInterval> | null = null;
let uploadSequence = 0;
let validationSequence = 0;

async function fingerprint(src: string) {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = 48; canvas.height = 24;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, 48, 24);
  const pixels = ctx.getImageData(0, 0, 48, 24).data;
  return Array.from({ length: 48 * 24 }, (_, i) => pixels[i * 4] / 255);
}

/** A clipboard image often has no original filename; match its pixels too. */
async function identifySample(file: File, url: string): Promise<DemoSampleKey | null> {
  const named = /^sample([1-3])(?:\.[^.]+)?$/i.exec(file.name);
  if (named) { await loadImage(url); return ("sample" + named[1]) as DemoSampleKey; }
  const actual = await fingerprint(url);
  let best: DemoSampleKey | null = null, error = Infinity;
  for (const key of DEMO_SAMPLE_KEYS) {
    const reference = await fingerprint(DEMO_PRESETS[key].sampleImage);
    const mse = actual.reduce((sum, value, i) => sum + (value - reference[i]) ** 2, 0) / actual.length;
    if (mse < error) { error = mse; best = key; }
  }
  return error < 0.015 ? best : null;
}

export async function uploadSample(file: File) {
  const request = ++validationSequence;
  if (!file.type.startsWith("image/")) { publish({ error: "Choose an image file." }); return; }
  const url = URL.createObjectURL(file);
  let sequence = uploadSequence;
  let accepted = false;
  try {
    const key = await identifySample(file, url);
    if (request !== validationSequence) { URL.revokeObjectURL(url); return; }
    if (!key) { URL.revokeObjectURL(url); publish({ error: "That image is not recognized. Drop a supported image here." }); return; }
    sequence = ++uploadSequence;
    accepted = true;
    if (timer) clearInterval(timer);
    if (session.sourceUrl) URL.revokeObjectURL(session.sourceUrl);
    const startedAt = Date.now();
    publish({ key, state: "processing", step: 0, startedAt, completedAt: null, sourceName: file.name,
      sourceUrl: url, maskUrl: null, maskPresented: false, error: "" });
    const mask = await buildMaskedFrame(DEMO_PRESETS[key].cleanImage);
    if (sequence !== uploadSequence) return;
    // Prepared privately, displayed by both panel and map only at stage 2.
    publish({ maskUrl: mask });
    timer = setInterval(() => {
      if (sequence !== uploadSequence) return;
      const step = Math.min(SAMPLE_STAGES.length, Math.floor((Date.now() - startedAt) / PROCESS_MESSAGE_MS));
      if (step >= SAMPLE_STAGES.length) {
        if (timer) clearInterval(timer);
        timer = null;
        publish({ state: "complete", step, completedAt: Date.now(),
          completed: session.completed.includes(key) ? session.completed : [...session.completed, key] });
      } else if (step !== session.step) publish({ step });
    }, 200);
  } catch {
    URL.revokeObjectURL(url);
    if (request !== validationSequence || sequence !== uploadSequence) return;
    if (!accepted) { publish({ error: "The image could not be decoded. Try uploading it again." }); return; }
    if (timer) clearInterval(timer);
    timer = null;
    publish({ state: "idle", sourceUrl: null, error: "The image could not be decoded. Try uploading it again." });
  }
}

export function SampleEvidenceImages({ sample }: { sample: DemoSampleKey }) {
  const preset = DEMO_PRESETS[sample];
  const [mask, setMask] = useState<string | null>(MASK_CANVAS_CACHE.get(preset.cleanImage) ?? null);
  useEffect(() => {
    let alive = true;
    buildMaskedFrame(preset.cleanImage).then(value => { if (alive) setMask(value); });
    return () => { alive = false; };
  }, [preset.cleanImage]);
  return <div className="grid gap-2 p-2" data-sample-evidence={sample}>
    {[["SAR input", preset.sampleImage], ["Cleaned image", preset.cleanImage], ["Detection boundary", mask]].map(([label, url]) =>
      <figure key={label} className="border" style={{ borderColor: "var(--line)" }}>
        <figcaption className="px-2 py-1 text-[10px] uppercase" style={{ color: "var(--ink-faint)" }}>{sample} · {label}</figcaption>
        {url && <img src={url} alt={sample + " " + label} className="max-h-48 w-full object-contain bg-white" />}
      </figure>)}
  </div>;
}

export function SampleImagePanel({ onSelect }: { onSelect: (key: DemoSampleKey) => void }) {
  const current = useSampleSession();
  const input = useRef<HTMLInputElement>(null);
  const processing = current.state === "processing";
  const maskReady = current.step >= 2 && !!current.maskUrl;
  const message = processing ? SAMPLE_STAGES[current.step] : current.state === "complete" ? "Complete" : "";
  const upload = (files: FileList | null) => { if (files?.[0]) void uploadSample(files[0]); };
  return <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" style={SCROLL} data-console-image-lab>
    <GroupHead right={<Flag tone="warn">simulated</Flag>}>add image</GroupHead>
    <div className="mt-2 border border-dashed p-3" style={{ borderColor: "var(--accent)" }}
      tabIndex={0} aria-label="Drop images here"
      onDragOver={event => event.preventDefault()}
      onDrop={event => { event.preventDefault(); upload(event.dataTransfer.files); }}
      onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); upload(event.clipboardData.files); } }}>
      <p className="text-[11px]">Drop images here.</p>
      <button type="button" onClick={() => input.current?.click()}
        className="mt-3 cursor-pointer border px-3 py-2 text-[11px] uppercase"
        style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>Upload image</button>
      <input ref={input} type="file" accept="image/*" className="hidden" aria-label="Image file"
        onChange={event => { upload(event.target.files); event.target.value = ""; }} />
      {current.error && <p role="alert" className="mt-2 text-[11px]" style={{ color: "var(--alarm)" }}>{current.error}</p>}
    </div>
    {current.key && current.sourceUrl && <div className="mt-3 space-y-3">
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-[11px]" data-sample-stage={current.step}>
        {processing && <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />}
        <span>{message}</span>
      </div>
      <p className="num text-[10px]" style={{ color: "var(--ink-faint)" }}>{current.sourceName}</p>
      <figure className="border" style={{ borderColor: "var(--line)" }}>
        <figcaption className="px-2 py-1 text-[10px] uppercase">Uploaded image</figcaption>
        <img src={current.sourceUrl} alt={current.key + " uploaded image"} className="max-h-48 w-full bg-white object-contain" />
      </figure>
      {maskReady && <figure className="border" style={{ borderColor: "var(--line)" }}>
        <figcaption className="px-2 py-1 text-[10px] uppercase">Cleaned image · red detection boundary</figcaption>
        <img src={current.maskUrl!} alt={current.key + " cleaned detection mask"} className="max-h-48 w-full bg-white object-contain" data-mask-ready
          onLoad={() => {
            const maskUrl = current.maskUrl;
            // A URL existing is not proof the browser has displayed its pixels.
            // Let the panel image paint before releasing detection to the map.
            requestAnimationFrame(() => requestAnimationFrame(() => {
              if (session.maskUrl === maskUrl && !session.maskPresented) publish({ maskPresented: true });
            }));
          }} />
      </figure>}
      {current.state === "complete" && <>
        <p className="text-[11px]" style={{ color: "var(--accent)" }}>Complete · hindcast, forecast, traffic and evidence available.</p>
        <button type="button" className="cursor-pointer border px-3 py-2 text-[11px] uppercase"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }} onClick={() => onSelect(current.key!)}>View {current.key} animation</button>
        <p className="text-[10px]" style={{ color: "var(--ink-faint)" }}>−36 h hindcast · +72 h forecast · model timing in the Panels menu</p>
      </>}
    </div>}
  </div>;
}
