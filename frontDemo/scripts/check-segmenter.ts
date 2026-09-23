/**
 * The browser segmenter, run in Node on real corpus scenes, scored on masks.
 *
 * What this guards is the failure the upload panel used to have: outlining the
 * sea. The Otsu screen it replaced marked water, not oil -- median precision
 * .045 over 24 Part I validation scenes -- where the release model run through
 * the Python pipeline (`backend/detect/yolo_lsk/infer.py`) scored .915. The
 * browser port reproduced that pipeline's masks pixel for pixel on the scenes
 * compared (mask IoU 1.000 on four, .997 on the fifth).
 *
 * The numbers here are on TRAIN scenes, so they are in-sample: this is a
 * regression floor for the port, not a claim about how the model generalises.
 * That claim lives in ISSUES.md Q1/Q4 and in the validation comparison above.
 *
 * Runs the same code the browser runs -- `decodeGeoTiff`, `segment`,
 * `ribbonFromMask` -- on onnxruntime-web's WASM backend.
 *
 * Run: npm run check:segmenter   (skips without the corpus or the exported model;
 * export it with .venv/Scripts/python.exe -m ml.export.onnx_export)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-web';
import { decodeGeoTiff } from '../src/sim/geotiff';
import { ribbonFromMask } from '../src/sim/ingest';
import { segment, type SegmenterManifest, type SessionLike } from '../src/sim/segmenter';
import { corpusOnDisk, readMask, REPO, SOURCES, trainScenes } from './corpusDisk';

const MODELS = join(REPO, 'frontDemo/public/models');
const MANIFEST = join(MODELS, 'L1-ciou-research.json');
if (!corpusOnDisk() || !existsSync(MANIFEST)) {
  console.log('Zenodo corpus or exported model not on disk; skipping.');
  process.exit(0);
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as SegmenterManifest;
if (!existsSync(join(MODELS, manifest.file))) {
  console.log(`${manifest.file} not exported; skipping. Run python -m ml.export.onnx_export.`);
  process.exit(0);
}

/**
 * Floors, well under what the port achieves, so a real regression trips them
 * and run-to-run noise does not. The screen it replaced scored .045 / .045.
 */
const MIN_MEDIAN_PRECISION = 0.6;
const MIN_MEDIAN_IOU = 0.5;
const SCENES = 6;

const session = await ort.InferenceSession.create(readFileSync(join(MODELS, manifest.file)));
const model = {
  manifest,
  session: session as unknown as SessionLike,
  tensor: (data: Float32Array, dims: number[]) => new ort.Tensor('float32', data, dims),
  backend: 'wasm',
};

const rows = [];
const undecodable: string[] = [];
for (const id of trainScenes('8346860', SCENES)) {
  const buf = readFileSync(SOURCES['8346860'].scene(id));
  const decoded = await decodeGeoTiff(new File([buf], `${id}.tif`, { type: 'image/tiff' }));
  if (!decoded.ok) { undecodable.push(`${id}: ${decoded.reason}`); continue; }
  const r = decoded.raster;
  const truth = readMask(SOURCES['8346860'].mask(id));
  const seg = await segment(model, r.rgba, r.width, r.height, { valid: r.valid });
  let inter = 0, union = 0, marked = 0, oil = 0;
  for (let i = 0; i < truth.length; i++) {
    const p = seg.mask[i], t = truth[i] > 0;
    if (p) marked++;
    if (t) oil++;
    if (p || t) union++;
    if (p && t) inter++;
  }
  const ribbon = ribbonFromMask(seg.mask, r.rgba, r.width, r.height, seg.detections);
  rows.push({
    scene: `8346860/${id}`,
    'oil %': +(100 * oil / truth.length).toFixed(2),
    'marked %': +(100 * marked / truth.length).toFixed(2),
    precision: +(marked ? inter / marked : 0).toFixed(3),
    recall: +(oil ? inter / oil : 0).toFixed(3),
    iou: +(union ? inter / union : 0).toFixed(3),
    detections: seg.detections.length,
    ribbon: ribbon.ok ? `score ${ribbon.ribbon.score}` : ribbon.reason,
    s: +(seg.ms / 1000).toFixed(1),
  });
}

console.table(rows);
if (undecodable.length) {
  // Every corpus scene decodes since the LZW fix (ISSUES.md F16); a refusal
  // here means the upload path would refuse it too.
  console.log(`FAIL: the upload decoder refused ${undecodable.join('; ')}`);
  process.exit(1);
}
const median = (key: 'precision' | 'iou') => {
  const v = rows.map(r => r[key]).sort((a, b) => a - b);
  return v[v.length >> 1];
};
if (rows.length < 3) {
  console.log('FAIL: fewer than three scenes could be run.');
  process.exit(1);
}
const precision = median('precision');
const iou = median('iou');
console.log(`median precision ${precision} (floor ${MIN_MEDIAN_PRECISION}), median IoU ${iou} (floor ${MIN_MEDIAN_IOU})`);
if (precision < MIN_MEDIAN_PRECISION || iou < MIN_MEDIAN_IOU) {
  console.log('FAIL: the segmenter is marking water as slick, or missing the slick.');
  process.exit(1);
}
console.log(`PASS: the browser segmenter outlines the labelled slick on ${rows.length} train scenes (in-sample).`);
