/**
 * Turning a real uploaded raster into a scene the console can run.
 *
 * Three things have to come from somewhere before an upload can be drifted at
 * all, and exactly one of them is in the pixels:
 *
 *  - **the outline.** Measured, by the dark-region screen in `ingest.ts`
 *  - **the acquisition time.** Read from the file name when it is a Sentinel-1
 *    product, asked for otherwise. Without it there is no wind field, no AIS
 *    window and no honest time axis, and a guess would poison all three
 *  - **where on Earth it is.** The corpus tiles are NOT georeferenced -- DATA.md
 *    records Part I as carrying no geotransform -- so for those it cannot be
 *    derived and the operator asserts it. Every run built here is stamped with
 *    that fact
 *
 * Everything downstream of those three is the same simulation the authored
 * scenarios use, and it says so. What is NEW is that the geometry being drifted
 * is the operator's own image rather than a preset: the ribbon, its bearing, its
 * length, its widths and its damping ratio are all measured off the raster they
 * uploaded.
 *
 * WHAT IS NOT CLAIMED. The class is `slick_unknown`, never `oos`. A threshold
 * screen cannot separate oil from a natural film -- the project's own research
 * concluded that SAR intensity alone is unreliable for exactly this -- and the
 * release weights carry one class. Calling an uploaded dark region an
 * operational discharge would be the system asserting the thing it is built to
 * be careful about.
 */

import { bearingDeg, distanceKm, kmPerDegLon, KM_PER_DEG_LAT } from "./geo";
import type { ScenarioSpec } from "./scenarios";
import type { SlickGeometry } from "./slick";
import type { LngLat } from "./types";
import { DB_WINDOW, type Ribbon } from "./ingest";

export interface UploadAssertions {
  /** Scene centre. Asserted by the operator unless the raster is georeferenced. */
  centre: LngLat;
  /** Ground width of the whole image, km. Asserted. */
  acrossKm: number;
  /** Acquisition instant, ms since epoch. */
  acquiredAt: number;
  /** Where the time came from, so the run can say. */
  acquisitionSource: "filename" | "operator";
  /** Where the position came from. Only ever "operator" until GeoTIFF lands. */
  positionSource: "operator" | "geotiff";
  fileName: string;
}

/** Ground length of a projected path, km. */
function pathKm(points: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceKm(points[i - 1], points[i]);
  return total;
}

/**
 * The ribbon's width at a fraction along its axis, in metres.
 *
 * The ring is `lo` forward then `hi` reversed, so the point opposite index `i`
 * is `ring.length - 2 - i`. Measuring rather than assuming a head and tail
 * width is what makes the width profile in the detect pane describe the image
 * the operator actually uploaded.
 */
function widthAtM(ring: LngLat[], fraction: number): number {
  const half = Math.floor((ring.length - 1) / 2);
  if (half < 2) return 0;
  const i = Math.max(0, Math.min(half - 1, Math.round(fraction * (half - 1))));
  const opposite = ring.length - 2 - i;
  if (opposite <= i || opposite >= ring.length) return 0;
  return distanceKm(ring[i], ring[opposite]) * 1000;
}

