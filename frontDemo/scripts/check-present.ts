/**
 * The console presentation overlay (T, X, Q, Z on `#/console`).
 *
 * What a presenter relies on and cannot check mid-demo: the keys do nothing
 * while an input has focus, Q never skips a beat however fast it is pressed,
 * the reveal ends the sequence exactly once, the stage fits any window, the
 * copy obeys the house rules, and every file the scenes draw exists.
 *
 * Run: npm run check:present
 */
import assert from 'node:assert/strict';
import { presentKeyOf } from '../src/present/keys';
import { BeatRunner, type Playable } from '../src/present/engine';
import { stageFit } from '../src/present/stage';
import { copyViolations } from '../src/present/copyGuard';
import {
  OBJECTIVES, SOLUTIONS, STATEMENT, STATEMENT_ASSETS, STATEMENT_BEATS, allStatementCopy, tickPlan,
} from '../src/present/statement/copy';
import { COLUMN_RECTS, PILLS, RIGHT, SOLUTION_SLOTS, rowRects } from '../src/present/statement/layout';
import { existsSync, readFileSync } from 'node:fs';
import { tileStarts } from '../src/sim/segmenter';
import { projector, tileCount } from '../src/present/technical/geo';
import { RAIL, TEAM, TECH_ASSETS, TECH_BEATS, THANKS, TIMING, allTechnicalCopy } from '../src/present/technical/copy';
import { DRIFT_CARDS, DRIFT_MAP, measureRows } from '../src/present/technical/panels';
import { meanField, streamline } from '../src/present/technical/streams';
import { LAYERS, STACK } from '../src/present/technical/stack';
import { driftBounds, positionAt, publishedVessel } from '../src/present/technical/data';
import { IMAGE_LOGOS, LOGOS } from '../src/present/technical/logos';
import { fileURLToPath } from 'node:url';

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
}

/* --- keys ----------------------------------------------------------- */

const key = (k: string, extra: Partial<Parameters<typeof presentKeyOf>[0]> = {}) =>
  presentKeyOf({ key: k, ctrlKey: false, altKey: false, metaKey: false, ...extra });

check('T, X, Q and Z map either case; anything else is not a present key', () => {
  assert.equal(key('t'), 'T');
  assert.equal(key('X'), 'X');
  assert.equal(key('Q'), 'Q');
  assert.equal(key('z'), 'Z');
  assert.equal(key('k'), 'K');
  assert.equal(key('a'), null);
  assert.equal(key(' '), null);
});

check('a modifier chord or a focused form field is never a present key', () => {
  assert.equal(key('q', { ctrlKey: true }), null);
  assert.equal(key('t', { altKey: true }), null);
  assert.equal(key('x', { metaKey: true }), null);
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(key('x', { targetTag: tag }), null);
  assert.equal(key('x', { targetTag: 'DIV' }), 'X');
});

/* --- engine --------------------------------------------------------- */

class Fake implements Playable {
  duration = 1000;
  completed = false;
  paused = false;
  seeks: number[] = [];
  private done: (() => void)[] = [];
  seek(ms: number) { this.seeks.push(ms); return this; }
  pause() { this.paused = true; return this; }
  then(fn: () => void) { this.done.push(fn); return this; }
  finish() { this.completed = true; for (const fn of this.done) fn(); }
}

function rig(n: number) {
  const made: Fake[] = [];
  let ends = 0;
  const beats = Array.from({ length: n }, () => () => { const f = new Fake(); made.push(f); return f; });
  const runner = new BeatRunner(beats, () => { ends++; });
  return { runner, made, ends: () => ends };
}

check('Q while a beat runs snaps it to its end instead of skipping ahead', () => {
  const { runner, made } = rig(3);
  assert.equal(runner.index, -1);
  runner.start();
  assert.equal(runner.index, 0);
  assert.equal(runner.next(), 'snapped');
  assert.equal(runner.index, 0);
  assert.deepEqual(made[0].seeks, [1000]);
  assert.equal(runner.next(), 'played');
  assert.equal(runner.index, 1);
});

