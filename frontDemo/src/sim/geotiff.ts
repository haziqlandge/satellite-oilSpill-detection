/**
 * Reading a GeoTIFF, which is the only upload whose position is MEASURED.
 *
 * Everything else the console accepts is a picture. A PNG from the corpus has
 * no geotransform and no CRS -- DATA.md records Part I as carrying none -- so
 * the operator has to state where it is, and the run is stamped with the fact
 * that they did. A GeoTIFF carries its own answer, and this reads it.
 *
 * That difference is worth the dependency. A position an operator typed is a
 * claim; a position out of the geotransform is a measurement, and every number
 * that hangs off it -- which wind, which AIS window, which vessels were within
 * reach -- inherits whichever it was.
 *
 * The decoder is imported dynamically, so the library is fetched the first time
 * somebody drops a TIFF and never on the path that only ever sees PNGs.
 *
 * WHAT IT WILL REFUSE, and why refusing is right:
 *
 *  - **a projected CRS.** Reprojecting needs a full transform stack, and
 *    guessing that a UTM easting is a longitude would silently put the scene in
 *    the wrong ocean. EPSG:4326 is read; anything else is named and declined
 *  - **a file with no geotransform.** A TIFF is not necessarily a GeoTIFF. One
 *    without a tie point has no more position than a PNG, so it is handled as
 *    one rather than being given an invented extent
 *  - **an overview-sized monster.** The processed scenes are 3.58 GB and no
 *    browser will open one. `scripts/cut_geotiff_window.py` cuts a real
 *    georeferenced window out of a scene for exactly this path
 */

import { DB_WINDOW } from "./ingest";
import { kmPerDegLon, KM_PER_DEG_LAT } from "./geo";
import type { LngLat } from "./types";

export interface GeoRaster {
  /** 8-bit RGBA, for the same screen a PNG goes through. */
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** Centre of the raster, from its geotransform. */
  centre: LngLat;
  /** Ground width of the raster, km, from its geotransform. */
  acrossKm: number;
  /** Acquisition instant from the file's own tag, if it carries one. */
  acquiredAt: number | null;
  /** Range of the source values, for the panel to show what it mapped. */
  lowDb: number;
  highDb: number;
  /** Whether the source was float sigma-0 dB rather than already 8-bit. */
  scaledThroughWindow: boolean;
}

export type GeoTiffOutcome =
  | { ok: true; raster: GeoRaster }
  | { ok: false; reason: string };

/** True for anything worth handing to the GeoTIFF decoder. */
export function looksLikeTiff(file: File): boolean {
  return /tiff?$/i.test(file.name) || /image\/tiff/i.test(file.type);
}

/** `YYYY:MM:DD HH:MM:SS`, the TIFF datetime convention. */
function parseTiffDateTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  return Number.isFinite(ms) ? ms : null;
}

