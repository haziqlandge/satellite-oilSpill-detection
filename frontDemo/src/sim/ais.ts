/**
 * AIS traffic synthesis.
 *
 * Two kinds of track come out of here and they are generated differently on
 * purpose:
 *
 *  - background traffic, laid along shipping corridors, is what the attribution
 *    gate has to filter out. A scenario with three vessels does not test
 *    filtering, so the corridors are populated densely enough that the gate has
 *    real work to do
 *  - the scripted track, whose behaviour is authored by us. C10 forbids deriving
 *    ground truth from a detector and then evaluating against it, which is the
 *    circularity P003 fell into
 *
 * Identities are masked everywhere. The published cases name real ships, and a
 * demo has no business printing a real vessel's name beside the word polluter.
 */

import { bearingDeg, destination, distanceKm } from "./geo";
import type { Rng } from "./rng";
import type { AisPoint, AnomalyFlag, LngLat, Vessel } from "./types";

export interface Corridor {
  from: LngLat;
  to: LngLat;
  /** Lateral scatter around the corridor centreline, km. */
  widthKm: number;
}

export interface TrafficConfig {
  corridors: Corridor[];
  vesselCount: number;
  /** Reporting cadence in seconds. marinecadastre is filtered to 60 s. */
  cadenceS: number;
  windowHours: number;
  acquiredAt: number;
}

const VESSEL_KINDS = [
  { kind: "Product tanker", lo: 140, hi: 190, prior: 0.9 },
  { kind: "Crude tanker", lo: 210, hi: 275, prior: 0.92 },
  { kind: "Bulk carrier", lo: 170, hi: 230, prior: 0.62 },
  { kind: "Container feeder", lo: 120, hi: 180, prior: 0.48 },
  { kind: "Offshore supply", lo: 55, hi: 90, prior: 0.7 },
  { kind: "Tug", lo: 22, hi: 38, prior: 0.35 },
  { kind: "Fishing", lo: 18, hi: 34, prior: 0.22 },
  { kind: "General cargo", lo: 90, hi: 140, prior: 0.5 },
];

export function vesselPrior(kind: string, lengthM: number): number {
  const entry = VESSEL_KINDS.find((v) => v.kind === kind);
  const base = entry ? entry.prior : 0.4;
  // Size is a weak, monotonic contribution on top of the type prior.
  const size = Math.min(1, lengthM / 260);
  return Math.min(1, base * 0.78 + size * 0.22);
}

/**
 * The same prior for a contact whose class nobody knows.
 *
 * A radar bright target has a radar-estimated length and nothing else. Until
 * 2026-09-05 `scoreDark` scored it as `min(0.8, lengthM / 260)` -- pure size,
 * no class term at all -- which put it on a different scale from every vessel
 * it is ranked against, where size carries only 22% and class carries 78%. A
 * 118 m contact came out at 0.454, *below* an identified 118 m general cargo at
 * 0.490. The contact was being marked down for the analyst's ignorance.
 *
 * The fix keeps the vessel formula and supplies the one missing input honestly:
 * class is unknown, so the class term is the mean over the classes whose length
 * range actually admits this contact. That is inference from the one
 * measurement radar does give, rather than either a guess or a zero.
 *
 * What it deliberately does NOT do is treat running dark as itself raising the
 * prior. That would be the natural way to make an unlit contact score well, and
 * it would be double counting: absence of AIS is already scored, explicitly and
 * with its own caveat about regional reception, in the `behaviour` term.
 */
export function unknownClassPrior(lengthM: number): number {
  const admitted = VESSEL_KINDS.filter(
    (v) => lengthM >= v.lo && lengthM <= v.hi,
  );
  // Nothing in the table is this length: fall back to the classes nearest it,
  // rather than to a constant that would be unrelated to the measurement.
  const pool = admitted.length
    ? admitted
    : [
        VESSEL_KINDS.reduce((best, v) => {
          const d = (x: { lo: number; hi: number }) =>
            Math.max(x.lo - lengthM, lengthM - x.hi, 0);
          return d(v) < d(best) ? v : best;
        }, VESSEL_KINDS[0]),
      ];
  const base = pool.reduce((s, v) => s + v.prior, 0) / pool.length;
  const size = Math.min(1, lengthM / 260);
  return Math.min(1, base * 0.78 + size * 0.22);
}

