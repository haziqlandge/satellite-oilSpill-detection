/**
 * The real-run views, built from the files on disk and held to what they claim.
 *
 * A real run (`src/sim/realRun.ts`) is the console's one view with nothing
 * simulated in it, and its whole value is that the claim is true. So this
 * builds each one exactly as the console does and checks the claim piece by
 * piece: the detections are the exported model output, each polygon marked
 * as the seed, a box-filled mask or neither by the export's own test, the drift
 * is the exported OpenDrift run frame for frame -- its 50/90% outlines smoothed
 * from the ensemble's own particles and holding about half and nine tenths of
 * them -- every vessel is real AIS, the wind
 * is the ERA5 series, the characterisation is the backend's PHASE-03 record
 * with a damping ratio only where one was measured, and -- the part most
 * likely to be "improved" into a lie later -- nobody is ranked, and the
 * refusal says why.
 *
 * Run: npm run check:realruns   (skips if the exported runs are not on disk)
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { momentAt } from '../src/lib/playback';
import { dissolveCells, pointInRing, polygonsOf, ringAreaKm2 } from '../src/sim/geo';
import { setTrafficLoader, type RealTrafficFile } from '../src/sim/realAis';
import { ensureRealRun, REAL_RUN_LISTINGS, setRealRunLoader, type RealSceneFile } from '../src/sim/realRun';
import type { RealDriftRun } from '../src/sim/realDrift';
import { buildRun } from '../src/sim/scenarios';
import { windGate } from '../src/sim/slick';
import { flowMean, isSimulated, ringsBbox, spillParts } from '../src/sim/flow';
import type { LngLat } from '../src/sim/types';
import { useDiskLandmask } from './landmaskDisk';
import { detectionFeatures } from '../src/map/detectionView';

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

/** Parcels afloat below which a frame's outline shares are not tested (2.5% of 2,000). */
const MIN_OUTLINE_PARCELS = 50;

const pub = (path: string) => fileURLToPath(new URL(`../public/${path}`, import.meta.url));
const missing = REAL_RUN_LISTINGS.filter(({ id, scene }) =>
  !existsSync(pub(`runs/${scene}/drift.json`)) || !existsSync(pub(`runs/${scene}/scene.json`)) || !existsSync(pub(`ais/${id}.json`)));
