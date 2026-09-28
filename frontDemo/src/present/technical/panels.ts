/**
 * Pure pieces of the journey's panels, kept out of the scene so the checks can
 * hold them: where the drift view's side cards stand, and what Measure says.
 */

/**
 * The drift view's map: the left of the content box. Its cards get their own
 * column on the right so they never sit on the particles, the origin area or
 * the tracks (the user, 2026-09-27).
 */
export const DRIFT_MAP = { x: 100, y: 205, w: 1300, h: 830 } as const;

/**
 * The drift view's side cards, top of the right column, where the clock used
 * to be (the user, 2026-09-27). Weather Data pops the weather card here;
 * Hindcast pushes it down and the hours card grows in its place; Gate swaps
 * both for the traffic card.
 */
export const DRIFT_CARDS = (() => {
  const x = 1440;
  const w = 380;
  const top = 225;
  const hourH = 214;
  const forcingH = 216;
  const gap = 16;
  return { x, w, top, hourH, forcingH, gap, gateH: 246, pillH: 58, forcingTop: top, forcingPushed: top + hourH + gap };
})();

export interface MeasureInput {
  areaKm2: number;
  lengthKm: number;
  widthMMean: number;
  dampingRatioDb: number;
}

export interface AgeHours {
  low: number | null;
  best: number | null;
  high: number | null;
}

const fix = (v: number | null | undefined, dp: number) => (v == null ? "?" : v.toFixed(dp));
const trim = (v: number | null | undefined) => (v == null ? "?" : Number(v.toFixed(1)).toString());

/**
 * Measure's callouts, top to bottom: the upper end of the slick, what the
 * outline measures, the age window, the lower end. Each names its quantity.
 * No depth: SAR sees the surface only, and damping is a contrast, not a thickness.
 */
export function measureRows(c: MeasureInput, age: AgeHours, tailOnTop: boolean): { name: string; value: string; tone?: string }[] {
  return [
    { name: tailOnTop ? "Tail" : "Head", value: "" },
    { name: "Area", value: `${fix(c.areaKm2, 1)} km²` },
    { name: "Length", value: `${fix(c.lengthKm, 2)} km` },
    { name: "Width", value: `${Math.round(c.widthMMean)} m` },
    { name: "Damping", value: `${fix(Math.abs(c.dampingRatioDb), 2)} dB` },
    {
      name: "Age",
      value: age.best == null ? "not resolved" : `${trim(age.low)} to ${trim(age.high)} h, best ${trim(age.best)} h`,
      tone: "pt-callout-red",
    },
    { name: tailOnTop ? "Head" : "Tail", value: "" },
  ];
}
