/**
 * PHASE-08's drift and attribution lines, measured on the five authored
 * scenarios, written to `eval/evaluation/authored.json` for `eval/RESULTS.md`.
 *
 * Per scenario, under the chosen S_drift variant (`integral`):
 *   - the truth's rank, total and margin, and its rank with S_drift removed;
 *   - the hindcast hours whose 90% origin contour holds the true source, and
 *     whether any of them falls inside the release window (a continuous release
 *     is at its source from the first hour of the window through the last), with
 *     the distance from the source to the contour at the window's start;
 *   - the reported age triple, and whether the true release age falls inside it.
 *
 * These are authored cases (C10): the slicks are P004's as published, the
 * Gulf traffic is real AIS, the forcing is the console's analytic field. They
 * test the logic, not real-world accuracy, and RESULTS.md says so.
 *
 * Run: npm run export:evaluation
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distanceKm, pointInPolygon, polygonsOf } from '../src/sim/geo';
import { buildRun, SCENARIOS } from '../src/sim/scenarios';
import { useDiskTraffic } from './realAisDisk';

await useDiskTraffic();

const HOUR = 3_600_000;
const rows = [];
for (const { id } of SCENARIOS) {
  const run = buildRun(id, 'integral');
  const truth = run.suspects.find((s) => s.isTruth) ?? null;
  const second = run.suspects.find((s) => s.rank === 2) ?? null;
  const row: Record<string, unknown> = {
    id,
    candidates: run.suspects.length,
    refused: run.drift.insufficientEvidence !== null,
    ageHours: run.drift.ageHours.map((v) => +v.toFixed(2)),
    ageMethod: run.drift.ageMethod,
  };
  if (run.truth && truth) {
    const releaseHour = (run.truth.releasedAt - run.meta.acquiredAt) / HOUR;
    const holds = (f: (typeof run.drift.frames)[number]) =>
      polygonsOf(f.contour90).some((poly) => pointInPolygon(run.truth!.position, poly));
    const hindcast = run.drift.frames.filter((f) => f.hour <= 0);
    const hoursInside = hindcast.filter(holds).map((f) => f.hour);
    const windowEnd = Math.min(0, run.releaseEndHour);
    const insideDuringRelease = hoursInside.some((h) => h >= run.releaseStartHour - 0.5 && h <= windowEnd + 0.5);
    const start = hindcast.reduce((best, f) => (Math.abs(f.hour - releaseHour) < Math.abs(best.hour - releaseHour) ? f : best));
    let kmFromContourAtStart = 0;
    if (!holds(start)) {
      kmFromContourAtStart = Infinity;
      for (const ring of start.contour90) for (const v of ring) kmFromContourAtStart = Math.min(kmFromContourAtStart, distanceKm(v, run.truth.position));
    }
    const age = -releaseHour;
    Object.assign(row, {
      truth: run.truth.label,
      rank: truth.rank,
      total: +truth.total.toFixed(4),
      margin: second ? +(truth.total - second.total).toFixed(4) : null,
      rankWithoutDrift: truth.rankWithoutDrift,
      releaseAgeHours: +age.toFixed(2),
      hoursSourceInside90: hoursInside,
      sourceInside90DuringRelease: insideDuringRelease,
      kmOutsideContourAtReleaseStart: +kmFromContourAtStart.toFixed(2),
      releaseInsideAge: age >= run.drift.ageHours[0] && age <= run.drift.ageHours[2],
      releaseWindowHours: [+(-run.releaseStartHour).toFixed(2), +(-run.releaseEndHour).toFixed(2)],
    });
  }
  rows.push(row);
}

console.table(rows.map((r) => ({
  id: r.id, rank: r.rank ?? '-', margin: r.margin ?? '-', noDrift: r.rankWithoutDrift ?? '-',
  inRelease: r.sourceInside90DuringRelease ?? '-', kmOutAtStart: r.kmOutsideContourAtReleaseStart ?? '-', ageTriple: (r.ageHours as number[]).join('/'), releaseAge: r.releaseAgeHours ?? '-',
  inAge: r.releaseInsideAge ?? '-', refused: r.refused,
})));
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../eval/evaluation/authored.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ variant: 'integral', note: 'authored scenarios (C10); see eval/RESULTS.md', scenarios: rows }, null, 1) + '\n');
console.log(`wrote ${out}`);
