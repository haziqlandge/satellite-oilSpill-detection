/**
 * Make the precomputed results the upload panel's "Use precomputed result" reads.
 *
 * Each file is decoded and segmented exactly as an upload of it would be
 * (`segmentDisk.ts`: the browser's `segment`, onnxruntime-web on WASM) and the
 * segmentation is written to `public/precomputed/`, filed under the SHA-256 of
 * the file and stamped with the model's. See `src/sim/precomputed.ts` for what
 * is stored and why it is honest, and `check:precomputed` for the proof.
 *
 * Run: npm run precompute:uploads -- <repo-relative file> ...
 *      (no arguments: every georeferenced window in data/processed/sar/windows/)
 *
 * Re-run after the model changes: every entry names the model it was made by,
 * the browser refuses entries from any other, and the check fails on them.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { encodeRuns, sha256Hex, type PrecomputedEntry, type PrecomputedIndex } from '../src/sim/precomputed';
import { REPO } from './corpusDisk';
import { loadDiskModel, segmentFile } from './segmentDisk';

const DIR = join(REPO, 'frontDemo/public/precomputed');
const WINDOWS = 'data/processed/sar/windows';

let files = process.argv.slice(2).map((f) => f.replace(/\\/g, '/'));
if (!files.length && existsSync(join(REPO, WINDOWS)))
  files = readdirSync(join(REPO, WINDOWS)).filter((f) => /\.tiff?$/i.test(f)).map((f) => `${WINDOWS}/${f}`);
if (!files.length) {
  console.log('Nothing to precompute: pass repo-relative files, or cut windows with scripts/cut_geotiff_window.py.');
  process.exit(0);
}

const { manifest } = await loadDiskModel();
mkdirSync(DIR, { recursive: true });
const indexPath = join(DIR, 'index.json');
const index: PrecomputedIndex = existsSync(indexPath)
  ? JSON.parse(readFileSync(indexPath, 'utf8'))
  : { version: 1, entries: {} };

const rows = [];
for (const source of files) {
  const bytes = readFileSync(join(REPO, source));
  const sha256 = await sha256Hex(bytes);
  const seg = await segmentFile(source);
  const entry: PrecomputedEntry = {
    version: 1,
    file: basename(source),
    source,
    sha256,
    bytes: bytes.length,
    width: seg.width,
    height: seg.height,
    model: { name: manifest.name, sha256: manifest.sha256 },
    engine: 'onnxruntime-web WASM in Node, the browser segmenter (scripts/precompute-uploads.ts)',
    computedAt: new Date().toISOString(),
    inferMs: seg.ms,
    tiles: seg.tiles,
    detections: seg.detections.map((d) => ({
      box: d.box.map((v) => +v.toFixed(2)) as [number, number, number, number],
      score: +d.score.toFixed(5),
      pixels: d.pixels,
    })),
    maskRuns: encodeRuns(seg.mask),
    ...(seg.decoded.note ? { decodeNote: seg.decoded.note } : {}),
  };
  const name = `${basename(source).replace(/\.[^.]+$/, '').slice(0, 60)}-${sha256.slice(0, 8)}.json`;
  writeFileSync(join(DIR, name), JSON.stringify(entry), 'utf8');
  index.entries[sha256] = name;
  rows.push({ file: entry.file, size: `${entry.width}x${entry.height}`, detections: entry.detections.length,
    runs: entry.maskRuns.length, kb: Math.round(JSON.stringify(entry).length / 1024), s: +(seg.ms / 1000).toFixed(1) });
}
writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
console.table(rows);
console.log(`Wrote ${rows.length} precomputed result${rows.length === 1 ? '' : 's'} to public/precomputed/ for ${manifest.name} ${manifest.sha256.slice(0, 12)}.`);
