/**
 * A despeckled copy of an upload, FOR DISPLAY ONLY.
 *
 * The segmenter runs on the raw raster: band 2 through the corpus dB window,
 * speckle and all, because that is what it was trained on (`read_sar_uint8`
 * applies no filter). Feeding it a filtered image would be feeding it a
 * distribution it has never seen. But raw speckle is hard for a person to read
 * a slick out of, so the panel shows this beside the model input, labelled as
 * what it is.
 *
 * The filter is the classic Lee filter, applied where speckle is actually
 * multiplicative: on LINEAR intensity, not on dB and not on grey. That is the
 * same reason the project's own SNAP chain runs Refined Lee before
 * `LinearToFromdB` (`backend/ingest/sar/preprocess.py`, guarded by
 * `tests/test_preprocess.py`). The grey values are mapped back to dB through
 * the window they were rendered with, to linear power, filtered, and back.
 *
 *   Ci^2 = var / mean^2   (local variation)      Cu^2 = 1 / ENL   (speckle)
 *   W    = clamp((1 - Cu^2 / Ci^2) / (1 + Cu^2), 0, 1)
 *   out  = mean + W * (x - mean)
 *
 * Flat water (Ci close to Cu) goes to its local mean; an edge or a ship (Ci well above
 * Cu) keeps its own value. ENL 4.4 is Sentinel-1 IW GRDH's published figure.
 */

const WINDOW = 7;
const ENL = 4.4;

/** Separable box mean over a (2r+1) square, clamped at the edges. */
function boxMean(src: Float32Array, width: number, height: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    let n = 0;
    for (let x = 0; x <= Math.min(width - 1, r); x++) { sum += src[row + x]; n++; }
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / n;
      const add = x + r + 1;
      const drop = x - r;
      if (add < width) { sum += src[row + add]; n++; }
      if (drop >= 0) { sum -= src[row + drop]; n--; }
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let n = 0;
    for (let y = 0; y <= Math.min(height - 1, r); y++) { sum += tmp[y * width + x]; n++; }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / n;
      const add = y + r + 1;
      const drop = y - r;
      if (add < height) { sum += tmp[add * width + x]; n++; }
      if (drop >= 0) { sum -= tmp[drop * width + x]; n--; }
    }
  }
  return out;
}

/**
 * Lee-filtered RGBA, grey in and grey out through the dB window `lowDb..highDb`
 * the raster was rendered with.
 *
 * `valid` marks the pixels that hold data. No-data -- the zero fill outside a
 * swath, which the model is fed as white -- is left out of every local mean so
 * it cannot bleed into the edge of the real scene, and is drawn as a dark hatch
 * so nobody reads it as bright sea.
 */
export function despeckle(
  rgba: Uint8ClampedArray, width: number, height: number, lowDb: number, highDb: number,
  valid: Uint8Array | null = null,
): Uint8ClampedArray {
  const n = width * height;
  const span = highDb - lowDb || 1;
  const toLinear = new Float32Array(256);
  for (let g = 0; g < 256; g++) toLinear[g] = 10 ** ((lowDb + (g / 255) * span) / 10);
  const x = new Float32Array(n);
  const x2 = new Float32Array(n);
  const weight = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (valid && !valid[i]) continue;
    const v = toLinear[rgba[i * 4]];
    x[i] = v;
    x2[i] = v * v;
    weight[i] = 1;
  }
  const r = (WINDOW - 1) / 2;
  // Means over valid pixels only: box sums of the values divided by the box
  // sum of the weights, which is the plain box mean where everything is valid.
  const sum = boxMean(x, width, height, r);
  const sumSq = boxMean(x2, width, height, r);
  const share = valid ? boxMean(weight, width, height, r) : null;
  const cu2 = 1 / ENL;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    if (valid && !valid[i]) {
      const p = i * 4;
      const hatch = ((i % width) + ((i / width) | 0)) % 12 < 2;
      out[p] = out[p + 1] = hatch ? 58 : 22;
      out[p + 2] = hatch ? 66 : 28;
      out[p + 3] = 255;
      continue;
    }
    const validShare = share ? share[i] || 1 : 1;
    const m = sum[i] / validShare;
    const variance = Math.max(0, sumSq[i] / validShare - m * m);
    const ci2 = m > 0 ? variance / (m * m) : 0;
    const k = ci2 > 0 ? Math.min(1, Math.max(0, (1 - cu2 / ci2) / (1 + cu2))) : 0;
    const v = m + k * (x[i] - m);
    const db = v > 0 ? 10 * Math.log10(v) : lowDb;
    const grey = Math.round(((db - lowDb) / span) * 255);
    const p = i * 4;
    out[p] = out[p + 1] = out[p + 2] = grey < 0 ? 0 : grey > 255 ? 255 : grey;
    out[p + 3] = 255;
  }
  return out;
}
