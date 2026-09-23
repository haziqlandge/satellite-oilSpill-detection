import geometry from "./sampleGeometry.json";
import { bearingDeg, centroid, kmPerDegLon, KM_PER_DEG_LAT } from "./geo";
import type { ScenarioListing, ScenarioSpec } from "./scenarios";
import type { LngLat } from "./types";
import type { SlickGeometry } from "./slick";
import { DEMO_SAMPLE_KEYS, type DemoSampleKey } from "../site/demoData";

export function isSample(id: string | null): id is DemoSampleKey {
  return DEMO_SAMPLE_KEYS.some((key) => key === id);
}

export const SAMPLE_LISTINGS: ScenarioListing[] = DEMO_SAMPLE_KEYS.map((id, i) => ({
  id, name: `Sample ${i + 1}`, short: "Image reconstruction · −36 h to +72 h",
  region: i === 0 ? "gulf-of-mexico" : i === 1 ? "indian-waters" : "south-china-sea", tests: "Model-segmented outline, drift ensemble and simulated vessel evidence.",
}));

function sampleSpec(id: DemoSampleKey, index: number): ScenarioSpec {
  // The input has no georeferencing. Assign an explicit demo location in deep
  // open Gulf water, far from either shore, with a consistent isotropic scale.
  // Three separate open-water theatres so changing the unlocked animation is
  // visibly a new case, rather than the same Gulf scene with a small offset.
  const centres: LngLat[] = [[-90.1, 25.6], [67.8, 17.8], [114.7, 12.6]];
  const centre: LngLat = centres[index];
  const raw = geometry[id];
  const origin = centroid(raw.ring as LngLat[]);
  const span = Math.max(
    Math.max(...raw.ring.map(p => p[0])) - Math.min(...raw.ring.map(p => p[0])),
    Math.max(...raw.ring.map(p => p[1])) - Math.min(...raw.ring.map(p => p[1])),
  );
  const scaleKm = [12, 8, 6][index] / span;
  const project = (p: number[]): LngLat => [
    centre[0] + (p[0] - origin[0]) * scaleKm / kmPerDegLon(centre[1]),
    centre[1] - (p[1] - origin[1]) * scaleKm / KM_PER_DEG_LAT,
  ];
  const axis = raw.axis.map(project);
  const geom: SlickGeometry = {
    parts: [raw.ring.map(project)], centreline: axis,
    head: axis[0], tail: axis[axis.length - 1],
  };
  return {
    geometry: geom,
    meta: {
      id, name: `Sample ${index + 1}`, region: index === 0 ? "gulf-of-mexico" : index === 1 ? "indian-waters" : "south-china-sea", place: ["Open Gulf of Mexico", "Arabian Sea", "South China Sea"][index],
      provenance: "SIM · Outline segmented from the supplied sample image by the trained model (L1-ciou research release). Ocean location, scale, forcing, AIS and timings are simulated; the image has no georeferencing.",
      acquiredAtIso: "2026-09-10T06:00:00Z", centre, zoom: 9.8,
      sceneId: `SAMPLE-${index + 1}-SAR`,
      summary: "Image-derived oil ribbon with 36-hour reconstruction and 72-hour drift forecast.",
      tests: "All views share the image-derived mask, hourly ensemble and simulated traffic.",
      expectedTop1: "Candidate ranking computed from simulated origin-field intersections.",
    },
    field: {
      meanU: 0.045 + index * 0.01, meanV: -0.03, tideMs: 0.015,
      tidePhaseHours: index * 2, windMs: 3.2 + index * 0.3,
      windDirDeg: 285 + index * 15, windRotateDegPerHour: 0.08,
      eddy: { centre, radiusKm: 28, strengthMs: 0.04 },
      convergence: { centre, radiusKm: 18, strengthMs: 0.02 },
    },
    release: geom.head, releaseAgeHours: 12, ongoing: true,
    // One shape each, so the three samples do not replay the same straight
    // accumulation line. Sample 2's release window is an hour long, which is
    // too short for a rate profile to be visible in it, so it stays steady
    // rather than being given a shape it cannot show.
    releaseShape: (["building", "steady", "pulsed"] as const)[index],
    slick: {
      axisDeg: 110, lengthKm: [12, 8, 6][index], headWidthM: 150,
      tailWidthM: 450, meanderKm: 0.1, fragments: 1,
      className: "oos", confidence: 0.9 - index * 0.02, dampingRatioDb: -6.1,
    },
    drift: {
      backwardHours: 36, forwardHours: 72, ensembleSize: 12, perMember: 320,
      diffusivity: 0.55, diffuseThresholdKm2: 600,
    },
    traffic: {
      vesselCount: [140, 210, 95][index],
      corridors: index === 0
        ? [
            { from: [centre[0] - 1.2, centre[1] - 0.25], to: [centre[0] + 1.1, centre[1] + 0.18], widthKm: 9 },
            { from: [centre[0] - 0.3, centre[1] + 0.9], to: [centre[0] + 0.1, centre[1] - 0.8], widthKm: 6 },
          ]
        : index === 1
          ? [
              { from: [centre[0] - 0.15, centre[1] - 1.2], to: [centre[0] + 0.35, centre[1] + 1.1], widthKm: 5 },
              { from: [centre[0] - 1.2, centre[1] + 0.7], to: [centre[0] + 1.1, centre[1] + 0.1], widthKm: 12 },
              { from: [centre[0] - 0.9, centre[1] - 0.9], to: [centre[0] + 0.8, centre[1] - 0.3], widthKm: 7 },
            ]
          : [
              { from: [centre[0] - 1.3, centre[1] + 0.7], to: [centre[0] + 1.2, centre[1] - 0.7], widthKm: 10 },
              { from: [centre[0] - 0.4, centre[1] - 1.2], to: [centre[0] + 0.5, centre[1] + 1.2], widthKm: 4 },
            ],
    },
    infrastructure: [{ id: `${id}-buoy`, label: "Offshore service installation (sim)", position: geom.tail }],
    infrastructureCoverage: "partial",
    source: index === 0
      ? { type: "berthed", approachBearingDeg: 260, approachKm: 18, mooredHoursBefore: 20, kind: "service tanker", lengthM: 165 }
      : index === 1
        ? { type: "moving", courseDeg: bearingDeg(geom.head, geom.tail), sogKn: 2.15, durationHours: 2, kind: "product tanker", lengthM: 190 }
        : { type: "dark", lengthM: 178 },
  };
}

export const SAMPLE_SPECS = Object.fromEntries(
  DEMO_SAMPLE_KEYS.map((id, index) => [id, sampleSpec(id, index)]),
) as Record<DemoSampleKey, ScenarioSpec>;
