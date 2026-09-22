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
import { isLand } from "./landmask";
import { makeRng, seedFrom, type Rng } from "./rng";
import type { AisPoint, AnomalyFlag, LngLat, Vessel } from "./types";

export interface Corridor {
  from: LngLat;
  to: LngLat;
  /** Lateral scatter around the corridor centreline, km. */
  widthKm: number;
}

/* ------------------------------------------------------------------ *
 * Keeping traffic in the water
 * ------------------------------------------------------------------ */

/**
 * Where across a corridor its traffic can be, as fractions of `widthKm`.
 *
 * `buildTraffic` scatters each vessel by a normal with sigma `widthKm / 2`, so
 * plus or minus one width is two sigma. Testing only the centreline is how a
 * lane could pass the corridor check and still put vessels on a beach.
 */
const BAND = [-1, -0.5, 0, 0.5, 1];

/** Whether any part of a corridor's traffic band is on land at this point. */
function bandAshore(at: LngLat, headingDeg: number, widthKm: number): boolean {
  for (const f of BAND) {
    const p = f === 0 ? at : destination(at, headingDeg + 90, f * widthKm);
    if (isLand(p[0], p[1])) return true;
  }
  return false;
}

/**
 * Fraction of a corridor's whole traffic band on land, on a `stepKm` grid.
 *
 * Half a kilometre along and across, which is about one land-mask cell: fine
 * enough that an islet cannot sit between two samples. This is the test lanes
 * are held to, both here and inside `planCorridors`.
 */
export function corridorLandFraction(c: Corridor, stepKm = 0.5): number {
  const lengthKm = distanceKm(c.from, c.to);
  const heading = bearingDeg(c.from, c.to);
  const steps = Math.max(2, Math.ceil(lengthKm / stepKm) + 1);
  const across = Math.max(1, Math.ceil((2 * c.widthKm) / stepKm));
  let ashore = 0;
  let total = 0;
  for (let i = 0; i < steps; i++) {
    const at = destination(c.from, heading, (lengthKm * i) / (steps - 1));
    for (let j = 0; j <= across; j++) {
      const p = destination(at, heading + 90, -c.widthKm + (2 * c.widthKm * j) / across);
      total++;
      if (isLand(p[0], p[1])) ashore++;
    }
  }
  return ashore / total;
}

export interface CorridorPlan {
  corridors: Corridor[];
  /** One line on what was laid, for the run's provenance. */
  note: string;
}

/**
 * Shipping lanes for a scene nobody authored, laid around the coast.
 *
 * An upload used to get two fixed lanes, a degree and a bit either side of its
 * centre, whatever was there. Over Bali that meant a lane through Denpasar.
 * This searches bearings and lateral offsets through the scene instead, walks
 * each lane out from the scene until its traffic band -- not just its
 * centreline -- meets land, and keeps the longest lanes that pass close to the
 * slick. Through a strait, the strait's own bearing wins, because it is the
 * only one that runs any distance.
 *
 * These are still simulated lanes, and the provenance says so. What this buys
 * is that they are lanes a ship could sail, not that they are lanes ships do
 * sail -- that needs real AIS (FUTURE_WORK 1.6).
 */
