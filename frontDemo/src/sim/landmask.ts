/**
 * Where the water stops, anywhere on Earth.
 *
 * The drift integrator was a random walk on an unbounded plane, so backward
 * reconstruction put origins on top of the Mississippi delta and ran the Kutch
 * scene across the Saurashtra peninsula. Oil does not drift through Louisiana,
 * and a hindcast that says it came from Venice is not a weak result, it is a
 * wrong one -- the whole claim of the system is that the origin field is
 * somewhere a vessel could have been.
 *
 * ONE COASTLINE FOR THE WHOLE SYSTEM. The mask is the GSHHG full-resolution
 * shoreline -- the same polygons OpenDrift's landmask answers from when the
 * backend strands or slides a parcel -- rasterised by `scripts/build_landmask.py`
 * onto 1/240 degree cells (~460 m), which is also the grid of OpenDrift's own
 * raster. The backend's point-in-polygon answer is authoritative; this is that
 * answer sampled at cell centres, and `tests/test_landmask.py` checks the two
 * agree.
 *
 * It used to be a classification of basemap pixel colour, built for three
 * hand-drawn boxes, with every point outside them answered as water. Uploads
 * over Bali and Java drifted inland and drew shipping lanes across the islands
 * because of that one gap, and OpenDrift's parcels had to be nudged off the
 * beach because the two halves of the system disagreed about where it was.
 *
 * HOW IT IS STORED. The globe is cut into 5 degree tiles. `TILE_KINDS` says,
 * for every tile, whether it is all water, all land or mixed, so open ocean and
 * continental interiors are answered synchronously everywhere. A mixed tile's
 * cells are one bit each, run-length encoded; the tiles the authored scenes
 * need are bundled, and the rest are fetched from this project's own static
 * files by `ensureLandmask` before an upload runs. Nothing is fetched from a
 * third-party service.
 */

import {
  BUNDLED_TILES,
  CELLS_PER_DEG,
  LANDMASK_SOURCE,
  TILE_DEG,
  TILE_KINDS,
} from "./landmask.generated";
import type { LngLat } from "./types";

export { LANDMASK_SOURCE };

const TILE_CELLS = TILE_DEG * CELLS_PER_DEG;
const TILE_COLS = 360 / TILE_DEG;
const TILE_ROWS = 180 / TILE_DEG;
const KIND_WATER = 48; // "0"
const KIND_LAND = 49; // "1"

/** Encoded streams, by tile index: bundled ones now, fetched ones as they arrive. */
const streams = new Map<number, Uint8Array | string>(BUNDLED_TILES);
/** Decoded bits, by tile index, filled on first touch. */
const bits = new Map<number, Uint8Array>();

/**
 * One tile's run-length stream as packed bits, row-major from its south-west
 * corner, LSB first.
 *
 * The stream alternates water and land runs, starting with water, each an
 * unsigned LEB128 varint. Its twin is `decode_tile` in the build script.
 */
export function decodeTile(stream: Uint8Array): Uint8Array {
  const cells = TILE_CELLS * TILE_CELLS;
  const out = new Uint8Array(cells >> 3);
  let position = 0;
  let land = false;
  let run = 0;
  let shift = 0;
  for (let i = 0; i < stream.length; i++) {
    const byte = stream[i];
    run += (byte & 0x7f) * 2 ** shift;
    if (byte & 0x80) {
      shift += 7;
      continue;
    }
    if (land) setRange(out, position, position + run);
    position += run;
    land = !land;
    run = 0;
    shift = 0;
  }
  if (position !== cells) throw new Error(`land tile decodes to ${position} cells, expected ${cells}`);
  return out;
}

/** Set bits [start, end), whole bytes at a time where it can. */
function setRange(out: Uint8Array, start: number, end: number): void {
  let i = start;
  while (i < end && i & 7) out[i >> 3] |= 1 << (i++ & 7);
  const wholeEnd = end & ~7;
  if (i < wholeEnd) {
    out.fill(0xff, i >> 3, wholeEnd >> 3);
    i = wholeEnd;
  }
  while (i < end) out[i >> 3] |= 1 << (i++ & 7);
}

function base64Bytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function tileBits(index: number): Uint8Array | null {
  const hit = bits.get(index);
  if (hit) return hit;
  const stream = streams.get(index);
  if (stream === undefined) return null;
  const decoded = decodeTile(typeof stream === "string" ? base64Bytes(stream) : stream);
  bits.set(index, decoded);
  streams.delete(index);
  return decoded;
}

function tileOf(lon: number, lat: number): { index: number; row: number; col: number } {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  const row = Math.min(TILE_ROWS - 1, Math.max(0, Math.floor((lat + 90) / TILE_DEG)));
  const col = Math.min(TILE_COLS - 1, Math.max(0, Math.floor((wrapped + 180) / TILE_DEG)));
  return { index: row * TILE_COLS + col, row, col };
}

/**
 * True when this coordinate is dry ground.
 *
 * A mixed tile that has not been loaded answers water, which is why an upload
 * awaits `ensureLandmask` before drifting and why `landKnown` exists for code
 * that needs to tell "water" from "not loaded".
 */
export function isLand(lon: number, lat: number): boolean {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  const { index, row, col } = tileOf(lon, lat);
  const kind = TILE_KINDS.charCodeAt(index);
  if (kind === KIND_WATER) return false;
  if (kind === KIND_LAND) return true;
  const tile = tileBits(index);
  if (!tile) return false;
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  const x = Math.min(TILE_CELLS - 1, Math.floor((wrapped + 180 - col * TILE_DEG) * CELLS_PER_DEG));
  const y = Math.min(TILE_CELLS - 1, Math.floor((lat + 90 - row * TILE_DEG) * CELLS_PER_DEG));
  const cell = y * TILE_CELLS + x;
  return (tile[cell >> 3] & (1 << (cell & 7))) !== 0;
}

