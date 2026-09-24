/**
 * The precomputed upload results, held to being the live result, stored.
 *
 * "Use precomputed result" (`src/sim/precomputed.ts`) swaps an upload's live
 * segmenter run for one made earlier. That is only honest if the stored
 * result IS what the live run would produce, for THIS file and THIS model. So:
 *
 *  - the mask codec round-trips exactly;
 *  - an entry is refused for a different file, a different model, or a size
 *    that disagrees with the raster -- never silently used;
 *  - every stored entry was made with the model the browser loads now (a
 *    retrained model makes every entry stale: re-run precompute:uploads);
 *  - every entry whose source file is on disk is recomputed here through the
 *    browser's own code and must match mask pixel for pixel.
 *
 * Run: npm run check:precomputed   (the recompute skips without the exported model)
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acceptEntry, decodeRuns, encodeRuns, sha256Hex, type PrecomputedEntry, type PrecomputedIndex,
} from '../src/sim/precomputed';
import { REPO } from './corpusDisk';
import { segmentFile } from './segmentDisk';

// 1. The codec, on the shapes that break run-length codecs.
const cases: Uint8Array[] = [
  new Uint8Array(0),
  new Uint8Array(7),
  new Uint8Array(7).fill(1),
  Uint8Array.from([1, 0, 0, 1, 1, 1, 0]),
  Uint8Array.from([0, 1, 0, 1, 0, 1, 1]),
];
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
cases.push(Uint8Array.from({ length: 50_000 }, () => (rand() < 0.03 ? 1 : 0)));
for (const mask of cases) {
  const runs = encodeRuns(mask);
  assert.equal(runs.reduce((s, r) => s + r, 0), mask.length, 'runs do not add up to the mask');
  assert.deepEqual(decodeRuns(runs, mask.length), mask, 'the mask did not round-trip');
}
assert.throws(() => decodeRuns([3, 2], 4), /runs/, 'runs longer than the mask were accepted');

// 2. Refusals, each for its own reason.
const MODELS = join(REPO, 'frontDemo/public/models');
const manifest = JSON.parse(readFileSync(join(MODELS, 'L1-ciou-research.json'), 'utf8')) as { sha256: string; file: string };
const sample: PrecomputedEntry = {
  version: 1, file: 'x.png', source: 'x.png', sha256: 'a'.repeat(64), bytes: 1, width: 2, height: 2,
  model: { name: 'L1-ciou-research', sha256: manifest.sha256 }, engine: 'test', computedAt: '2026-09-23T00:00:00Z',
  inferMs: 1, tiles: 1, detections: [], maskRuns: [4],
};
assert.equal(acceptEntry(sample, { sha256: sample.sha256, modelSha256: manifest.sha256 }).ok, true);
const refused = (entry: PrecomputedEntry, sha: string, model: string, why: RegExp) => {
  const got = acceptEntry(entry, { sha256: sha, modelSha256: model });
  assert.equal(got.ok, false, `accepted an entry that should be refused (${why})`);
  if (!got.ok) assert.match(got.reason, why);
};
refused(sample, 'b'.repeat(64), manifest.sha256, /different file/);
refused(sample, sample.sha256, 'c'.repeat(64), /different model/);
refused({ ...sample, maskRuns: [3] }, sample.sha256, manifest.sha256, /mask/);

// 3. The store itself.
const DIR = join(REPO, 'frontDemo/public/precomputed');
const indexPath = join(DIR, 'index.json');
assert.ok(existsSync(indexPath), 'public/precomputed/index.json is missing; run npm run precompute:uploads');
const index = JSON.parse(readFileSync(indexPath, 'utf8')) as PrecomputedIndex;
const modelOnDisk = existsSync(join(MODELS, manifest.file));
const rows = [];
for (const [sha, name] of Object.entries(index.entries)) {
  const entry = JSON.parse(readFileSync(join(DIR, name), 'utf8')) as PrecomputedEntry;
  assert.equal(entry.sha256, sha, `${name}: filed under the wrong hash`);
  assert.equal(entry.model.sha256, manifest.sha256,
    `${name}: made with a different model than the browser loads; re-run npm run precompute:uploads`);
  const mask = decodeRuns(entry.maskRuns, entry.width * entry.height);
  const source = join(REPO, entry.source);
  let recomputed = 'source not on disk';
  if (existsSync(source) && modelOnDisk) {
    const bytes = readFileSync(source);
    assert.equal(await sha256Hex(bytes), sha, `${entry.source}: the file on disk is not the one this entry was made from`);
    const live = await segmentFile(entry.source);
    assert.deepEqual(live.mask, mask, `${entry.source}: recomputed mask differs from the stored one`);
    assert.equal(live.detections.length, entry.detections.length, `${entry.source}: detection count differs`);
    recomputed = 'identical';
  }
  let marked = 0;
  for (const v of mask) marked += v;
  rows.push({ file: entry.file, size: `${entry.width}x${entry.height}`, detections: entry.detections.length,
    marked: `${((100 * marked) / mask.length).toFixed(2)}%`, recomputed });
}
console.table(rows);
console.log(`PASS: ${rows.length} precomputed result${rows.length === 1 ? '' : 's'}, all for the current model.`);
