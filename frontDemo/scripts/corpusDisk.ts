/**
 * Reading the Zenodo corpus from disk, for the checks that run real scenes.
 *
 * TRAIN scenes only, from the final-v11 train list: the held-out test split is
 * consumed (CLAUDE.md section 6).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const ZENODO = process.env.ZENODO_DIR ?? join(REPO, 'data/interim/datasets/zenodo');
const TRAIN_LIST = join(REPO, 'data/processed/dataset/final-v11/train.txt');

export const SOURCES = {
  '8346860': {
    scene: (id: string) => join(ZENODO, '8346860/01_Train_Val_Oil_Spill_images/Oil', `${id}.tif`),
    mask: (id: string) => join(ZENODO, '8346860/01_Train_Val_Oil_Spill_mask/Mask_oil', `${id}.tif`),
  },
  '13761290': {
    scene: (id: string) => join(ZENODO, '13761290/02_Test_images_and_ground_truth/Images/Oil', `${id}.tif`),
    mask: (id: string) => join(ZENODO, '13761290/02_Test_images_and_ground_truth/Mask/Oil', `${id}_segmentation.tif`),
  },
} as const;
export type Source = keyof typeof SOURCES;

export function corpusOnDisk(): boolean {
  return existsSync(ZENODO) && existsSync(TRAIN_LIST);
}

/** `take` evenly spaced train scenes of one source, so a check is deterministic. */
export function trainScenes(source: Source, take: number): string[] {
  const pattern = new RegExp(`${source}__Oil__(\\d{5})\\.png$`);
  const ids = readFileSync(TRAIN_LIST, 'utf8').split(/\r?\n/)
    .map(l => pattern.exec(l)?.[1]).filter((id): id is string => !!id);
  const step = Math.max(1, Math.floor(ids.length / take));
  return ids.filter((_, i) => i % step === 0).slice(0, take);
}

/**
 * A corpus mask, read from its own strip table.
 *
 * The masks were written by SCIFIO as uncompressed one-row strips, and
 * geotiff.js 3.0.5 reads their StripOffsets with the wrong byte order (16780
 * comes back as 0x8C410000), so `readRasters` walks off the end of the file.
 * libtiff and PIL read them fine. They are plain bytes, so the first IFD is
 * parsed here and the strips concatenated directly.
 */
export function readMask(path: string): Uint8Array {
  const buf = readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const le = buf.toString('latin1', 0, 2) === 'II';
  const ifd = view.getUint32(4, le);
  const tags = new Map<number, number[]>();
  for (let e = 0, n = view.getUint16(ifd, le); e < n; e++) {
    const at = ifd + 2 + e * 12;
    const type = view.getUint16(at + 2, le);
    const count = view.getUint32(at + 4, le);
    const size = type === 3 ? 2 : 4;
    const base = count * size > 4 ? view.getUint32(at + 8, le) : at + 8;
    const values: number[] = [];
    for (let i = 0; i < count && (type === 3 || type === 4); i++)
      values.push(size === 2 ? view.getUint16(base + i * 2, le) : view.getUint32(base + i * 4, le));
    tags.set(view.getUint16(at, le), values);
  }
  const [width] = tags.get(256)!, [height] = tags.get(257)!;
  if ((tags.get(259)?.[0] ?? 1) !== 1 || (tags.get(258)?.[0] ?? 8) !== 8 || (tags.get(277)?.[0] ?? 1) !== 1)
    throw new Error(`${path}: expected an uncompressed 8-bit single-band mask`);
  const offsets = tags.get(273)!, counts = tags.get(279)!;
  const out = new Uint8Array(width * height);
  let at = 0;
  for (let i = 0; i < offsets.length && at < out.length; i++) {
    out.set(buf.subarray(offsets[i], offsets[i] + Math.min(counts[i], out.length - at)), at);
    at += counts[i];
  }
  return out;
}