/** Whether `isLand` gives a real answer here, rather than "water" by default. */
export function landKnown(lon: number, lat: number): boolean {
  const { index } = tileOf(lon, lat);
  const kind = TILE_KINDS.charCodeAt(index);
  return kind === KIND_WATER || kind === KIND_LAND || bits.has(index) || streams.has(index);
}

/**
 * The fraction of a path that lies on land, sampled at `steps` points.
 *
 * This is the programmatic form of the by-hand corridor check recorded in
 * `scenarios.ts`. It exists so a shipping lane can be verified against the same
 * mask the drift uses, rather than against a separate reading of the basemap.
 */
export function landFraction(
  from: [number, number],
  to: [number, number],
  steps = 25,
): number {
  let ashore = 0;
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    if (isLand(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t)) ashore++;
  }
  return ashore / steps;
}

/* ------------------------------------------------------------------ *
 * Loading the tiles an upload needs
 * ------------------------------------------------------------------ */

/** Reads one packed latitude band. Swappable so Node checks can read from disk. */
export type BandLoader = (file: string) => Promise<Uint8Array>;

let loadBand: BandLoader = async (file) => {
  const response = await fetch(`landmask/${file}`);
  if (!response.ok) throw new Error(`land mask ${file}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

export function setBandLoader(loader: BandLoader): void {
  loadBand = loader;
}

export const bandFile = (row: number) => `band_${String(row).padStart(2, "0")}.bin`;

const bandsLoaded = new Set<number>();
const bandsPending = new Map<number, Promise<void>>();

/** Unpack a band: "LMB1", u16 count, count x (u8 col, u32 offset, u32 length), payload. */
function registerBand(row: number, blob: Uint8Array): void {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const magic = String.fromCharCode(blob[0], blob[1], blob[2], blob[3]);
  if (magic !== "LMB1") throw new Error(`land mask band ${row}: bad header`);
  const count = view.getUint16(4, true);
  const base = 6 + count * 9;
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 9;
    const col = view.getUint8(at);
    const offset = view.getUint32(at + 1, true);
    const length = view.getUint32(at + 5, true);
    const index = row * TILE_COLS + col;
    if (!bits.has(index) && !streams.has(index)) {
      streams.set(index, blob.subarray(base + offset, base + offset + length));
    }
  }
  bandsLoaded.add(row);
}

async function ensureBand(row: number): Promise<boolean> {
  if (bandsLoaded.has(row)) return false;
  const inFlight = bandsPending.get(row);
  if (inFlight) {
    await inFlight;
    return false;
  }
  const work = loadBand(bandFile(row)).then((blob) => registerBand(row, blob));
  bandsPending.set(row, work);
  try {
    await work;
    return true;
  } finally {
    bandsPending.delete(row);
  }
}

export interface LandmaskBuild {
  /** Mixed coastal tiles covering the area. */
  tiles: number;
  /** Band files fetched by this call; zero when everything was already known. */
  fetched: number;
  /** Fraction of the area that is land, sampled on a 64 x 64 grid. */
  landFraction: number;
  ms: number;
}

/** The lon/lat box `radiusKm` around `centre`, clamped to the globe. */
function boxAround(centre: LngLat, radiusKm: number) {
  const latPad = radiusKm / 110.574;
  const lonPad = radiusKm / Math.max(1, 111.32 * Math.cos((centre[1] * Math.PI) / 180));
  return {
    west: centre[0] - lonPad,
    east: centre[0] + lonPad,
    south: Math.max(-90, centre[1] - latPad),
    north: Math.min(90, centre[1] + latPad),
  };
}

/**
 * Make sure land is known around `centre` out to `radiusKm`.
 *
 * Only mixed tiles need anything fetched; the rest are answered from the index.
 * Concurrent calls for the same band share one fetch.
 */
export async function ensureLandmask(centre: LngLat, radiusKm: number): Promise<LandmaskBuild> {
  const started = performance.now();
  const { west, east, south, north } = boxAround(centre, radiusKm);
  const rows = new Set<number>();
  let tiles = 0;
  const rowFrom = Math.max(0, Math.floor((south + 90) / TILE_DEG));
  const rowTo = Math.min(TILE_ROWS - 1, Math.floor((north + 90) / TILE_DEG));
  const colFrom = Math.floor((west + 180) / TILE_DEG);
  const colTo = Math.floor((east + 180) / TILE_DEG);
  for (let row = rowFrom; row <= rowTo; row++) {
    for (let c = colFrom; c <= colTo; c++) {
      const index = row * TILE_COLS + (((c % TILE_COLS) + TILE_COLS) % TILE_COLS);
      const kind = TILE_KINDS.charCodeAt(index);
      if (kind === KIND_WATER || kind === KIND_LAND) continue;
      tiles++;
      if (!bits.has(index) && !streams.has(index)) rows.add(row);
    }
  }
  const fetched = (await Promise.all([...rows].map(ensureBand))).filter(Boolean).length;

  let land = 0;
  const N = 64;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (isLand(west + ((i + 0.5) / N) * (east - west), south + ((j + 0.5) / N) * (north - south))) land++;
    }
  }
  return { tiles, fetched, landFraction: land / (N * N), ms: Math.round(performance.now() - started) };
}
