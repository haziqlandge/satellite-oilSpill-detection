/**
 * How close each scene gets to dry ground.
 *
 * Reported rather than asserted: `check-hindcast.ts` owns the hard guarantee
 * that no parcel is ashore, and this answers the different question of how much
 * daylight there is. That is what decided the two displacements in
 * `scenarios.ts` -- "not on land" and "not near land" are not the same
 * requirement, and the second is a judgement about how the scene reads.
 *
 * Run: npm run measure:land
 */
import { buildRun, SCENARIOS } from '../src/sim/scenarios';
import { SAMPLE_LISTINGS } from '../src/sim/samples';
import { isLand } from '../src/sim/landmask';
import { distanceKm, KM_PER_DEG_LAT, kmPerDegLon } from '../src/sim/geo';
import type { LngLat } from '../src/sim/types';
import { useDiskTraffic } from './realAisDisk';

// The Gulf scenes' traffic is real AIS; buildRun refuses them until it is loaded.
await useDiskTraffic();

/** Distance from a water point to the nearest land, by expanding ring search. */
function toLandKm(p: LngLat): number {
  if (isLand(p[0], p[1])) return 0;
  for (let r = 1; r <= 200; r++) {
    const km = r * 0.55;
    for (let a = 0; a < 32; a++) {
      const th = (a / 32) * 2 * Math.PI;
      const q: LngLat = [p[0] + (Math.cos(th) * km) / kmPerDegLon(p[1]), p[1] + (Math.sin(th) * km) / KM_PER_DEG_LAT];
      if (isLand(q[0], q[1])) return distanceKm(p, q);
    }
  }
  return 110;
}
const rows = [...SCENARIOS, ...SAMPLE_LISTINGS].map(({ id }) => {
  const run = buildRun(id);
  let minOil = Infinity, onLand = 0;
  for (const f of run.drift.frames) {
    for (let i = 0; i < f.particles.length; i += 40) {
      const p: LngLat = [f.particles[i], f.particles[i + 1]];
      if (isLand(p[0], p[1])) onLand++;
      minOil = Math.min(minOil, toLandKm(p));
    }
    for (const ring of [...f.contour50, ...f.contour90])
      for (let j = 0; j < ring.length; j += 4) minOil = Math.min(minOil, toLandKm(ring[j]));
  }
  let minVessel = Infinity;
  for (const v of run.vessels) for (const pt of v.points) minVessel = Math.min(minVessel, toLandKm([pt.lon, pt.lat]));
  return { id, centre: run.meta.centre.map(v => v.toFixed(2)).join(', '), oilOnLand: onLand, nearestOilToLandKm: +minOil.toFixed(1), nearestVesselToLandKm: +minVessel.toFixed(1) };
});
console.table(rows);
