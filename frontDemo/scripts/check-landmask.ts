/**
 * Spot-check the land mask where being wrong has already cost something.
 *
 * Every expected value here is OpenDrift's own answer
 * (`roaring_landmask.RoaringLandmask.contains`, GSHHG full resolution), not a
 * reading of the basemap. The mask used to be derived from basemap pixel colour
 * and these cases asserted agreement with THAT, which is how "Venice, LA is
 * water" came to be a passing test: the basemap draws the town pale enough to
 * classify as sea. Venice is a town on the delta, and OpenDrift says land.
 *
 * The Indonesian cases are the ones the user reported: uploads over Bali and
 * Java drifted inland and drew shipping lanes across both islands, because the
 * old mask covered three boxes and answered "water" everywhere else. The
 * straits between them must stay water, or a lane through them is refused.
 *
 * `tests/test_landmask.py` checks the raster against OpenDrift over thousands
 * of cells; this is the readable version, run the way the browser runs it.
 *
 * Run: npm run check:landmask
 */
import { ensureLandmask, isLand, landKnown } from '../src/sim/landmask';
import { useDiskLandmask } from './landmaskDisk';

const cases: [string, number, number, boolean][] = [
  ['open Gulf (gom-moving centre)', -89.28, 28.28, false],
  ['Venice, LA (a town, on land)', -89.35, 29.28, true],
  ['delta land west of Venice', -89.42, 29.33, true],
  ['Grand Bay open water', -89.25, 29.37, false],
  ['West Bay (authored gom-platform centre)', -89.62, 29.06, false],
  ['displaced gom-platform centre', -89.77, 28.31, false],
  ['displaced kutch-dark centre', 68.05, 22.52, false],
  // Moved a degree east on 2026-09-23 with the corrected Case 3 berth.
  ['gom-berthed centre', -88.96, 28.90, false],
  ['New Orleans-ish inland', -89.90, 29.75, true],
  ['Gulf of Kutch water', 69.40, 22.42, false],
  ['Saurashtra peninsula', 69.60, 22.10, true],
  ['Kutch peninsula north', 69.60, 23.10, true],
  ['open Arabian Sea', 71.60, 19.50, false],
  ['Mumbai land', 72.87, 19.08, true],
  // Outside every bundled region: fetched from public/landmask/ first.
  ['Bali, interior', 115.19, -8.40, true],
  ['Java, central', 110.40, -7.20, true],
  ['Lombok Strait', 115.75, -8.60, false],
  ['Bali Strait', 114.42, -8.20, false],
  ['Red Sea, mid-channel', 38.50, 20.50, false],
  ['Sudan coast, inland', 37.00, 20.00, true],
];

useDiskLandmask();

let bad = 0;
for (const [name, lon, lat, expected] of cases) {
  const before = landKnown(lon, lat);
  if (!before) await ensureLandmask([lon, lat], 5);
  const got = isLand(lon, lat);
  const ok = got === expected && landKnown(lon, lat);
  if (!ok) bad++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(40)} expected ${expected ? 'land ' : 'water'} got ${got ? 'land ' : 'water'}${before ? '' : '  (fetched)'}`,
  );
}
if (bad) {
  console.error(`\n${bad} disagreement(s) with OpenDrift's coastline`);
  process.exit(1);
}
console.log('\nAll spot-checks agree with OpenDrift\'s coastline.');