/** MMSI masked to its country prefix and check digit, the way the UI shows it. */
export function maskMmsi(mmsi: string): string {
  return `MMSI ${mmsi.slice(0, 3)}${"•".repeat(5)}${mmsi.slice(-1)}`;
}

export function buildTraffic(cfg: TrafficConfig, rng: Rng): Vessel[] {
  const vessels: Vessel[] = [];
  const startT = cfg.acquiredAt - (cfg.windowHours / 2) * 3600_000;
  const endT = startT + cfg.windowHours * 3600_000;

  for (let i = 0; i < cfg.vesselCount; i++) {
    const corridor = cfg.corridors[i % cfg.corridors.length];
    const spec = rng.pick(VESSEL_KINDS);
    const lengthM = Math.round(rng.range(spec.lo, spec.hi));

    const reverse = rng.next() < 0.5;
    const from = reverse ? corridor.to : corridor.from;
    const to = reverse ? corridor.from : corridor.to;

    const legKm = distanceKm(from, to);
    const heading = bearingDeg(from, to);
    const offsetKm = rng.normal() * corridor.widthKm * 0.5;
    const sog = rng.range(lengthM > 150 ? 10.5 : 7.5, lengthM > 150 ? 15.5 : 12);
    const kmPerHour = sog * 1.852;

    // Each vessel enters the corridor at its own time. Starting them all
    // together empties the area within one transit, which is the difference
    // between a scene that looks busy for a moment and traffic the gate
    // actually has to filter across the whole backward window.
    const transitH = legKm / kmPerHour;
    const enterT =
      startT + rng.range(-transitH, cfg.windowHours) * 3600_000;

    const points: AisPoint[] = [];
    const stepMs = cfg.cadenceS * 1000;

    for (let t = enterT; t <= enterT + transitH * 3600_000; t += stepMs) {
      if (t < startT || t > endT) continue;
      const along = ((t - enterT) / 3600_000) * kmPerHour;
      let p = destination(from, heading, along);
      p = destination(p, heading + 90, offsetKm + Math.sin(along / 7) * 0.35);
      points.push({
        t,
        lon: p[0],
        lat: p[1],
        sog: sog + rng.normal() * 0.25,
        cog: (heading + rng.normal() * 1.6 + 360) % 360,
      });
    }

    if (points.length < 4) continue;

    const mmsi = String(rng.int(200_000_000, 776_000_000));
    vessels.push({
      mmsi,
      label: maskMmsi(mmsi),
      kind: spec.kind,
      lengthM,
      draftM: Number(rng.range(4, 14).toFixed(1)),
      points,
      background: true,
    });
  }

  return vessels;
}

/* ------------------------------------------------------------------ *
 * Scripted tracks: the authored ground truth
 * ------------------------------------------------------------------ */

export interface MovingDischargeSpec {
  /** Where the discharge began. This is the tip the published case names. */
  dischargeStart: LngLat;
  /** Course the vessel was making. The slick is laid along it. */
  courseDeg: number;
  sogKn: number;
  /** Hours before acquisition that the discharge ended. */
  endedHoursBefore: number;
  /** How long the discharge ran. Length laid = sog times this. */
  durationHours: number;
  windowHours: number;
  cadenceS: number;
  acquiredAt: number;
  kind: string;
  lengthM: number;
}

/**
 * Case 2 analogue: a vessel underway, discharging as it goes, then carrying on.
 *
 * The track runs across the whole window, not just the discharge. That matters:
 * by acquisition the vessel is tens of kilometres away and the oil has drifted
 * off its track, which is precisely the situation P004 could only resolve by
 * hand and named reverse-trajectory simulation as the fix for.
 */
