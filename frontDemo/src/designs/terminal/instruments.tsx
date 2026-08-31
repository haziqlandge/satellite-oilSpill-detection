/**
 * TERMINAL's instruments.
 *
 * These are not charts. A chart is a picture of a dataset made for a reader; an
 * instrument is a readout of a running process made for an operator, and the
 * difference shows in every decision here:
 *
 *  - no titles, no legends, no axis names. The frame the instrument sits in
 *    already said what it is, and repeating it costs a line of a pane that has
 *    forty rows to fit
 *  - the grid is drawn at a fixed pitch and clipped, like a graticule, rather
 *    than derived from "nice" tick values. An operator reads position against a
 *    reticle, not against labels
 *  - the current value is always marked and always numbered, because the whole
 *    point of the thing is where the process is *now*
 *  - everything is drawn in stroke. There are no filled areas except where the
 *    fill carries a meaning that a line cannot (a credible band, a gate window)
 *
 * The same numbers appear as annotated editorial exhibits in Signal. These are
 * a different picture of them, not a restyling of the same one.
 */

import { useId, useMemo } from "react";
import { formatHour, relHour } from "../../lib/format";
import { fieldHours, fieldProjection, ringPath } from "../../lib/project";
import { windGate } from "../../sim/slick";
import type { AnomalyFlag, LngLat, Run } from "../../sim/types";
import { TONE, type Tone } from "./components";

/* ------------------------------------------------------------------ *
 * Shared plot chrome
 * ------------------------------------------------------------------ */

/**
 * The reticle every instrument sits on.
 *
 * A fixed-pitch grid rather than one tick per data value: this is the same
 * decision as the map's 0.1 degree graticule, and for the same reason. A grid
 * that moves when the data changes cannot be read as a reference.
 */
function Reticle({
  w,
  h,
  stepX = 40,
  stepY = 20,
}: {
  w: number;
  h: number;
  stepX?: number;
  stepY?: number;
}) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = 0; x <= w; x += stepX) xs.push(x);
  for (let y = 0; y <= h; y += stepY) ys.push(y);
  return (
    <g aria-hidden stroke="var(--line)" strokeWidth={0.5} opacity={0.85}>
      {xs.map((x) => (
        <line key={`x${x}`} x1={x} y1={0} x2={x} y2={h} />
      ))}
      {ys.map((y) => (
        <line key={`y${y}`} x1={0} y1={y} x2={w} y2={y} />
      ))}
    </g>
  );
}

function Tick({
  x,
  y,
  children,
  anchor = "middle",
  tone = "faint",
  size = 8,
}: {
  x: number;
  y: number;
  children: string;
  anchor?: "start" | "middle" | "end";
  tone?: Tone;
  /** Instruments that carry a caption band set it a step smaller than a tick. */
  size?: number;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: size,
        letterSpacing: "0.06em",
        fill: TONE[tone],
      }}
    >
      {children}
    </text>
  );
}

/* ------------------------------------------------------------------ *
 * Convergence
 * ------------------------------------------------------------------ */

const CONV_W = 320;
const CONV_H = 120;

/**
 * Area of the 90% origin contour against hours before the acquisition.
 *
 * This is the measurement the age estimate and the insufficient-evidence rule
 * are both written against, so it is published as it comes out of the model:
 * not smoothed, not clipped to look like a clean basin. When the curve has no
 * minimum inside the horizon, the interface has to say the field never
 * converged, and the operator should be able to see that themselves.
 *
 * The shaded band is the reported release window `[-high, -low]`. The dashed
 * vertical is the best estimate. Both are drawn from `drift.ageHours`, never
 * from a scalar recomputed here.
 */