check('a beat that finished on its own is followed, not snapped', () => {
  const { runner, made } = rig(3);
  runner.start();
  made[0].finish();
  assert.equal(runner.next(), 'played');
  assert.equal(made[0].seeks.length, 0);
});

check('an instant beat (null) never needs a snap', () => {
  const beats = [() => null, () => null];
  const runner = new BeatRunner(beats, () => {});
  runner.start();
  assert.equal(runner.next(), 'played');
  assert.equal(runner.index, 1);
});

check('the last beat finishing ends the sequence exactly once', () => {
  const { runner, made, ends } = rig(2);
  runner.start();
  made[0].finish();
  runner.next();
  made[1].finish();
  assert.equal(ends(), 1);
  assert.equal(runner.next(), 'ended');
  assert.equal(ends(), 1);
});

check('snapping the last beat ends the sequence once, even if it then completes', () => {
  const { runner, made, ends } = rig(2);
  runner.start();
  runner.next(); // snap 0
  runner.next(); // play 1
  assert.equal(runner.next(), 'snapped');
  assert.equal(ends(), 1);
  made[1].finish();
  assert.equal(ends(), 1);
  assert.equal(runner.next(), 'ended');
});

check('dispose pauses the running beat and never ends the sequence', () => {
  const { runner, made, ends } = rig(2);
  runner.start();
  runner.next();
  runner.next();
  runner.dispose();
  assert.equal(made[1].paused, true);
  made[1].finish();
  assert.equal(ends(), 0);
});

/* --- stage ---------------------------------------------------------- */

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

check('the 1920 x 1080 stage fits any window, uniformly scaled and centred', () => {
  assert.deepEqual(stageFit(1920, 1080), { scale: 1, x: 0, y: 0 });
  const laptop = stageFit(1366, 768);
  near(laptop.scale, 768 / 1080, 1e-4);
  near(laptop.x, (1366 - 1920 * (768 / 1080)) / 2, 0.5);
  near(laptop.y, 0, 1e-9);
  assert.deepEqual(stageFit(2560, 1080), { scale: 1, x: 320, y: 0 });
  const tall = stageFit(1080, 1920);
  near(tall.scale, 0.5625, 1e-9);
  near(tall.y, (1920 - 1080 * 0.5625) / 2, 1e-6);
});

/* --- copy ----------------------------------------------------------- */

check('the copy guard catches dashes, semicolons and verdict words, and allows hyphenated names', () => {
  for (const bad of ['a — b', 'a – b', 'a - b', 'a; b', 'the responsible ship', 'Guilty', 'confirmed polluter']) {
    assert.equal(copyViolations(bad).length, 1, bad);
  }
  assert.deepEqual(copyViolations('Sentinel-1 and User-GPU'), []);
  assert.deepEqual(copyViolations('the vessel responsible for the spill', { officialTitle: true }), []);
});

check('every statement string on screen obeys the copy rules', () => {
  for (const s of allStatementCopy()) assert.deepEqual(copyViolations(s), [], s);
  const title = STATEMENT.title.map((p) => p.text).join('');
  assert.deepEqual(copyViolations(title, { officialTitle: true }), [], title);
  assert.equal(
    title,
    'Leveraging satellite imagery to determine Oil spills at sea along with AIS data correlations to identify vessel responsible for the spill.',
  );
});

check('the statement sequence is blackout plus 24 presses of Q', () => {
  assert.equal(STATEMENT_BEATS.length, 25);
  assert.equal(STATEMENT_BEATS[0], 'blackout');
  assert.equal(STATEMENT_BEATS.at(-1), 'reveal');
  assert.equal(new Set(STATEMENT_BEATS).size, 25);
  assert.equal(OBJECTIVES.length, 5);
});

check('each solution waits for its own Q before it shrinks into the stack', () => {
  SOLUTIONS.forEach((_, i) => {
    const land = STATEMENT_BEATS.indexOf(`sol${i + 1}`);
    assert.ok(land > 0, `sol${i + 1} is a beat`);
    assert.equal(STATEMENT_BEATS[land + 1], `sol${i + 1}-stack`, 'landing and stacking are separate presses (user, 2026-09-27)');
  });
});

