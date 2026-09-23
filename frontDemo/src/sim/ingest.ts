/**
 * Reading a real raster: what can honestly be derived from an uploaded image.
 *
 * The panel this replaces did not read uploads at all. It fingerprinted the
 * file against three supplied JPEGs, refused anything else, and then built its
 * mask from a stored preset image rather than from the pixels it had just
 * been handed, behind four five-second timers. Nothing about the upload reached
 * the result.
 *
 * TWO PATHS LIVE HERE. `ribbonFromMask` traces the trained segmenter's mask,
 * and is what every upload and every authored sample uses. `extractRibbon`
 * below is the dark-region screen it replaced -- on the Part I corpus that
 * screen outlined the sea -- kept only for `check:ingest`.
 *
 * WHAT THE SCREEN IS, SAID PLAINLY. It is a dark-region threshold screen. It is
 * NOT the trained segmenter, and the interface must never present it as one.
 * The release weights are a single class, `slick`, and the project's own
 * research is explicit that oil cannot be separated from natural films by SAR
 * intensity alone -- so a threshold cannot be, and is not, a detection. What it
 * can do is find the dark region a person is pointing at, which is exactly what
 * an upload needs in order to have geometry to drift.
 *
 * It began as the screen an older offline script ran over the supplied
 * samples, with two differences, both deliberate:
 *
 *  - the threshold is chosen from the image rather than fixed at 100, because a
 *    fixed cut is a statement about one set of JPEGs and the corpus spans two
 *    intensity scalings (DATA.md D6)
 *  - the scan axis is measured rather than hardcoded per sample
 *
 * Extraction runs on a decimated copy. That is not only for speed: it is the
 * cheap first pass PHASE-03 describes, where a coarse screen decides which
 * windows are worth looking at before anything expensive happens. A 2048-pixel
 * tile carries speckle that a coarse pass averages away for free.
 */

/**
 * The fixed dB window the corpus was rendered through.
 *
 * Recorded here because it is what makes an 8-bit PNG from this dataset
 * comparable at all: Part I and Part III were written through this window, so
 * a grey value means the same thing between tiles. A per-image stretch would
 * make each tile its own scale. It is not applied to PNG or JPEG input -- that
 * has already been through it -- and it is what a float32 GeoTIFF path would
 * apply. See PREVIOUS_WORK.md section 2.2.
 */
export const DB_WINDOW: readonly [number, number] = [-35.0, 0.0];

/** The longest edge extraction works on. Above this the image is decimated. */
const SCREEN_MAX = 1024;

/** Beyond this fraction of the frame, the dark region is the sea, not a slick. */
const MAX_COVERAGE = 0.4;

/** Below this, there is nothing with enough extent to drift. */
const MIN_COVERAGE = 0.0004;

export interface Ribbon {
  /** Closed outline, normalised by image WIDTH so aspect ratio survives. */
  ring: [number, number][];
  /** Medial axis, head first, same normalisation. */
  axis: [number, number][];
  /** Fraction of the frame the region covers. */
  coverage: number;
  /** How many dark components the screen found before picking the largest. */
  components: number;
  /** Grey level the screen cut at, 0-255. */
  threshold: number;
  /** Whether the region reaches the frame edge, so its true extent is unknown. */
  touchesEdge: boolean;
  /**
   * How many times the cut had to be re-applied inside the dark class.
   *
   * Zero for a tile that is mostly slick. Non-zero means the frame was mostly
   * water and the first cut found the sea, which is worth surfacing: the
   * region that survived is a darker population inside the dark one.
   */
  splits: number;
  /** Mean grey inside the region and in the water around it, 0-255. */
  meanInside: number;
  meanOutside: number;
  /**
   * Contrast separation, 0 to 1: how far apart the two populations are.
   *
   * This is a measurement, not a model score. It is reported in place of a
   * detection confidence because the screen has no calibrated one to give, and
   * putting an invented number where an operator expects a confidence is the
   * single most misleading thing this panel could do.
   */
  separation: number;
  /** What drew the outline: the trained segmenter, or the threshold screen. */
  method: "segmenter" | "screen";
  /**
   * The segmenter's own confidence: the highest-scoring detection over the
   * traced region. Null for the screen, which has no score to give.
   */
  score: number | null;
  /** Detections the segmenter returned for the whole frame, before seam merging. */
  detections: number | null;
}

