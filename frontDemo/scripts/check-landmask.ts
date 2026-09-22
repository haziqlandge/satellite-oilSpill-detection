/**
 * Spot-check the generated land mask against the basemap it was derived from.
 *
 * The mask is only useful if it agrees with the coastline the operator sees, so
 * these cases are chosen where being wrong would matter: open water a scene
 * sits in, dry ground a backward field used to reach, and the awkward middle of
 * the Mississippi bird's-foot where a bay and a marsh are a kilometre apart.
 *
 * "Grand Bay" reads as water because it is a bay. That is the mask agreeing
 * with the basemap, which is the requirement -- not a miss.
 *
 * Run: npm run check:landmask
 */
import { isLand } from '../src/sim/landmask';
const cases: [string, number, number, boolean][] = [
  ['open Gulf (gom-moving centre)', -89.28, 28.28, false],
  ['Venice LA township', -89.35, 29.28, false],
  ['delta land west of Venice', -89.42, 29.33, true],
  // Grand Bay is a bay: the basemap reads +36 (water) there, and agreeing
  // with the basemap is the requirement.
  ['Grand Bay open water', -89.25, 29.37, false],
  // The AUTHORED gom-platform centre. Still water, but the scene no longer
  // sits here -- see DISPLACEMENTS in scenarios.ts.
  ['West Bay (authored gom-platform centre)', -89.62, 29.06, false],
  ['displaced gom-platform centre', -89.77, 28.31, false],
  ['displaced kutch-dark centre', 68.05, 22.52, false],
  ['gom-berthed centre', -89.96, 28.90, false],
  ['New Orleans-ish inland', -89.90, 29.75, true],
  ['Gulf of Kutch water', 69.40, 22.42, false],
  ['Saurashtra peninsula', 69.60, 22.10, true],
  ['Kutch peninsula north', 69.60, 23.10, true],
  ['open Arabian Sea', 71.60, 19.50, false],
  ['Mumbai land', 72.87, 19.08, true],
];
let bad = 0;
for (const [name, lon, lat, expected] of cases) {
  const got = isLand(lon, lat);
  const ok = got === expected;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(32)} expected ${expected ? 'land ' : 'water'} got ${got ? 'land ' : 'water'}`);
}
console.log(bad === 0 ? '\nAll mask spot-checks agree with the basemap.' : `\n${bad} disagreement(s)`);
