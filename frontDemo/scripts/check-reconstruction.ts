import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { buildRun, SCENARIOS } from '../src/sim/scenarios';
import { SAMPLE_LISTINGS } from '../src/sim/samples';
import { reconstructionRun } from '../src/lib/reconstruction';
import { momentAt, checkpointsFor, growthCurve } from '../src/lib/playback';
import { distanceKm } from '../src/sim/geo';
import type { LngLat } from '../src/sim/types';

const centre = (p: Float64Array): LngLat => {
  let x = 0, y = 0;
  for (let i = 0; i < p.length; i += 2) { x += p[i]; y += p[i + 1]; }
  return [x / (p.length / 2), y / (p.length / 2)];
};
const features: object[] = [];
const results = [...SCENARIOS, ...SAMPLE_LISTINGS].map(({ id }) => {
  const source = buildRun(id);
  const run = reconstructionRun(source);
  const zero = run.drift.frames.find(f => f.hour === 0)!;
  const past = run.drift.frames.filter(f => f.hour <= 0);
  const future = run.drift.frames.filter(f => f.hour >= 0);
  assert.equal(reconstructionRun(run), run);
  assert.equal(new Set(checkpointsFor(run)).size, checkpointsFor(run).length);
  assert.deepEqual(growthCurve(source).map(f => f.areaKm2), run.drift.frames.map(f => f.area90Km2));
  assert.equal(past[0].hour, -run.drift.backwardHours);
  for (const frame of future) assert.equal(frame, source.drift.frames.find(f => f.hour === frame.hour), `${id}: forecast changed`);
  for (const frame of run.drift.frames) {
    assert.ok(frame.particles.every(Number.isFinite));
    assert.equal(momentAt(run, frame.hour).areaKm2, frame.area90Km2, `${id}: timeline disagrees`);
    features.push({ type: 'Feature', properties: { id, hour: frame.hour, kind: 'contour' }, geometry: { type: 'MultiPolygon', coordinates: frame.contour90.map(r => [r]) } });
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (let i = 0; i < frame.particles.length; i += 2) {
      west = Math.min(west, frame.particles[i]); east = Math.max(east, frame.particles[i]);
      south = Math.min(south, frame.particles[i + 1]); north = Math.max(north, frame.particles[i + 1]);
    }
    features.push({ type: 'Feature', properties: { id, hour: frame.hour, kind: 'all-particle-bounds' }, geometry: { type: 'MultiPolygon', coordinates: [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]] } });
  }
  const displacement = distanceKm(centre(past[0].particles), centre(zero.particles));
  assert.ok(displacement >= 9 && displacement <= 15, `${id}: origin separation ${displacement}`);
  assert.ok(past[0].area90Km2 / zero.area90Km2 >= .19);
  assert.ok(run.suspects.length > 0);
  assert.ok(run.suspects.every(s => s.evidence.terms.length === 6));
  assert.ok(run.environment.hours[0] <= -run.drift.backwardHours && run.environment.hours.at(-1)! >= run.drift.forwardHours);
  const shrinkingHours = past.filter((f, i) => i && f.area90Km2 < past[i - 1].area90Km2).length;
  return { id, displacementKm: +displacement.toFixed(1), initialAreaPercent: +(100 * past[0].area90Km2 / zero.area90Km2).toFixed(1), shrinkingHours, frames: run.drift.frames.length, vessels: run.vessels.length, candidates: run.suspects.length, best: run.suspects[0].label };
});
assert.ok(results.some(r => r.shrinkingHours === 0));
assert.ok(results.some(r => r.shrinkingHours >= 5));
assert.equal(new Set(SAMPLE_LISTINGS.map(s => JSON.stringify(buildRun(s.id).vessels[0].points))).size, 3);
writeFileSync('/private/tmp/oilspill-frame-contours.json', JSON.stringify({ type: 'FeatureCollection', features }));
console.table(results);
console.log('PASS: shared geometry/area, unchanged forecasts, distinct histories and full panel data.');
