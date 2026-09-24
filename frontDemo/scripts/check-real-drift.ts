/**
 * The exported OpenDrift artifacts must be loadable and physically sane.
 *
 * The first export of these files was UNLOADABLE and nothing said so. When the
 * backward field does not converge, `estimate_age` honestly returns a NaN
 * triple; `json.dumps` writes that as a bare `NaN`, which Python reads back
 * happily and `JSON.parse` refuses outright. The artifact looked fine on disk,
 * round-tripped fine in Python, and would have failed in the browser as a
 * syntax error a long way from its cause. So the first thing checked here is
 * the thing a human would never think to check: that the file parses at all.
 *
 * Run: npm run check:realdrift
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isLand } from '../src/sim/landmask';
import { deepAshore, type RealDriftRun } from '../src/sim/realDrift';

const ROOT = join(process.cwd(), 'public', 'runs');
if (!existsSync(ROOT)) {
  console.log('No exported runs; skipping. Run scripts/export_drift_runs.py.');
  process.exit(0);
}
const scenes = readdirSync(ROOT).filter(d => existsSync(join(ROOT, d, 'drift.json')));
if (scenes.length === 0) {
  console.log('No exported runs; skipping. Run scripts/export_drift_runs.py.');
  process.exit(0);
}

const rows = [];
for (const scene of scenes) {
  const raw = readFileSync(join(ROOT, scene, 'drift.json'), 'utf8');

  // The NaN guard. JSON.parse is exactly what the browser will do.
  assert.doesNotThrow(
    () => JSON.parse(raw),
    `${scene}: drift.json is not valid JSON — a non-finite value almost certainly reached it`,
  );
  assert.ok(!/\bNaN\b|\bInfinity\b/.test(raw), `${scene}: contains a bare NaN or Infinity`);

  const run = JSON.parse(raw) as RealDriftRun;
  assert.ok(run.frames.length > 1, `${scene}: needs more than one frame`);
  assert.equal(run.engine, 'OpenDrift OpenOil', `${scene}: not an OpenDrift run`);

  const hours = run.frames.map(f => f.hour);
  assert.ok(hours.includes(0), `${scene}: the observation hour is missing`);
  assert.ok(run.forwardHours > 0, `${scene}: re-export -- the run has no forecast`);
  assert.equal(Math.max(...hours), run.forwardHours, `${scene}: the forecast stops at T+${Math.max(...hours)}, not +${run.forwardHours} h`);
  assert.equal(
    Math.min(...hours), -run.backwardHours,
    `${scene}: frames stop at T${Math.min(...hours)}, not the ${run.backwardHours} h horizon`,
  );
  // Ascending, so the interface can step through them without re-sorting.
  for (let i = 1; i < hours.length; i++)
    assert.ok(hours[i] > hours[i - 1], `${scene}: frames are not in ascending hour order`);

  // Two counts, because they mean different things. `coastal` is a parcel in
  // a cell whose centre is land -- mostly rounding, since backward parcels are
  // parked hard against the shore. `deep` has no water in any neighbouring
  // cell either, which the raster's rounding cannot explain: that would be a
  // real disagreement with OpenDrift's coastline, which this mask is built from.
  let coastal = 0;
  let deep = 0;
  let parcels = 0;
  for (const frame of run.frames) {
    assert.equal(frame.particles.length % 2, 0, `${scene}: odd particle array at T${frame.hour}`);
    for (let i = 0; i < frame.particles.length; i += 2) {
      const lon = frame.particles[i];
      const lat = frame.particles[i + 1];
      assert.ok(Number.isFinite(lon) && Number.isFinite(lat), `${scene}: non-finite parcel`);
      parcels++;
      if (isLand(lon, lat)) coastal++;
      if (deepAshore(lon, lat)) deep++;
    }
  }

  const zero = run.frames.find(f => f.hour === 0)!;
  const earliest = run.frames[0];
  const widening = earliest.area90Km2 / Math.max(1e-9, zero.area90Km2);
  // Diffusion is irreversible: the origin field is widest furthest back.
  assert.ok(widening > 1, `${scene}: backward field did not widen (x${widening.toFixed(2)})`);
  // And the forecast spreads forward from the same parcels; oil that strands stays stranded.
  const ahead = run.frames.filter(f => f.hour > 0);
  const last = ahead[ahead.length - 1];
  assert.ok(last.spreadKm > zero.spreadKm, `${scene}: the forecast did not spread (${last.spreadKm} km at +${last.hour} h)`);
  let stranded = 0;
  for (const f of ahead) {
    assert.ok(f.strandedPct !== undefined && f.strandedPct >= 0 && f.strandedPct <= 100, `${scene}: +${f.hour} h has no stranded share`);
    assert.ok(f.strandedPct! >= stranded, `${scene}: stranded oil came back afloat at +${f.hour} h`);
    stranded = f.strandedPct!;
  }

  // Whether the physics stayed on its coast is OpenDrift's own answer, measured
  // on its GSHHG polygons at export: 0.00-0.26% so far. This used to be judged
  // from `deep` on the raster, and the December run seeded at sea broke it:
  // parcels carried into the delta passes, which are narrower than one
  // 1/240-degree cell, read as 1.28% "deep ashore" -- 98.8% of them are water
  // on GSHHG, every one within a quarter cell of it. The raster's own agreement
  // with GSHHG is tested where it is built (tests/test_landmask.py, >= 99.9%);
  // `coastal` and `deep` stay in the table as what the map's mask says.
  assert.ok(run.onLandPct !== undefined, `${scene}: re-export -- the run does not record its parcels on OpenDrift's land`);
  assert.ok(run.onLandPct < 1, `${scene}: ${run.onLandPct}% of parcels are on OpenDrift's own land`);

  rows.push({
    scene: scene.slice(0, 26),
    frames: run.frames.length,
    members: run.members,
    forcing: run.forcing,
    failures: run.memberFailures.length,
    widening: +widening.toFixed(1),
    'spread +72 km': +last.spreadKm.toFixed(2),
    'stranded +72 %': stranded,
    spreadAtHorizonKm: +earliest.spreadKm.toFixed(2),
    inCoastalCellPct: +(100 * coastal / parcels).toFixed(2),
    deepAshorePct: +(100 * deep / parcels).toFixed(2),
    openDriftLandPct: run.onLandPct,
    age: run.age.age_method && run.age.age_method !== 'none' ? run.age.age_method : (run.age.status ?? 'refused'),
    seconds: run.elapsedSeconds,
  });
}
console.table(rows);
console.log(`PASS: ${scenes.length} real OpenDrift run(s) parse, span both horizons, widen backward, spread forward, and agree with the coastline.`);
