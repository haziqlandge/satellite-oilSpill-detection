/**
 * Every shipping lane, tested against the land mask.
 *
 * `scenarios.ts` records how corridors used to be checked: fetch a basemap
 * tile, read the pixel, classify on blue-red, and calibrate by hand first. That
 * worked and it is where the mask's own threshold comes from, but it was done
 * per point, by a person, and one lane still ran half a per cent of its scatter
 * ashore once the full width was sampled. This does the same test over every
 * lane in every scenario, and prints only the ones that touch land.
 *
 * Run: npm run check:corridors
 */
import { SPEC_FOR_CHECK } from '../src/sim/scenarios';
import { landFraction, isLand } from '../src/sim/landmask';
for (const [id, spec] of Object.entries(SPEC_FOR_CHECK)) {
  const rows = spec.traffic.corridors.map((c, i) => ({
    lane: i,
    from: c.from.map(v => v.toFixed(3)).join(','),
    to: c.to.map(v => v.toFixed(3)).join(','),
    centrelineLandPct: +(100 * landFraction(c.from, c.to, 25)).toFixed(1),
    fromAshore: isLand(c.from[0], c.from[1]),
    toAshore: isLand(c.to[0], c.to[1]),
  }));
  const bad = rows.filter(r => r.centrelineLandPct > 0 || r.fromAshore || r.toAshore);
  if (bad.length) { console.log(`\n${id}:`); console.table(bad); }
}
console.log('\n(only lanes touching land are listed)');
