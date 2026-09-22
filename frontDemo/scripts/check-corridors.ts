/**
 * Every shipping lane, and every ship on it, tested against the land mask.
 *
 * Three parts:
 *
 *  1. The AUTHORED lanes in every scenario, across their whole traffic band
 *     (plus or minus one width -- two sigma of the scatter `buildTraffic`
 *     applies), not just the centreline. Reported, since each was placed by
 *     hand and a graze is worth seeing; the vessels on them are asserted in 2.
 *  2. The RUNTIME lanes an upload gets, at real coastal sites from the corpus
 *     and from the user's own report (Bali, where lanes used to cross the
 *     island). Asserted: every lane's band is water and no vessel point is on
 *     land. Before 2026-09-22 nothing tested these at all.
 *  3. A CONTROL: the fixed lanes uploads used to get, placed at Bali. They
 *     must be caught crossing land, or a clean result above proves nothing.
 *
 * Run: npm run check:corridors
 */
import assert from 'node:assert/strict';
import { buildTraffic, corridorLandFraction, planCorridors, type Corridor, type TrafficStats } from '../src/sim/ais';
import { ensureLandmask, isLand } from '../src/sim/landmask';
import { makeRng } from '../src/sim/rng';
import { SPEC_FOR_CHECK } from '../src/sim/scenarios';
import type { LngLat } from '../src/sim/types';
import { useDiskLandmask } from './landmaskDisk';

useDiskLandmask();

// 1. Authored lanes.
const authored = [];
for (const [id, spec] of Object.entries(SPEC_FOR_CHECK)) {
  for (const [lane, c] of spec.traffic.corridors.entries()) {
    const bandPct = +(100 * corridorLandFraction(c)).toFixed(2);
    if (bandPct > 0) authored.push({ id, lane, bandLandPct: bandPct });
  }
}
console.log('Authored lanes whose traffic band touches land:');
if (authored.length) console.table(authored); else console.log('  none');

const vesselsAshore = (corridors: Corridor[], stats: TrafficStats) => {
  const vessels = buildTraffic(
    { corridors, vesselCount: 160, cadenceS: 60, windowHours: 48, acquiredAt: Date.UTC(2026, 8, 10, 6) },
    makeRng(7),
    stats,
  );
  let points = 0;
  let ashore = 0;
  for (const v of vessels) for (const p of v.points) { points++; if (isLand(p.lon, p.lat)) ashore++; }
  return { vessels: vessels.length, points, ashore };
};

// Authored scenarios' vessels, built exactly as the scenario builds them.
for (const [id, spec] of Object.entries(SPEC_FOR_CHECK)) {
  const stats = { resampled: 0, dropped: 0 };
  const { ashore } = vesselsAshore(spec.traffic.corridors, stats);
  assert.equal(ashore, 0, `${id}: ${ashore} authored-lane AIS points on land`);
}

// 2. Runtime lanes at coastal sites.
const SITES: [string, LngLat][] = [
  ['Bali, south of the Bukit', [115.25, -8.95]],
  ['Java, off Semarang', [110.4, -6.75]],
  ['Malacca Strait (corpus 00586)', [98.463, 4.159]],
  ['Singapore Strait', [104.0, 1.2]],
  ['Red Sea', [38.5, 20.5]],
  ['Persian Gulf (corpus 00039)', [48.482, 28.7]],
  ['Eastern Mediterranean (corpus 00254)', [33.867, 34.594]],
  ['Gulf of Guinea (corpus 00340)', [11.355, -4.744]],
];
const rows = [];
for (const [name, centre] of SITES) {
  await ensureLandmask(centre, 160);
  assert.ok(!isLand(centre[0], centre[1]), `${name}: the site itself is on land`);
  const plan = planCorridors(centre);
  const stats = { resampled: 0, dropped: 0 };
  const traffic = vesselsAshore(plan.corridors, stats);
  for (const c of plan.corridors) {
    assert.equal(corridorLandFraction(c), 0, `${name}: a planned lane's band touches land`);
  }
  assert.equal(traffic.ashore, 0, `${name}: ${traffic.ashore} vessel points on land`);
  rows.push({
    site: name,
    lanes: plan.corridors.length,
    laneKm: plan.corridors.map(c => Math.round(Math.hypot(c.to[0] - c.from[0], c.to[1] - c.from[1]) * 111)).join(' / '),
    vessels: traffic.vessels,
    resampled: stats.resampled,
    dropped: stats.dropped,
    pointsAshore: traffic.ashore,
  });
}
console.log('\nRuntime lanes for uploads:');
console.table(rows);

// 3. Control: the lanes every upload used to get, at Bali.
const bali: LngLat = [115.25, -8.95];
const legacy: Corridor[] = [
  { from: [bali[0] - 1.1, bali[1] - 0.22], to: [bali[0] + 1.0, bali[1] + 0.2], widthKm: 8 },
  { from: [bali[0] - 0.28, bali[1] + 0.85], to: [bali[0] + 0.12, bali[1] - 0.8], widthKm: 6 },
];
const legacyPct = legacy.map(c => +(100 * corridorLandFraction(c)).toFixed(1));
console.log(`\nControl: the old fixed upload lanes at Bali put ${legacyPct.join('% and ')}% of their band on land.`);
assert.ok(legacyPct.some(p => p > 0), 'control: the old lanes should have been caught crossing Bali');

console.log('\nPASS: every runtime lane and every vessel on it is in the water, and the control fires.');