/* --- statement layout ------------------------------------------------ */

check('the objective row stays centred as each card joins', () => {
  for (let k = 1; k <= 5; k++) {
    const r = rowRects(k);
    assert.equal(r.length, k);
    near((r[0].x + r[k - 1].x + r[k - 1].w) / 2, 960, 1e-9);
  }
});

check('the objective column fits the left 36% and the stage height', () => {
  assert.equal(COLUMN_RECTS.length, 5);
  for (const r of COLUMN_RECTS) assert.ok(r.x + r.w <= 0.36 * 1920, `column reaches x ${r.x + r.w}`);
  const last = COLUMN_RECTS[4];
  assert.ok(last.y + last.h <= 1080);
});

/* --- solutions ------------------------------------------------------- */

check('each solution flips the objectives it answers first and pulses the ones already ticked', () => {
  assert.deepEqual(tickPlan(SOLUTIONS), [
    { flip: ['detect'], pulse: [] },
    { flip: ['characterise'], pulse: ['detect'] },
    { flip: ['trace'], pulse: [] },
    { flip: ['predict'], pulse: ['trace'] },
    { flip: [], pulse: [] },
    { flip: [], pulse: [] },
    { flip: ['attribute'], pulse: [] },
  ]);
  assert.equal(SOLUTIONS[tickPlan(SOLUTIONS).findIndex((t) => t.flip.includes('predict'))].id, 'drift', 'Predict ticks with OpenDrift, Both Ways (user, 2026-09-28)');
  assert.equal(SOLUTIONS[tickPlan(SOLUTIONS).findIndex((t) => t.flip.includes('attribute'))].id, 'score', 'Attribute ticks only with the Six Factor Score (user, 2026-09-27)');
  const flipped = new Set(tickPlan(SOLUTIONS).flatMap((t) => t.flip));
  assert.deepEqual([...flipped].sort(), OBJECTIVES.map((o) => o.id).sort(), 'every objective ends ticked');
});

check('solutions are the seven the user chose, image cards first and icon cards last', () => {
  assert.deepEqual(
    SOLUTIONS.map((s) => s.title),
    [
      'Model Trained on Real SAR',
      'Sliced, then Segmented',
      'Wind and Currents on Demand',
      'OpenDrift, Both Ways',
      'Runs Locally on User-GPU',
      'AIS in the Origin Window',
      'Six Factor Score',
    ],
  );
  assert.deepEqual(SOLUTIONS.map((s) => s.kind), ['image', 'image', 'image', 'image', 'icon', 'icon', 'icon']);
  for (const s of allStatementCopy()) assert.deepEqual(copyViolations(s), [], s);
});

check('solution slots fill the right side without overlapping', () => {
  assert.equal(SOLUTION_SLOTS.length, 7);
  for (const r of SOLUTION_SLOTS) {
    assert.ok(r.x >= RIGHT.x && r.x + r.w <= RIGHT.x + RIGHT.w, `x ${r.x}..${r.x + r.w}`);
    assert.ok(r.y >= 150 && r.y + r.h <= 1060, `y ${r.y}..${r.y + r.h}`);
  }
  for (let i = 0; i < 7; i++)
    for (let j = i + 1; j < 7; j++) {
      const a = SOLUTION_SLOTS[i];
      const b = SOLUTION_SLOTS[j];
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(apart, `slots ${i} and ${j} overlap`);
    }
});

check('the split screen has equal side margins and one top and one bottom edge', () => {
  const left = COLUMN_RECTS[0].x;
  const right = Math.max(...SOLUTION_SLOTS.map((r) => r.x + r.w));
  assert.equal(left, 1920 - right, 'side margins');
  assert.equal(COLUMN_RECTS[0].y, Math.min(...SOLUTION_SLOTS.map((r) => r.y)), 'top edge');
  const last = COLUMN_RECTS[4];
  assert.equal(last.y + last.h, Math.max(...SOLUTION_SLOTS.map((r) => r.y + r.h)), 'bottom edge');
  assert.equal(PILLS.left.w, COLUMN_RECTS[0].w, 'the objectives pill spans its column');
  assert.deepEqual([PILLS.right.x, PILLS.right.w], [RIGHT.x, RIGHT.w], 'the solution pill spans the right side');
});