export function planCorridors(
  centre: LngLat,
  {
    widths = [8, 6],
    reachKm = 110,
    minKm = 40,
  }: { widths?: number[]; reachKm?: number; minKm?: number } = {},
): CorridorPlan {
  const OFFSETS = [0, 5, -5, 10, -10, 18, -18, 28, -28];
  const STEP_KM = 1;

  interface Candidate {
    bearing: number;
    offsetKm: number;
    corridor: Corridor;
    lengthKm: number;
    score: number;
  }

  const lay = (bearing: number, offsetKm: number, widthKm: number): Candidate | null => {
    const anchor = offsetKm === 0 ? centre : destination(centre, bearing + 90, offsetKm);
    if (bandAshore(anchor, bearing, widthKm)) return null;
    const walk = (heading: number): number => {
      let km = 0;
      while (km < reachKm && !bandAshore(destination(anchor, heading, km + STEP_KM), bearing, widthKm)) {
        km += STEP_KM;
      }
      return km;
    };
    const ahead = walk(bearing);
    const behind = walk(bearing + 180);
    const lengthKm = ahead + behind;
    if (lengthKm < minKm) return null;
    return {
      bearing,
      offsetKm,
      lengthKm,
      // Long, and close to the slick: a lane far off gives the gate nothing
      // to filter, and a stub is not a shipping lane.
      score: (lengthKm / (2 * reachKm)) * (1 - (0.5 * Math.abs(offsetKm)) / 30),
      corridor: {
        from: destination(anchor, bearing + 180, behind),
        to: destination(anchor, bearing, ahead),
        widthKm,
      },
    };
  };

  const chosen: Candidate[] = [];
  for (const widthKm of widths) {
    const candidates: Candidate[] = [];
    for (let bearing = 0; bearing < 180; bearing += 7.5) {
      for (const offsetKm of OFFSETS) {
        // A second lane must cross the first or stand clear of it, or the
        // scene has one lane drawn twice.
        const distinct = chosen.every((c) => {
          const turn = (((bearing - c.bearing) % 180) + 180) % 180;
          return Math.min(turn, 180 - turn) >= 35 || Math.abs(offsetKm - c.offsetKm) >= 12;
        });
        if (!distinct) continue;
        const candidate = lay(bearing, offsetKm, widthKm);
        if (candidate) candidates.push(candidate);
      }
    }
    // The walk above samples the band coarsely so the search stays fast. The
    // lane actually kept must pass the same fine test the checks apply, so
    // an islet that fell between two coarse samples costs a candidate, not a
    // ship on a beach.
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates.find((c) => corridorLandFraction(c.corridor) === 0);
    if (best) chosen.push(best);
  }

  const note = chosen.length
    ? `${chosen.length} simulated lane${chosen.length === 1 ? "" : "s"} laid around the coastline (` +
      chosen.map((c) => `${c.lengthKm} km at ${c.bearing.toFixed(1)}°`).join(", ") + ")"
    : `no lane of ${minKm} km or more fits in open water here, so there is no background traffic`;
  return { corridors: chosen.map((c) => c.corridor), note };
}

