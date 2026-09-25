/**
 * The region registry (PHASE-10): the zones the console knows, each with its
 * extent and what is and is not verified there. Shared with the backend
 * (`backend/regions.py`), so the two can never disagree about a box.
 *
 * Every evidence card in a zone carries its caveats (`zoneCaveats`): the
 * installation layer's coverage -- a missing platform turns a leak into a
 * false vessel accusation -- and whether the wind-gate bounds were validated
 * for its wind climate. None is, yet, and the cards say so.
 */

import registry from "./regions.json";
import type { LngLat } from "./types";

type Box = [west: number, south: number, east: number, north: number];

export interface Zone {
  id: string;
  label: string;
  kind: "validation" | "demonstration" | "sample";
  aoi: Box;
  landmask?: Box;
  aisFootprint?: Box;
  ais: string;
  forcing: string;
  infrastructure: { coverage: "complete" | "partial"; note: string };
  windGate: { validated: boolean; note: string };
}

export const ZONES = registry.regions as Zone[];

/** The first zone whose AOI holds `p`, or null outside them all. */
export function zoneOf(p: LngLat): Zone | null {
  return ZONES.find(({ aoi: [w, s, e, n] }) => p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n) ?? null;
}

/** What an evidence card must say about where it is (PHASE-10): coverage gaps and unvalidated wind-gate bounds. */
export function zoneCaveats(zone: Zone | null): string[] {
  if (!zone) {
    return ["This place is outside every configured zone: no installation coverage or wind-gate validation is recorded for it."];
  }
  return [
    ...(zone.infrastructure.coverage === "partial" ? [`${zone.label}: ${zone.infrastructure.note}`] : []),
    ...(zone.windGate.validated ? [] : [`${zone.label}: ${zone.windGate.note}`]),
  ];
}
