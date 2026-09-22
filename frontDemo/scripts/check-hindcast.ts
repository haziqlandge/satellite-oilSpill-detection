/**
 * Guard the backward leg against becoming a picture of itself again.
 *
 * This replaces check-reconstruction.ts, which validated a transform that no
 * longer exists. That transform took the T0 particle cloud and applied a
 * uniform scale about a moving centre for every negative hour, so the hindcast
 * was the observed slick at a different size -- same outline, same bearing,
 * locked aspect ratio, in every scenario, because it was the same function with
 * different constants. Its own checks encoded that: it asserted the backward
 * field was SMALLER than the T0 field, which is backwards. Running a diffusive
 * process in reverse spreads it. The field is widest at the far end of the
 * backward horizon, which is exactly when there is least oil in the water.
 *
 * The assertions below are chosen so that reinstating any similarity transform
 * fails them. A uniform scale about any centre preserves shape exactly, so it
 * holds the cloud's aspect ratio and principal bearing constant to the last
 * digit. Real ensemble members disagree, so both move.
 */

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRun, SCENARIOS } from '../src/sim/scenarios';
import { SAMPLE_LISTINGS } from '../src/sim/samples';
import { momentAt, checkpointsFor, growthCurve } from '../src/lib/playback';
import { distanceKm, KM_PER_DEG_LAT, kmPerDegLon } from '../src/sim/geo';
import { isLand } from '../src/sim/landmask';
import type { DriftFrame, LngLat } from '../src/sim/types';

/** Distance from a land point to the nearest water, by expanding ring search. */
function inlandKm(p: LngLat): number {
  if (!isLand(p[0], p[1])) return 0;
  for (let r = 1; r <= 40; r++) {
    for (let a = 0; a < 16; a++) {
      const th = (a / 16) * 2 * Math.PI;
      const q: LngLat = [p[0] + Math.cos(th) * r * 0.005, p[1] + Math.sin(th) * r * 0.005];
      if (!isLand(q[0], q[1])) return distanceKm(p, q);
    }
  }
  return 99;
}

/**
 * Second moments of a particle cloud, in kilometres about its own centroid.
 *
 * Degrees are projected to km before the covariance so a north-south cloud is
 * not reported as elongated purely by the cosine of the latitude.
 */
function shape(frame: DriftFrame) {
  const p = frame.particles;
  const n = p.length / 2;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += p[i * 2]; my += p[i * 2 + 1]; }
  mx /= n; my /= n;
  const kx = kmPerDegLon(my);
  let xx = 0, yy = 0, xy = 0;
  for (let i = 0; i < n; i++) {
    const a = (p[i * 2] - mx) * kx;
    const b = (p[i * 2 + 1] - my) * KM_PER_DEG_LAT;
    xx += a * a; yy += b * b; xy += a * b;
  }
  xx /= n; yy /= n; xy /= n;
  const trace = xx + yy;
  const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - (xx * yy - xy * xy)));
  const major = trace / 2 + disc;
  const minor = Math.max(trace / 2 - disc, 1e-12);
  return {
    aspect: Math.sqrt(major / minor),
    bearingDeg: (Math.atan2(2 * xy, xx - yy) * 90) / Math.PI,
    rmsKm: Math.sqrt(trace),
  };
}

