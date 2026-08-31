/**
 * The event, hour by hour.
 *
 * A spill is not a shape, it is something that happened. The simulation already
 * models it that way -- `runRelease` emits parcels from the first hour of the
 * discharge and carries them through the same forcing the hindcast runs
 * backward through -- but nothing in the old interface let a viewer watch it.
 * The slick simply existed, finished, and the story started at the satellite
 * pass.
 *
 * This module is the derivation the four designs share to tell it properly: at
 * any hour from the first minute of the discharge to the end of the forecast,
 * what phase the event is in, how much oil is in the water, how big the surface
 * extent is, and which vessels were near it at that moment. Every design
 * renders that in its own grammar; none of them re-derives it.
 *
 * The proximity list is explicitly not a ranking. It is who was in the
 * neighbourhood, which is a much weaker claim than who is a candidate, and the
 * designs are careful to keep the two apart.
 */

import { distanceKm, pointInPolygon } from "../sim/geo";
import { positionAt } from "../sim/ais";
import type { ReleaseFrame } from "../sim/drift";
import type { LngLat, Run, Vessel } from "../sim/types";

export type EventPhase =
  | "pre"
  | "discharging"
  | "adrift"
  | "acquisition"
  | "forecast";

export interface Contact {
  mmsi: string;
  label: string;
  kind: string;
  position: LngLat;
  sog: number;
  cog: number;
  /** Kilometres to the nearest oil on the surface. Zero means inside it. */
  distanceKm: number;
  /** Is this track one of the scored candidates? */
  candidate: boolean;
  /** Is this the authored source? Only ever used to mark, never to rank. */
  source: boolean;
}

export interface Moment {
  hour: number;
  at: number;
  phase: EventPhase;
  /** Null before the first parcel enters the water. */
  release: ReleaseFrame | null;
  releasedFraction: number;
  areaKm2: number;
  /** Hours since the discharge began. Negative before it starts. */
  sinceStart: number;
  contacts: Contact[];
  /** Contacts actually touching the oil at this hour. */
  inContact: number;
}

/** How close a track has to pass to be listed as present. */
export const CONTACT_RADIUS_KM = 12;

/**
 * Both release hours are negative and `releaseStartHour <= releaseEndHour <= 0`,
 * so the discharge is the window *up to* the end hour and adrift is everything
 * after it. The two were the wrong way round, which put "no longer discharging"
 * on the very hour the first parcel entered the water and "oil entering the
 * water" on the hours after it had stopped.
 */
export function phaseAt(run: Run, hour: number): EventPhase {
  if (hour < run.releaseStartHour) return "pre";
  if (hour > 0.5) return "forecast";
  if (hour >= -0.5) return "acquisition";
  if (hour <= run.releaseEndHour) return "discharging";
  return "adrift";
}

export const PHASE_LABEL: Record<EventPhase, string> = {
  pre: "Before the release",
  discharging: "Oil entering the water",
  adrift: "Adrift, no longer discharging",
  acquisition: "Satellite pass",
  forecast: "Forecast",
};

/** Distance from a point to the oil on the surface. Zero if inside it. */
function distanceToOil(p: LngLat, extent: LngLat[][]): number {
  if (!extent.length) return Infinity;
  if (pointInPolygon(p, extent)) return 0;
  let best = Infinity;
  for (const ring of extent) {
    // Ring vertices are dense enough that sampling them is within a few tens of
    // metres of the true edge distance, which is far finer than anything this
    // list is used to decide.
    for (const v of ring) {
      const d = distanceKm(p, v);
      if (d < best) best = d;
    }
  }
  return best;
}

function labelFor(v: Vessel, run: Run): string {
  const suspect = run.suspects.find((s) => s.id === v.mmsi);
  return suspect?.label ?? v.label;
}

/**
 * Everything about one instant of the event.
 *
 * Vessels are read at the same timestamp the oil is, from the one `hour` this
 * application has, so the traffic and the slick can never fall out of step.
 */
export function momentAt(
  run: Run,
  hour: number,
  radiusKm = CONTACT_RADIUS_KM,
): Moment {
  const at = run.meta.acquiredAt + hour * 3600_000;
  const phase = phaseAt(run, hour);
  const rounded = Math.round(hour);
  const release =
    hour < run.releaseStartHour
      ? null
      : (run.release.find((f) => f.hour === rounded) ??
        run.release[run.release.length - 1] ??
        null);

  const extent = release?.extent ?? [];
  const candidateIds = new Set(run.suspects.map((s) => s.id));
  const contacts: Contact[] = [];

  for (const v of run.vessels) {
    const p = positionAt(v, at);
    if (!p) continue;
    const d = extent.length ? distanceToOil(p, extent) : Infinity;
    if (!Number.isFinite(d) || d > radiusKm) continue;

    // Speed and course at the nearest report, rather than interpolated: these
    // are reported values, and inventing intermediate ones would be inventing
    // AIS.
    let nearest = v.points[0];
    for (const q of v.points) {
      if (Math.abs(q.t - at) < Math.abs(nearest.t - at)) nearest = q;
    }

    contacts.push({
      mmsi: v.mmsi,
      label: labelFor(v, run),
      kind: v.kind,
      position: p,
      sog: nearest.sog,
      cog: nearest.cog,
      distanceKm: d,
      candidate: candidateIds.has(v.mmsi),
      source: run.suspects.some((s) => s.id === v.mmsi && s.isTruth),
    });
  }

  contacts.sort((a, b) => a.distanceKm - b.distanceKm);

  return {
    hour,
    at,
    phase,
    release,
    releasedFraction: release?.releasedFraction ?? 0,
    areaKm2: release?.areaKm2 ?? 0,
    sinceStart: hour - run.releaseStartHour,
    contacts,
    inContact: contacts.filter((c) => c.distanceKm <= 0.001).length,
  };
}

/** The full span the event playback covers, first parcel to forecast horizon. */
export function eventSpan(run: Run): [number, number] {
  return [
    Math.min(run.releaseStartHour, -run.drift.backwardHours),
    run.drift.forwardHours,
  ];
}

/** Growth curve for the whole event, for the designs that chart it. */
export function growthCurve(run: Run): { hour: number; areaKm2: number; released: number }[] {
  return run.release.map((f) => ({
    hour: f.hour,
    areaKm2: f.areaKm2,
    released: f.releasedFraction,
  }));
}