check('the statement pill and the objective row sit about the middle of the screen', () => {
  const row = rowRects(5)[0];
  near((PILLS.top.y + row.y + row.h) / 2, 540, 30);
  assert.ok(row.y - PILLS.top.y <= 110, 'the row sits close under its pill');
});

check('every file the statement sequence draws exists', () => {
  const pub = fileURLToPath(new URL('../public/', import.meta.url));
  for (const path of STATEMENT_ASSETS) assert.ok(existsSync(pub + path), `missing public/${path}`);
});

/* --- technical journey ------------------------------------------------ */

const readPublic = (path: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../public/${path}`, import.meta.url)), 'utf8'));

check('the slice beat counts tiles exactly as the browser segmenter cuts them', () => {
  assert.equal(tileCount(2048, 1024), tileStarts(1024, 1024, 922).length * tileStarts(2048, 1024, 922).length);
  assert.equal(tileCount(2048, 2048), 9);
  const journey = readPublic('present/journey.json');
  assert.ok(tileCount(journey.scene.widthPx, journey.scene.heightPx) > 100);
});

check('the projector keeps ground aspect and fits the target box', () => {
  const box = { x: 0, y: 0, w: 1000, h: 1000 };
  const p = projector({ west: -89, south: 28, east: -88, north: 29 }, box);
  const corners = [p(-89, 28), p(-88, 28), p(-89, 29), p(-88, 29)];
  for (const [x, y] of corners) assert.ok(x >= -1e-9 && x <= 1000 + 1e-9 && y >= -1e-9 && y <= 1000 + 1e-9);
  const w = corners[1][0] - corners[0][0];
  const h = corners[0][1] - corners[2][1];
  near(w / h, Math.cos((28.5 * Math.PI) / 180), 0.01);
});

check('the technical sequence is blackout plus 19 presses of Q and ends on the thank you, rail in order', () => {
  assert.equal(TECH_BEATS.length, 20);
  assert.equal(TECH_BEATS[0], 'blackout');
  assert.equal(TECH_BEATS.at(-1), 'thanks');
  assert.ok(!TECH_BEATS.includes('reveal'), 'X ends on the thank you, not the console (user, 2026-09-27)');
  assert.equal(new Set(TECH_BEATS).size, 20);
  assert.equal(TECH_BEATS[TECH_BEATS.indexOf('score') + 1], 'timing', 'processing time follows the score (user, 2026-09-27)');
  assert.deepEqual(RAIL, ['Acquire', 'Clean', 'Slice', 'Segment', 'Measure', 'Weather Data', 'Hindcast', 'Forecast', 'Gate', 'Score', 'Timing']);
  for (const s of allTechnicalCopy()) assert.deepEqual(copyViolations(s), [], s);
  assert.ok(!allTechnicalCopy().some((s) => /BOCHEM/i.test(s)), 'the suspect reads as an MMSI (user, 2026-09-27)');
});

check('the suspect is shown by its masked MMSI, first in the ranking', () => {
  const journey = readPublic('present/journey.json');
  assert.match(journey.score.label, /^MMSI \d{3}•+\d$/);
  assert.equal(journey.ranking[0].label, journey.score.label);
  assert.equal(journey.ranking[0].isTruth, true);
});

check("the timing beat is the deck's measured 00016 run, its stages summing to the stated total", () => {
  assert.deepEqual(TIMING.stages.map((st) => st.name), [
    'Decode raster', 'Load segmenter', 'Segmenter inference', 'Trace outline', 'Despeckle (display only)',
    'Coastline tiles (GSHHG)', 'Wind and currents (ERA5, Copernicus)', 'AIS traffic (MarineCadastre)', 'Drift, traffic and scoring',
  ]);
  const sum = TIMING.stages.reduce((a, st) => a + st.ms, 0) / 1000;
  near(sum, TIMING.totalS, 0.15);
  assert.equal(TIMING.stages.find((st) => st.name === 'Segmenter inference')!.ms / 1000, TIMING.inferenceS);
  for (const st of TIMING.stages) for (const t of [st.name, st.detail]) assert.deepEqual(copyViolations(t), [], t);
});

check('the timing card quotes the model figures the md files hold', () => {
  assert.equal(TIMING.confidencePct, 91, 'scene 00016, the console run the deck shows');
  const { alarms, of } = TIMING.lookalikes;
  assert.deepEqual([alarms, of], [4, 87], 'eval/RESULTS.md: v12 alarms on 4 of 87 frozen holdout look-alikes');
  assert.equal(TIMING.rejectedPct, Math.round((100 * (of - alarms)) / of));
});

check('the measure callouts name what they measure, head and tail at the ends, and no wind', () => {
  const c = { areaKm2: 3.9975, lengthKm: 8.547, widthMMean: 462.1, dampingRatioDb: -3.21 };
  const rows = measureRows(c, { low: 4.75, best: 6.22, high: 9.87 }, true);
  assert.deepEqual(rows.map((r) => r.name), ['Tail', 'Area', 'Length', 'Width', 'Damping', 'Age', 'Head']);
  assert.deepEqual(rows.map((r) => r.value), ['', '4.0 km²', '8.55 km', '462 m', '3.21 dB', '4.8 to 9.9 h, best 6.2 h', '']);
  assert.deepEqual(measureRows(c, { low: 4.75, best: 6.22, high: 9.87 }, false).map((r) => r.name).at(0), 'Head');
  assert.ok(!rows.some((r) => /wind/i.test(r.name + r.value)), 'no wind in Measure (user, 2026-09-27)');
});

check('the weather card makes way for the hours card, and the gate card takes their place', () => {
  const { x, w, top, hourH, forcingH, gap, gateH } = DRIFT_CARDS;
  assert.equal(DRIFT_CARDS.forcingTop, top, 'the weather card starts where the hours card later pops');
  assert.equal(DRIFT_CARDS.forcingPushed, top + hourH + gap, 'then it is pushed down under the hours card');
  assert.ok(DRIFT_CARDS.forcingPushed + forcingH <= 1035 && top + gateH <= 1035, 'all inside the content box');
  assert.ok(x >= 100 && x + w <= 1820);
  assert.ok(x >= DRIFT_MAP.x + DRIFT_MAP.w + 20, 'the cards stand in their own column, clear of the map (user, 2026-09-27)');
});

check('the gate beat keeps only tracks the AIS file actually has', () => {
  const journey = readPublic('present/journey.json');
  const ais = readPublic('ais/real-20230515.json');
  const ids = new Set(ais.vessels.map((v: { id: string }) => v.id));
  assert.ok(journey.gate.admittedIds.length > 0);
  for (const id of journey.gate.admittedIds) assert.ok(ids.has(id), id);
  assert.equal(journey.gate.admitted, journey.gate.admittedIds.length);
});

check('every file the technical sequence draws exists', () => {
  const pub = fileURLToPath(new URL('../public/', import.meta.url));
  for (const path of TECH_ASSETS) assert.ok(existsSync(pub + path), `missing public/${path}`);
});

/* --- streamlines ------------------------------------------------------ */

const grid = (u: (i: number, j: number) => number, v: (i: number, j: number) => number) => {
  const nx = 5;
  const ny = 5;
  const row: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) row.push(u(i, j), v(i, j));
  return { minLon: 0, minLat: 0, dLon: 1, dLat: 1, nx, ny, hours: [0, 1], wind: [row, row.map((x) => x * 3)], current: null, windSource: '', currentSource: '' };
};

check('averaged flow is the time mean at each node', () => {
  const g = grid(() => 1, () => 0);
  const m = meanField(g, 'wind')!;
  near(m.u[0], 2, 1e-12);
  near(m.v[0], 0, 1e-12);
  assert.equal(meanField(g, 'current'), null);
});

check('a streamline runs straight through a uniform field, for the length asked', () => {
  const g = grid(() => 1, () => 0);
  const line = streamline(g, meanField(g, 'wind')!, [1, 2], 0.05, 20);
  assert.equal(line.length, 21);
  near(line.at(-1)![0] - 1, 20 * 0.05 / Math.cos((2 * Math.PI) / 180), 1e-6);
  near(line.at(-1)![1], 2, 1e-9);
});

check('a streamline bends where the field turns, and stops at the grid edge', () => {
  const g = grid((_i, j) => 1, (i) => (i - 2) * 0.5);
  const line = streamline(g, meanField(g, 'wind')!, [0.5, 2], 0.05, 200);
  const dy = line.at(-1)![1] - line[0][1];
  assert.ok(Math.abs(dy) > 0.1, `expected a curve, got dy ${dy}`);
  for (const [lon, lat] of line) assert.ok(lon >= 0 && lon <= 4 && lat >= 0 && lat <= 4);
});

/* --- the suspected vessel ---------------------------------------------- */

check('the suspected vessel is Case 2 published ship, and its recorded track crosses the drift area', () => {
  const gom = readPublic('ais/gom-moving.json');
  const drift = readPublic('runs/S1A_IW_GRDH_1SDV_20230515T000208_20230515T000233_048537_05D69B_35AF_s0db/drift.json');
  const suspect = publishedVessel(gom);
  assert.ok(suspect, 'no published vessel in gom-moving.json');
  assert.equal(gom.vessels.filter((v: { published: boolean }) => v.published).length, 1);
  const b = driftBounds(drift);
  const inside = suspect!.lon.filter((lon: number, i: number) => lon >= b.west && lon <= b.east && suspect!.lat[i] >= b.south && suspect!.lat[i] <= b.north);
  assert.ok(inside.length >= 5, `only ${inside.length} track points inside the drift view`);
  const [lon, lat] = positionAt(suspect!, 0);
  assert.ok(lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north, 'ship is off the drift view at the pass');
});

/* --- thank you ------------------------------------------------------- */

check('the thank you names the team, its ids and all six members', () => {
  assert.equal(TEAM.name, 'Dead Braincells');
  assert.equal(TEAM.teamId, '161987');
  assert.equal(TEAM.problemId, 'SIH26143');
  assert.deepEqual(TEAM.members, ['Haziq Landge', 'Aditya Madhavi', 'Jayraj Sanas', 'Smit Patil', 'Sayoni Patil', 'Harvinder Jadhav']);
  assert.equal(TEAM.repo, 'https://github.com/haziqlandge/satellite-oilSpill-detection');
  for (const s of [...TEAM.members, TEAM.name, ...Object.values(THANKS)]) assert.deepEqual(copyViolations(s), [], s);
  assert.ok(TECH_ASSETS.includes('present/repo-qr.svg'));
});

/* --- tech stack ------------------------------------------------------- */

check('the tech stack is the five layers the md files name, GFS under data and R2 under backend', () => {
  assert.deepEqual(LAYERS.map((l) => l.name), ['DATA', 'ML', 'PHYSICS', 'BACKEND', 'FRONTEND']);
  assert.deepEqual(LAYERS.map((l) => l.tools.length), [6, 5, 3, 5, 8]);
  assert.ok(LAYERS[0].tools.some((t) => t.name.startsWith('GFS')));
  assert.ok(LAYERS[3].tools.some((t) => t.name.startsWith('Cloudflare R2')));
  for (const l of LAYERS)
    for (const t of l.tools) {
      if (t.logo) assert.ok(t.logo in LOGOS, `no logo ${t.logo}`);
      assert.deepEqual(copyViolations(t.name), [], t.name);
      if (t.note) assert.deepEqual(copyViolations(t.note), [], t.note);
      assert.ok(!/planned/i.test(`${t.name} ${t.note ?? ''}`), 'no planned tag (user, 2026-09-27)');
    }
});

check('every layer column fits the stage', () => {
  for (const l of LAYERS) assert.ok(STACK.top + (l.tools.length - 1) * STACK.pitch + STACK.h <= 1060, l.name);
  const pub = fileURLToPath(new URL('../public/', import.meta.url));
  for (const src of Object.values(IMAGE_LOGOS)) assert.ok(existsSync(pub + src.slice(1)), src);
});

console.log(`check:present: ${checks} checks passed`);
