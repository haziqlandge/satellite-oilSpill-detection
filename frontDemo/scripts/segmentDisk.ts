/**
 * An upload's segmentation, computed in Node exactly as the browser computes it.
 *
 * The browser decodes a PNG or JPEG through a canvas and a GeoTIFF through
 * `decodeGeoTiff`, then hands the RGBA pixels (and, for a GeoTIFF, its no-data
 * mask) to `segment`. This does the same, on the same model, through
 * onnxruntime-web's WASM backend, so what `precompute-uploads.ts` stores is the
 * live result and `check-precomputed.ts` can prove it.
 *
 * PNG is lossless, so a decoder here gives the canvas's pixels exactly -- for
 * 8-bit files with no colour-management chunks, which is what the corpus tiles
 * are; anything else is refused rather than decoded approximately. JPEG is
 * decoded with jpeg-js, and a browser's decoder can differ from it by a grey
 * level here and there; that is recorded on the entry as `decodeNote`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';
import * as ort from 'onnxruntime-web';
import { decodeGeoTiff } from '../src/sim/geotiff';
import { segment, type Segmentation, type SegmenterManifest, type SessionLike } from '../src/sim/segmenter';
import { REPO } from './corpusDisk';

const MODELS = join(REPO, 'frontDemo/public/models');

export interface Decoded {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  valid: Uint8Array | null;
  note?: string;
}

/** A PNG as the canvas would hand it over: RGBA, 8 bits a channel. */
export function decodePng(buf: Buffer): Decoded {
  const SIG = '89504e470d0a1a0a';
  if (buf.subarray(0, 8).toString('hex') !== SIG) throw new Error('not a PNG');
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  let palette: Buffer | null = null;
  let alpha: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length;) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colour = data[9]; interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') alpha = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'gAMA' || type === 'iCCP' || type === 'cHRM' || type === 'sRGB')
      throw new Error(`PNG carries ${type}; a browser colour-manages it, so a plain decode would not match`);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`PNG ${depth}-bit${interlace ? ', interlaced' : ''} is not supported`);
  if (colour === 4 || colour === 6 || alpha)
    throw new Error('PNG with transparency: a canvas premultiplies it, so a plain decode would not match');
  const channels = ({ 0: 1, 2: 3, 3: 1 } as Record<number, number>)[colour];
  if (!channels) throw new Error(`PNG colour type ${colour} is not supported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`PNG filter ${filter}`);
      cur[x] = v & 255;
    }
    prev = cur;
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels, d = i * 4;
    if (colour === 0) { rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s]; rgba[d + 3] = 255; }
    else if (colour === 2) { rgba[d] = out[s]; rgba[d + 1] = out[s + 1]; rgba[d + 2] = out[s + 2]; rgba[d + 3] = 255; }
    else {
      if (!palette) throw new Error('PNG palette missing');
      const k = out[s];
      rgba[d] = palette[k * 3]; rgba[d + 1] = palette[k * 3 + 1]; rgba[d + 2] = palette[k * 3 + 2];
      rgba[d + 3] = 255;
    }
  }
  return { rgba, width, height, valid: null };
}

/** Any upload the panel accepts, decoded the way the panel decodes it. */
export async function decodeFile(repoPath: string): Promise<Decoded> {
  const buf = readFileSync(join(REPO, repoPath));
  const lower = repoPath.toLowerCase();
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) {
    const name = repoPath.split(/[\\/]/).pop()!;
    const decoded = await decodeGeoTiff(new File([buf], name, { type: 'image/tiff' }));
    if (!decoded.ok) throw new Error(decoded.reason);
    const r = decoded.raster;
    return { rgba: r.rgba, width: r.width, height: r.height, valid: r.valid };
  }
  if (lower.endsWith('.png')) return decodePng(buf);
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return {
      rgba: new Uint8ClampedArray(img.data), width: img.width, height: img.height, valid: null,
      note: 'decoded with jpeg-js; a browser JPEG decoder can differ from it by a grey level',
    };
  }
  throw new Error(`${repoPath}: not a raster the upload panel accepts`);
}

let model: Promise<{ manifest: SegmenterManifest; session: SessionLike; tensor: (d: Float32Array, dims: number[]) => unknown; backend: string }> | null = null;

export function loadDiskModel() {
  model ??= (async () => {
    const manifest = JSON.parse(readFileSync(join(MODELS, 'L1-ciou-research.json'), 'utf8')) as SegmenterManifest;
    const session = await ort.InferenceSession.create(readFileSync(join(MODELS, manifest.file)));
    return {
      manifest,
      session: session as unknown as SessionLike,
      tensor: (data: Float32Array, dims: number[]) => new ort.Tensor('float32', data, dims),
      backend: 'wasm',
    };
  })();
  return model;
}

/** Decode and segment one file, as an upload of it would. */
export async function segmentFile(repoPath: string): Promise<Segmentation & { decoded: Decoded }> {
  const decoded = await decodeFile(repoPath);
  const m = await loadDiskModel();
  const seg = await segment(m, decoded.rgba, decoded.width, decoded.height, { valid: decoded.valid });
  return { ...seg, decoded };
}