export interface TrafficStats {
  /** Vessels whose first lateral position touched land and were re-placed. */
  resampled: number;
  /** Vessels no re-placement could keep off land, left out. */
  dropped: number;
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

/**
 * Class priors for the broader categories real AIS reports.
 *
 * AIS ship-type codes say "tanker" or "cargo", not "product tanker" or "bulk
 * carrier", so real traffic arrives in coarser classes than the table above.
 * These sit on the same scale and are ASSUMED, not fitted: a tanker as the
 * tanker rows, cargo as the mean of the three cargo rows, and low values for
 * vessels that carry little oil. "Other" and "Unknown" get no number of their
 * own -- they go through `unknownClassPrior`, which infers the class from the
 * one thing AIS usually does report, the length.
 */
const AIS_CLASS_PRIOR: Record<string, number> = {
  Tanker: 0.9,
  Cargo: 0.53,
  Passenger: 0.3,
  "Service vessel": 0.25,
  "Pleasure craft": 0.08,
};

export function vesselPrior(kind: string, lengthM: number): number {
  if (kind === "Other" || kind === "Unknown") return unknownClassPrior(lengthM);
  const entry = VESSEL_KINDS.find((v) => v.kind === kind);
  const base = entry ? entry.prior : (AIS_CLASS_PRIOR[kind] ?? 0.4);
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

/* ------------------------------------------------------------------ *
 * Voyages, for scenes with no real AIS
 * ------------------------------------------------------------------ */

/**
 * A smooth path through `control`, sampled every `stepKm`.
 *
 * Catmull-Rom, so the path passes through every waypoint and turns through
 * them rather than kinking at them: a ship alters course over minutes, not at a
 * vertex. Worked in local degrees, which is fine at the tens-of-km scale here.
 */
function smoothPath(control: LngLat[], stepKm: number): LngLat[] {
  const out: LngLat[] = [];
  const p = [control[0], ...control, control[control.length - 1]];
  for (let i = 1; i < p.length - 2; i++) {
    const [a, b, c, d] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    const steps = Math.max(2, Math.ceil(distanceKm(b, c) / stepKm));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const at = (k: 0 | 1) =>
        0.5 * (2 * b[k] + (-a[k] + c[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 +
          (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3);
      out.push([at(0), at(1)]);
    }
  }
  out.push(control[control.length - 1]);
  return out;
}

/**
 * How often each kind stops before it reaches port -- anchoring, waiting on a
 * berth or a tow, holding alongside.
 */
const STOP_PROBABILITY: Record<string, number> = {
  "Product tanker": 0.15,
  "Crude tanker": 0.15,
  "Bulk carrier": 0.18,
  "Container feeder": 0.08,
  "General cargo": 0.15,
  "Offshore supply": 0.45,
  Tug: 0.35,
};

/**
 * One simulated voyage along a corridor, shaped like a voyage.
 *
 * The generator this replaced drew every vessel on a straight centreline plus a
 * constant offset and a 0.35 km sine, and a reviewer's first reaction to the
 * console was that ships never move like that. They do not. This one routes
 * each vessel through a few waypoints of its own -- so no two share a line --
 * smooths the turns, lets the speed wander, and gives each kind the behaviour
 * it actually has: fishing boats leave the lane to trawl back and forth over a
 * ground at 2.5-4 kn; tankers, bulkers and supply boats sometimes stop for
 * hours; everyone's helm wanders a little.
 *
 * It is still SIMULATED, and every scene that uses it says so. Scenes with
 * real AIS (`sim/realAis.ts`) never come here.
 */
function voyage(
  from: LngLat,
  to: LngLat,
  widthKm: number,
  kind: string,
  sogKn: number,
  enterT: number,
  startT: number,
  endT: number,
  stepMs: number,
  vr: Rng,
): AisPoint[] {
  const legKm = distanceKm(from, to);
  const heading = bearingDeg(from, to);

  /*
    Where it came from and where it is going, beyond the lane.

    A lane is where traffic CONVERGES -- a fairway, a separation scheme, the
    one sensible line past a headland -- not where every ship starts and
    stops. Starting and ending every voyage at the corridor's two endpoints
    drew each lane as a bundle pinched at both ends. So each vessel arrives
    from, and leaves toward, a point of its own off the end of the lane: the
    bundle funnels through the scene and fans out beyond it.
  */
  const origin = destination(from, heading + 180 + vr.normal() * 20, legKm * vr.range(0.15, 0.45));
  const bound = destination(to, heading + vr.normal() * 20, legKm * vr.range(0.15, 0.45));

  // Waypoints: a lateral offset that wanders along the leg, so the route bends.
  const interior = 2 + Math.floor(vr.next() * 3);
  let offset = vr.normal() * widthKm * 0.5;
  const control: LngLat[] = [origin, destination(from, heading + 90, offset)];
  for (let i = 1; i <= interior; i++) {
    const f = (i + (vr.next() - 0.5) * 0.6) / (interior + 1);
    offset = Math.max(-1.4 * widthKm, Math.min(1.4 * widthKm, offset * 0.55 + vr.normal() * widthKm * 0.5));
    control.push(destination(destination(from, heading, legKm * f), heading + 90, offset));
  }
  offset = offset * 0.5 + vr.normal() * widthKm * 0.3;
  control.push(destination(to, heading + 90, offset));
  control.push(bound);
  const path = smoothPath(control, 0.5);
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + distanceKm(path[i - 1], path[i]));
  const total = cum[cum.length - 1];
  const along = (km: number): LngLat => {
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= km) lo = mid;
      else hi = mid;
    }
    const f = cum[hi] > cum[lo] ? (km - cum[lo]) / (cum[hi] - cum[lo]) : 0;
    return [path[lo][0] + (path[hi][0] - path[lo][0]) * f, path[lo][1] + (path[hi][1] - path[lo][1]) * f];
  };

  /*
    One event at most per voyage: a fishing ground, or a stop.

    WHERE a stop happens matters as much as whether. The first version of this
    put stops anywhere in the middle half of the lane, and since the authored
    lanes run through the scene, stops piled up beside the slick: in
    kutch-dark a simulated tug holding position inside the origin field
    outranked the dark contact. The scorer was right to rank it -- a vessel
    stationary where the oil came from IS a suspect -- but the tug was the
    generator's invention. Merchant ships and tugs stop where they wait: at the
    approach to the port they are bound for, the far end of the voyage. So
    stops go there. Fishing boats work grounds, which can be anywhere.
  */
  const fishing = kind === "Fishing" && vr.next() < 0.7;
  const stops = !fishing && vr.next() < (STOP_PROBABILITY[kind] ?? 0.1);
  const eventKm = total * (fishing ? vr.range(0.2, 0.8) : vr.range(0.88, 0.97));
  const eventH = fishing ? vr.range(3, 9) : vr.range(1.5, 7);

  // Speed wanders slowly around the service speed.
  const period = vr.range(2, 6) * 3600_000;
  const phase = vr.next() * 2 * Math.PI;
  const swing = vr.range(0.03, 0.09);

  const points: AisPoint[] = [];
  let km = 0;
  let t = enterT;
  let helm = 0; // cross-track wander, km, AR(1)
  let mode: "transit" | "event" | "rejoin" = "transit";
  let eventEnds = 0;
  let at: LngLat = along(0);
  let anchor: LngLat = at;
  let course = heading;
  let fishLegEnds = 0;
  let prev: LngLat = at;

  while (km < total && t <= endT) {
    let sog: number;
    if (mode === "transit") {
      sog = sogKn * (1 + swing * Math.sin((2 * Math.PI * (t - enterT)) / period + phase)) + vr.normal() * 0.12;
      km += (sog * 1.852 * stepMs) / 3600_000;
      helm = helm * 0.92 + vr.normal() * 0.025;
      const onPath = along(Math.min(km, total));
      const dir = bearingDeg(prev, onPath);
      at = destination(onPath, dir + 90, helm);
      if ((fishing || stops) && eventEnds === 0 && km >= eventKm) {
        mode = "event";
        eventEnds = t + eventH * 3600_000;
        anchor = at;
        course = (heading + 90 + vr.normal() * 40 + 360) % 360;
        fishLegEnds = t + vr.range(0.3, 1.1) * 3600_000;
      }
    } else if (mode === "event") {
      if (fishing) {
        // Trawling: long slow legs, turning back across the ground, kept
        // within a few km of where the boat left the lane.
        if (t >= fishLegEnds) {
          course = (course + 180 + vr.normal() * 25 + 360) % 360;
          fishLegEnds = t + vr.range(0.3, 1.1) * 3600_000;
        }
        if (distanceKm(at, anchor) > 4) course = bearingDeg(at, anchor);
        sog = vr.range(2.5, 4) ;
        at = destination(at, course + vr.normal() * 4, (sog * 1.852 * stepMs) / 3600_000);
      } else {
        // Stopped: swinging on an anchor or holding alongside, a boat length or two.
        sog = Math.max(0, vr.normal() * 0.15 + 0.1);
        at = [anchor[0] + vr.normal() * 0.0006, anchor[1] + vr.normal() * 0.0006];
      }
      if (t >= eventEnds) mode = "rejoin";
    } else {
      // Back to the lane at transit speed, then carry on along it.
      const target = along(Math.min(eventKm, total));
      sog = sogKn * 0.9;
      const step = (sog * 1.852 * stepMs) / 3600_000;
      if (distanceKm(at, target) <= step) {
        at = target;
        mode = "transit";
      } else {
        at = destination(at, bearingDeg(at, target), step);
      }
    }
    if (t >= startT) {
      const moved = distanceKm(prev, at) > 0.005;
      points.push({
        t,
        lon: at[0],
        lat: at[1],
        sog: Math.max(0, sog + vr.normal() * 0.1),
        cog: ((moved ? bearingDeg(prev, at) : course) + vr.normal() * 1.2 + 360) % 360,
      });
    }
    prev = at;
    t += stepMs;
  }
  return points;
}

export function buildTraffic(
  cfg: TrafficConfig,
  rng: Rng,
  stats: TrafficStats = { resampled: 0, dropped: 0 },
): Vessel[] {
  const vessels: Vessel[] = [];
  const startT = cfg.acquiredAt - (cfg.windowHours / 2) * 3600_000;
  const endT = startT + cfg.windowHours * 3600_000;
  if (!cfg.corridors.length) return vessels;

  for (let i = 0; i < cfg.vesselCount; i++) {
    const corridor = cfg.corridors[i % cfg.corridors.length];
    const spec = rng.pick(VESSEL_KINDS);
    const lengthM = Math.round(rng.range(spec.lo, spec.hi));

    const reverse = rng.next() < 0.5;
    const from = reverse ? corridor.to : corridor.from;
    const to = reverse ? corridor.from : corridor.to;

    const legKm = distanceKm(from, to);
    const sog = rng.range(lengthM > 150 ? 10.5 : 7.5, lengthM > 150 ? 15.5 : 12);

    // Each vessel enters the corridor at its own time. Starting them all
    // together empties the area within one transit, which is the difference
    // between a scene that looks busy for a moment and traffic the gate
    // actually has to filter across the whole backward window.
    const transitH = legKm / (sog * 1.852);
    const enterT =
      startT + rng.range(-transitH, cfg.windowHours) * 3600_000;
    // Everything about the voyage itself comes from a stream of the vessel's
    // own, seeded by one draw here, so the shared stream advances by the same
    // amount per vessel however long or eventful its voyage turns out.
    const seed = rng.int(0, 2 ** 31 - 1);
    const stepMs = cfg.cadenceS * 1000;
    const sail = (stream: Rng) =>
      voyage(from, to, corridor.widthKm, spec.kind, sog, enterT, startT, endT, stepMs, stream);
    const ashore = (track: AisPoint[]) => track.some((p) => isLand(p.lon, p.lat));

    /*
      A voyage that touches land is sailed again from a fresh stream of its
      own. Drawing the retry from the shared `rng` would shift every draw after
      it, and `buildTraffic` hands vessels round-robin off that one stream, so
      one re-routed vessel would silently re-roll the whole scene.
    */
    let points = sail(makeRng(seed));
    let placed = !ashore(points);
    if (!placed) {
      for (let attempt = 1; attempt <= 8 && !placed; attempt++) {
        points = sail(makeRng(seedFrom(`land-retry-${i}-${attempt}-${seed}`)));
        placed = !ashore(points);
      }
      if (placed) stats.resampled++;
    }

    if (points.length < 4) continue;

    const mmsi = String(rng.int(200_000_000, 776_000_000));
    const draftM = Number(rng.range(4, 14).toFixed(1));
    // Dropped only after its draws are taken, for the same reason as above.
    if (!placed) {
      stats.dropped++;
      continue;
    }
    vessels.push({
      mmsi,
      label: maskMmsi(mmsi),
      kind: spec.kind,
      lengthM,
      draftM,
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
/**
 * A route that runs dead straight between `a` and `b` and bends everywhere else.
 *
 * `lead` km of approach before `a` and `trail` km after `b`, each broken into
 * legs that alter course by a few tens of degrees and smoothed through the
 * turns. The straight part is kept straight on purpose: a vessel discharging
 * holds its course -- the real Case 2 tanker ran 18.4 km on 179.3 degrees while
 * it did -- and the release model lays the oil along exactly that line.
 */
function routeThrough(a: LngLat, b: LngLat, courseDeg: number, lead: number, trail: number, vr: Rng) {
  const legs = (from: LngLat, dir: number, km: number, sign: 1 | -1): LngLat[] => {
    // Two or three legs; the first carries on along the course for a while so
    // the join into the straight part is smooth.
    const out: LngLat[] = [];
    let at = destination(from, dir, Math.min(km, 4) * sign);
    out.push(at);
    let heading = dir;
    let left = km - 4;
    while (left > 0) {
      heading += (vr.next() < 0.5 ? -1 : 1) * vr.range(18, 55);
      const leg = Math.min(left, vr.range(0.3, 0.55) * km + 5);
      at = destination(at, heading, leg * sign);
      out.push(at);
      left -= leg;
    }
    return out;
  };
  const before = legs(a, courseDeg, lead, -1).reverse();
  const after = legs(b, courseDeg, trail, 1);
  const head = smoothPath([...before, a], 0.5);
  const tail = smoothPath([b, ...after], 0.5);
  const path: LngLat[] = [...head.slice(0, -1), a, b, ...tail.slice(1)];
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + distanceKm(path[i - 1], path[i]));
  const aKm = cum[head.length - 1];
  const at = (km: number): LngLat => {
    const k = Math.max(0, Math.min(cum[cum.length - 1], km));
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= k) lo = mid;
      else hi = mid;
    }
    const f = cum[hi] > cum[lo] ? (k - cum[lo]) / (cum[hi] - cum[lo]) : 0;
    return [path[lo][0] + (path[hi][0] - path[lo][0]) * f, path[lo][1] + (path[hi][1] - path[lo][1]) * f];
  };
  return { at, aKm };
}

export function movingDischarge(spec: MovingDischargeSpec, rng: Rng): Vessel {
  const steps = Math.round((spec.windowHours * 3600) / spec.cadenceS);
  const startT = spec.acquiredAt - spec.windowHours * 3600_000;
  const dischargeEndT = spec.acquiredAt - spec.endedHoursBefore * 3600_000;
  const dischargeStartT = dischargeEndT - spec.durationHours * 3600_000;
  const kmPerHour = spec.sogKn * 1.852;
  const points: AisPoint[] = [];
  const dischargeEnd = destination(spec.dischargeStart, spec.courseDeg, spec.durationHours * kmPerHour);
  // The route's own stream, so the shared one advances exactly as it did.
  const route = routeThrough(
    spec.dischargeStart,
    dischargeEnd,
    spec.courseDeg,
    ((dischargeStartT - startT) / 3600_000) * kmPerHour + 2,
    ((spec.acquiredAt + spec.windowHours * 3600_000 - dischargeEndT) / 3600_000) * kmPerHour + 2,
    makeRng(seedFrom(`route-${spec.dischargeStart.join(",")}-${spec.courseDeg}`)),
  );
  let prev: LngLat | null = null;

  for (let s = 0; s < steps; s++) {
    const t = startT + s * spec.cadenceS * 1000;
    const hoursFromDischargeStart = (t - dischargeStartT) / 3600_000;
    const p = route.at(route.aKm + hoursFromDischargeStart * kmPerHour);
    const heading = prev && distanceKm(prev, p) > 0.01 ? bearingDeg(prev, p) : spec.courseDeg;
    prev = p;
    const discharging = t >= dischargeStartT && t <= dischargeEndT;
    points.push({
      t,
      lon: p[0],
      lat: p[1],
      // A modest speed reduction while discharging. On its own this means
      // nothing; next to the field agreement it is corroboration.
      sog: spec.sogKn - (discharging ? 1.6 : 0) + rng.normal() * 0.16,
      cog: (heading + rng.normal() * 1.1 + 360) % 360,
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

  // The inbound leg bends through two waypoints of its own, from a stream of
  // its own, rather than running a ruler line into the berth. The final
  // approach straightens up, as a vessel lining up on a berth does.
  const vr = makeRng(seedFrom(`approach-${spec.berth.join(",")}`));
  const side = vr.next() < 0.5 ? -1 : 1;
  const approach = smoothPath(
    [
      spec.approachFrom,
      destination(destination(spec.approachFrom, heading, approachKm * 0.35), heading + 90, side * approachKm * vr.range(0.12, 0.25)),
      destination(destination(spec.approachFrom, heading, approachKm * 0.7), heading + 90, -side * approachKm * vr.range(0.04, 0.1)),
      destination(spec.berth, heading, -Math.min(1.5, approachKm * 0.1)),
      spec.berth,
    ],
    0.3,
  );
  const cum = [0];
  for (let i = 1; i < approach.length; i++) cum.push(cum[i - 1] + distanceKm(approach[i - 1], approach[i]));
  const alongApproach = (km: number): LngLat => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < km) i++;
    const f = cum[i] > cum[i - 1] ? Math.min(1, Math.max(0, (km - cum[i - 1]) / (cum[i] - cum[i - 1]))) : 0;
    return [approach[i - 1][0] + (approach[i][0] - approach[i - 1][0]) * f, approach[i - 1][1] + (approach[i][1] - approach[i - 1][1]) * f];
  };
  let prev: LngLat = spec.approachFrom;

  for (let s = 0; s < steps; s++) {
    const t = startT + s * spec.cadenceS * 1000;
    if (t <= mooredAt) {
      // Inbound leg, decelerating into the berth.
      const frac = (t - startT) / (mooredAt - startT);
      const p = alongApproach(cum[cum.length - 1] * frac);
      const course = distanceKm(prev, p) > 0.01 ? bearingDeg(prev, p) : heading;
      prev = p;
      points.push({
        t,
        lon: p[0],
        lat: p[1],
        sog: Math.max(0.4, 9.2 * (1 - frac ** 1.7)) + rng.normal() * 0.2,
        cog: (course + rng.normal() * 2.2 + 360) % 360,
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