export function buildUploadSpec(ribbon: Ribbon, a: UploadAssertions): ScenarioSpec {
  // The ring is normalised by image WIDTH, so x spans 0..1 and y spans
  // 0..aspect. One scale for both axes therefore keeps the shape.
  const kmPerUnit = a.acrossKm;
  const originX = 0.5;
  const originY =
    ribbon.ring.reduce((s, p) => s + p[1], 0) / Math.max(1, ribbon.ring.length);
  const project = (p: [number, number]): LngLat => [
    a.centre[0] + ((p[0] - originX) * kmPerUnit) / kmPerDegLon(a.centre[1]),
    // Image y grows downward; latitude grows upward.
    a.centre[1] - ((p[1] - originY) * kmPerUnit) / KM_PER_DEG_LAT,
  ];

  const ring = ribbon.ring.map(project);
  const axis = ribbon.axis.map(project);
  const geometry: SlickGeometry = {
    parts: [ring],
    centreline: axis,
    head: axis[0],
    tail: axis[axis.length - 1],
  };

  const lengthKm = Math.max(0.4, pathKm(axis));
  const headWidthM = Math.max(40, widthAtM(ring, 0.08));
  const tailWidthM = Math.max(40, widthAtM(ring, 0.92));

  /*
    A real damping ratio, in dB, from the grey levels.

    The corpus is rendered through a fixed window, so a grey value carries a dB
    value and a difference of means is a difference in backscatter. It is a
    contrast index between the slick and the water around it and nothing more --
    not a thickness and not a volume, for the reason the detect pane already
    states at length.

    The caveat that travels with it: Refined SOS tiles were pre-scaled by their
    authors under an unknown rule (DATA.md D6), so for those the dB figure is
    the window's arithmetic rather than a calibrated measurement. The provenance
    string says the window was assumed.
  */
  const [dbLow, dbHigh] = DB_WINDOW;
  const perGrey = (dbHigh - dbLow) / 255;
  const dampingRatioDb = +((ribbon.meanInside - ribbon.meanOutside) * perGrey).toFixed(2);

  const centre = a.centre;
  const assertedPosition = a.positionSource === "operator";
  const provenance =
    "SIM · Outline, bearing, length, widths and damping ratio are MEASURED from the " +
    `uploaded raster by a dark-region threshold screen (Otsu cut at grey ${ribbon.threshold}, ` +
    `covering ${(ribbon.coverage * 100).toFixed(2)}% of the frame). That screen is NOT the ` +
    "trained segmenter and this is not a detection: intensity alone cannot separate oil from a " +
    "natural film, so the class is slick_unknown. The dB figure assumes the corpus window " +
    `${dbLow} to ${dbHigh} dB. Acquisition time ${a.acquisitionSource === "filename" ? "parsed from the file name" : "asserted by the operator"}. ` +
    (assertedPosition
      ? "POSITION ASSERTED BY OPERATOR — the raster carries no georeferencing, so the map location and scale are stated, not measured. "
      : "Position read from the raster's georeferencing. ") +
    "Drift field, AIS traffic, infrastructure and all scores are simulated.";

  return {
    geometry,
    meta: {
      id: "upload",
      name: "Uploaded image",
      region: "gulf-of-mexico",
      provenance,
      acquiredAtIso: new Date(a.acquiredAt).toISOString(),
      centre,
      zoom: 10.4,
      sceneId: a.fileName.replace(/\.[^.]+$/, "").slice(0, 48) || "UPLOAD",
      place: assertedPosition ? "an operator-asserted position" : "the raster's own position",
      summary:
        `A ${lengthKm.toFixed(1)} km dark region traced from the uploaded raster, drifted ` +
        "backward 36 h and forward 72 h through a simulated field.",
      tests: "The geometry is the operator's image; everything downstream is simulated.",
      expectedTop1: "No ground truth: an uploaded scene has no authored answer to check against.",
    },
    field: {
      meanU: 0.04,
      meanV: -0.025,
      tideMs: 0.015,
      tidePhaseHours: 0,
      windMs: 5.4,
      windDirDeg: 285,
      windRotateDegPerHour: 0.08,
      eddy: { centre, radiusKm: 26, strengthMs: 0.04 },
      convergence: { centre, radiusKm: 17, strengthMs: 0.025 },
    },
    release: geometry.head,
    releaseShape: "building",
    releaseAgeHours: 12,
    ongoing: true,
    slick: {
      axisDeg: bearingDeg(geometry.head, geometry.tail),
      lengthKm,
      headWidthM,
      tailWidthM,
      meanderKm: 0.1,
      fragments: 1,
      // Never `oos`. See the header.
      className: "slick_unknown",
      // The screen's contrast separation, not a model score.
      confidence: +ribbon.separation.toFixed(2),
      dampingRatioDb,
    },
    drift: {
      backwardHours: 36,
      forwardHours: 72,
      ensembleSize: 12,
      perMember: 320,
      diffusivity: 0.55,
      diffuseThresholdKm2: 600,
    },
    traffic: {
      vesselCount: 160,
      corridors: [
        { from: [centre[0] - 1.1, centre[1] - 0.22], to: [centre[0] + 1.0, centre[1] + 0.2], widthKm: 8 },
        { from: [centre[0] - 0.28, centre[1] + 0.85], to: [centre[0] + 0.12, centre[1] - 0.8], widthKm: 6 },
      ],
    },
    infrastructure: [
      { id: "upload-installation", label: "Offshore installation (sim)", position: geometry.tail },
    ],
    infrastructureCoverage: "partial",
    // Nobody is the authored source, because nobody authored this scene. The
    // candidates below it are simulated traffic, ranked on the same terms as
    // everywhere else, and none of them is a known answer.
    source: { type: "none" },
  };
}
