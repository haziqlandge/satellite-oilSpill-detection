/**
 * The real-run views, built from the files on disk and held to what they claim.
 *
 * A real run (`src/sim/realRun.ts`) is the console's one view with nothing
 * simulated in it, and its whole value is that the claim is true. So this
 * builds each one exactly as the console does and checks the claim piece by
 * piece: the detections are the exported model output, the drift is the
 * exported OpenDrift run frame for frame -- its credible regions redrawn as
 * outlines but covering exactly the exported cells -- every vessel is real AIS, the wind
 * is the ERA5 series, and -- the part most likely to be "improved" into a lie
 * later -- nobody is ranked, and the refusal says why.
 *
 * Run: npm run check:realruns   (skips if the exported runs are not on disk)
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { momentAt } from '../src/lib/playback';
import { pointInRing, polygonsOf } from '../src/sim/geo';
import { setTrafficLoader, type RealTrafficFile } from '../src/sim/realAis';
import { ensureRealRun, REAL_RUN_LISTINGS, setRealRunLoader, type RealSceneFile } from '../src/sim/realRun';
import type { RealDriftRun } from '../src/sim/realDrift';
import { buildRun } from '../src/sim/scenarios';
import type { LngLat } from '../src/sim/types';

/** Inside a set of rings, holes counted: an odd number of rings around the point. */
const inside = (p: LngLat, rings: LngLat[][]) => rings.filter((r) => pointInRing(p, r)).length % 2 === 1;

/**
 * The outline drawn is the region exported: every cell's centre is inside it,
 * and the centre of every uncovered neighbour is outside. Returns the number
 * of separate regions (holes are not regions).
 */
function sameCells(id: string, hour: number, boxes: LngLat[][], rings: LngLat[][]): number {
  if (!boxes.length) {
    assert.equal(rings.length, 0, `${id} ${hour} h: an outline with no cells`);
    return 0;
  }
  const step = Math.abs(boxes[0][1][0] - boxes[0][0][0]);
  const centres = boxes.map((b): LngLat => [(b[0][0] + b[2][0]) / 2, (b[0][1] + b[2][1]) / 2]);
  const cell = (p: LngLat) => `${Math.round(p[0] / step)},${Math.round(p[1] / step)}`;
  const covered = new Set(centres.map(cell));
  for (const c of centres) {
    assert.ok(inside(c, rings), `${id} ${hour} h: exported cell ${c} is outside the outline`);
    for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const n: LngLat = [c[0] + dx, c[1] + dy];
      if (!covered.has(cell(n))) assert.ok(!inside(n, rings), `${id} ${hour} h: uncovered cell ${n} is inside the outline`);
    }
  }
  return polygonsOf(rings).length;
}

const pub = (path: string) => fileURLToPath(new URL(`../public/${path}`, import.meta.url));
const missing = REAL_RUN_LISTINGS.filter(({ id, scene }) =>
  !existsSync(pub(`runs/${scene}/drift.json`)) || !existsSync(pub(`runs/${scene}/scene.json`)) || !existsSync(pub(`ais/${id}.json`)));
if (missing.length) {
  console.log(`Real-run files not on disk for ${missing.map((m) => m.id).join(', ')}; skipping. ` +
    'Export with scripts/export_drift_runs.py, scripts/export_real_scenes.py and export_ais_traffic.py --real-runs.');
  process.exit(0);
}
setRealRunLoader(async (path) => JSON.parse(readFileSync(pub(path), 'utf8')));
setTrafficLoader(async (scene) => JSON.parse(readFileSync(pub(`ais/${scene}.json`), 'utf8')) as RealTrafficFile);

