/**
 * Precomputed upload results: the segmenter's output for a known file, made
 * earlier, used on request instead of a live run.
 *
 * WHY. The live segmenter takes seconds on WebGPU and tens of seconds on WASM,
 * and a demonstration should not stall on it. So the upload panel always offers
 * "Use precomputed result" (FUTURE_WORK.md §1.5): instant, and labelled as
 * precomputed wherever the result is shown.
 *
 * WHAT MAKES IT HONEST. A stored result is only ever the live result, stored:
 *
 *  - it is made OFFLINE by the same code the browser runs (`segment` in
 *    `segmenter.ts`, onnxruntime-web on WASM), by
 *    `scripts/precompute-uploads.ts`, and `check:precomputed` recomputes every
 *    entry whose file is on disk and demands the identical mask;
 *  - it is keyed by the SHA-256 of the file's bytes, so a renamed copy still
 *    finds it and a different file with the same name never does;
 *  - it records the model's SHA-256 and is refused for any other model, so a
 *    retrained release can never be shown a previous model's answer;
 *  - only the segmentation is stored. Decoding, tracing, the despeckled copy,
 *    the coastline and the drift all run live on the file in hand.
 *
 * The same contract is what the live pipeline (§3, `POST /runs`) has to honour:
 * one button, the precomputed answer for this exact input, and a label.
 */

import type { Detection, Segmentation } from "./segmenter";

export const PRECOMPUTED_DIR = "precomputed/";

export interface PrecomputedEntry {
  version: 1;
  /** The file name it was computed from, for the label. */
  file: string;
  /** Repository-relative path of that file, for provenance and the check. */
  source: string;
  /** SHA-256 of the file's bytes, hex. */
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  model: { name: string; sha256: string };
  /** What ran it, stated on the result. */
  engine: string;
  computedAt: string;
  inferMs: number;
  tiles: number;
  detections: Detection[];
  /** The scene mask, row-major, as run lengths alternating 0 and 1, starting with 0. */
  maskRuns: number[];
  /** Anything about how the file was read that the label should carry. */
  decodeNote?: string;
}

export interface PrecomputedIndex {
  version: 1;
  /** File SHA-256 to the entry's file name in `PRECOMPUTED_DIR`. */
  entries: Record<string, string>;
}

export type Lookup = { ok: true; entry: PrecomputedEntry } | { ok: false; reason: string };

/** Run lengths of a 0/1 mask, alternating, starting with a run of zeros (possibly empty). */
export function encodeRuns(mask: Uint8Array): number[] {
  const runs: number[] = [];
  let value = 0;
  let length = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 1 : 0;
    if (v === value) {
      length++;
      continue;
    }
    runs.push(length);
    value = v;
    length = 1;
  }
  runs.push(length);
  return runs;
}

export function decodeRuns(runs: number[], length: number): Uint8Array {
  const mask = new Uint8Array(length);
  let at = 0;
  for (let r = 0; r < runs.length; r++) {
    const n = runs[r];
    if (!Number.isInteger(n) || n < 0 || at + n > length) throw new Error("mask runs overrun the mask");
    if (r % 2 === 1) mask.fill(1, at, at + n);
    at += n;
  }
  if (at !== length) throw new Error(`mask runs cover ${at} of ${length} pixels`);
  return mask;
}

/** SHA-256 of some bytes, lower-case hex. WebCrypto: the browser and Node alike. */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  // A copy, so the digest never sees a view onto a larger shared buffer.
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whether a stored entry may stand in for this file under this model, and if not, why not. */
export function acceptEntry(
  entry: PrecomputedEntry,
  want: { sha256: string; modelSha256: string; width?: number; height?: number },
): Lookup {
  if (entry.version !== 1) return { ok: false, reason: `unknown precomputed format (version ${entry.version})` };
  if (entry.sha256 !== want.sha256) return { ok: false, reason: "the stored result is for a different file" };
  if (entry.model.sha256 !== want.modelSha256)
    return { ok: false, reason: "the stored result was made by a different model than the one loaded now" };
  if (want.width !== undefined && (entry.width !== want.width || entry.height !== want.height))
    return { ok: false, reason: `the stored result is ${entry.width} x ${entry.height}, the raster is ${want.width} x ${want.height}` };
  const total = entry.maskRuns.reduce((s, n) => s + n, 0);
  if (total !== entry.width * entry.height)
    return { ok: false, reason: `the stored mask covers ${total} of ${entry.width * entry.height} pixels` };
  return { ok: true, entry };
}

/** The stored result in the shape the rest of the upload path consumes. */
export function toSegmentation(entry: PrecomputedEntry): Segmentation {
  return {
    mask: decodeRuns(entry.maskRuns, entry.width * entry.height),
    width: entry.width,
    height: entry.height,
    detections: entry.detections,
    tiles: entry.tiles,
    ms: entry.inferMs,
  };
}

type JsonLoader = (path: string) => Promise<unknown>;

let loader: JsonLoader = async (path) => {
  const response = await fetch(path);
  // A static host answers a missing file with its index page; only JSON counts.
  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json")) return null;
  return response.json();
};

/** Swap the fetcher, for Node checks that read `public/` from disk. */
export function setPrecomputedLoader(next: JsonLoader) {
  loader = next;
}

/** The stored result for this file under this model, or why there is none. */
export async function findPrecomputed(sha256: string, modelSha256: string): Promise<Lookup> {
  const index = (await loader(`${PRECOMPUTED_DIR}index.json`)) as PrecomputedIndex | null;
  const name = index?.entries?.[sha256];
  if (!name) return { ok: false, reason: "no precomputed result exists for this file; it has to run live" };
  const entry = (await loader(`${PRECOMPUTED_DIR}${name}`)) as PrecomputedEntry | null;
  if (!entry) return { ok: false, reason: `the precomputed result ${name} could not be read` };
  return acceptEntry(entry, { sha256, modelSha256 });
}
