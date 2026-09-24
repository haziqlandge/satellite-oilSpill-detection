/**
 * Which of a run's detection polygons the map draws: the seed alone.
 *
 * A real run's detection is everything the model found in the whole Sentinel-1
 * scene -- 40 to 240 detections, most of their area masks that filled their
 * inference box (ISSUES Q5, F18) -- and only one of them, the seed, was
 * drifted. The map draws that one and nothing else. It used to offer four
 * views (focus / seed only / no boxes / all); the user asked for seed only and
 * the switch was removed on 2026-09-24. Nothing is deleted from the run: the
 * provenance still counts every detection and polygon. An authored scenario
 * has one slick and no part kinds, and all of it is drawn.
 */

import type { Detection } from "../sim/types";

export interface DetectionFeature {
  ring: Detection["parts"][number];
  confidence: number;
}

/** The polygons the map draws, each with its own confidence. */
export function detectionFeatures(detection: Detection): DetectionFeature[] {
  const kinds = detection.partKinds;
  const out: DetectionFeature[] = [];
  detection.parts.forEach((ring, i) => {
    if (kinds && kinds[i] !== "seed") return;
    out.push({ ring, confidence: detection.partConfidence?.[i] ?? detection.confidence });
  });
  return out;
}
