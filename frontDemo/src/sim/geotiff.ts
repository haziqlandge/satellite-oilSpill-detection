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
  /** Which band was used, 1-based, and why. */
  band: number;
  bandCount: number;
  bandNote: string;
  /** The dB range actually mapped to 0-255. */
  mappedLow: number;
  mappedHigh: number;
  /** True when the corpus window would have clipped most of the data away. */
  windowFallback: boolean;
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
  // `getBoundingBox` THROWS on a TIFF with no affine transform rather than
  // returning nothing, and an uncaught throw here surfaced as the generic
  // "could not be decoded" -- which tells an operator nothing about why. The
  // corpus ships masks beside its scenes under the same file name, so this is
  // the most likely wrong file to drop and it deserves a real answer.
  let bbox: number[] | null = null;
  try {
    bbox = image.getBoundingBox();
  } catch {
    bbox = null;
  }
  const hasExtent =
    bbox !== null &&
    Array.isArray(bbox) && bbox.length === 4 && bbox.every((v) => Number.isFinite(v)) &&
    bbox[2] !== bbox[0] && bbox[3] !== bbox[1];
  if (!hasExtent) {
    return {
      ok: false,
      reason:
        "This TIFF has no affine transform, so it carries no position. Corpus mask files are " +
        "like this — use the scene from the Images directory, not the one from Mask.",
    };
  }
  if (keys.ProjectedCSTypeGeoKey || (epsg && epsg !== 4326)) {
    return {
      ok: false,
      reason:
        `This raster is in EPSG:${epsg || "unknown"}, and only EPSG:4326 is read. ` +
        "Reprojecting here would risk placing the scene in the wrong ocean.",
    };
  }
  const [west, south, east, north] = bbox as number[];
  if (Math.abs(west) > 180 || Math.abs(east) > 180 || Math.abs(south) > 90 || Math.abs(north) > 90) {
    return { ok: false, reason: "The geotransform is not in degrees; only EPSG:4326 is read." };
  }

  /*
    Which band, decided by measurement rather than by assumption.

    DATA.md D5 records that the VV/VH band order in this corpus is an
    ASSUMPTION -- it was never read from metadata -- and that one band was found
    to carry about 0.51 dB of contrast, which is no signal at all. Measured
    across two real corpus scenes the order is not even consistent: band 1
    carries the wider spread in the Part I file (sd 3.12 against 1.82) and band 2
    in the Part III file (2.20 against 0.78).

    So the band with the greater standard deviation is used. That is a
    measurement of which band can discriminate anything, it is stated in the
    panel, and it does not pretend to have resolved D5. Hardcoding band 2 would
    have silently screened the Part I scene on its flattest channel.
  */
  const bandCount = Math.max(1, image.getSamplesPerPixel());
  let raster: ArrayLike<number>;
  let band = 1;
  let bandNote = "single band";
  try {
    const candidates: { index: number; data: ArrayLike<number>; sd: number }[] = [];
    for (let s = 0; s < Math.min(bandCount, 4); s++) {
      const read = (await image.readRasters({ samples: [s] })) as ArrayLike<number>[];
      const data = read[0];
      let sum = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 7) {
        const v = data[i];
        if (Number.isFinite(v)) { sum += v; n++; }
      }
      const mean = n ? sum / n : 0;
      let variance = 0;
      for (let i = 0; i < data.length; i += 7) {
        const v = data[i];
        if (Number.isFinite(v)) variance += (v - mean) ** 2;
      }
      candidates.push({ index: s, data, sd: n ? Math.sqrt(variance / n) : 0 });
    }
    const best = candidates.reduce((a, b) => (b.sd > a.sd ? b : a));
    raster = best.data;
    band = best.index + 1;
    if (bandCount > 1)
      bandNote = `band ${band} of ${bandCount}, chosen for the wider spread (sd ${best.sd.toFixed(2)} dB)`;
  } catch {
    return { ok: false, reason: "The raster bands could not be read." };
  }

  /*
    Float sigma-0 dB becomes 8-bit, through the corpus window WHERE THAT WORKS.

    The fixed window exists for a good reason: two tiles stretched to their own
    min and max are on two different scales and a grey value means nothing
    between them, which is the defect DATA.md D6 records in the corpus itself.
    So the recorded window is tried first.

    It does not always fit. Measured on real corpus GeoTIFFs, the Part I scene
    spans -48.5 to -21.4 dB and the Part III scene -39.0 to -27.3 dB, while the
    window is -35 to 0. Mapping the first through it sends everything below -35
    to pure black and compresses the rest into the bottom third of the scale;
    the second nearly vanishes. That is not a display preference, it destroys
    the contrast the screen then has to threshold, and a screen run on a black
    image finds nothing.

    So: if the window would clip more than a fifth of the pixels, the raster's
    own robust range is used instead and the panel SAYS which mapping it got.
    Comparability across tiles is the thing being traded away, and it is worth
    naming rather than losing silently.
  */
  const [windowLow, windowHigh] = DB_WINDOW;
  let min = Infinity;
  let max = -Infinity;
  let finiteCount = 0;
  let clipped = 0;
  for (let i = 0; i < raster.length; i++) {
    const v = raster[i];
    if (!Number.isFinite(v)) continue;
    finiteCount++;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v < windowLow || v > windowHigh) clipped++;
  }
  if (!finiteCount) return { ok: false, reason: "The raster holds no finite values." };

  // Already-8-bit data is passed through; only dB-scaled values are windowed.
  const scaledThroughWindow = min < 0;
  const clipFraction = clipped / finiteCount;
  const windowFallback = scaledThroughWindow && clipFraction > 0.2;

  /*
    A near-binary raster is a label mask, not an image.

    The corpus ships masks beside its scenes under names that differ only by a
    directory, so dropping one is an easy mistake, and screening a mask returns
    a confident outline of the answer rather than of the oil. Two distinct
    values over a 2048 square raster is not a SAR scene.
  */
  if (max - min <= 1.0001 && finiteCount > 1000) {
    return {
      ok: false,
      reason:
        `This raster holds only values ${min} to ${max}, which is a label mask rather than a ` +
        "SAR image. Use the scene from the Images directory, not the one from Mask.",
    };
  }

  let mappedLow = windowLow;
  let mappedHigh = windowHigh;
  if (!scaledThroughWindow) {
    mappedLow = 0;
    mappedHigh = 255;
  } else if (windowFallback) {
    mappedLow = min;
    mappedHigh = max;
  }
  const span = mappedHigh - mappedLow || 1;

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const value = raster[i];
    let grey: number;
    if (!Number.isFinite(value)) grey = 0;
    else if (scaledThroughWindow) grey = Math.round(((value - mappedLow) / span) * 255);
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
      lowDb: +min.toFixed(2),
      highDb: +max.toFixed(2),
      scaledThroughWindow,
      band, bandCount, bandNote,
      mappedLow: +mappedLow.toFixed(2),
      mappedHigh: +mappedHigh.toFixed(2),
      windowFallback,
    },
  };
}