export function movingDischarge(spec: MovingDischargeSpec, rng: Rng): Vessel {
  const steps = Math.round((spec.windowHours * 3600) / spec.cadenceS);
  const startT = spec.acquiredAt - spec.windowHours * 3600_000;
  const dischargeEndT = spec.acquiredAt - spec.endedHoursBefore * 3600_000;
  const dischargeStartT = dischargeEndT - spec.durationHours * 3600_000;
  const kmPerHour = spec.sogKn * 1.852;
  const points: AisPoint[] = [];

  for (let s = 0; s < steps; s++) {
    const t = startT + s * spec.cadenceS * 1000;
    const hoursFromDischargeStart = (t - dischargeStartT) / 3600_000;
    const p = destination(
      spec.dischargeStart,
      spec.courseDeg,
      hoursFromDischargeStart * kmPerHour,
    );
    const discharging = t >= dischargeStartT && t <= dischargeEndT;
    points.push({
      t,
      lon: p[0],
      lat: p[1],
      // A modest speed reduction while discharging. On its own this means
      // nothing; next to the field agreement it is corroboration.
      sog: spec.sogKn - (discharging ? 1.6 : 0) + rng.normal() * 0.16,
      cog: (spec.courseDeg + rng.normal() * 1.1 + 360) % 360,
    });
  }

  const mmsi = "636019184";
  return {
    mmsi,
    label: maskMmsi(mmsi),
    kind: spec.kind,
    lengthM: spec.lengthM,
    draftM: 11.4,
    points,
    background: false,
  };
}

export interface BerthedSpec {
  /** Where the vessel came from, and the berth it stopped at. */
  approachFrom: LngLat;
  berth: LngLat;
  /** Hours before acquisition that it moored. */
  mooredHoursBefore: number;
  windowHours: number;
  cadenceS: number;
  acquiredAt: number;
  kind: string;
  lengthM: number;
}

/**
 * Case 3 analogue: sailed in, moored, and was still moored at acquisition.
 *
 * This is the adversarial track. There is no course to be parallel to and the
 * vessel never moved along the slick, so Cerulean's parity and proximity terms
 * both fail on it. Only a backward field that reaches the berth at the right
 * time can rank it.
 */
export function berthedDischarge(spec: BerthedSpec, rng: Rng): Vessel {
  const steps = Math.round((spec.windowHours * 3600) / spec.cadenceS);
  const startT = spec.acquiredAt - spec.windowHours * 3600_000;
  const mooredAt = spec.acquiredAt - spec.mooredHoursBefore * 3600_000;
  const approachKm = distanceKm(spec.approachFrom, spec.berth);
  const heading = bearingDeg(spec.approachFrom, spec.berth);
  const points: AisPoint[] = [];

  for (let s = 0; s < steps; s++) {
    const t = startT + s * spec.cadenceS * 1000;
    if (t <= mooredAt) {
      // Inbound leg, decelerating into the berth.
      const frac = (t - startT) / (mooredAt - startT);
      const p = destination(spec.approachFrom, heading, approachKm * frac);
      points.push({
        t,
        lon: p[0],
        lat: p[1],
        sog: Math.max(0.4, 9.2 * (1 - frac ** 1.7)) + rng.normal() * 0.2,
        cog: (heading + rng.normal() * 2.2 + 360) % 360,
      });
    } else {
      // Moored: position wanders by a boat length on the mooring, speed at zero.
      points.push({
        t,
        lon: spec.berth[0] + rng.normal() * 0.00035,
        lat: spec.berth[1] + rng.normal() * 0.00035,
        sog: Math.max(0, rng.normal() * 0.06),
        cog: (heading + 180 + rng.normal() * 6 + 360) % 360,
      });
    }
  }

  const mmsi = "367762340";
  return {
    mmsi,
    label: maskMmsi(mmsi),
    kind: spec.kind,
    lengthM: spec.lengthM,
    draftM: 4.6,
    points,
    background: false,
  };
}

