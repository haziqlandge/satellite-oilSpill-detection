/**
 * An upload's measured forcing reads its sources' conventions the right way round.
 *
 * Open-Meteo gives wind as the direction it blows FROM and currents as the
 * direction they flow TOWARD; mixing the two up drifts every upload the wrong
 * way while looking perfectly plausible. This answers `fetchMeasuredFlow` with
 * a canned response (no network) and asserts the vectors, the relative hours,
 * a missing current, and that `measuredForcing` holds edge values instead of
 * inventing flow.
 *
 * Run: npm run check:metocean
 */
import assert from 'node:assert/strict';
import { fetchMeasuredFlow, measuredForcing } from '../src/sim/metocean';
import type { Forcing } from '../src/sim/field';

const T0 = Date.parse('2023-12-05T00:00:00Z');
const stamps = ['2023-12-04T23:00', '2023-12-05T00:00', '2023-12-05T01:00'];
const series = (values: Record<string, (number | null)[]>) => ({ hourly: { time: stamps, ...values } });

function answer(marine: 'values' | 'none') {
  globalThis.fetch = (async (url: string) => {
    const n = new URL(url).searchParams.get('latitude')!.split(',').length;
    const body = url.includes('marine-api')
      ? Array.from({ length: n }, () => series({
          ocean_current_velocity: marine === 'values' ? [1, 1, 1] : [null, null, null],
          ocean_current_direction: marine === 'values' ? [90, 90, 90] : [null, null, null],
        }))
      : Array.from({ length: n }, () => series({ wind_speed_10m: [5, 5, null], wind_direction_10m: [0, 0, null] }));
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

answer('values');
const flow = await fetchMeasuredFlow([-89, 29], T0, -1, 1);
assert(flow, 'a grid comes back');
assert.deepEqual(flow.hours, [-1, 0], 'hours are relative to the pass, and an hour ERA5 has not published is dropped');
const [wu, wv] = [flow.wind[0][0], flow.wind[0][1]];
assert(Math.abs(wu) < 1e-9 && Math.abs(wv + 5) < 1e-9, `a north wind blows south: got ${wu}, ${wv}`);
const [cu, cv] = [flow.current![0][0]!, flow.current![0][1]!];
assert(Math.abs(cu - 1) < 1e-9 && Math.abs(cv) < 1e-9, `a current toward 90° flows east: got ${cu}, ${cv}`);
assert.equal(flow.windSource, 'ERA5 10 m (Open-Meteo)');

const analytic: Forcing = { wind: () => [9, 9], current: () => [7, 7], speedAt: () => 0 };
const forcing = measuredForcing(flow, analytic);
const far = forcing.wind([-60, 60], 40);
assert(Math.abs(far[1] + 5) < 1e-9, 'beyond the box and hours the edge value holds, nothing is invented');
assert.deepEqual(forcing.current([-89, 29], 0).map((v) => Math.round(v * 1e6) / 1e6), [1, 0]);

answer('none');
const windOnly = await fetchMeasuredFlow([-89, 29], T0, -1, 1);
assert(windOnly && windOnly.current === null && windOnly.currentSource === null, 'no currents before 2022: said, not faked');
assert.deepEqual(measuredForcing(windOnly, analytic).current([-89, 29], 0), [7, 7], 'the SIM current stands in, and the caller labels it');

console.log('PASS: measured forcing reads wind FROM and currents TOWARD, drops unpublished hours, holds edges, and admits a missing current.');