export async function decodeGeoTiff(file: File): Promise<GeoTiffOutcome> {
  let fromArrayBuffer: (b: ArrayBuffer) => Promise<{
    getImage: (i?: number) => Promise<unknown>;
  }>;
  try {
    ({ fromArrayBuffer } = await import("geotiff"));
  } catch {
    return { ok: false, reason: "The GeoTIFF decoder could not be loaded." };
  }

  let image: {
    getWidth(): number;
    getHeight(): number;
    getBoundingBox(): number[];
    getSamplesPerPixel(): number;
    getGeoKeys(): Record<string, unknown> | null;
    getFileDirectory(): Record<string, unknown>;
    readRasters(options?: unknown): Promise<unknown>;
  };
  try {
    const tiff = await fromArrayBuffer(await file.arrayBuffer());
    image = (await tiff.getImage()) as typeof image;
  } catch {
    return { ok: false, reason: "That file could not be read as a TIFF." };
  }

  const width = image.getWidth();
  const height = image.getHeight();
  if (width * height > 64_000_000) {
    return {
      ok: false,
      reason:
        `This raster is ${width} x ${height}, which is beyond what a browser will decode. ` +
        "Cut a window with scripts/cut_geotiff_window.py.",
    };
  }

  const keys = image.getGeoKeys() ?? {};
  const epsg = Number(keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey ?? 0);
  const bbox = image.getBoundingBox();
  const hasExtent =
    Array.isArray(bbox) && bbox.length === 4 && bbox.every((v) => Number.isFinite(v)) &&
    bbox[2] !== bbox[0] && bbox[3] !== bbox[1];
  if (!hasExtent) {
    return { ok: false, reason: "This TIFF carries no geotransform, so it has no position to read." };
  }
  if (keys.ProjectedCSTypeGeoKey || (epsg && epsg !== 4326)) {
    return {
      ok: false,
      reason:
        `This raster is in EPSG:${epsg || "unknown"}, and only EPSG:4326 is read. ` +
        "Reprojecting here would risk placing the scene in the wrong ocean.",
    };
  }
  const [west, south, east, north] = bbox;
  if (Math.abs(west) > 180 || Math.abs(east) > 180 || Math.abs(south) > 90 || Math.abs(north) > 90) {
    return { ok: false, reason: "The geotransform is not in degrees; only EPSG:4326 is read." };
  }

  let raster: ArrayLike<number>;
  try {
    const bands = (await image.readRasters({ samples: [0] })) as ArrayLike<number>[];
    raster = bands[0];
  } catch {
    return { ok: false, reason: "The raster bands could not be read." };
  }

  /*
    Float sigma-0 dB becomes 8-bit through the project's FIXED window.

    Not a per-image stretch. Two tiles rendered through their own min and max
    are on two different scales, and a grey value then means nothing between
    them -- which is the defect DATA.md D6 records in the corpus itself. Using
    the recorded window means an uploaded GeoTIFF is on the same scale as every
    PNG the screen has ever seen, so one threshold is meaningful for both.
  */
  const [lowDb, highDb] = DB_WINDOW;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < raster.length; i++) {
    const v = raster[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // Already-8-bit data is passed through; only dB-scaled values are windowed.
  const scaledThroughWindow = min < 0 || max <= 1;
  const span = highDb - lowDb;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const value = raster[i];
    let grey: number;
    if (!Number.isFinite(value)) grey = 0;
    else if (scaledThroughWindow) grey = Math.round(((value - lowDb) / span) * 255);
    else grey = Math.round(value);
    const clamped = grey < 0 ? 0 : grey > 255 ? 255 : grey;
    const p = i * 4;
    rgba[p] = clamped;
    rgba[p + 1] = clamped;
    rgba[p + 2] = clamped;
    rgba[p + 3] = 255;
  }

  const directory = image.getFileDirectory();
  const acquiredAt =
    parseTiffDateTime(directory.DateTime) ??
    parseTiffDateTime((directory as { TIFFTAG_DATETIME?: unknown }).TIFFTAG_DATETIME);

  const centre: LngLat = [(west + east) / 2, (south + north) / 2];
  const acrossKm = Math.abs(east - west) * kmPerDegLon(centre[1]);
  // Sanity: a geotransform that claims a 1 cm or 20,000 km scene is not one we
  // should be building a drift run on.
  const downKm = Math.abs(north - south) * KM_PER_DEG_LAT;
  if (!(acrossKm > 0.05 && acrossKm < 5000 && downKm > 0.05)) {
    return { ok: false, reason: `The geotransform implies a ${acrossKm.toFixed(2)} km scene, which is not usable.` };
  }

  return {
    ok: true,
    raster: {
      rgba, width, height, centre, acrossKm, acquiredAt,
      lowDb: Number.isFinite(min) ? min : lowDb,
      highDb: Number.isFinite(max) ? max : highDb,
      scaledThroughWindow,
    },
  };
}