export function ConvergencePlot({ run }: { run: Run }) {
  const c = run.drift.convergence;
  const [lo, best, hi] = run.drift.ageHours;

  const { pts, minPt, xAt, yAt, maxArea } = useMemo(() => {
    const hours = c.map((p) => p.hour);
    const h0 = Math.min(...hours);
    const h1 = Math.max(...hours);
    const areas = c.map((p) => p.area90Km2);
    const aMax = Math.max(...areas, 1);
    const fx = (hour: number) =>
      ((hour - h0) / Math.max(1e-6, h1 - h0)) * CONV_W;
    // Linear, not logarithmic. The claim the plot supports is "this contour is
    // four times the area of that one", and a log axis quietly flattens exactly
    // that comparison.
    const fy = (area: number) => CONV_H - (area / aMax) * (CONV_H - 8) - 4;
    let low = c[0];
    for (const p of c) if (p.area90Km2 < low.area90Km2) low = p;
    return {
      pts: c.map((p) => [fx(p.hour), fy(p.area90Km2)] as const),
      minPt: low,
      xAt: fx,
      yAt: fy,
      maxArea: aMax,
    };
  }, [c]);

  if (!c.length) return null;

  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const bandX0 = xAt(-hi);
  const bandX1 = xAt(-lo);

  return (
    <svg
      viewBox={`0 0 ${CONV_W} ${CONV_H + 14}`}
      className="w-full"
      role="img"
      aria-label={`Area of the 90 percent origin contour against hours before acquisition, minimum ${minPt.area90Km2.toFixed(1)} square kilometres at ${minPt.hour} hours`}
    >
      <Reticle w={CONV_W} h={CONV_H} stepX={CONV_W / 8} stepY={CONV_H / 4} />

      {/* Reported release window. Filled, because a credible interval is the
          one thing on this plot that is genuinely an area rather than a line. */}
      <rect
        x={Math.min(bandX0, bandX1)}
        y={0}
        width={Math.abs(bandX1 - bandX0)}
        height={CONV_H}
        fill="var(--accent)"
        opacity={0.1}
      />
      <line
        x1={xAt(-best)}
        y1={0}
        x2={xAt(-best)}
        y2={CONV_H}
        stroke="var(--accent)"
        strokeWidth={1}
        strokeDasharray="3 3"
        opacity={0.8}
      />

      <path d={d} fill="none" stroke="var(--ink)" strokeWidth={1.1} />

      <g>
        <circle
          cx={xAt(minPt.hour)}
          cy={yAt(minPt.area90Km2)}
          r={3}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.2}
        />
        <Tick
          x={xAt(minPt.hour)}
          y={Math.max(10, yAt(minPt.area90Km2) - 6)}
          tone="ok"
        >
          {`${minPt.area90Km2.toFixed(0)} km2`}
        </Tick>
      </g>

      <Tick x={0} y={CONV_H + 10} anchor="start">
        {`${relHour(c[0].hour)} h`}
      </Tick>
      <Tick x={CONV_W} y={CONV_H + 10} anchor="end">
        {`${relHour(c[c.length - 1].hour)} h`}
      </Tick>
      <Tick x={CONV_W / 2} y={CONV_H + 10} tone="ok">
        {`window ${lo}-${hi} h`}
      </Tick>
      <Tick x={2} y={10} anchor="start">
        {`${maxArea.toFixed(0)} km2`}
      </Tick>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Ensemble spread
 * ------------------------------------------------------------------ */

const SPREAD_W = 320;
const SPREAD_H = 54;

/**
 * Mean particle distance from the cloud centroid, per backward hour.
 *
 * Sits under the convergence plot on the same horizontal scale, so the two read
 * as one instrument with two traces. The playhead is drawn on both: an operator
 * scrubbing the timeline should be able to see where the current hour sits on
 * the curve that decides the age.
 */
export function SpreadPlot({ run, hour }: { run: Run; hour: number }) {
  const c = run.drift.convergence;
  if (!c.length) return null;

  const hours = c.map((p) => p.hour);
  const h0 = Math.min(...hours);
  const h1 = Math.max(...hours);
  const sMax = Math.max(...c.map((p) => p.spreadKm), 1);
  const fx = (h: number) => ((h - h0) / Math.max(1e-6, h1 - h0)) * SPREAD_W;
  const fy = (s: number) => SPREAD_H - (s / sMax) * (SPREAD_H - 6) - 3;
  const d = c
    .map((p, i) => `${i === 0 ? "M" : "L"}${fx(p.hour).toFixed(1)},${fy(p.spreadKm).toFixed(1)}`)
    .join(" ");
  const px = fx(Math.max(h0, Math.min(h1, hour)));

  return (
    <svg
      viewBox={`0 0 ${SPREAD_W} ${SPREAD_H}`}
      className="w-full"
      role="img"
      aria-label="Ensemble spread in kilometres against hours before acquisition"
    >
      <Reticle w={SPREAD_W} h={SPREAD_H} stepX={SPREAD_W / 8} stepY={SPREAD_H / 2} />
      <path d={d} fill="none" stroke="var(--ink-dim)" strokeWidth={1} />
      <line
        x1={px}
        y1={0}
        x2={px}
        y2={SPREAD_H}
        stroke="var(--accent)"
        strokeWidth={1}
      />
      <Tick x={2} y={9} anchor="start">
        {`spread ${sMax.toFixed(0)} km`}
      </Tick>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Origin field, as a scope
 * ------------------------------------------------------------------ */

const SCOPE = 260;

/**
 * The backward field, drawn as a contracting stack on a scope.
 *
 * One outline per backward hour, oldest faintest, over a centred reticle. This
 * is the honest picture of what a backward ensemble produces (C5): a stack of
 * credible regions that widens with time, never a trajectory. There is
 * deliberately no line joining the rings, because a line between them is
 * exactly the false object this figure exists to avoid drawing.
 */
export function FieldScope({ run, hour }: { run: Run; hour: number }) {
  const hours = useMemo(() => fieldHours(run, 7), [run]);
  const proj = useMemo(
    () => fieldProjection(run, SCOPE, SCOPE, hours, 1.22),
    [run, hours],
  );

  const rounded = Math.round(hour);
  const live =
    run.drift.frames.find((f) => f.hour === rounded) ?? run.drift.frames[0];

  return (
    <svg
      viewBox={`0 0 ${SCOPE} ${SCOPE}`}
      className="w-full"
      role="img"
      aria-label="Stack of 90 percent credible origin regions, one per backward hour, contracting toward the estimated release"
    >
      <rect width={SCOPE} height={SCOPE} fill="var(--base)" />
      <Reticle w={SCOPE} h={SCOPE} stepX={SCOPE / 8} stepY={SCOPE / 8} />

      {/* Range rings and crosshair: scope furniture, so the stack is read as a
          field over ground rather than as a set of abstract blobs. */}
      <g stroke="var(--line)" fill="none" strokeWidth={0.6}>
        {[0.18, 0.34, 0.5].map((r) => (
          <circle key={r} cx={SCOPE / 2} cy={SCOPE / 2} r={SCOPE * r} />
        ))}
        <line x1={SCOPE / 2} y1={0} x2={SCOPE / 2} y2={SCOPE} />
        <line x1={0} y1={SCOPE / 2} x2={SCOPE} y2={SCOPE / 2} />
      </g>

      {hours.map((h, i) => {
        const frame = run.drift.frames.find((f) => f.hour === h);
        if (!frame) return null;
        const fade = 0.2 + (i / Math.max(1, hours.length - 1)) * 0.55;
        return (
          <g key={h}>
            {frame.contour90.map((ring, j) => (
              <path
                key={j}
                d={ringPath(ring, proj)}
                fill="none"
                stroke="var(--contour, var(--ink-dim))"
                strokeWidth={0.8}
                opacity={fade}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        );
      })}

      {/* The hour the operator is actually on, picked out of the stack. */}
      {live?.contour90.map((ring, j) => (
        <path
          key={`live90-${j}`}
          d={ringPath(ring, proj)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.1}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {live?.contour50.map((ring, j) => (
        <path
          key={`live50-${j}`}
          d={ringPath(ring, proj)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.4}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {/* The detection itself, for scale. */}
      {run.detection.parts.map((ring, j) => (
        <path
          key={`det-${j}`}
          d={ringPath(ring, proj)}
          fill="var(--ink)"
          fillOpacity={0.16}
          stroke="var(--ink)"
          strokeWidth={0.8}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      <Tick x={4} y={10} anchor="start" tone="ok">
        {`T${rounded <= 0 ? "" : "+"}${rounded}h  50% ${live ? live.area50Km2.toFixed(1) : "--"} km2`}
      </Tick>
      <Tick x={4} y={SCOPE - 4} anchor="start">
        {`stack ${relHour(hours[0])}..${relHour(hours[hours.length - 1])} h  90% band`}
      </Tick>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Wind gate
 * ------------------------------------------------------------------ */

const GATE_W = 320;
const GATE_H = 64;

/**
 * The wind gate as a continuous transfer function, with the sample marked.
 *
 * C9 forbids a silent hard cut, and the reason is visible here: both edges are
 * ramps, not steps. Under about 2 m/s the sea is flat whether or not there is
 * oil on it; over about 13 m/s the oil is mixed down and the contrast is gone.
 * Between those the detection is kept and its confidence is scaled, which is
 * what the multiplier does to every score downstream.
 */
export function WindGatePlot({ ms, value }: { ms: number; value: number }) {
  const max = 16;
  const pts = Array.from({ length: 97 }, (_, i) => {
    const v = (i / 96) * max;
    return [
      (v / max) * GATE_W,
      GATE_H - windGate(v) * (GATE_H - 8) - 4,
    ] as const;
  });
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(" ");
  const x = (Math.min(ms, max) / max) * GATE_W;
  const y = GATE_H - value * (GATE_H - 8) - 4;

  return (
    <svg
      viewBox={`0 0 ${GATE_W} ${GATE_H + 12}`}
      className="w-full"
      role="img"
      aria-label={`Wind gate transfer function. At ${ms.toFixed(1)} metres per second the multiplier is ${value.toFixed(2)}`}
    >
      <Reticle w={GATE_W} h={GATE_H} stepX={GATE_W / 8} stepY={GATE_H / 2} />
      <path d={d} fill="none" stroke="var(--ink-dim)" strokeWidth={1} />
      <line
        x1={x}
        y1={0}
        x2={x}
        y2={GATE_H}
        stroke={value < 0.5 ? "var(--warn)" : "var(--accent)"}
        strokeWidth={1}
      />
      <circle
        cx={x}
        cy={y}
        r={2.6}
        fill={value < 0.5 ? "var(--warn)" : "var(--accent)"}
      />
      <Tick x={0} y={GATE_H + 9} anchor="start">
        0 m/s
      </Tick>
      <Tick x={GATE_W} y={GATE_H + 9} anchor="end">
        {`${max} m/s`}
      </Tick>
      <Tick
        x={Math.min(GATE_W - 30, Math.max(30, x))}
        y={GATE_H + 9}
        tone={value < 0.5 ? "warn" : "ok"}
      >
        {`${ms.toFixed(1)} -> x${value.toFixed(2)}`}
      </Tick>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Width profile
 * ------------------------------------------------------------------ */

const PROF_W = 320;
const PROF_H = 48;

/**
 * Width sampled perpendicular to the medial axis, head to tail.
 *
 * Drawn as a column plot rather than a curve, because the samples are discrete
 * measurements at stations along the axis and a smooth interpolation between
 * them would be inventing widths that were never sampled.
 */
export function WidthProfile({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const bw = PROF_W / values.length;
  return (
    <svg
      viewBox={`0 0 ${PROF_W} ${PROF_H + 11}`}
      className="w-full"
      role="img"
      aria-label="Slick width profile from head to tail"
    >
      <Reticle w={PROF_W} h={PROF_H} stepX={PROF_W / 8} stepY={PROF_H / 2} />
      {values.map((v, i) => {
        const h = (v / max) * (PROF_H - 3);
        return (
          <rect
            key={i}
            x={i * bw + 0.5}
            y={PROF_H - h}
            width={Math.max(0.8, bw - 1)}
            height={h}
            fill="var(--accent)"
            opacity={0.55}
          />
        );
      })}
      <Tick x={0} y={PROF_H + 9} anchor="start" tone="ok">
        head
      </Tick>
      <Tick x={PROF_W} y={PROF_H + 9} anchor="end">
        tail
      </Tick>
      <Tick x={PROF_W / 2} y={PROF_H + 9}>
        {`max ${max.toFixed(0)} m`}
      </Tick>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Anomaly series
 * ------------------------------------------------------------------ */

const ANOM_W = 320;
const ANOM_H = 44;

/**
 * The series behind a behaviour flag.
 *
 * C7: a raw gap is not evidence, and neither is a composite anomaly number with
 * nothing under it. Every flag carries the series that raised it, so the flag
 * is drawn with the series and never without. Where the flag has an `expected`
 * value -- the reception density the region actually supports -- it is ruled
 * across the plot, because a gap only means something against what the region
 * normally delivers.
 */
export function AnomalySeries({ flag }: { flag: AnomalyFlag }) {
  const s = flag.series;
  if (s.length < 2) return null;
  const ts = s.map((p) => p.t);
  const vs = s.map((p) => p.v);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const vMax = Math.max(...vs, flag.expected ?? 0, 1);
  const fx = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * ANOM_W;
  const fy = (v: number) => ANOM_H - (v / vMax) * (ANOM_H - 6) - 3;
  const d = s
    .map((p, i) => `${i === 0 ? "M" : "L"}${fx(p.t).toFixed(1)},${fy(p.v).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${ANOM_W} ${ANOM_H}`}
      className="w-full"
      role="img"
      aria-label={`${flag.seriesLabel} for the flag ${flag.label}`}
    >
      <Reticle w={ANOM_W} h={ANOM_H} stepX={ANOM_W / 8} stepY={ANOM_H / 2} />
      {flag.expected !== undefined && (
        <>
          <line
            x1={0}
            y1={fy(flag.expected)}
            x2={ANOM_W}
            y2={fy(flag.expected)}
            stroke="var(--warn)"
            strokeWidth={0.8}
            strokeDasharray="4 3"
          />
          <Tick x={ANOM_W} y={Math.max(8, fy(flag.expected) - 3)} anchor="end" tone="warn">
            {`expected ${flag.expected.toFixed(2)}`}
          </Tick>
        </>
      )}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1} />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Term contribution
 * ------------------------------------------------------------------ */

/**
 * A term's raw value and its weighted contribution on one axis.
 *
 * Two marks, not one: the hollow tick is what the term measured, the filled bar
 * is what it contributed after its weight. Showing only the second hides a
 * strong term that is weighted down; showing only the first hides that a
 * dominant-looking term barely moved the total. C4 wants both.
 */
export function TermBar({
  value,
  weight,
  tone = "ok",
}: {
  value: number;
  weight: number;
  tone?: Tone;
}) {
  const W = 120;
  const H = 10;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} aria-hidden>
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="var(--line)" strokeWidth={1} />
      <rect x={0} y={H / 2 - 2} width={v * weight * W * 3.34} height={4} fill={TONE[tone]} />
      <line
        x1={v * W}
        y1={0}
        x2={v * W}
        y2={H}
        stroke="var(--ink-dim)"
        strokeWidth={1}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Track plot
 * ------------------------------------------------------------------ */

/** The plotting square. The projection is fitted to this, not to the frame. */
const TRACK = 220;

/**
 * Header band: case identity and time direction.
 *
 * Both sit outside the plotting square so the projection arithmetic stays a
 * square and the labels cannot be mistaken for geometry.
 */
const TRACK_HEAD = 16;

/** Caption band: three lines of statement under the square. */
const TRACK_FOOT = 34;

/** A round number of kilometres no larger than the width the bar is allowed. */
function niceKm(km: number): number {
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  for (let i = steps.length - 1; i >= 0; i -= 1) if (steps[i] <= km) return steps[i];
  return steps[0];
}

/** Unweighted mean of every vertex. Enough to point an arrow with. */
function centroidOf(rings: LngLat[][]): LngLat | null {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const ring of rings) {
    for (const p of ring) {
      x += p[0];
      y += p[1];
      n += 1;
    }
  }
  return n ? [x / n, y / n] : null;
}

/**
 * A candidate's track against the origin field it was gated on.
 *
 * The matched segment -- the part of the track that was actually inside the
 * credible region at a matching hour -- is drawn heavier than the rest, because
 * that segment is the geometry the drift term was computed from and C4 requires
 * the evidence to carry the geometry that produced it.
 *
 * Three things here answer a reading failure rather than a data requirement,
 * and none of them should be removed as decoration:
 *
 *  - **the direction is stated.** `fieldHours` returns negative hours, so this
 *    is the *backward* origin field: it runs upstream, away from where the live
 *    map is forecasting the slick to go. Drawn without saying so, a reader
 *    scrubbing the map to T+8h sees two pictures pointing opposite ways and
 *    concludes one of them is wrong. Both are right, and a hindcast is supposed
 *    to run the other way -- so the header names the direction and the span it
 *    was fitted over (read off the hours actually drawn, never hard-coded), an
 *    arrow points upstream on the plot, and the caption says it in words
 *  - **the case is named.** The contour stack has a similar silhouette in every
 *    scenario, which makes a plot that is in fact refitted per run look like one
 *    static picture with different lines drawn on it. The scene id and a scale
 *    bar derived from the fitted projection both change with the case, so
 *    switching scenarios is visibly reflected rather than merely true
 *  - **the plot moves with the clock.** `hour` picks the origin contour for the
 *    hour the operator is on out of the stack, the same way `FieldScope` does.
 *    Past the acquisition there is no origin region to pick -- forward of T0 the
 *    ensemble is a forecast, not a hindcast -- so the plot says where the map
 *    has got to instead of drawing a contour that would mean something else
 *
 * `hour` is optional so the instrument still renders honestly with no clock
 * attached: the live marker is simply absent, and no caption claims otherwise.
 */
export function TrackScope({
  run,
  track,
  matched,
  position,
  hour,
}: {
  run: Run;
  track: LngLat[] | null;
  matched: LngLat[] | null;
  position: LngLat;
  /** Hours from the acquisition, off the console clock. Negative is backward. */
  hour?: number;
}) {
  // SVG ids are document-global, and this instrument can be mounted more than
  // once. `useId` emits colons, which are legal in an id but not in the
  // fragment syntax of a `url(#...)` reference in every engine.
  const clip = `tsclip-${useId().replace(/:/g, "")}`;
  const hours = useMemo(() => fieldHours(run, 4), [run]);
  const proj = useMemo(
    () => fieldProjection(run, TRACK, TRACK, hours, 1.3),
    [run, hours],
  );

  const H = TRACK_HEAD + TRACK + TRACK_FOOT;
  const oldest = hours[0];
  const newest = hours[hours.length - 1];

  const line = (pts: LngLat[]) =>
    pts
      .map((p, i) => {
        const [x, y] = proj.toXY(p);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const [px, py] = proj.toXY(position);

  /* --- the hour the operator is actually on ------------------------ */

  const rounded = hour === undefined ? null : Math.round(hour);
  // Only backward frames are origin regions. A frame at T+8h is the forward
  // forecast cloud, and drawing it in this figure would assert that the oil
  // came from where it is going -- which is the confusion this plot caused in
  // the first place.
  const live =
    rounded !== null && rounded <= 0
      ? (run.drift.frames.find((f) => f.hour === rounded) ?? null)
      : null;

  const nowLine =
    rounded === null
      ? null
      : rounded > 0
        ? `map at ${formatHour(rounded)} · forward of this stack`
        : live
          ? `now ${formatHour(rounded)} · 90% ${live.area90Km2.toFixed(0)} km2`
          : `now ${formatHour(rounded)} · outside this stack`;

  /* --- which way upstream is --------------------------------------- */

  const outerFrame = run.drift.frames.find((f) => f.hour === oldest) ?? null;
  const from = useMemo(() => centroidOf(run.detection.parts), [run]);
  const to = useMemo(
    () => (outerFrame ? centroidOf(outerFrame.contour90) : null),
    [outerFrame],
  );

  const arrow = (() => {
    if (!from || !to) return null;
    const [ax, ay] = proj.toXY(from);
    const [bx, by] = proj.toXY(to);
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    // Below this the two centroids are effectively coincident, and an arrow
    // would assert a direction the geometry does not carry.
    if (len <= 24) return null;
    const ux = dx / len;
    const uy = dy / len;
    return {
      x1: ax + ux * 8,
      y1: ay + uy * 8,
      x2: ax + ux * (len - 6),
      y2: ay + uy * (len - 6),
      mx: ax + ux * (len / 2) - uy * 7,
      my: ay + uy * (len / 2) + ux * 7,
    };
  })();

  /* --- scale, so the fit is legible as a distance ------------------- */

  const barKm = niceKm(60 * proj.kmPerUnit);
  const barUnits = barKm / proj.kmPerUnit;
  const barX2 = TRACK - 6;
  const barX1 = barX2 - barUnits;
  const barY = TRACK - 8;

  return (
    <svg
      viewBox={`0 0 ${TRACK} ${H}`}
      className="w-full"
      role="img"
      aria-label={
        `Backward origin field for scene ${run.meta.id}, ${formatHour(oldest)} to ` +
        `${formatHour(newest)}. This is a hindcast, so it runs upstream, opposite to ` +
        `the forward forecast on the live map. The candidate track is drawn over it, ` +
        `with the segment that fell inside the credible region at a matching hour ` +
        `drawn heavier.`
      }
    >
      <defs>
        <clipPath id={clip}>
          <rect x={0} y={TRACK_HEAD} width={TRACK} height={TRACK} />
        </clipPath>
      </defs>

      {/* --- header: which case, which direction, over which hours --- */}
      <Tick x={0} y={10} anchor="start" tone="ok" size={7.5}>
        {`CASE ${run.meta.id.toUpperCase()}`}
      </Tick>
      <Tick x={TRACK - 2} y={10} anchor="end" tone="warn" size={7.5}>
        {`HINDCAST ${formatHour(oldest)} → ${formatHour(newest)}`}
      </Tick>

      <g clipPath={`url(#${clip})`}>
        <g transform={`translate(0,${TRACK_HEAD})`}>
          <rect width={TRACK} height={TRACK} fill="var(--base)" />
          <Reticle w={TRACK} h={TRACK} stepX={TRACK / 6} stepY={TRACK / 6} />

          {hours.map((h, i) => {
            const frame = run.drift.frames.find((f) => f.hour === h);
            if (!frame) return null;
            return frame.contour90.map((ring, j) => (
              <path
                key={`${h}-${j}`}
                d={ringPath(ring, proj)}
                fill="none"
                stroke="var(--ink-dim)"
                strokeWidth={0.9}
                opacity={0.34 + i * 0.16}
                vectorEffect="non-scaling-stroke"
              />
            ));
          })}

          {/* The hour the console clock is on, picked out of the stack. This is
              what makes the plot visibly answer the scrubber. */}
          {live?.contour90.map((ring, j) => (
            <path
              key={`live-${j}`}
              d={ringPath(ring, proj)}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.3}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {run.detection.parts.map((ring, j) => (
            <path
              key={`d${j}`}
              d={ringPath(ring, proj)}
              fill="var(--ink)"
              fillOpacity={0.18}
              stroke="var(--ink)"
              strokeWidth={0.9}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Upstream. The one mark in this figure that is an assertion about
              direction rather than a drawing of geometry. */}
          {arrow && (
            <g>
              <line
                x1={arrow.x1}
                y1={arrow.y1}
                x2={arrow.x2}
                y2={arrow.y2}
                stroke="var(--warn)"
                strokeWidth={0.9}
                strokeDasharray="3 2.5"
                opacity={0.85}
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={arrow.x2} cy={arrow.y2} r={2.4} fill="var(--warn)" opacity={0.85} />
              <text
                x={arrow.mx}
                y={arrow.my}
                textAnchor="middle"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 7,
                  letterSpacing: "0.14em",
                  fill: "var(--warn)",
                }}
              >
                UPSTREAM
              </text>
            </g>
          )}

          {track && track.length > 1 && (
            <path
              d={line(track)}
              fill="none"
              stroke="var(--ink-dim)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {matched && matched.length > 1 && (
            <path
              d={line(matched)}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2.4}
              opacity={0.9}
              vectorEffect="non-scaling-stroke"
            />
          )}

          <g>
            <circle cx={px} cy={py} r={3.4} fill="none" stroke="var(--accent)" strokeWidth={1.2} />
            <line x1={px - 7} y1={py} x2={px - 4.5} y2={py} stroke="var(--accent)" strokeWidth={1} />
            <line x1={px + 4.5} y1={py} x2={px + 7} y2={py} stroke="var(--accent)" strokeWidth={1} />
          </g>

          {/* Scale bar. Derived from the fitted projection, so it is also the
              cheapest proof that the fit is per case and not a fixed picture. */}
          <g>
            <line x1={barX1} y1={barY} x2={barX2} y2={barY} stroke="var(--ink-dim)" strokeWidth={0.9} />
            <line x1={barX1} y1={barY - 2.5} x2={barX1} y2={barY + 2.5} stroke="var(--ink-dim)" strokeWidth={0.9} />
            <line x1={barX2} y1={barY - 2.5} x2={barX2} y2={barY + 2.5} stroke="var(--ink-dim)" strokeWidth={0.9} />
            <Tick x={(barX1 + barX2) / 2} y={barY - 4} tone="dim" size={7}>
              {`${barKm} km`}
            </Tick>
          </g>

          {nowLine && (
            <Tick
              x={4}
              y={11}
              anchor="start"
              tone={rounded !== null && rounded > 0 ? "warn" : "ok"}
              size={7.5}
            >
              {nowLine}
            </Tick>
          )}
        </g>
      </g>

      {/* --- caption: the direction, in words -------------------------- *
          Kept at 7 px and inside 44 characters. The mono advance is 0.675em,
          so a 46-character line at this size runs past the viewBox and an
          outer `svg` clips silently -- which is how the previous single
          caption lost its right-hand end without anyone noticing. */}
      <Tick x={0} y={TRACK_HEAD + TRACK + 10} anchor="start" tone="dim" size={7}>
        backward origin field · where oil came from
      </Tick>
      <Tick x={0} y={TRACK_HEAD + TRACK + 20} anchor="start" tone="dim" size={7}>
        hindcast: runs opposite the live forecast
      </Tick>
      <Tick x={0} y={TRACK_HEAD + TRACK + 30} anchor="start" size={7}>
        {matched ? "heavy = inside the field at a matching hour" : "no matched segment"}
      </Tick>
    </svg>
  );
}
