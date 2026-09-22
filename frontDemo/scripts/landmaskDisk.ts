/**
 * Point the land mask at `public/landmask/` on disk, for checks run under Node.
 *
 * In the browser the mixed coastal tiles are fetched; here there is no page to
 * fetch relative to, so the same band files are read straight from the tree.
 * Call once, then `await ensureLandmask(...)` exactly as the upload path does.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setBandLoader } from '../src/sim/landmask';

const DIR = fileURLToPath(new URL('../public/landmask/', import.meta.url));

export function useDiskLandmask(): void {
  setBandLoader(async file => new Uint8Array(await readFile(DIR + file)));
}