const features: object[] = [];
const results = [...SCENARIOS, ...SAMPLE_LISTINGS].map(({ id }) => {
  const run = buildRun(id);
  const frames = run.drift.frames;
  const zero = frames.find(f => f.hour === 0)!;
  const past = frames.filter(f => f.hour <= 0);
  const earliest = past[0];

  assert.equal(earliest.hour, -run.drift.backwardHours, `${id}: backward leg truncated`);
  assert.equal(new Set(checkpointsFor(run)).size, checkpointsFor(run).length);
  assert.deepEqual(growthCurve(run).map(f => f.areaKm2), frames.map(f => f.area90Km2));

  for (const frame of frames) {
    assert.ok(frame.particles.every(Number.isFinite), `${id}: non-finite particle`);

    // Oil does not drift through Louisiana. The integrator refuses a step onto
    // land, so this is exact rather than a tolerance.
    for (let i = 0; i < frame.particles.length; i += 2) {
      assert.ok(
        !isLand(frame.particles[i], frame.particles[i + 1]),
        `${id}: parcel ashore at T${frame.hour}`,
      );
    }
    // Contours are traced on a grid whose land cells are zeroed, so a vertex
    // can still land in the first land cell across the shoreline where
    // marching squares interpolates the crossing. One cell is 0.005 degrees,
    // about 550 m; anything beyond that is the contour crossing the coast
    // rather than meeting it.
    for (const ring of [...frame.contour50, ...frame.contour90]) {
      for (const vertex of ring) {
        assert.ok(
          inlandKm(vertex) <= 0.6,
          `${id}: contour reaches ${inlandKm(vertex).toFixed(2)} km inland at T${frame.hour}`,
        );
      }
    }
    assert.equal(momentAt(run, frame.hour).areaKm2, frame.area90Km2, `${id}: timeline disagrees`);
    features.push({
      type: 'Feature',
      properties: { id, hour: frame.hour, kind: 'contour' },
      geometry: { type: 'MultiPolygon', coordinates: frame.contour90.map(r => [r]) },
    });
  }

  // Diffusion is irreversible, so the origin field is widest furthest back.
  const widening = earliest.area90Km2 / zero.area90Km2;
  assert.ok(widening > 1, `${id}: backward field did not widen (x${widening.toFixed(2)})`);

  // The anti-regression assertions. A similarity transform of the T0 cloud
  // would hold both of these at exactly zero.
  const shapes = past.map(shape);
  const aspects = shapes.map(s => s.aspect);
  const aspectRange = Math.max(...aspects) - Math.min(...aspects);
  let rotation = 0;
  for (let i = 1; i < shapes.length; i++) {
    // Principal axes are undirected, so a bearing is modulo 180 degrees.
    let d = Math.abs(shapes[i].bearingDeg - shapes[i - 1].bearingDeg) % 180;
    if (d > 90) d = 180 - d;
    rotation += d;
  }
  assert.ok(
    aspectRange > 0.1,
    `${id}: cloud shape is frozen across the backward leg (aspect range ${aspectRange.toFixed(3)}) -- is a similarity transform back?`,
  );
  // Three degrees, not five: mumbai-null measures 5.0 and a guard that a real
  // scenario sits exactly on is a guard that will fail for no reason. A frozen
  // transform scores exactly zero, so the margin is still decisive.
  assert.ok(
    rotation > 3,
    `${id}: cloud never rotates across the backward leg (${rotation.toFixed(1)} deg total)`,
  );

  assert.ok(run.suspects.length > 0);
  assert.ok(run.suspects.every(s => s.evidence.terms.length === 6));
  assert.ok(
    run.environment.hours[0] <= -run.drift.backwardHours &&
    run.environment.hours.at(-1)! >= run.drift.forwardHours,
  );

  return {
    id,
    widening: +widening.toFixed(2),
    aspectRange: +aspectRange.toFixed(2),
    rotationDeg: +rotation.toFixed(0),
    spreadKmAtHorizon: +earliest.spreadKm.toFixed(1),
    frames: frames.length,
    vessels: run.vessels.length,
    candidates: run.suspects.length,
    best: run.suspects[0].label,
  };
});

// Histories must differ between scenarios, or one shape is being reused again.
assert.equal(
  new Set(SAMPLE_LISTINGS.map(s => JSON.stringify(buildRun(s.id).vessels[0].points))).size,
  3,
);
assert.ok(
  new Set(results.map(r => r.aspectRange)).size > 1,
  'every scenario reports an identical shape range -- the histories are not distinct',
);

const out = join(tmpdir(), 'oilspill-frame-contours.json');
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }));
console.table(results);
console.log(`PASS: backward leg widens, changes shape and bearing, and differs by scenario. Contours: ${out}`);