export type IngestFailure =
  | { ok: false; reason: "empty"; detail: string }
  | { ok: false; reason: "too-dark"; detail: string; coverage: number }
  | { ok: false; reason: "too-small"; detail: string; coverage: number };

export type IngestOutcome = { ok: true; ribbon: Ribbon } | IngestFailure;

/**
 * Acquisition time from a file name, or null.
 *
 * Sentinel-1 products carry it (`..._20230409T000206_...`) and so do the
 * project's own processed scenes. The dataset tiles do NOT -- `8346860__Oil__
 * 00001.png` is an archive identity, not a time -- so for those this returns
 * null and the operator is asked. That is the right outcome rather than a
 * failure: without an acquisition time there is no wind field, no AIS window
 * and no honest time axis, so it has to come from somewhere and guessing is
 * the one option that is not allowed.
 */
export function parseAcquisitionTime(name: string): number | null {
  const match = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(name);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (!Number.isFinite(ms)) return null;
  // Sentinel-1 launched in 2014; anything outside a sane window is a false
  // match on some other run of digits.
  const year = +y;
  if (year < 2000 || year > 2100) return null;
  return ms;
}

/** Luminance of an RGBA buffer, decimated so the long edge is at most `max`. */
function decimate(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  max: number,
): { grey: Uint8Array; width: number; height: number } {
  const factor = Math.max(1, Math.ceil(Math.max(width, height) / max));
  const w = Math.max(1, Math.floor(width / factor));
  const h = Math.max(1, Math.floor(height / factor));
  const grey = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Box mean over the source block: averaging is what removes the speckle
      // that makes a per-pixel threshold on SAR unusable.
      let sum = 0;
      let n = 0;
      const y1 = Math.min(height, (y + 1) * factor);
      const x1 = Math.min(width, (x + 1) * factor);
      for (let sy = y * factor; sy < y1; sy++) {
        for (let sx = x * factor; sx < x1; sx++) {
          const p = (sy * width + sx) * 4;
          if (data[p + 3] < 16) continue;
          sum += 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
          n++;
        }
      }
      grey[y * w + x] = n ? Math.round(sum / n) : 255;
    }
  }
  return { grey, width: w, height: h };
}

/**
 * The grey level separating the dark region from the sea around it.
 *
 * Otsu, which maximises between-class variance, rather than a fixed cut or a
 * percentile. A percentile assumes how much of the frame is oil, which is the
 * thing being measured; Otsu assumes only that there are two populations, which
 * is the actual claim a dark-region screen makes. The result is clamped so a
 * frame with no real dark region cannot return a cut that admits half the sea.
 */
