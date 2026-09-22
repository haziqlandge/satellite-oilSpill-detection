/**
 * The real AIS behind the Gulf scenes: present, matched to its scene, and honest.
 *
 * Asserted, per scene:
 *  - the export's position and time are the scenario's (a scene moved in
 *    `scenarios.ts` without re-exporting fails here)
 *  - exactly one published vessel where the case names one, none where it does not
 *  - that vessel's REAL track reaches the coordinate the publication gives: at
 *    the pass for the moving case, at its berth for the berthed one. This is the
 *    check that caught the Case 3 coordinate being one degree of longitude out
 *  - resampling never bridges a reception gap
 *
 * And a control: the uncorrected Case 3 coordinate must be far from the real
 * berth, or the correction -- and this check -- would prove nothing.
 *
 * Run: npm run check:realais
 */
import assert from 'node:assert/strict';
import { distanceKm } from '../src/sim/geo';
import { isLand } from '../src/sim/landmask';
import { realTrafficFile, realVessels, REAL_AIS_SCENES, REAL_CADENCE_S, publishedVesselId } from '../src/sim/realAis';
import { PUBLISHED_SOURCES, SPEC_FOR_CHECK } from '../src/sim/scenarios';
import type { LngLat, ScenarioId } from '../src/sim/types';
import { useDiskTraffic } from './realAisDisk';

await useDiskTraffic();

const rows = [];
for (const scene of REAL_AIS_SCENES) {
  const id = scene as ScenarioId;
  const file = realTrafficFile(scene)!;
  const spec = SPEC_FOR_CHECK[id as keyof typeof SPEC_FOR_CHECK];
  assert.ok(spec, `${scene}: no scenario spec`);

  const drift = distanceKm(file.centre, spec.meta.centre);
  assert.ok(drift < 2, `${scene}: exported around ${file.centre}, scenario is at ${spec.meta.centre} (${drift.toFixed(1)} km)`);
  const dt = Math.abs(Date.parse(file.acquiredAt) - Date.parse(spec.meta.acquiredAtIso));
  assert.ok(dt <= 60_000, `${scene}: export and scenario disagree on acquisition by ${dt / 1000}s`);

  const vessels = realVessels(scene);
  const published = publishedVesselId(scene);
  const expected = PUBLISHED_SOURCES[id];
  assert.equal(published !== null, expected !== undefined, `${scene}: published vessel ${published ? 'present' : 'absent'} but the case ${expected ? 'names' : 'does not name'} one`);

  let reachKm: number | null = null;
  if (published && expected) {
    const truth = vessels.find(v => v.mmsi === published)!;
    const acquiredAt = Date.parse(file.acquiredAt);
    const near = (p: { lon: number; lat: number }) => distanceKm([p.lon, p.lat] as LngLat, expected);
    if (spec.source.type === 'moving') {
      const atPass = truth.points.filter(p => Math.abs(p.t - acquiredAt) <= 10 * 60_000);
      assert.ok(atPass.length, `${scene}: the published vessel has no report within 10 min of the pass`);
      reachKm = Math.min(...atPass.map(near));
    } else {
      const moored = truth.points.filter(p => p.sog < 0.5);
      assert.ok(moored.length, `${scene}: the published vessel never stops`);
      reachKm = moored.map(near).sort((a, b) => a - b)[Math.floor(moored.length / 2)];
    }
    assert.ok(reachKm <= 0.3, `${scene}: the published vessel's real track is ${reachKm.toFixed(2)} km from the published coordinate`);
  }

  let bridged = 0;
  let points = 0;
  let ashore = 0;
  const gapMs = file.simplification.gapMin * 60_000;
  for (const v of vessels) {
    for (let i = 0; i < v.points.length; i++) {
      points++;
      if (isLand(v.points[i].lon, v.points[i].lat)) ashore++;
      if (i === 0) continue;
      const step = v.points[i].t - v.points[i - 1].t;
      // Every step is either inside a segment (at most one cadence step) or a
      // real reception gap (longer than the gap threshold, left unfilled). A
      // step in between means the resampler skipped a stretch it should fill.
      if (step > REAL_CADENCE_S * 1000 + 1 && step <= gapMs) bridged++;
    }
  }
  assert.equal(bridged, 0, `${scene}: ${bridged} steps are neither a cadence step nor a real gap`);

  rows.push({
    scene,
    vessels: vessels.length,
    reports: file.rows.inBoxAndWindow,
    exportedPts: file.rows.kept,
    resampledPts: points,
    published: published ? 'yes' : '-',
    reachKm: reachKm === null ? '-' : +reachKm.toFixed(3),
    // Real ships sail up the Mississippi and moor in port; the coastline
    // raster calls rivers land. Reported, not asserted.
    ptsOnLandPct: +(100 * ashore / points).toFixed(2),
  });
}
console.table(rows);

// Control: where the uncorrected Case 3 coordinate would have put the berth.
const uncorrected: LngLat = [-(89 + 58 / 60 + 7.356 / 3600), 28 + 56 / 60 + 12.876 / 3600];
const berth = PUBLISHED_SOURCES['gom-berthed']!;
const apart = distanceKm(uncorrected, berth);
console.log(`\nControl: the uncorrected Case 3 coordinate is ${apart.toFixed(1)} km from the berth the vessel's AIS shows.`);
assert.ok(apart > 90, 'control: the correction should move the berth by about a degree');

console.log('PASS: every Gulf scene runs on real AIS matched to it, and each named vessel reaches its published coordinate.');
