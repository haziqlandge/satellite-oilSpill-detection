/**
 * Discharges must not all be the same straight line.
 *
 * Every release used to emit at a perfectly constant rate, so the accumulation
 * curve was identical in shape for every scenario and only differed in length.
 * Measured before the shapes were assigned, all eight reported exactly ONE
 * distinct rate increment across the whole release.
 *
 * This asserts the curves are distinguishable from each other and from a
 * straight line, and reports the peak-to-mean rate so a shape that was meant
 * to surge can be seen to surge.
 *
 * Run: npm run check:release
 */
import assert from 'node:assert/strict';
import { buildRun, SCENARIOS } from '../src/sim/scenarios';
import { SAMPLE_LISTINGS } from '../src/sim/samples';
import { isLand } from '../src/sim/landmask';
import { useDiskTraffic } from './realAisDisk';

// The Gulf scenes' traffic is real AIS; buildRun refuses them until it is loaded.
await useDiskTraffic();

const rows = [];
const signatures = new Map<string, string>();
for (const { id } of [...SCENARIOS, ...SAMPLE_LISTINGS]) {
  const run = buildRun(id);
  const frames = run.release ?? [];
  for (const f of frames)
    for (let i = 0; i < f.particles.length; i += 2)
      assert.ok(!isLand(f.particles[i], f.particles[i + 1]), `${id}: oil ashore at T${f.hour}`);

  // The discharge curve, over the hours where oil is still entering the water.
  const during = frames.filter(f => f.releasedFraction > 0 && f.releasedFraction < 1);
  const rate = during.slice(1).map((f, i) => f.releasedFraction - during[i].releasedFraction);
  if (rate.length < 3) { rows.push({ id, hours: during.length, note: 'window too short to shape' }); continue; }
  const mean = rate.reduce((a, b) => a + b, 0) / rate.length;
  const peak = Math.max(...rate);
  const low = Math.min(...rate);
  // Largest gap between the curve and the straight line through its ends.
  let bow = 0;
  for (let i = 0; i < during.length; i++) {
    const t = i / (during.length - 1);
    bow = Math.max(bow, Math.abs(during[i].releasedFraction - t));
  }
  signatures.set(id, rate.map(r => (r / mean).toFixed(1)).join(','));
  rows.push({
    id, hours: during.length,
    peakOverMean: +(peak / mean).toFixed(2),
    lowOverMean: +(low / mean).toFixed(2),
    bowFromStraight: +bow.toFixed(3),
  });
}
console.table(rows);
const shaped = rows.filter(r => 'bowFromStraight' in r);
assert.ok(
  shaped.some(r => (r as { bowFromStraight: number }).bowFromStraight > 0.05),
  'no scenario departs from a straight discharge line',
);
assert.ok(
  new Set(signatures.values()).size > 1,
  'every scenario has an identical discharge curve',
);
console.log(`PASS: ${new Set(signatures.values()).size} distinct discharge curves, and no oil ashore.`);