function otsu(grey: Uint8Array, ceiling = 255): number {
  const histogram = new Float64Array(256);
  let total = 0;
  for (let i = 0; i < grey.length; i++) {
    // Only the population at or below `ceiling`, so the cut can be re-applied
    // inside the dark class. See `extractRibbon`.
    if (grey[i] > ceiling) continue;
    histogram[grey[i]]++;
    total++;
  }
  if (total === 0) return 0;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * histogram[t];

  let weightBelow = 0;
  let sumBelow = 0;
  let best = 0;
  let bestVariance = -1;
  for (let t = 0; t < 256; t++) {
    weightBelow += histogram[t];
    if (weightBelow === 0) continue;
    const weightAbove = total - weightBelow;
    if (weightAbove === 0) break;
    sumBelow += t * histogram[t];
    const meanBelow = sumBelow / weightBelow;
    const meanAbove = (sum - sumBelow) / weightAbove;
    const variance = weightBelow * weightAbove * (meanBelow - meanAbove) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return Math.max(8, Math.min(140, best));
}

/** Largest 4-connected dark component, as a label map and its size. */
function largestDarkComponent(
  grey: Uint8Array,
  width: number,
  height: number,
  threshold: number,
): { label: Int32Array; target: number; size: number; components: number } {
  const n = width * height;
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let components = 0;
  let target = -1;
  let size = 0;

  for (let seed = 0; seed < n; seed++) {
    if (label[seed] !== -1 || grey[seed] > threshold) continue;
    const id = components++;
    let top = 0;
    stack[top++] = seed;
    label[seed] = id;
    let count = 0;
    while (top > 0) {
      const idx = stack[--top];
      count++;
      const y = (idx / width) | 0;
      const x = idx - y * width;
      if (x > 0 && label[idx - 1] === -1 && grey[idx - 1] <= threshold) {
        label[idx - 1] = id;
        stack[top++] = idx - 1;
      }
      if (x < width - 1 && label[idx + 1] === -1 && grey[idx + 1] <= threshold) {
        label[idx + 1] = id;
        stack[top++] = idx + 1;
      }
      if (y > 0 && label[idx - width] === -1 && grey[idx - width] <= threshold) {
        label[idx - width] = id;
        stack[top++] = idx - width;
      }
      if (y < height - 1 && label[idx + width] === -1 && grey[idx + width] <= threshold) {
        label[idx + width] = id;
        stack[top++] = idx + width;
      }
    }
    if (count > size) {
      size = count;
      target = id;
    }
  }
  return { label, target, size, components };
}

/**
 * Trace a component as an outline and a medial axis.
 *
 * Scanned across its SHORT dimension, so each scan line crosses the ribbon once
 * and its span is a width rather than a length. The offline extractor hardcodes
 * this per sample; here it is measured from the component's own bounding box,
 * because an upload does not come with a note about which way it lies.
 */
function trace(
  label: Int32Array,
  target: number,
  width: number,
  height: number,
  normaliseBy: number,
): { ring: [number, number][]; axis: [number, number][]; touchesEdge: boolean } {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  let touchesEdge = false;
  for (let i = 0; i < label.length; i++) {
    if (label[i] !== target) continue;
    const y = (i / width) | 0;
    const x = i - y * width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
  }

  const vertical = maxY - minY > maxX - minX;
  const spans = new Map<number, { lo: number; hi: number; sum: number; n: number }>();
  for (let i = 0; i < label.length; i++) {
    if (label[i] !== target) continue;
    const y = (i / width) | 0;
    const x = i - y * width;
    const key = vertical ? y : x;
    const value = vertical ? x : y;
    const row = spans.get(key);
    if (!row) spans.set(key, { lo: value, hi: value, sum: value, n: 1 });
    else {
      if (value < row.lo) row.lo = value;
      if (value > row.hi) row.hi = value;
      row.sum += value;
      row.n++;
    }
  }

  const point = (key: number, value: number): [number, number] => {
    const x = vertical ? value : key;
    const y = vertical ? key : value;
    return [
      +(x / normaliseBy).toFixed(5),
      +(y / normaliseBy).toFixed(5),
    ];
  };

  const keys = [...spans.keys()].sort((a, b) => a - b);

  /*
    Smooth each boundary along the scan.

    A component traced off real SAR has a ragged edge, and the medial axis of a
    ragged component zigzags scan line to scan line. That zigzag is speckle, not
    shape, and it is not harmless: the axis path length becomes the slick's
    reported LENGTH, so an unsmoothed trace of a 20 km frame reported a 40 km
    ribbon -- the measurement was mostly the noise. A five-wide moving average
    along the scan direction removes it without touching the extent, because the
    ends are clamped rather than averaged inward.
  */
  const smooth = (pick: (row: { lo: number; hi: number; sum: number; n: number }) => number) => {
    const raw = keys.map((k) => pick(spans.get(k)!));
    return raw.map((_, i) => {
      let total = 0;
      let count = 0;
      for (let d = -2; d <= 2; d++) {
        const j = i + d;
        if (j < 0 || j >= raw.length) continue;
        total += raw[j];
        count++;
      }
      return total / count;
    });
  };
  const loSmooth = smooth((r) => r.lo);
  const hiSmooth = smooth((r) => r.hi);
  const midSmooth = smooth((r) => r.sum / r.n);

  const lo: [number, number][] = [];
  const hi: [number, number][] = [];
  const axis: [number, number][] = [];
  // Every other scan line, ends always kept: the outline stays smooth without
  // carrying a vertex per pixel row into every drift frame.
  for (let i = 0; i < keys.length; i++) {
    if (i % 2 && i !== 0 && i !== keys.length - 1) continue;
    const key = keys[i];
    lo.push(point(key, loSmooth[i]));
    hi.push(point(key, hiSmooth[i] + 1));
    axis.push(point(key, midSmooth[i]));
  }
  const ring: [number, number][] = [...lo, ...hi.reverse(), lo[0]];
  return { ring, axis, touchesEdge };
}

/**
 * Derive a drift-ready ribbon from decoded image pixels.
 *
 * Refusals are results, not errors. A frame that is uniformly dark is the
 * look-alike condition the wind gate exists for -- below about 3 m/s there is
 * no Bragg roughness for oil to suppress, the whole sea is already dark, and
 * contrast means nothing (Espedal 1999). Saying so is a better answer than
 * returning the largest blob and calling it a slick.
 */
export function extractRibbon(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): IngestOutcome {
  const small = decimate(data, width, height, SCREEN_MAX);
  const cells = small.width * small.height;

  /*
    Otsu, then Otsu again inside the dark class, until the region is a slick
    rather than the sea.

    One pass is right for a tile that is mostly slick, which is what the corpus
    is: those return 3-8% coverage on the first cut. It is wrong for a real
    scene. A Sentinel-1 window over open water is ~90% water, and Otsu maximises
    between-class variance between the two populations it can see -- which in
    that scene are the water and the bright targets on it, not the oil and the
    water. The first cut on a real georeferenced window came back claiming 62%
    of the frame was one dark region, and it was: it was the sea.

    So when the dark class is too big to be a slick, the same cut is applied
    again to only that class, splitting dark water from the darker oil inside
    it. This is multi-level Otsu by recursive splitting, and it is the standard
    answer to exactly this failure. Three splits is the limit; past that the
    scene has no slick-shaped population in it and saying so is the result.
  */
  let ceiling = 255;
  let threshold = otsu(small.grey, ceiling);
  let found = largestDarkComponent(small.grey, small.width, small.height, threshold);
  let coverage = found.size / cells;
  let splits = 0;
  while (coverage > MAX_COVERAGE && splits < 3 && threshold > 1) {
    ceiling = threshold - 1;
    const next = otsu(small.grey, ceiling);
    if (next >= threshold) break;
    threshold = next;
    found = largestDarkComponent(small.grey, small.width, small.height, threshold);
    coverage = found.size / cells;
    splits++;
  }
  const { label, target, size, components } = found;

  if (target < 0 || size === 0) {
    return { ok: false, reason: "empty", detail: "No dark region found in this frame." };
  }

  if (coverage > MAX_COVERAGE) {
    return {
      ok: false,
      reason: "too-dark",
      detail:
        `The dark region covers ${(coverage * 100).toFixed(0)}% of the frame, so it is the sea ` +
        "rather than a slick. Below roughly 3 m/s there is no roughness for oil to suppress and " +
        "contrast carries no information.",
      coverage,
    };
  }
  if (coverage < MIN_COVERAGE) {
    return {
      ok: false,
      reason: "too-small",
      detail:
        `The largest dark region covers ${(coverage * 100).toFixed(3)}% of the frame, which is ` +
        "too little extent to drift.",
      coverage,
    };
  }

  const { ring, axis, touchesEdge } = trace(
    label,
    target,
    small.width,
    small.height,
    small.width,
  );
  if (ring.length < 8 || axis.length < 3) {
    return { ok: false, reason: "too-small", detail: "The dark region has no usable outline.", coverage };
  }

  let insideSum = 0;
  let insideN = 0;
  let outsideSum = 0;
  let outsideN = 0;
  for (let i = 0; i < label.length; i++) {
    if (label[i] === target) {
      insideSum += small.grey[i];
      insideN++;
    } else {
      outsideSum += small.grey[i];
      outsideN++;
    }
  }
  const meanInside = insideN ? insideSum / insideN : 0;
  const meanOutside = outsideN ? outsideSum / outsideN : 0;

  return {
    ok: true,
    ribbon: {
      ring,
      axis,
      coverage,
      components,
      threshold,
      touchesEdge,
      splits,
      meanInside: +meanInside.toFixed(1),
      meanOutside: +meanOutside.toFixed(1),
      separation: Math.max(0, Math.min(1, (meanOutside - meanInside) / 255)),
      method: "screen",
      score: null,
      detections: null,
    },
  };
}

/**
 * Fragments of one slick closer than this, in screen cells, are traced as one.
 *
 * The segmenter returns a slick the way the corpus labels draw it -- often a
 * string of pieces along one streak, broken where the film thins -- and the
 * drift needs the streak, not its largest piece. Eight cells is ~16 px of a
 * 2048 tile: it joins breaks along a streak without reaching across open water
 * to an unrelated slick.
 */
const GROUP_CELLS = 8;

/**
 * A drift-ready ribbon from the trained segmenter's mask.
 *
 * The mask is the model's answer and is not second-guessed here: it is pooled
 * onto the same decimated grid the screen works on (a cell is slick if ANY of
 * its pixels is, so a thin streak survives decimation), nearby fragments are
 * grouped, and the group holding the most slick is traced with the same tracer
 * the screen uses, so everything downstream reads one shape either way.
 */
export function ribbonFromMask(
  mask: Uint8Array,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  detections: { box: [number, number, number, number]; score: number }[],
): IngestOutcome {
  const small = decimate(rgba, width, height, SCREEN_MAX);
  const w = small.width;
  const h = small.height;
  const factor = Math.max(1, Math.ceil(Math.max(width, height) / SCREEN_MAX));
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < height && ((y / factor) | 0) < h; y++) {
    const row = ((y / factor) | 0) * w;
    for (let x = 0; x < width; x++) {
      const cx = (x / factor) | 0;
      if (cx < w && mask[y * width + x]) cells[row + cx] = 1;
    }
  }

  // Dilate to group, separably: the grouping only decides which fragments
  // belong together; the traced cells are still the model's own.
  const across = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!cells[y * w + x]) continue;
      for (let d = Math.max(0, x - GROUP_CELLS); d <= Math.min(w - 1, x + GROUP_CELLS); d++) across[y * w + d] = 1;
    }
  const grown = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!across[y * w + x]) continue;
      for (let d = Math.max(0, y - GROUP_CELLS); d <= Math.min(h - 1, y + GROUP_CELLS); d++) grown[d * w + x] = 1;
    }
  // `largestDarkComponent` labels cells at or below a threshold, so the grown
  // mask is passed inverted: slick 0, water 255.
  const inverted = new Uint8Array(w * h);
  for (let i = 0; i < inverted.length; i++) inverted[i] = grown[i] ? 0 : 255;
  const groups = largestDarkComponent(inverted, w, h, 0);
  if (groups.target < 0) {
    return {
      ok: false,
      reason: "empty",
      detail:
        "The trained segmenter found no slick in this raster above its release confidence. " +
        "That is its answer, not a failure: it misses most small slicks (held-out recall .11 on them).",
    };
  }

  // The group that holds the most slick, not the widest halo.
  const slickIn = new Map<number, number>();
  for (let i = 0; i < cells.length; i++)
    if (cells[i]) slickIn.set(groups.label[i], (slickIn.get(groups.label[i]) ?? 0) + 1);
  let target = -1;
  let most = 0;
  for (const [id, n] of slickIn) if (n > most) { most = n; target = id; }
  const label = new Int32Array(w * h).fill(-1);
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i] || groups.label[i] !== target) continue;
    label[i] = 0;
    const x = i % w, y = (i / w) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const coverage = most / (w * h);

  const { ring, axis, touchesEdge } = trace(label, 0, w, h, w);
  if (ring.length < 8 || axis.length < 3) {
    return { ok: false, reason: "too-small", detail: "The segmented slick is too small to trace an outline.", coverage };
  }

  // The score of the traced slick: the best detection whose box lies over it.
  const bx0 = minX * factor, bx1 = (maxX + 1) * factor, by0 = minY * factor, by1 = (maxY + 1) * factor;
  let score = 0;
  for (const d of detections) {
    const [x1, y1, x2, y2] = d.box;
    if (x2 >= bx0 && x1 <= bx1 && y2 >= by0 && y1 <= by1 && d.score > score) score = d.score;
  }

  let insideSum = 0, insideN = 0, outsideSum = 0, outsideN = 0;
  for (let i = 0; i < label.length; i++) {
    if (label[i] === 0) { insideSum += small.grey[i]; insideN++; }
    else if (!cells[i]) { outsideSum += small.grey[i]; outsideN++; }
  }
  const meanInside = insideN ? insideSum / insideN : 0;
  const meanOutside = outsideN ? outsideSum / outsideN : 0;

  return {
    ok: true,
    ribbon: {
      ring,
      axis,
      coverage,
      components: slickIn.size,
      threshold: 0,
      touchesEdge,
      splits: 0,
      meanInside: +meanInside.toFixed(1),
      meanOutside: +meanOutside.toFixed(1),
      separation: Math.max(0, Math.min(1, (meanOutside - meanInside) / 255)),
      method: "segmenter",
      score: +score.toFixed(3),
      detections: detections.length,
    },
  };
}
