/**
 * Load the Gulf scenes' real AIS from `public/ais/` on disk, for checks under Node.
 *
 * The browser fetches these; `buildRun` refuses to build a real-AIS scene until
 * they are loaded. Call this once, before building any run.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ensureRealTraffic, REAL_AIS_SCENES, setTrafficLoader, type RealTrafficFile } from '../src/sim/realAis';

const DIR = fileURLToPath(new URL('../public/ais/', import.meta.url));

export async function useDiskTraffic(): Promise<void> {
  setTrafficLoader(async scene => JSON.parse(await readFile(`${DIR}${scene}.json`, 'utf8')) as RealTrafficFile);
  for (const scene of REAL_AIS_SCENES) await ensureRealTraffic(scene);
}
