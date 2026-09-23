/**
 * The authored samples' slick outlines, segmented by the trained model.
 *
 * Each `public/data_sample/sample{n}.jpg` goes through exactly what an upload
 * goes through -- `segment` (the release model via onnxruntime-web) and
 * `ribbonFromMask` -- and the traced ring and axis, normalised by image width,
 * are written to `src/sim/sampleGeometry.json`, which `sim/samples.ts` projects
 * onto each sample's theatre. The outline is the model's, from the same image
 * the operator sees.
 *
 * Run: npm run build:sample-geometry   (needs the exported model; see
 * .venv/Scripts/python.exe -m ml.export.onnx_export)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import * as ort from 'onnxruntime-web';
import { ribbonFromMask } from '../src/sim/ingest';
import { segment, type SegmenterManifest, type SessionLike } from '../src/sim/segmenter';

const at = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const manifest = JSON.parse(readFileSync(at('public/models/L1-ciou-research.json'), 'utf8')) as SegmenterManifest;
const session = await ort.InferenceSession.create(readFileSync(at(`public/models/${manifest.file}`)));
const model = {
  manifest,
  session: session as unknown as SessionLike,
  tensor: (data: Float32Array, dims: number[]) => new ort.Tensor('float32', data, dims),
  backend: 'wasm',
};

const out: Record<string, { ring: [number, number][]; axis: [number, number][] }> = {};
for (const n of [1, 2, 3]) {
  const image = jpeg.decode(readFileSync(at(`public/data_sample/sample${n}.jpg`)), { useTArray: true, formatAsRGBA: true });
  const rgba = new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  const segmented = await segment(model, rgba, image.width, image.height);
  const traced = ribbonFromMask(segmented.mask, rgba, image.width, image.height, segmented.detections);
  if (!traced.ok) throw new Error(`sample${n}: ${traced.detail}`);
  // Every other axis point, ends kept: the density the sample scenarios were
  // built and checked at.
  const axis = traced.ribbon.axis;
  const thinned = axis.filter((_, i) => i % 2 === 0);
  if ((axis.length - 1) % 2 !== 0) thinned.push(axis[axis.length - 1]);
  out[`sample${n}`] = { ring: traced.ribbon.ring, axis: thinned };
  console.log(`sample${n}: ${image.width}x${image.height}, ${segmented.detections.length} detection(s), ` +
    `best ${traced.ribbon.score}, ${(traced.ribbon.coverage * 100).toFixed(1)}% of frame, ` +
    `ring ${traced.ribbon.ring.length} / axis ${thinned.length} points`);
}
writeFileSync(at('src/sim/sampleGeometry.json'), JSON.stringify(out));
console.log('wrote src/sim/sampleGeometry.json');