/* ------------------------------------------------------------------ *
 * Behaviour
 * ------------------------------------------------------------------ */

/**
 * Behavioural evidence for one track.
 *
 * Rules plus a composite score, never a bare isolation-forest number. A raw
 * anomaly score is not inspectable evidence, and the output here is an
 * accusation, so every flag carries the series that raised it (C4).
 */
export function behaviour(
  vessel: Vessel,
  acquiredAt: number,
): { score: number; flags: AnomalyFlag[] } {
  const flags: AnomalyFlag[] = [];
  const pts = vessel.points;
  if (pts.length < 6) return { score: 0, flags };

  const sogSeries = pts
    .filter((_, i) => i % Math.max(1, Math.floor(pts.length / 90)) === 0)
    .map((p) => ({ t: p.t, v: p.sog }));

  const speeds = pts.map((p) => p.sog);
  const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length;
  const minRun = rollingMin(speeds, 8);

  let score = 0;

  /*
    Sustained speed drop against the vessel's own service speed.

    The threshold was 0.72 -- a 28% reduction -- and at that value this flag
    was dead code. Censused across all five scenarios, 1096 vessels: two flags
    fired in the whole fixture set, both `stationary`/`course_change` on
    gom-berthed's truth, and `speed_drop` fired on nothing at all. That
    includes gom-moving, where `movingDischarge` plants a 1.6 kn reduction on
    an 8.0 kn transit *specifically* so this flag has something to find. It
    reached 0.7912 and missed.

    0.85 -- a 15% sustained reduction -- is set against the noise rather than
    against any one scenario. AIS speed noise here is 0.16 kn per report and
    `minRun` averages eight of them, so the sampling sigma of the quantity
    being tested is 0.16/sqrt(8) = 0.057 kn, 0.7% of an 8 kn transit. 15% is
    roughly 21 sigma clear of that, and comfortably under the 20% the
    generator plants. Measured margin on the shipped fixtures: it fires on
    gom-moving's truth at 0.7912 and on nothing else, the nearest other vessel
    anywhere being 0.9539.

    `mean` is a whole-window statistic and the discharge is inside it, so a
    long enough discharge would drag its own baseline down and hide itself.
    Here the discharge is 3.3% of the window (mean 7.947 against a service
    speed of 8.0) so it does not matter, but a scenario that discharged for a
    large fraction of its window would need a transit baseline -- a high
    percentile of the speed series -- rather than the mean.
  */
  if (mean > 2 && minRun < mean * 0.85) {
    const drop = 1 - minRun / mean;
    score += Math.min(0.42, drop * 0.6);
    flags.push({
      code: "speed_drop",
      label: "Sustained speed reduction",
      detail: `Held ${minRun.toFixed(1)} kn against a ${mean.toFixed(1)} kn transit mean for at least 8 reports.`,
      series: sogSeries,
      seriesLabel: "SOG, knots",
    });
  }

  // Stationary for a long stretch: relevant only because the origin field
  // reaches this position, and stated that way.
  const stationary = speeds.filter((s) => s < 0.5).length / speeds.length;
  if (stationary > 0.5) {
    score += 0.3;
    const hours =
      ((pts[pts.length - 1].t - pts[0].t) * stationary) / 3600_000;
    flags.push({
      code: "stationary",
      label: "Stationary through the origin window",
      detail: `Speed below 0.5 kn for roughly ${hours.toFixed(0)} h of the window, including the modelled release time.`,
      series: sogSeries,
      seriesLabel: "SOG, knots",
    });
  }

  // Course deviation.
  const turns = pts.slice(1).map((p, i) => angleDiff(p.cog, pts[i].cog));
  const maxTurn = Math.max(...turns.map(Math.abs));
  if (maxTurn > 28) {
    score += 0.1;
    flags.push({
      code: "course_change",
      label: "Course deviation",
      detail: `Largest single-report heading change ${maxTurn.toFixed(0)} degrees.`,
      series: pts
        .filter((_, i) => i % Math.max(1, Math.floor(pts.length / 90)) === 0)
        .map((p) => ({ t: p.t, v: p.cog })),
      seriesLabel: "COG, degrees",
    });
  }

  // Reception gaps, normalised (C7). A raw gap is not evidence: reception
  // density varies hugely by region and vessel class, and there are legitimate
  // reasons to go dark. The expected rate travels with the flag.
  const gaps = findGaps(pts);
  const expectedRate = 0.92;
  if (gaps.longestMin > 24) {
    const observedRate =
      1 - gaps.missingSamples / Math.max(1, gaps.expectedSamples);
    const shortfall = Math.max(0, expectedRate - observedRate);
    if (shortfall > 0.06) {
      score += Math.min(0.18, shortfall);
      flags.push({
        code: "reception_gap",
        label: "Reception below the regional expectation",
        detail: `Longest gap ${gaps.longestMin.toFixed(0)} min. Observed reception ${(observedRate * 100).toFixed(0)}% against ${(expectedRate * 100).toFixed(0)}% expected for this class and region.`,
        series: gaps.series,
        seriesLabel: "Minutes since previous report",
        expected: expectedRate,
      });
    }
  }

  // Recency: behaviour far from the acquisition time counts for less.
  const nearest = Math.min(
    ...pts.map((p) => Math.abs(p.t - acquiredAt) / 3600_000),
  );
  const recency = Math.exp(-nearest / 12);

  return { score: Math.min(1, score * (0.55 + 0.45 * recency)), flags };
}

