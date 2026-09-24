/**
 * The live pipeline's runs (FUTURE_WORK §3), read by the console the way it reads the exports.
 *
 * Two things are held here. First, the stage list the console draws from the
 * event stream (`applyEvent`, `lib/api.ts`) is the stage list the API itself
 * reports -- the same events folded two ways must agree, or the pane would show
 * a run the pipeline did not have. Second, every complete run the API has made
 * on this machine (`data/runs/<id>/`, not in git) builds with the real-run view
 * exactly as an exported run does: every detection it wrote, the seed flagged,
 * OpenDrift's frames untouched, its AIS or an honest "none", the provenance
 * naming the run and how it detected -- and nobody ranked.
 *
 * Run: npm run check:apiruns   (the stage fold always; the runs only where data/runs holds some)
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyEvent, type ApiRunEvent, type ApiRunStage } from '../src/lib/api';
import { setTrafficLoader, type RealTrafficFile } from '../src/sim/realAis';
import { ensureRealRun, registerApiRun, setRealRunLoader, type RealSceneFile } from '../src/sim/realRun';
import type { RealDriftRun } from '../src/sim/realDrift';
import { buildRun } from '../src/sim/scenarios';
import { useDiskLandmask } from './landmaskDisk';

// ---- the fold ----------------------------------------------------------------
const pending = (keys: string[]): ApiRunStage[] => keys.map((key) => ({ key, label: key, state: 'pending' }));
const events: ApiRunEvent[] = [
  { seq: 1, stage: 'run', state: 'running' },
  { seq: 2, stage: 'input', state: 'running', at: '2026-09-24T00:00:00Z' },
  { seq: 3, stage: 'input', state: 'done', ms: 40, detail: 'read' },
  { seq: 4, stage: 'detect', state: 'running', at: '2026-09-24T00:00:01Z' },
  { seq: 5, stage: 'detect', state: 'progress', done: 2, total: 4 },
  { seq: 6, stage: 'detect', state: 'progress', done: 4, total: 4 },
  { seq: 7, stage: 'detect', state: 'refused', ms: 900, detail: 'no precomputed result' },
  { seq: 8, stage: 'seed', state: 'skipped', detail: 'not run: no precomputed result' },
];
const folded = events.reduce(applyEvent, pending(['input', 'detect', 'seed', 'write']));
assert.deepEqual(folded.map((s) => s.state), ['done', 'refused', 'skipped', 'pending']);
assert.equal(folded[0].ms, 40);
assert.equal(folded[1].detail, 'no precomputed result');
assert.deepEqual(folded[1].progress, { done: 4, total: 4 });
// A running stage carries the start the pipeline stamped, and loses it when it ends.
assert.equal(events.slice(0, 4).reduce(applyEvent, pending(['input', 'detect']))[1].startedAt, Date.parse('2026-09-24T00:00:01Z'));
assert.equal(folded[1].startedAt, null);
console.log('api stage fold: events fold to the states the API reports');

// ---- the runs on this machine ------------------------------------------------------
const repo = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const runsDir = repo('data/runs');
const complete = existsSync(runsDir)
  ? readdirSync(runsDir).filter((id) => {
    const summary = `${runsDir}/${id}/run.json`;
    return existsSync(summary) && JSON.parse(readFileSync(summary, 'utf8')).outcome === 'complete';
  })
  : [];
if (!complete.length) {
  console.log('No complete API runs in data/runs on this machine; the run checks are skipped.');
  process.exit(0);
}

useDiskLandmask();
const fromApi = (path: string) => {
  const match = /^api\/v1\/runs\/([^/]+)\/files\/(.+)$/.exec(path);
  assert.ok(match, `the view asked for ${path}, which is not an API run file`);
  return JSON.parse(readFileSync(`${runsDir}/${match[1]}/${match[2]}`, 'utf8'));
};
setRealRunLoader(async (path) => fromApi(path));
setTrafficLoader(async (_scene, url) => fromApi(url!) as RealTrafficFile);

for (const runId of complete) {
  const dir = `${runsDir}/${runId}`;
  const summary = JSON.parse(readFileSync(`${dir}/run.json`, 'utf8'));
  const hasAis = existsSync(`${dir}/ais.json`);
  const id = registerApiRun({ id: runId, source: summary.source, hasAis });
  await ensureRealRun(id);
  const run = buildRun(id);
  const drift = JSON.parse(readFileSync(`${dir}/drift.json`, 'utf8')) as RealDriftRun;
  const scene = JSON.parse(readFileSync(`${dir}/scene.json`, 'utf8')) as RealSceneFile & { verdict?: { verdict: string } };
  const detections = JSON.parse(readFileSync(`${dir}/detections.geojson`, 'utf8')) as { features: unknown[] };

  assert.equal(run.meta.id, id);
  assert.ok(run.meta.provenance.includes(`Live pipeline run ${runId}`), `${runId}: the provenance does not name the run`);
  assert.ok(run.meta.provenance.includes(scene.detectionSource), `${runId}: the provenance does not say how it detected`);
  assert.ok(run.meta.provenance.includes(`${detections.features.length} detection`), `${runId}: detections miscounted`);
  assert.equal(run.detection.parts.length, scene.detections.length, `${runId}: polygons dropped or invented`);
  assert.equal(run.detection.partKinds?.filter((k) => k === 'seed').length, 1, `${runId}: not exactly one seed`);
  assert.deepEqual(run.drift.frames.map((f) => f.hour), drift.frames.map((f) => f.hour), `${runId}: drift frames changed`);
  drift.frames.forEach((f, i) => assert.deepEqual(Array.from(run.drift.frames[i].particles), f.particles, `${runId}: particles changed at ${f.hour} h`));
  const traffic = hasAis ? (JSON.parse(readFileSync(`${dir}/ais.json`, 'utf8')) as RealTrafficFile) : null;
  assert.equal(run.vessels.length, traffic?.vessels.length ?? 0, `${runId}: vessels dropped or invented`);
  if (!traffic) assert.match(run.meta.provenance, /AIS: none on this machine/, `${runId}: missing AIS not said`);
  assert.ok(run.vessels.every((v) => v.source === 'real'), `${runId}: a vessel is not real AIS`);
  // Nobody is ranked, and the refusal is carried, not an empty list.
  assert.equal(run.suspects.length, 0, `${runId}: somebody was ranked`);
  assert.equal(run.gate.admitted, 0, `${runId}: the gate admitted a candidate`);
  assert.ok(run.drift.insufficientEvidence?.reason, `${runId}: the refusal has no reason`);
  console.log(`${runId}: ${summary.source} -- ${detections.features.length} detections, ${run.drift.frames.length} frames, ` +
    `${run.vessels.length} vessels, verdict ${scene.verdict?.verdict ?? 'n/a'}, nobody ranked`);
}
console.log(`api runs: ${complete.length} complete run(s) build with the real-run view`);
