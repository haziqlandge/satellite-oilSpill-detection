/**
 * The GeoTIFF upload path, run over real corpus scenes with their masks.
 *
 * The question this answers is narrow and it is the one an operator asks first:
 * when a scene labelled as oil is dropped on the panel, is the oil VISIBLE in
 * the picture the panel derives? Everything downstream -- the segmenter, the
 * traced outline, the drift -- works on that picture, so a raster with the oil
 * flattened out of it fails silently all the way to the map.
 *
 * It failed exactly that way. The decoder picked the band with the larger
 * standard deviation, which on Part I is band 1 -- VH, sitting near the noise
 * floor, where the spread is speckle and the slick is invisible. Measured over
 * 60 corpus scenes, the oil sat a median 3 grey levels from the water around it.
 *
 * TRAIN scenes only (see `corpusDisk.ts`). No model is run and nothing is
 * tuned; the masks are used only to say where the oil is.
 *
 * Run: npm run check:geotiff   (skips if the Zenodo corpus is not on disk)
 */
import { existsSync, readFileSync } from 'node:fs';
import * as geotiff from 'geotiff';
import { decodeGeoTiff } from '../src/sim/geotiff';
import { useFixedLzw } from '../src/sim/lzw';
import { corpusOnDisk, readMask, SOURCES, trainScenes, type Source } from './corpusDisk';

useFixedLzw(geotiff);

if (!corpusOnDisk()) {
  console.log('Zenodo corpus or final-v11 train list not on disk; skipping.');
  process.exit(0);
}

/**
 * The least oil-to-water contrast, in 8-bit grey levels, that counts as visible.
 *
 * Band 2 through the corpus window gives 19 to 66 on the scenes measured; the
 * noise band gave -6 to 18, median 3. Ten is well clear of both.
 */
const MIN_VISIBLE_GREY = 10;
const TAKE: Record<Source, number> = { '8346860': 10, '13761290': 6 };
/**
 * Train scenes geotiff.js's own LZW decoder threw on (ISSUES.md F16). Always
 * checked, so the fix in `src/sim/lzw.ts` cannot quietly stop being used.
 */
const LZW_REGRESSION: Record<Source, string[]> = { '8346860': ['00284', '00504', '00818', '01168'], '13761290': [] };
/**
 * Train scenes more than half zero-filled at a swath edge. Counted as data, the
 * zeros made both bands' medians 0 dB and the tie handed the model band 1.
 */
const NO_DATA_REGRESSION: Record<Source, string[]> = { '8346860': ['01034'], '13761290': [] };

async function bands(path: string): Promise<ArrayLike<number>[]> {
  const buf = readFileSync(path);
  const tiff = await geotiff.fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const image = await tiff.getImage();
  const out: ArrayLike<number>[] = [];
  for (let s = 0; s < image.getSamplesPerPixel(); s++)
    out.push(((await image.readRasters({ samples: [s] })) as unknown as ArrayLike<number>[])[0]);
  return out;
}

/** Mean outside the mask minus mean inside it: how much darker the oil is. */
function contrast(values: ArrayLike<number>, mask: ArrayLike<number>, stride = 1): number {
  let inSum = 0, inN = 0, outSum = 0, outN = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = values[i * stride];
    if (!Number.isFinite(v)) continue;
    if (mask[i] > 0) { inSum += v; inN++; } else { outSum += v; outN++; }
  }
  return inN && outN ? outSum / outN - inSum / inN : NaN;
}

const rows = [];
const failures: string[] = [];
for (const source of Object.keys(SOURCES) as Source[]) {
  const ids = [...new Set([...trainScenes(source, TAKE[source]), ...LZW_REGRESSION[source], ...NO_DATA_REGRESSION[source]])];
  for (const id of ids) {
    const scenePath = SOURCES[source].scene(id);
    const maskPath = SOURCES[source].mask(id);
    if (!existsSync(scenePath) || !existsSync(maskPath)) continue;

    // A scene that cannot be decompressed is a failure: libtiff reads every
    // corpus scene, so an exception here is a decoder defect (ISSUES.md F16).
    let sourceBands: ArrayLike<number>[];
    try {
      sourceBands = await bands(scenePath);
    } catch (error) {
      failures.push(`${source}/${id}: could not decode -- ${(error as Error).message}`);
      continue;
    }
    const oil = readMask(maskPath);
    const dbContrast = sourceBands.map(b => contrast(b, oil));
    const oilBand = dbContrast.indexOf(Math.max(...dbContrast)) + 1;

    const buf = readFileSync(scenePath);
    const decoded = await decodeGeoTiff(new File([buf], `${id}.tif`, { type: 'image/tiff' }));
    if (!decoded.ok) {
      failures.push(`${source}/${id}: refused -- ${decoded.reason}`);
      continue;
    }
    const r = decoded.raster;
    // rgba: every 4th byte is the grey value.
    const grey = contrast(r.rgba, oil, 4);
    rows.push({
      scene: `${source}/${id}`,
      'oil dB b1': +dbContrast[0].toFixed(2),
      'oil dB b2': +(dbContrast[1] ?? NaN).toFixed(2),
      'oil band': oilBand,
      'panel band': r.band,
      mapped: `${r.mappedLow}..${r.mappedHigh}`,
      'oil grey': +grey.toFixed(1),
    });
    // The failure being guarded is picking a band the oil is much weaker in
    // (0.5 dB against 5.5 on Part I, when band 1 was picked). Where both bands
    // show it about equally -- train 00818: 7.2 dB in band 1, 6.7 in band 2 --
    // the co-polarised band the model was trained on is still the right one.
    const chosen = dbContrast[r.band - 1];
    const strongest = dbContrast[oilBand - 1];
    if (chosen < 0.5 * strongest)
      failures.push(`${source}/${id}: panel used band ${r.band} (oil ${chosen.toFixed(2)} dB), band ${oilBand} shows ${strongest.toFixed(2)} dB`);
    if (!(grey >= MIN_VISIBLE_GREY))
      failures.push(`${source}/${id}: oil is ${grey.toFixed(1)} grey levels from the water, under ${MIN_VISIBLE_GREY}`);
  }
}

console.table(rows);
if (!rows.length) {
  console.log('No corpus scenes resolved; nothing checked.');
  process.exit(1);
}
if (failures.length) {
  console.log(`\nFAIL: ${failures.length} problem(s) over ${rows.length} scenes`);
  for (const f of failures) console.log('  ' + f);
  process.exit(1);
}
console.log(`\nPASS: the oil is visible in the derived raster for all ${rows.length} train scenes.`);