const rows = [];
for (const { id, scene } of REAL_RUN_LISTINGS) {
  await ensureRealRun(id);
  const run = buildRun(id);
  const drift = JSON.parse(readFileSync(pub(`runs/${scene}/drift.json`), 'utf8')) as RealDriftRun;
  const file = JSON.parse(readFileSync(pub(`runs/${scene}/scene.json`), 'utf8')) as RealSceneFile;

  // Detections: the exported model output, all of it, seeded from one.
  assert.equal(run.detection.parts.length, file.detections.length, `${id}: detections dropped or invented`);
  assert.equal(file.detections.filter((d) => d.seed).length, 1, `${id}: exactly one seed polygon`);
  // The seed is chosen by a stated rule, and the view states it (ISSUES Q5).
  const pick = drift.seedDetection;
  assert.ok(pick, `${id}: the drift does not record which detection it was seeded from`);
  assert.ok(pick.straightEdgeKm < 1.2 && pick.landFraction <= 0.1, `${id}: the seed is a filled box or ashore`);
  assert.match(run.meta.provenance, /box-cut/, `${id}: the provenance does not say what the seed rule passed over`);
  assert.equal(run.detection.className, 'slick_unknown', `${id}: a real detection is never called oos`);

  // Drift: OpenDrift's frames, untouched, most-backward first.
  let maxLobes = 0, cells = 0, outlineRings = 0;
  assert.equal(run.drift.frames.length, drift.frames.length, `${id}: drift frames lost`);
  assert.deepEqual(run.drift.frames.map((f) => f.hour), drift.frames.map((f) => f.hour), `${id}: hours reordered`);
  for (let i = 0; i < drift.frames.length; i++) {
    assert.equal(run.drift.frames[i].particles.length, drift.frames[i].particles.length, `${id}: particles changed at ${drift.frames[i].hour} h`);
    assert.equal(run.drift.frames[i].area90Km2, drift.frames[i].area90Km2, `${id}: contour area changed`);
    const f = run.drift.frames[i], x = drift.frames[i];
    assert.ok(f.contour90.length <= x.contour90.length, `${id}: the outline has more rings than there are cells`);
    sameCells(id, x.hour, x.contour50, f.contour50);
    maxLobes = Math.max(maxLobes, sameCells(id, x.hour, x.contour90, f.contour90));
    cells += x.contour90.length;
    outlineRings += f.contour90.length;
  }
  assert.equal(run.drift.frames[0].hour, -drift.backwardHours, `${id}: does not start at the horizon`);
  assert.equal(run.drift.frames.at(-1)!.hour, 0, `${id}: does not end at the pass`);

  // The refusal: no age (C1 keeps the triple), nobody ranked, and it says why.
  const halt = run.drift.insufficientEvidence;
  assert.ok(halt && halt.kind === 'no_age', `${id}: the no-age refusal is missing`);
  assert.match(halt.reason, /never converges/, `${id}: the refusal does not say the field never converges`);
  assert.match(halt.reason, /no current\s+field/, `${id}: the refusal does not name the missing currents`);
  assert.equal(run.drift.ageMethod, 'no_convergence', `${id}: an age method was claimed`);
  assert.equal(run.drift.ageHours.length, 3, `${id}: C1 -- the age is a triple`);
  assert.equal(run.suspects.length, 0, `${id}: a real run ranked a vessel`);
  assert.equal(run.gate.admitted, 0, `${id}: the gate admitted a candidate`);
  assert.equal(run.truth, null, `${id}: a real run has no authored truth`);

  // Traffic: real, all of it, and the provenance says how much of the window it covers.
  assert.ok(run.vessels.length > 0, `${id}: no traffic`);
  assert.ok(run.vessels.every((v) => v.source === 'real'), `${id}: a simulated vessel got in`);
  assert.match(run.meta.provenance, /^REAL · /, `${id}: provenance does not open with REAL`);
  assert.doesNotMatch(run.meta.provenance, /\bSIM\b/, `${id}: provenance claims simulation`);

  // Wind is the ERA5 series; currents are absent, not zero.
  assert.equal(run.environment.windMs.length, drift.backwardHours + 1, `${id}: wind series length`);
  assert.ok(run.environment.windMs.every(Number.isFinite), `${id}: wind has gaps`);
  assert.ok(run.environment.currentMs.every(Number.isNaN), `${id}: a current was invented`);

  // The characterisation measured something: the traced axis stays inside the slick.
  const c = run.characterisation;
  assert.ok(c.areaKm2 > 0 && c.lengthKm > 0 && c.widthMMean > 0, `${id}: characterisation measured nothing`);
  assert.ok(Number.isNaN(c.dampingRatioDb), `${id}: a damping ratio nobody measured`);

  // No release is claimed before the pass.
  assert.equal(momentAt(run, -10).phase, 'reconstruction', `${id}: a release phase was claimed`);
  assert.equal(run.release.length, 0, `${id}: a release was simulated`);

  rows.push({
    id,
    detections: run.detection.parts.length,
    'seed conf': +run.detection.confidence.toFixed(2),
    'area km2': +c.areaKm2.toFixed(2),
    'length km': +c.lengthKm.toFixed(1),
    'wind at pass': +c.windSpeedMs.toFixed(1),
    'wind gate': +c.windGateMultiplier.toFixed(2),
    vessels: run.vessels.length,
    frames: run.drift.frames.length,
    'cells90 → rings': `${cells} → ${outlineRings}`,
    'max lobes': maxLobes,
    'area90 horizon': +run.drift.frames[0].area90Km2.toFixed(0),
  });
}
console.table(rows);
console.log(`PASS: ${rows.length} real runs are built from their files, rank nobody, and say why.`);
