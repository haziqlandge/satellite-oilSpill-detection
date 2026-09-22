/**
 * The upload screen, run over real labelled tiles from the corpus.
 *
 * This is a sanity measure, NOT a detection benchmark, and the difference
 * matters. The screen is a dark-region threshold; the corpus labels are what
 * the trained segmenter was fitted to. Agreement says the screen finds the
 * thing a person is pointing at, which is all an upload needs in order to have
 * geometry to drift. It says nothing about detection performance, and the held
 * out test split is consumed and must not be touched -- these are TRAIN tiles,
 * used here only to check that the screen returns a region roughly where the
 * oil is.
 *
 * Run: npm run check:ingest   (needs tiles exported by the scratchpad script)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractRibbon, parseAcquisitionTime } from '../src/sim/ingest';

const DIR = process.env.TILE_DIR ?? '';
if (!DIR || !existsSync(join(DIR, 'manifest.json'))) {
  console.log('No exported tiles; skipping. Set TILE_DIR to the export directory.');
  process.exit(0);
}
interface Tile { name: string; source: string; width: number; height: number; bin: string; polygons: number[][][] }
const tiles: Tile[] = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));

/** Rasterise normalised polygons onto an N x N grid. */
function raster(polys: number[][][], n: number): Uint8Array {
  const g = new Uint8Array(n * n);
  for (const poly of polys) {
    let minY = 1, maxY = 0;
    for (const [, y] of poly) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    for (let py = Math.max(0, Math.floor(minY * n)); py <= Math.min(n - 1, Math.ceil(maxY * n)); py++) {
      const y = (py + 0.5) / n;
      const xs: number[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let px = Math.max(0, Math.floor(xs[k] * n)); px <= Math.min(n - 1, Math.ceil(xs[k + 1] * n)); px++)
          if ((px + 0.5) / n >= xs[k] && (px + 0.5) / n <= xs[k + 1]) g[py * n + px] = 1;
    }
  }
  return g;
}

const N = 256;
const rows = [];
let hits = 0, refusals = 0;
for (const t of tiles) {
  const buf = readFileSync(join(DIR, t.bin));
  const data = new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
  const started = Date.now();
  const out = extractRibbon(data, t.width, t.height);
  const ms = Date.now() - started;

  if (!out.ok) {
    refusals++;
    rows.push({ tile: t.name.slice(0, 28), source: t.source, result: `refused: ${out.reason}`, ms });
    continue;
  }
  // The ring is normalised by WIDTH; labels are normalised by width and height
  // separately, so put the ring back into label space before comparing.
  const aspect = t.height / t.width;
  const ring = out.ribbon.ring.map(([x, y]) => [x, y / aspect]);
  const got = raster([ring], N);
  const want = raster(t.polygons, N);
  let inter = 0, union = 0, wantN = 0, gotN = 0;
  for (let i = 0; i < got.length; i++) {
    if (got[i]) gotN++;
    if (want[i]) wantN++;
    if (got[i] || want[i]) union++;
    if (got[i] && want[i]) inter++;
  }
  const iou = union ? inter / union : 0;
  const recall = wantN ? inter / wantN : 0;
  if (recall > 0.1) hits++;
  rows.push({
    tile: t.name.slice(0, 28), source: t.source,
    labelPolys: t.polygons.length,
    coverage: +(out.ribbon.coverage * 100).toFixed(2),
    threshold: out.ribbon.threshold,
    iou: +iou.toFixed(3), recallOfLabel: +recall.toFixed(3), ms,
  });
}
console.table(rows);
console.log(`\n${tiles.length} real tiles · ${refusals} refused · ${hits} overlap a labelled slick (recall > 0.1)`);
console.log('filename time parse:',
  parseAcquisitionTime('S1A_IW_GRDH_1SDV_20230409T000206_20230409T000231_047855.SAFE'),
  '|', parseAcquisitionTime('8346860__Oil__00001.png'));

/* ------------------------------------------------------------------ *
 * End to end: a real tile becomes a runnable scene
 * ------------------------------------------------------------------ */

import assert from 'node:assert/strict';
import { buildUploadSpec } from '../src/sim/uploadSpec';
import { registerUpload, buildRun } from '../src/sim/scenarios';
import { isLand } from '../src/sim/landmask';

const usable = tiles.find(t => {
  const b = readFileSync(join(DIR, t.bin));
  return extractRibbon(new Uint8ClampedArray(b.buffer, b.byteOffset, b.byteLength), t.width, t.height).ok;
})!;
const buf2 = readFileSync(join(DIR, usable.bin));
const out2 = extractRibbon(new Uint8ClampedArray(buf2.buffer, buf2.byteOffset, buf2.byteLength), usable.width, usable.height);
assert.ok(out2.ok);

const spec = buildUploadSpec(out2.ribbon, {
  centre: [-90.1, 25.6],            // open Gulf, as a console operator would pin it
  acrossKm: 20,
  acquiredAt: Date.UTC(2026, 8, 10, 6, 0, 0),
  acquisitionSource: 'operator',
  positionSource: 'operator',
  fileName: usable.name + '.png',
});
registerUpload(spec);
const run = buildRun('upload');

assert.equal(run.detection.className, 'slick_unknown', 'an uploaded dark region must not be called oos');
assert.ok(/POSITION ASSERTED BY OPERATOR/.test(run.meta.provenance), 'provenance must state the position is asserted');
assert.ok(/NOT the\s+trained segmenter|NOT the trained segmenter/.test(run.meta.provenance), 'provenance must disclaim the segmenter');
assert.ok(run.drift.frames.length > 100, 'no drift frames');
assert.ok(run.suspects.length > 0, 'no candidates ranked');
assert.equal(run.truth, null, 'an upload has no authored truth');
for (const f of run.drift.frames)
  for (let i = 0; i < f.particles.length; i += 2)
    assert.ok(!isLand(f.particles[i], f.particles[i + 1]), 'uploaded scene drifted ashore');

// A second upload must not show the first one's results.
const spec2 = buildUploadSpec(out2.ribbon, {
  centre: [67.8, 17.8], acrossKm: 30, acquiredAt: Date.UTC(2026, 8, 11, 6, 0, 0),
  acquisitionSource: 'operator', positionSource: 'operator', fileName: 'second.png',
});
registerUpload(spec2);
const run2 = buildRun('upload');
assert.notEqual(run2.meta.centre[0], run.meta.centre[0], 'the cache served a stale upload');

console.log(`\nend to end on ${usable.name}:`);
console.table([{
  lengthKm: +run.characterisation.lengthKm.toFixed(2),
  areaKm2: +run.characterisation.areaKm2.toFixed(2),
  headWidthM: Math.round(run.characterisation.widthMMean),
  orientationDeg: Math.round(run.characterisation.orientationDeg),
  dampingDb: +run.characterisation.dampingRatioDb.toFixed(2),
  separation: run.detection.confidence,
  frames: run.drift.frames.length,
  candidates: run.suspects.length,
  class: run.detection.className,
}]);
console.log('PASS: a real corpus tile becomes a runnable, honestly-labelled scene.');