function rollingMin(v: number[], w: number): number {
  let best = Infinity;
  for (let i = 0; i + w <= v.length; i++) {
    let m = -Infinity;
    for (let j = i; j < i + w; j++) m = Math.max(m, v[j]);
    best = Math.min(best, m);
  }
  return best === Infinity ? Math.min(...v) : best;
}

function angleDiff(a: number, b: number): number {
  let d = ((a - b + 540) % 360) - 180;
  return d;
}

function findGaps(pts: AisPoint[]) {
  const series: { t: number; v: number }[] = [];
  let longestMin = 0;
  let missingSamples = 0;
  const nominalMs = pts.length > 1 ? pts[1].t - pts[0].t : 60_000;

  for (let i = 1; i < pts.length; i++) {
    const dtMin = (pts[i].t - pts[i - 1].t) / 60_000;
    series.push({ t: pts[i].t, v: dtMin });
    if (dtMin > longestMin) longestMin = dtMin;
    if (pts[i].t - pts[i - 1].t > nominalMs * 1.5) {
      missingSamples += Math.round((pts[i].t - pts[i - 1].t) / nominalMs) - 1;
    }
  }

  return {
    longestMin,
    missingSamples,
    expectedSamples: pts.length + missingSamples,
    series: series.filter(
      (_, i) => i % Math.max(1, Math.floor(series.length / 90)) === 0,
    ),
  };
}

/** Track as a plain polyline, for map rendering and geometry terms. */
export function trackPath(vessel: Vessel): LngLat[] {
  return vessel.points.map((p) => [p.lon, p.lat] as LngLat);
}

/** Position at a given instant, interpolated between reports. */
export function positionAt(vessel: Vessel, t: number): LngLat | null {
  const pts = vessel.points;
  if (!pts.length) return null;
  if (t <= pts[0].t) return [pts[0].lon, pts[0].lat];
  if (t >= pts[pts.length - 1].t) {
    const last = pts[pts.length - 1];
    return [last.lon, last.lat];
  }
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - pts[lo].t) / Math.max(1, pts[hi].t - pts[lo].t);
  return [
    pts[lo].lon + (pts[hi].lon - pts[lo].lon) * f,
    pts[lo].lat + (pts[hi].lat - pts[lo].lat) * f,
  ];
}
