/**
 * Fixtures that hold the backend's attribution engine to the console's (PHASE-06).
 *
 * For each authored scenario, the exact input `score()` receives in `buildRun`
 * and what `score()` returns under both S_drift variants. `tests/test_attribution.py`
 * feeds the same input to `backend/attribute` and demands the same terms,
 * totals, ranks, gate, separability, refusal and evidence text.
 *
 * Kept small on purpose (a dense 128x128 float64 frame per hour came to 13.5 MB):
 *
 *  - only vessels whose field agreement ever reaches `NEAR` -- every one the
 *    gate admits, and the near misses. The rest are counted, and it is asserted
 *    here that dropping them changes nothing but that count;
 *  - per hour, the console's own mass table and only the grid cells the scorer
 *    samples (the four bilinear corners of every in-window report of a stored
 *    vessel, and of every installation and dark contact at every hour);
 *  - one whole frame, `frame.json.gz`, for the Python ports of `massTable` and
 *    `sampleDensity` on their own.
 *
 * Re-run after changing `sim/scoring.ts`, `sim/drift.ts`, `sim/ais.ts` or a
 * scenario:  npm run export:scoring-fixtures
 *
 * `-- --all-vessels <dir>` keeps every vessel and writes there instead (~2 MB a
 * scenario, not for the repository): the input `scripts/attribution_ablation.py`
 * needs to score the whole traffic with no field gate.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildRun, SCENARIOS } from '../src/sim/scenarios';
import { score, scoringTap, type DriftVariant, type ScoringInput } from '../src/sim/scoring';
import { fieldProbabilityAt, type FieldFrame } from '../src/sim/drift';
import type { LngLat, Vessel } from '../src/sim/types';
import { useDiskTraffic } from './realAisDisk';

const allAt = process.argv.indexOf('--all-vessels');
const ALL = allAt >= 0;
const out = ALL
  ? join(process.argv[allAt + 1], '/')
  : fileURLToPath(new URL('../../tests/fixtures/scoring/', import.meta.url));
mkdirSync(out, { recursive: true });

await useDiskTraffic();

const f64 = (values: ArrayLike<number>) => Buffer.from(Float64Array.from(values).buffer).toString('base64');
const i32 = (values: number[]) => Buffer.from(Int32Array.from(values).buffer).toString('base64');
const gz = (name: string, value: unknown) => {
  const bytes = gzipSync(JSON.stringify(value), { level: 9 });
  writeFileSync(`${out}${name}`, bytes);
  return Math.round(bytes.length / 1024);
};

/** A third of the gate's 0.06 (`GATE_THRESHOLD` in sim/scoring.ts): admitted, or a near miss. */
const NEAR = 0.02;

const inWindow = (t: number, input: ScoringInput) => {
  const hour = Math.round((t - input.acquiredAt) / 3600_000);
  return hour <= 0 && hour >= -input.drift.backwardHours ? hour : null;
};

function nearField(v: Vessel, input: ScoringInput): boolean {
  return v.points.some((p) => {
    const hour = inWindow(p.t, input);
    return hour !== null && fieldProbabilityAt(input.grids, hour, [p.lon, p.lat]) >= NEAR;
  });
}

/** The four cells `sampleDensity` reads for a position, where they exist. */
function corners(f: FieldFrame, p: LngLat): number[] {
  const g = f.grid;
  const x0 = Math.floor((p[0] - g.minLon) / g.dLon);
  const y0 = Math.floor((p[1] - g.minLat) / g.dLat);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= g.nx || y0 + 1 >= g.ny) return [];
  return [y0 * g.nx + x0, y0 * g.nx + x0 + 1, (y0 + 1) * g.nx + x0, (y0 + 1) * g.nx + x0 + 1];
}

function frameHeader(f: FieldFrame) {
  const g = f.grid;
  return {
    nx: g.nx, ny: g.ny, minLon: g.minLon, minLat: g.minLat, dLon: g.dLon, dLat: g.dLat,
    cellAreaKm2: g.cellAreaKm2, area90Km2: f.area90Km2,
    table: { levels: f64(f.table.levels), mass: f64(f.table.mass), peak: f.table.peak },
  };
}