if (missing.length) {
  console.log(`Real-run files not on disk for ${missing.map((m) => m.id).join(', ')}; skipping. ` +
    'Export with scripts/export_drift_runs.py, scripts/export_real_scenes.py and export_ais_traffic.py --real-runs.');
  process.exit(0);
}
useDiskLandmask();
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
  // A detection can be a MultiPolygon, so rings are not detections: April's
  // 86 detections are 366 rings. The view's count is the model output's own.
  const source = JSON.parse(readFileSync(fileURLToPath(new URL(`../../eval/final/scenes/${scene}.geojson`, import.meta.url)), 'utf8')) as { features: unknown[] };
  const said = `${source.features.length} detections`;
  assert.ok(run.meta.provenance.includes(said), `${id}: the provenance does not say "${said}"`);
  assert.ok(run.meta.summary.includes(said), `${id}: the summary does not say "${said}"`);
  // The seed is chosen by a stated rule, and the view states it (ISSUES Q5).
  const pick = drift.seedDetection;
  assert.ok(pick, `${id}: the drift does not record which detection it was seeded from`);
  assert.ok(pick.straightEdgeKm < 1.2 && pick.landFraction <= 0.1, `${id}: the seed is a filled box or ashore`);
  assert.match(run.meta.provenance, /box-cut/, `${id}: the provenance does not say what the seed rule passed over`);
  assert.equal(run.detection.className, 'slick_unknown', `${id}: a real detection is never called oos`);
  // Each polygon says what it is (ISSUES F18), by the export's own flags, and keeps its own score.
  const kinds = run.detection.partKinds;
  assert.ok(kinds && kinds.length === file.detections.length, `${id}: a polygon has no kind`);
  assert.equal(kinds.filter((k) => k === 'seed').length, 1, `${id}: not exactly one seed`);
  assert.equal(kinds.filter((k) => k === 'box').length, file.detections.filter((d) => d.boxCut && !d.seed).length,
    `${id}: box-filled polygons miscounted`);
  assert.deepEqual(run.detection.partConfidence, file.detections.map((d) => d.confidence), `${id}: a polygon lost its own confidence`);
  // Radar: the exported CFAR targets, all of them, and the provenance counts them.
  const radar = file.cfar?.status === 'run' ? file.cfar.targets : [];
  assert.equal(run.cfarTargets.length, radar.length, `${id}: radar targets dropped or invented`);
  assert.match(run.meta.provenance, /Radar: CA-CFAR/, `${id}: the provenance does not describe the radar`);
  // The map draws the seed alone, with its own confidence.
  const drawn = detectionFeatures(run.detection);
  const seedAt = kinds.indexOf('seed');
  assert.equal(drawn.length, 1, `${id}: the map draws ${drawn.length} polygons, not the seed alone`);
  assert.deepEqual(drawn[0].ring, run.detection.parts[seedAt], `${id}: the polygon drawn is not the seed`);
  assert.equal(drawn[0].confidence, file.detections[seedAt].confidence, `${id}: the seed lost its own confidence`);

  // Drift: OpenDrift's frames, particles untouched, most-backward first. The
  // 50/90% outlines are smoothed from those particles by the authored scenes'
  // own blur and contour, so they have to hold the ensemble: about half and
  // nine tenths of the parcels. A 90% outline drawn at the 50% level, or from
  // the wrong frame, fails this.
  let maxLobes = 0, rings90 = 0, in90Min = 1, in90Max = 0, in50Min = 1, in50Max = 0, sparse = 0;
  assert.equal(run.drift.frames.length, drift.frames.length, `${id}: drift frames lost`);
  assert.deepEqual(run.drift.frames.map((f) => f.hour), drift.frames.map((f) => f.hour), `${id}: hours reordered`);
  assert.match(run.meta.provenance, /smoothed from OpenDrift's/, `${id}: the provenance does not say the outlines are smoothed`);
  for (let i = 0; i < drift.frames.length; i++) {
    const f = run.drift.frames[i], x = drift.frames[i];
    assert.deepEqual(Array.from(f.particles), x.particles, `${id}: particles changed at ${x.hour} h`);
    const parcels = x.particles.length / 2;
    const share = (rings: LngLat[][]) => {
      let n = 0;
      for (let k = 0; k < parcels; k++) if (inside([x.particles[2 * k], x.particles[2 * k + 1]], rings)) n++;
      return n / parcels;
    };
    // A forecast whose oil has nearly all stranded leaves a few dozen parcels
    // afloat, and a density outline over those is one blob: on the v12 April
    // run the 50% outline held 57-69% of 45-384 parcels, then all of 36 (+27 h,
    // 98% ashore), and from +42 h nothing is afloat. Below this the shares are
    // not a statistic, so those frames are counted, not tested.
    if (parcels < MIN_OUTLINE_PARCELS) {
      sparse++;
    } else {
      const in90 = share(f.contour90), in50 = share(f.contour50);
      // No ceiling on the 90% share: at the pass the parcels are uniform over the
      // slick, the density has no interior peak, and the 90% region covers
      // nearly all of it (99.5% measured). The 50% band is what pins the levels.
      assert.ok(in90 >= 0.8, `${id} ${x.hour} h: the 90% outline holds ${(in90 * 100).toFixed(1)}% of the parcels`);
      // Measured over all 435 frames: 90% outlines hold 91-100% of the parcels,
      // 50% outlines 52-77% (highest at the pass, for the same reason), and the
      // two levels are never closer than 20.8 points.
      assert.ok(in50 >= 0.35 && in50 <= 0.85, `${id} ${x.hour} h: the 50% outline holds ${(in50 * 100).toFixed(1)}% of the parcels`);
      assert.ok(in90 - in50 >= 0.1, `${id} ${x.hour} h: the 50% and 90% outlines hold nearly the same parcels`);
      [in90Min, in90Max, in50Min, in50Max] = [Math.min(in90Min, in90), Math.max(in90Max, in90), Math.min(in50Min, in50), Math.max(in50Max, in50)];
    }
    // The number printed is the outline drawn.
    const drawn = f.contour90.reduce((sum, r) => sum + ringAreaKm2(r), 0);
    assert.ok(Math.abs(drawn - f.area90Km2) < 1e-6, `${id} ${x.hour} h: area90 ${f.area90Km2} is not the drawn outline's ${drawn}`);
    // The export's own cells still dissolve to exactly themselves.
    maxLobes = Math.max(maxLobes, sameCells(id, x.hour, x.contour90, dissolveCells(x.contour90)));
    rings90 += f.contour90.length;
  }
  assert.equal(run.drift.frames[0].hour, -drift.backwardHours, `${id}: does not start at the horizon`);
  assert.equal(run.drift.frames.at(-1)!.hour, drift.forwardHours, `${id}: does not end at the forecast horizon`);
  assert.ok(drift.forwardHours > 0, `${id}: no forecast`);

  // At the pass the parcels ARE the detected slick: inside it and spanning its
  // length, not a disc at its centre (the runs used to be seeded that way, so a
  // 9 km streak began as a point).
  const seedRing = file.detections.find((d) => d.seed)!.ring;
  const pass = run.drift.frames.find((f) => f.hour === 0)!;
  const n0 = pass.particles.length / 2;
  let inSlick = 0;
  for (let k = 0; k < n0; k++) if (pointInRing([pass.particles[2 * k], pass.particles[2 * k + 1]], seedRing)) inSlick++;
  assert.ok(inSlick / n0 >= 0.95, `${id}: only ${((100 * inSlick) / n0).toFixed(0)}% of the parcels start inside the seed slick`);
  const axis = run.characterisation.medialAxis;
  const [ax, ay] = axis[0], [bx, by] = axis[axis.length - 1];
  const kx = Math.cos((ay * Math.PI) / 180);
  const ux = (bx - ax) * kx, uy = by - ay, ul = Math.hypot(ux, uy);
  const along = (x: number, y: number) => ((x - ax) * kx * ux + (y - ay) * uy) / ul;
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < n0; k++) {
    const t = along(pass.particles[2 * k], pass.particles[2 * k + 1]);
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  let rlo = Infinity, rhi = -Infinity;
  for (const [x, y] of seedRing) { const t = along(x, y); rlo = Math.min(rlo, t); rhi = Math.max(rhi, t); }
  const covered = (hi - lo) / (rhi - rlo);
  assert.ok(covered >= 0.7, `${id}: at the pass the parcels span ${(covered * 100).toFixed(0)}% of the slick's length`);

  // The forecast is drawn the way an authored scene's is: the 90% outline every 12 h.
  const ahead = run.drift.frames.filter((f) => f.hour > 0 && f.hour % 12 === 0);
  assert.deepEqual(run.forwardImpact, ahead.flatMap((f) => f.contour90), `${id}: the forecast envelope is not the forward frames' 90% outlines`);
  assert.ok(run.forwardImpact.length > 0, `${id}: no forecast envelope`);
  assert.match(run.meta.provenance, /Forecast: the same parcels run forward/, `${id}: the provenance does not describe the forecast`);

  // Wind and current around the run (`scene.json` flow, `sim/flow.ts`): measured,
  // never tagged SIM on a real run that has them, and only a few averaged arrows.
  assert.ok(run.flow, `${id}: no flow grid`);
  assert.ok(!isSimulated(run.flow.windSource) && !isSimulated(run.flow.currentSource),
    `${id}: a real run's wind or current reads as simulated (${run.flow.windSource} / ${run.flow.currentSource})`);
  assert.equal(run.trafficSource, 'marinecadastre AIS', `${id}: the Gulf runs' ships are real AIS`);
  // The streaks and the cards read the current around the spill: it must be there at the pass.
  assert.ok(flowMean(run.flow, 'current', ringsBbox(spillParts(run.detection), 1.5), 0) !== null, `${id}: no current around the spill at the pass`);

  // The refusal: no age (C1 keeps the triple), nobody ranked, and it says why.
  // With an age when the export converged (its own triple, C1), without one when it did not.
  const halt = run.drift.insufficientEvidence;
  const t = drift.age.age_hours;
  const aged = drift.age.status === 'converged' && !!t && t.low !== null && t.best !== null && t.high !== null;
  const currents = drift.forcing === 'era5+cmems';
  assert.ok(halt && halt.kind === (!aged ? 'no_age' : currents ? 'unscored' : 'wind_only'), `${id}: the refusal kind does not match the export's age and forcing`);
  assert.match(halt.reason, aged ? /tightest/ : /never converges/, `${id}: the refusal misstates convergence`);
  assert.match(halt.reason, currents ? /current-forced/ : /no current\s+field/, `${id}: the refusal does not name the forcing`);
  assert.equal(run.drift.ageMethod, aged ? 'drift_convergence' : 'no_convergence', `${id}: the age method is not the export's`);
  assert.equal(run.drift.ageHours.length, 3, `${id}: C1 -- the age is a triple`);
  if (aged) assert.deepEqual(run.drift.ageHours, [t!.low, t!.best, t!.high], `${id}: the age is not the export's triple`);
  assert.equal(run.suspects.length, 0, `${id}: a real run ranked a vessel`);
  assert.equal(run.gate.admitted, 0, `${id}: the gate admitted a candidate`);
  assert.equal(run.truth, null, `${id}: a real run has no authored truth`);

  // Traffic: real, all of it, and the provenance says how much of the window it covers.
  assert.ok(run.vessels.length > 0, `${id}: no traffic`);
  assert.ok(run.vessels.every((v) => v.source === 'real'), `${id}: a simulated vessel got in`);
  assert.match(run.meta.provenance, /^REAL · /, `${id}: provenance does not open with REAL`);
  assert.doesNotMatch(run.meta.provenance, /\bSIM\b/, `${id}: provenance claims simulation`);

  // Wind is the ERA5 series. Currents are CMEMS where the run was forced by them
  // (some hours may be NaN: the seed's surroundings on land), and absent, never
  // zero or simulated, on a wind-only run: these charts carry no SIM label.
  assert.equal(run.environment.windMs.length, drift.backwardHours + drift.forwardHours + 1, `${id}: wind series length`);
  assert.ok(run.environment.windMs.every(Number.isFinite), `${id}: wind has gaps`);
  if (drift.forcing === 'era5+cmems')
    assert.ok(run.environment.currentMs.some(Number.isFinite), `${id}: forced by CMEMS, yet no current at the seed`);
  else assert.ok(run.environment.currentMs.every(Number.isNaN), `${id}: a current was invented`);

  // The characterisation measured something, and a damping ratio only where one was measured.
  const c = run.characterisation;
  assert.ok(c.areaKm2 > 0 && c.lengthKm > 0 && c.widthMMean > 0, `${id}: characterisation measured nothing`);
  const measured = file.characterisation;
  if (measured) {
    // The backend's record, as exported (`backend/characterize`, PHASE-03).
    assert.equal(c.lengthKm, measured.lengthKm, `${id}: the view re-measured the backend's length`);
    assert.deepEqual(c.widthMProfile, measured.widthMProfile, `${id}: the width profile is not the backend's`);
    assert.equal(c.headTailResolvedBy, 'ambiguous', `${id}: geometry alone resolved the head`);
    if (measured.dampingRatioDb === null) assert.ok(Number.isNaN(c.dampingRatioDb), `${id}: a damping ratio nobody measured`);
    else {
      assert.equal(c.dampingRatioDb, measured.dampingRatioDb, `${id}: the damping is not the backend's`);
      assert.ok(measured.damping && /relative contrast only \(C2\)/.test(measured.damping.note), `${id}: the damping does not say it is relative`);
    }
    assert.equal(c.dampingConfidence, 'low', `${id}: C2 -- damping confidence must be low`);
    // One gate: the backend's is the console's `windGate` (pinned by tests/test_windgate.py).
    // The export rounds speed to 0.01 m/s, and the steepest ramp moves 1/1.6 per m/s.
    assert.ok(Math.abs(c.windGateMultiplier - windGate(c.windSpeedMs)) <= 0.005 / 1.6 + 1e-4, `${id}: the backend gate is not the console's`);
    // The same ERA5 cell and hour as the wind series the drift ran on.
    const atPass = file.wind.ms[file.wind.hours.indexOf(0)];
    assert.ok(Math.abs(c.windSpeedMs - atPass) < 0.01, `${id}: wind at the pass ${c.windSpeedMs} is not the series' ${atPass}`);
    const prior = measured.agePrior;
    assert.ok(prior.method === 'morphology_prior' && prior.lowHours <= prior.bestHours && prior.bestHours <= prior.highHours,
      `${id}: C1 -- the morphology prior is not an ordered triple with its method`);
    assert.match(prior.explanation, /not an age/, `${id}: the prior does not say it is not an age`);
    assert.match(run.meta.provenance, /Characterisation: backend\/characterize \(PHASE-03\)/, `${id}: the provenance does not name the characterisation`);
  } else {
    assert.ok(Number.isNaN(c.dampingRatioDb), `${id}: a damping ratio nobody measured`);
  }

  // No release is claimed before the pass.
  assert.equal(momentAt(run, -10).phase, 'reconstruction', `${id}: a release phase was claimed`);
  assert.equal(run.release.length, 0, `${id}: a release was simulated`);

  rows.push({
    id,
    detections: new Set(file.detections.map((d) => d.feature)).size,
    polygons: run.detection.parts.length,
    radar: `${run.cfarTargets.length} (${run.cfarTargets.filter((t) => t.matched).length} AIS)`,
    'seed conf': +run.detection.confidence.toFixed(2),
    'area km2': +c.areaKm2.toFixed(2),
    'length km': +c.lengthKm.toFixed(1),
    'wind at pass': +c.windSpeedMs.toFixed(1),
    'wind gate': +c.windGateMultiplier.toFixed(2),
    'damping dB': Number.isFinite(c.dampingRatioDb) ? +c.dampingRatioDb.toFixed(1) : '—',
    vessels: run.vessels.length,
    frames: run.drift.frames.length,
    'rings90 smoothed': rings90,
    'T0 in slick': `${((100 * inSlick) / n0).toFixed(0)}%`,
    'T0 spans slick': `${(covered * 100).toFixed(0)}%`,
    'parcels in 90%': `${(in90Min * 100).toFixed(0)}-${(in90Max * 100).toFixed(0)}%`,
    'parcels in 50%': `${(in50Min * 100).toFixed(0)}-${(in50Max * 100).toFixed(0)}%`,
    'frames < 50 afloat': sparse,
    'export max lobes': maxLobes,
    'area90 horizon': +run.drift.frames[0].area90Km2.toFixed(0),
  });
}
console.table(rows);
console.log(`PASS: ${rows.length} real runs are built from their files, rank nobody, and say why.`);
