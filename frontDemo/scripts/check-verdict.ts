/**
 * The oos / slick_unknown verdict, decided after detection (FUTURE_WORK §2.4).
 *
 * The model has one class, `slick`. Whether a slick is an operational discharge
 * is decided downstream from evidence the model cannot see, and shown with its
 * terms (`src/sim/verdict.ts`). This holds the rules to the rubric on cases
 * where the answer is set by construction, then prints what the rules say about
 * every scenario next to what its author wrote -- printed, not asserted: the
 * rules come from the literature, and bending them until the fixtures agree is
 * the tuning this project forbids.
 *
 * It also holds the backend twin (`backend/characterize/verdict.py`) to this
 * file: `tests/fixtures/characterise/verdict_cases.json` records inputs and the
 * outputs this module gave, pytest asserts the Python gives the same, and this
 * asserts the TypeScript still does. Regenerate with
 * `npm run export:characterise-fixtures` after changing a rule on purpose.
 *
 * Run: npm run check:verdict
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verdictFrom, verdictFor, type VerdictInputs } from '../src/sim/verdict';
import { buildRun, SCENARIOS } from '../src/sim/scenarios';
import { setTrafficLoader, type RealTrafficFile } from '../src/sim/realAis';
import { ensureRealRun, REAL_RUN_LISTINGS, setRealRunLoader } from '../src/sim/realRun';
import { useDiskTraffic } from './realAisDisk';
import { useDiskLandmask } from './landmaskDisk';
import { CONSTRUCTED_VERDICT_CASES } from './verdictCases';

// A trail: long, even width, a vessel 100 m off its tail, moderate wind, good contrast.
const trail: VerdictInputs = CONSTRUCTED_VERDICT_CASES.trail;
const oos = verdictFrom(trail);
assert.equal(oos.verdict, 'oos', 'a long even trail with a vessel at its end is the textbook discharge');
assert.ok(oos.support >= 0.5 && oos.caution === null);
assert.equal(oos.terms.length, 6, 'every term is shown, even when it could not be measured');

// The same line widening in a V from the vessel: a wake, and never oos.
const wake = verdictFrom({ ...trail, widthProfileM: Array.from({ length: 12 }, (_, i) => 760 - i * 60) });
assert.equal(wake.verdict, 'slick_unknown', 'a V from the vessel is a wake, not a discharge');
assert.match(wake.caution ?? '', /wake/);

// Compact, no vessel: unknown origin.
const patch = verdictFrom({ ...trail, elongation: 2, endTarget: { end: 'head', distanceKm: 20, matched: true, installation: false } });
assert.equal(patch.verdict, 'slick_unknown');

// No bright target anywhere: the vessel term is zero and says why.
const alone = verdictFrom({ ...trail, endTarget: null });
assert.equal(alone.verdict, 'slick_unknown');
assert.match(alone.terms.find((t) => t.key === 'vessel')!.detail, /no bright target/i);

// CFAR cannot tell a ship from a platform: a listed installation at the end is
// not a vessel, and an unmatched target is said to be unidentified.
const platform = verdictFrom({ ...trail, endTarget: { ...trail.endTarget!, installation: true } });
assert.equal(platform.verdict, 'slick_unknown', 'a slick off a listed installation is not a vessel discharge');
const dark = verdictFrom({ ...trail, endTarget: { ...trail.endTarget!, matched: false } });
assert.equal(dark.verdict, 'oos');
assert.match(dark.summary, /not an AIS vessel/);

// C9: the wind gate is a multiplier, so support moves continuously with it, never a cut.
const supports = [0, 0.25, 0.5, 0.75, 1].map((g) => verdictFrom({ ...trail, windGate: g }).support);
for (let i = 1; i < supports.length; i++) assert.ok(supports[i] > supports[i - 1], 'support must rise with the wind gate');
assert.ok(supports[0] === 0 && supports[4] === oos.support);

// Unmeasured terms carry no weight rather than a guessed one.
const unmeasured = verdictFrom({ ...trail, dampingRatioDb: null, bestVesselDrift: null });
assert.ok(unmeasured.terms.filter((t) => t.value === null).length === 2);
assert.ok(unmeasured.support >= oos.support);

// The backend twin is pinned to the outputs recorded here; they must still be this module's.
const fixture = fileURLToPath(new URL('../../tests/fixtures/characterise/verdict_cases.json', import.meta.url));
assert.ok(existsSync(fixture), 'tests/fixtures/characterise/verdict_cases.json is missing: npm run export:characterise-fixtures');
const recorded = JSON.parse(readFileSync(fixture, 'utf8')) as {
  cases: { name: string; inputs: VerdictInputs; expected: { verdict: string; support: number; caution: string | null; terms: Record<string, number | null> } }[];
};
for (const { name, inputs, expected } of recorded.cases) {
  const v = verdictFrom(inputs);
  assert.equal(v.verdict, expected.verdict, `${name}: the verdict moved from the recorded fixture; regenerate it and update the backend twin`);
  assert.ok(Math.abs(v.support - expected.support) < 1e-12, `${name}: support ${v.support} is not the recorded ${expected.support}`);
  assert.equal(v.caution, expected.caution, `${name}: the caution moved from the recorded fixture`);
  for (const t of v.terms) assert.equal(t.value, expected.terms[t.key], `${name}: term ${t.key} moved from the recorded fixture`);
}

// What the rules say about every run the console has.
await useDiskTraffic();
useDiskLandmask();
const rows = [];
for (const { id } of SCENARIOS) {
  const run = buildRun(id);
  const v = verdictFor(run);
  rows.push({ run: id, authored: run.detection.className, verdict: v.verdict, support: +v.support.toFixed(2),
    ...Object.fromEntries(v.terms.map((t) => [t.key, t.value === null ? '—' : +t.value.toFixed(2)])), caution: v.caution ? 'wake?' : '' });
}
const pub = (p: string) => fileURLToPath(new URL(`../public/${p}`, import.meta.url));
if (REAL_RUN_LISTINGS.every(({ id, scene }) => existsSync(pub(`runs/${scene}/drift.json`)) && existsSync(pub(`ais/${id}.json`)))) {
  setRealRunLoader(async (p) => JSON.parse(readFileSync(pub(p), 'utf8')));
  setTrafficLoader(async (s) => JSON.parse(readFileSync(pub(`ais/${s}.json`), 'utf8')) as RealTrafficFile);
  for (const { id } of REAL_RUN_LISTINGS) {
    await ensureRealRun(id);
    const run = buildRun(id);
    const v = verdictFor(run);
    rows.push({ run: id, authored: '(model: slick)', verdict: v.verdict, support: +v.support.toFixed(2),
      ...Object.fromEntries(v.terms.map((t) => [t.key, t.value === null ? '—' : +t.value.toFixed(2)])), caution: v.caution ? 'wake?' : '' });
  }
}
console.table(rows);
console.log(`PASS: the verdict follows the rubric on constructed cases, matches the ${recorded.cases.length} recorded cases the backend twin is held to, and the table is what it says about every run.`);
