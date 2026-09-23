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
import { useFixedLzw } from "./lzw";
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
  /** 1 where the source holds data; null when every pixel does. */
  valid: Uint8Array | null;
  /** Share of the raster that is no-data (non-finite, or a float zero). */
  noDataFraction: number;
}

/**
 * Which values of a band are no-data: non-finite always, and exactly zero in
 * a float raster, where the corpus zero-fills outside the swath (the release
 * manifest's `masked_zero`). In an 8-bit raster zero is a real grey level.
 */
function noDataTest(data: ArrayLike<number>): (v: number) => boolean {
  const float = data instanceof Float32Array || data instanceof Float64Array;
  return float ? (v) => !Number.isFinite(v) || v === 0 : (v) => !Number.isFinite(v);
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
    const geotiff = await import("geotiff");
    // geotiff.js's own LZW dictionary is three entries short and throws on a
    // sizeable share of the corpus; see `lzw.ts` and ISSUES.md F16.
    useFixedLzw(geotiff);
    ({ fromArrayBuffer } = geotiff);
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
    Which band: the co-polarised one, identified by its level.

    The corpus scenes carry two bands with no names on them (DATA.md D5). This
    used to take the band with the larger standard deviation, which reads like
    "the band with more contrast" and is the opposite. On Part I the wider
    spread is band 1, VH, sitting near the noise floor, where the spread IS the
    speckle and the slick is not there at all. Measured against the ground-truth
    masks over 60 corpus scenes, oil sat a median 0.5 dB from the water in band
    1 and 5.5 dB in band 2; the panel showed band 1 for 37 of 40 Part I scenes,
    and the oil an operator was looking for was 3 grey levels from the sea.

    Oil damps the short Bragg waves the co-polarised return comes from, so VV
    (or HH) is where it shows. Over the sea the co-polarised return sits well
    above the cross-polarised one, so the band with the higher median
    backscatter IS the co-polarised band, whatever order the file stores them
    in. On every corpus scene measured that is band 2 -- the band the training
    loader reads (`SAR_BAND` in ml/datasets/oos_dataset.py) -- and here it is
    read off the pixels rather than assumed from the position.

    `npm run check:geotiff` decodes real train scenes through this function and
    fails if the oil is not visible in what comes out.

    NO-DATA IS NOT DATA. Scenes cut at a swath edge are zero-filled: 14 of 121
    Part I scenes sampled carry some, 3 carry more than half a frame. The release
    manifest records the convention (`masked_zero: true`) and `infer_scene`
    excludes those pixels. Counted in, a 61%-empty scene has a median of 0 dB in
    BOTH bands, the tie went to band 1, and the segmenter was handed VH and
    marked a fifth of the frame. So zeros in a float raster are no-data
    throughout: not in the band statistics, not in the mapping, and not
    available to a detection.
  */
  const bandCount = Math.max(1, image.getSamplesPerPixel());
  let raster: ArrayLike<number>;
  let band = 1;
  let bandNote = "single band";
  try {
    const candidates: { index: number; data: ArrayLike<number>; median: number }[] = [];
    for (let s = 0; s < Math.min(bandCount, 4); s++) {
      const read = (await image.readRasters({ samples: [s] })) as ArrayLike<number>[];
      const data = read[0];
      const noData = noDataTest(data);
      const sample = new Float64Array(Math.ceil(data.length / 7));
      let n = 0;
      for (let i = 0; i < data.length; i += 7) {
        const v = data[i];
        if (!noData(v)) sample[n++] = v;
      }
      const sorted = sample.subarray(0, n).sort();
      candidates.push({ index: s, data, median: n ? sorted[n >> 1] : -Infinity });
    }
    const best = candidates.reduce((a, b) => (b.median > a.median ? b : a));
    raster = best.data;
    band = best.index + 1;
    if (bandCount > 1) {
      const others = candidates.filter((c) => c !== best).map((c) => c.median.toFixed(1)).join(", ");
      bandNote =
        `band ${band} of ${bandCount}, the brighter by median (${best.median.toFixed(1)} dB against ` +
        `${others}), which on a dual-pol scene is the co-polarised band`;
    }
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

    Both of those scenes were measured on band 1, VH, which the band choice
    above no longer picks. Band 2 fits the window on all 60 corpus scenes
    measured (at most 2.3% clipped), so on the corpus this fallback should not
    fire; it stays for a raster that genuinely sits outside the window.
  */
  const [windowLow, windowHigh] = DB_WINDOW;
  const noData = noDataTest(raster);
  let min = Infinity;
  let max = -Infinity;
  let finiteCount = 0;
  let clipped = 0;
  let valid: Uint8Array | null = null;
  for (let i = 0; i < raster.length; i++) {
    const v = raster[i];
    if (noData(v)) {
      // Allocated on the first no-data pixel: most scenes never need it.
      if (!valid) { valid = new Uint8Array(raster.length).fill(1); }
      valid[i] = 0;
      continue;
    }
    finiteCount++;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v < windowLow || v > windowHigh) clipped++;
  }
  if (!finiteCount) return { ok: false, reason: "The raster holds no valid values." };
  const noDataFraction = 1 - finiteCount / raster.length;

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
    // No-data renders as 0 dB -- the top of the window, white -- because that is
    // what `infer_scene` and the training loader feed the model for it.
    if (valid && !valid[i]) grey = scaledThroughWindow ? 255 : 0;
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
      valid,
      noDataFraction,
    },
  };
}