const rows = [];
for (const { id } of SCENARIOS) {
  buildRun(id, 'integral');
  const input = scoringTap.last!;
  const back = input.drift.backwardHours;

  const kept = ALL ? input.vessels : input.vessels.filter((v) => nearField(v, input));
  const sampled = new Map<number, Set<number>>();
  const touch = (hour: number, p: LngLat) => {
    const f = input.grids.get(hour);
    if (!f) return;
    if (!sampled.has(hour)) sampled.set(hour, new Set());
    for (const c of corners(f, p)) sampled.get(hour)!.add(c);
  };
  for (const v of kept) {
    for (const p of v.points) {
      const h = inWindow(p.t, input);
      if (h !== null) touch(h, [p.lon, p.lat]);
    }
  }
  for (let h = -back; h <= 0; h++) {
    for (const x of [...input.infrastructure, ...input.darkTargets]) touch(h, x.position);
  }

  const frames: Record<string, unknown> = {};
  for (let h = -back; h <= 0; h++) {
    const f = input.grids.get(h);
    if (!f) continue;
    const cells = [...(sampled.get(h) ?? [])].sort((a, b) => a - b);
    frames[h] = { ...frameHeader(f), cells: i32(cells), values: f64(cells.map((c) => f.grid.values[c])) };
  }

  if (id === 'gom-berthed' && !ALL) {
    const f = input.grids.get(-12)!;
    const g = f.grid;
    // Probes over the frame's whole extent, and a little past its edges.
    const probes: LngLat[] = [];
    for (let i = 0; i < 400; i++) {
      probes.push([
        g.minLon + (((i * 0.6180339887) % 1.04) - 0.02) * g.nx * g.dLon,
        g.minLat + (((i * 0.7548776662) % 1.04) - 0.02) * g.ny * g.dLat,
      ]);
    }
    gz('frame.json.gz', {
      scenario: id, hour: -12, ...frameHeader(f), values: f64(g.values),
      probes: probes.map((p) => ({ p, value: fieldProbabilityAt(input.grids, -12, p) })),
    });
  }

  const vessels = kept.map((v) => ({
    mmsi: v.mmsi, label: v.label, kind: v.kind, lengthM: v.lengthM, draftM: v.draftM,
    lengthAssumed: v.lengthAssumed ?? false, source: v.source ?? null,
    t: f64(v.points.map((p) => p.t)), lon: f64(v.points.map((p) => p.lon)), lat: f64(v.points.map((p) => p.lat)),
    sog: f64(v.points.map((p) => p.sog)), cog: f64(v.points.map((p) => p.cog)),
  }));

  const expected: Record<string, unknown> = {};
  for (const variant of ['integral', 'max'] as DriftVariant[]) {
    const all = score({ ...input, variant });
    const stored = score({ ...input, variant, vessels: kept });
    // The omitted vessels must change nothing but the count the gate considered.
    if (all.gate.admitted !== stored.gate.admitted || all.suspects.length !== stored.suspects.length ||
        all.suspects.some((s, i) => s.id !== stored.suspects[i].id || s.total !== stored.suspects[i].total)) {
      throw new Error(`${id}/${variant}: dropping out-of-field vessels changed the result`);
    }
    expected[variant] = {
      gate: all.gate,
      separability: all.separability,
      insufficientEvidence: all.insufficientEvidence,
      suspects: all.suspects.map((s) => ({
        id: s.id, kind: s.kind, label: s.label, detail: s.detail, isTruth: s.isTruth,
        total: s.total, rank: s.rank, totalWithoutDrift: s.totalWithoutDrift, rankWithoutDrift: s.rankWithoutDrift,
        terms: s.terms, position: s.position,
        evidence: s.evidence,
      })),
    };
  }

  const c = input.characterisation;
  const kb = gz(`${id}.json.gz`, {
    scenario: id,
    input: {
      acquiredAt: input.acquiredAt,
      truthId: input.truthId,
      infrastructureCoverage: input.infrastructureCoverage,
      infrastructure: input.infrastructure,
      darkTargets: input.darkTargets,
      characterisation: {
        head: c.head, tail: c.tail, lengthKm: c.lengthKm, windSpeedMs: c.windSpeedMs,
        windGateMultiplier: c.windGateMultiplier, headTailResolvedBy: c.headTailResolvedBy,
        dampingRatioDb: c.dampingRatioDb,
      },
      drift: {
        backwardHours: back,
        convergence: input.drift.convergence.map((x) => ({ hour: x.hour, area90Km2: x.area90Km2 })),
        insufficientEvidence: input.drift.insufficientEvidence,
      },
      frames,
      vessels,
      vesselsOmitted: input.vessels.length - kept.length,
    },
    expected,
  });
  rows.push({ id, frames: Object.keys(frames).length, vessels: kept.length, omitted: input.vessels.length - kept.length, kb });
}
console.table(rows);
console.log(`Wrote ${rows.length} scoring fixtures to ${out}.`);
