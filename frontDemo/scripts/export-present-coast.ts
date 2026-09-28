/**
 * Coastlines as dot matrices, for the presentation overlay's technical
 * journey (`src/present/technical/`): the whole Gulf of Mexico for the Acquire
 * beat, and a finer patch around the 15 May 2023 drift for the drift view.
 *
 * Sampled from the project's one coastline -- the GSHHG mask in
 * `src/sim/landmask.ts`, the same polygons OpenDrift strands parcels on -- so
 * the overlay's coast is the drift's coast, not a picture of one.
 *
 * Run: npm run export:present-coast
 */
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureLandmask, isLand } from '../src/sim/landmask';
import { useDiskLandmask } from './landmaskDisk';

useDiskLandmask();
mkdirSync(new URL('../public/present/', import.meta.url), { recursive: true });

async function dots(name: string, bounds: [number, number, number, number], step: number, radiusKm: number) {
  const [west, south, east, north] = bounds;
  await ensureLandmask([(west + east) / 2, (south + north) / 2], radiusKm);
  const land: [number, number][] = [];
  for (let lat = south + step / 2; lat < north; lat += step) {
    for (let lon = west + step / 2; lon < east; lon += step) {
      if (isLand(lon, lat)) land.push([Math.round(lon * 1000) / 1000, Math.round(lat * 1000) / 1000]);
    }
  }
  writeFileSync(fileURLToPath(new URL(`../public/present/${name}`, import.meta.url)), JSON.stringify({ bounds, step, land }));
  console.log(`${name}: ${land.length} land cells at ${step} deg`);
  return land;
}

const gulf = await dots('coast-gulf.json', [-98, 18, -80, 31], 0.1, 1100);
assert.ok(gulf.length > 1000 && gulf.length < 20000, `gulf land cells ${gulf.length} outside 1,000 to 20,000`);
assert.ok(isLand(-90.07, 29.95), 'New Orleans must be land');
assert.ok(!isLand(-89.22, 28.5), 'the 15 May seed must be water');

const drift = await dots('coast-drift.json', [-90.6, 27.5, -87.2, 29.6], 0.02, 250);
assert.ok(drift.length > 500, `drift patch has only ${drift.length} land cells; the Mississippi delta should be in it`);
