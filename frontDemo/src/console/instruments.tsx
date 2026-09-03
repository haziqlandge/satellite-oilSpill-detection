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
 *
 * ---
 *
 * **Where an instrument's text lives.** A label anchored to a position stays in
 * the SVG. A summary readout moves out to HTML, through `FigLine`.
 *
 * The reason is that `<text>` is drawn in user units, so it scales with
 * whatever frame the instrument lands in and HTML beside it does not. The same
 * caption composed at 7 units inside a 220-unit viewBox renders at 9px in a
 * dock rail and at 20px in the panel reader -- larger there than the pane title
 * above it and the prose under it. Nothing about a caption wants that; only
 * marks tied to a coordinate do, because they have to move with the geometry
 * they annotate. So an axis end, a scale bar's length and an arrow's name are
 * drawn; a horizon multiplier, a stack span and a current-hour readout are set.
 *
 * `figW` is the other half of the same problem. Each instrument states the
 * width at which it renders at the scale it was composed for, and the reader's
 * scoped CSS caps it there instead of letting a 320-unit plot stretch to 480px
 * and take its tick labels with it. It has no effect in a dock, where the rail
 * is already about that wide.
 */

import { useId, useMemo, type CSSProperties, type ReactNode } from "react";
import { formatHour, relHour } from "../lib/format";
import { fieldProjection, forecastHours, ringPath } from "../lib/project";
import { pathLengthKm } from "../sim/geo";
import { windGate } from "../sim/slick";
import type { AnomalyFlag, LngLat, Run } from "../sim/types";
import { Row, Split, TONE, type Tone } from "./components";

/* ------------------------------------------------------------------ *
 * Shared plot chrome
 * ------------------------------------------------------------------ */

/**
 * The width this instrument renders at its composed scale.
 *
 * Read by `[data-panel-reader]` in `index.css`. A dock rail is already close to
 * these numbers, so capping there changes nothing; the reader's measure is not,
 * and without a cap every instrument in it runs at one and a half to two times
 * the scale its line weights and tick sizes were chosen against.
 */
export function figW(px: number) {
  return { "--fig-w": `${px}px` } as CSSProperties;
}

/**
 * Every 320-unit plot.
 *
 * Derived rather than measured off the current dock: `Tick` draws at 8 units,
 * and 8 units land on the console's 9-10px small-label size at a scale of
 * 400/320. That the right rail happens to give a pane about this much width is
 * why these have looked right there and nowhere else.
 */
const FIG_320 = 408;

/**
 * An instrument's readout, in HTML rather than in the drawing.
 *
 * Set identically to a `Block`'s right-hand metadata -- `num`, 9.5px,
 * untracked -- because that is what this is: a figure stating its own scale,
 * span or current value. Not tracked, because `components.tsx`'s rule is that
 * uppercase and tracked means a label and anything else is not one, and a
 * lowercase tracked line is exactly the in-between that made this family look
 * arbitrary before.
 *
 * Two slots, so a line can carry an identity on the left and a span on the
 * right without a second element.
 *
 * It sits **above** the drawing, always. Partly because that is the shape of
 * everything else here -- a `Pane` header precedes its body, a `Block` label
 * precedes its rows -- and partly for a composition reason: the convergence
 * plot and the spread trace are drawn flush against each other on purpose, to
 * read as one instrument with two traces, and a caption under the first would
 * be a rule driven between them.
 */
function FigLine({
  left,
  right,
  tone = "faint",
  toneRight = "faint",
  className = "",
}: {
  left?: ReactNode;
  right?: ReactNode;
  tone?: Tone;
  toneRight?: Tone;
  className?: string;
}) {
  return (
    <div
      className={`flex items-baseline gap-2 text-[9.5px] ${className}`}
    >
      {left !== undefined && (
        <span className="num min-w-0" style={{ color: TONE[tone] }}>
          {left}
        </span>
      )}
      {right !== undefined && (
        <span
          className="num ml-auto shrink-0"
          style={{ color: TONE[toneRight] }}
        >
          {right}
        </span>
      )}
    </div>
  );
}

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
 * Area of the 90% forecast contour against hours after the acquisition.
 *
 * Published as it comes out of the model: not smoothed, not clipped. Where the
 * backward version of this plot had a minimum -- the basin whose width is the
 * age interval -- the forward one only rises, and the rise is the reading. The
 * marked point is therefore the horizon rather than a minimum, because the
 * question a forecast answers is how much the region has stopped ruling out by
 * the time it runs out.
 *
 * The shaded band is the last checkpoint interval, where the region is widest.
 * The age interval and its dashed best estimate are gone from this plot: they
 * are properties of the backward run and have no position on a forward axis.
 * `drift.ageHours` is still reported, in the panes that state it as a value.
 */
export function ConvergencePlot({ run }: { run: Run }) {
  // Forward frames rather than `drift.convergence`, which the simulation
  // pre-filters to backward hours and which therefore has no forward analogue
  // to read. Every frame already carries the two quantities this plot needs.
  const c = useMemo(
    () =>
      run.drift.frames
        .filter((f) => f.hour >= 0)
        .map((f) => ({
          hour: f.hour,
          area90Km2: f.area90Km2,
          spreadKm: f.spreadKm,
        })),
    [run],
  );

  const { pts, xAt, yAt, maxArea } = useMemo(() => {
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
    return {
      pts: c.map((p) => [fx(p.hour), fy(p.area90Km2)] as const),
      xAt: fx,
      yAt: fy,
      maxArea: aMax,
    };
  }, [c]);

  if (!c.length) return null;

  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  // The last twelve hours of the horizon: the stretch where the region is
  // widest and the forecast is worth least.
  const last = c[c.length - 1];
  const bandX0 = xAt(Math.max(c[0].hour, last.hour - 12));
  const bandX1 = xAt(last.hour);

  const rise = last.area90Km2 / Math.max(0.001, c[0].area90Km2);
  // The ceiling is worth labelling only when it is not the point already
  // labelled. On a rise -- which is what a forward horizon does -- the maximum
  // *is* the marked endpoint, and printing it twice was the plot stating one
  // number in two places. A curve that peaked early would get its label back.
  const ceilingIsEndpoint = Math.abs(maxArea - last.area90Km2) < 0.05;

  return (
    <>
    {/* The right slot is the key to the shaded band, which is otherwise an
        unexplained amber rectangle -- the same gap the accent ring had on the
        field scope. `12` is the band's own width, not a constant repeated. */}
    <FigLine
      left={`x${rise.toFixed(0)} over the horizon`}
      tone="ok"
      right={`amber = last ${Math.round(last.hour - Math.max(c[0].hour, last.hour - 12))} h`}
      toneRight="warn"
    />
    <svg
      viewBox={`0 0 ${CONV_W} ${CONV_H + 14}`}
      className="mt-1 w-full"
      style={figW(FIG_320)}
      role="img"
      aria-label={`Area of the 90 percent forecast contour against hours after acquisition, reaching ${last.area90Km2.toFixed(1)} square kilometres at the horizon`}
    >
      <Reticle w={CONV_W} h={CONV_H} stepX={CONV_W / 8} stepY={CONV_H / 4} />

      {/* The far end of the horizon. Filled, because the caution it carries is
          about a stretch of time rather than an instant. */}
      <rect
        x={Math.min(bandX0, bandX1)}
        y={0}
        width={Math.abs(bandX1 - bandX0)}
        height={CONV_H}
        fill="var(--warn)"
        opacity={0.09}
      />

      <path d={d} fill="none" stroke="var(--ink)" strokeWidth={1.1} />

      <g>
        <circle
          cx={xAt(last.hour)}
          cy={yAt(last.area90Km2)}
          r={3}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.2}
        />
        <Tick
          x={xAt(last.hour)}
          y={Math.max(10, yAt(last.area90Km2) - 6)}
          anchor="end"
          tone="ok"
        >
          {`${last.area90Km2.toFixed(0)} km2`}
        </Tick>
      </g>

      <Tick x={0} y={CONV_H + 10} anchor="start">
        {`${relHour(c[0].hour)} h`}
      </Tick>
      <Tick x={CONV_W} y={CONV_H + 10} anchor="end">
        {`${relHour(c[c.length - 1].hour)} h`}
      </Tick>
      {!ceilingIsEndpoint && (
        <Tick x={2} y={10} anchor="start">
          {`${maxArea.toFixed(0)} km2`}
        </Tick>
      )}
    </svg>
    </>
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
  const c = run.drift.frames.filter((f) => f.hour >= 0);
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
      style={figW(FIG_320)}
      role="img"
      aria-label="Ensemble spread in kilometres against hours after acquisition"
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
  // Forward, in step with the map and the timeline beside it. The stack now
  // widens away from the pass instead of contracting toward the release; the
  // shape of the argument is the same and its direction is not.
  const hours = useMemo(() => forecastHours(run, 7), [run]);
  const proj = useMemo(
    () => fieldProjection(run, SCOPE, SCOPE, hours, 1.22, { includeTrack: false }),
    [run, hours],
  );

  const rounded = Math.round(hour);
  // Only hours the stack actually covers. Before the pass there is no forecast
  // frame to be live, and drawing the hindcast ring inside a forward stack puts
  // two opposite meanings in one picture.
  const live =
    (rounded >= 0
      ? run.drift.frames.find((f) => f.hour === rounded)
      : undefined) ?? run.drift.frames.find((f) => f.hour === 0) ?? run.drift.frames[0];

  return (
    <>
    {/*
      What the drawing is, and the key to its one unexplained mark.
      Deliberately *not* the hour or the 50% area: the block header above this
      already prints `Field at T+Nh`, and the three boxes directly under it
      already print 50%, 90% and spread. The tick that used to sit in the
      corner said both again in a third place, at twice the size of the text
      around it. What is left is the part nothing else states -- that this is a
      stack of hourly 90% contours, and that the accent ring is the hour the
      clock is on.
    */}
    <FigLine
      left={`stack ${formatHour(hours[0])}..${formatHour(hours[hours.length - 1])} · 90%`}
      right="accent = this hour"
      toneRight="ok"
    />
    <svg
      viewBox={`0 0 ${SCOPE} ${SCOPE}`}
      className="mt-1 w-full"
      style={figW(330)}
      role="img"
      aria-label="Stack of 90 percent credible forecast regions, one per forward hour, widening away from the satellite pass"
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

    </svg>
    </>
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
      style={figW(FIG_320)}
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
      {/*
        No readout for the sample, and none wanted. `Wind gate` prints the
        multiplier in its block header, and the two rows under the plot print
        the speed and the multiplier again -- a fourth copy inside the drawing
        was the same figure at twice the surrounding type size. What the plot is
        for is the shape: two ramps rather than a cut, and where this sample
        sits on them. The mark carries that, and it turns amber below 0.5.
      */}
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
    <>
    {/*
      Both of these are stated nowhere else on the pane: `Geometry` above prints
      the *mean* width, not the maximum, and the station count is what makes the
      columns readable as discrete samples rather than a sampled curve.
    */}
    <FigLine
      left={`max ${max.toFixed(0)} m`}
      right={`${values.length} stations`}
    />
    <svg
      viewBox={`0 0 ${PROF_W} ${PROF_H + 11}`}
      className="mt-1 w-full"
      style={figW(FIG_320)}
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
    </svg>
    </>
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
      style={figW(FIG_320)}
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
 * The width this scope renders at.
 *
 * A 220-unit square wants roughly a 280px frame for its 7-unit marks to land
 * near the console's small-label size. It used to render at 480px in the panel
 * reader, and the two bands it then carried -- a header and three caption lines
 * -- came out at twenty pixels, larger than the pane title above them. Both
 * bands are now HTML above and below the drawing, which is why this is a plain
 * square and not a 220 x 270 portrait.
 */
const TRACK_FIG = 280;

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
 *  - **the direction is stated.** The stack is the *forward* field now, so it
 *    runs the same way as the live map and the timeline beside it. That is the
 *    change this instrument was turned around for: the plot used to run
 *    upstream while everything around it ran downstream, and a reader scrubbing
 *    to T+8h met two pictures pointing opposite ways. The header still names
 *    the direction and the span it was fitted over -- read off the hours
 *    actually drawn, never hard-coded -- because a figure that stopped saying
 *    which way it runs would simply be wrong more quietly
 *
 *    What this costs is worth writing down. Backward, the track over the field
 *    *was* the evidence: it showed the vessel inside the region the oil came
 *    from. Forward it cannot show that, so the score decomposition beside this
 *    plot is now the only place the drift term is evidenced. The track and its
 *    matched segment are still drawn, at the same weights, because they are
 *    what an operator wants next to the oil
 *  - **the case is named.** The contour stack has a similar silhouette in every
 *    scenario, which makes a plot that is in fact refitted per run look like one
 *    static picture with different lines drawn on it. The scene id and a scale
 *    bar derived from the fitted projection both change with the case, so
 *    switching scenarios is visibly reflected rather than merely true
 *  - **the plot moves with the clock.** `hour` picks the contour for the hour
 *    the operator is on out of the stack, the same way `FieldScope` does.
 *    Before the acquisition there is nothing in a forward stack to pick, so the
 *    plot says where the map has got to instead of drawing a contour that would
 *    mean something else
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
  const hours = useMemo(() => forecastHours(run, 4), [run]);
  // The track *is* framed here, unlike the home page's plate: this instrument
  // exists to show a vessel against a field, and a frame that cut the track off
  // would be hiding the comparison.
  const proj = useMemo(
    () => fieldProjection(run, TRACK, TRACK, hours, 1.3),
    [run, hours],
  );

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
  // Only forward frames belong in a forward stack. Before the pass the ensemble
  // is a hindcast, and drawing that ring here would put two opposite meanings
  // in one picture -- the confusion this plot was turned around to end.
  const live =
    rounded !== null && rounded >= 0
      ? (run.drift.frames.find((f) => f.hour === rounded) ?? null)
      : null;

  const nowLine =
    rounded === null
      ? null
      : rounded < 0
        ? `map at ${formatHour(rounded)} · before this stack`
        : live
          ? `now ${formatHour(rounded)} · 90% ${live.area90Km2.toFixed(0)} km2`
          : `now ${formatHour(rounded)} · outside this stack`;

  /* --- which way the oil is going ---------------------------------- */

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

  const drawing = (
    <svg
      viewBox={`0 0 ${TRACK} ${TRACK}`}
      className="w-full"
      style={figW(TRACK_FIG)}
      role="img"
      aria-label={
        `Forward forecast field for scene ${run.meta.id}, ${formatHour(oldest)} to ` +
        `${formatHour(newest)}, running the same way as the live map. The candidate ` +
        `track is drawn over it, with the segment that fell inside the credible ` +
        `region at a matching hour drawn heavier.`
      }
    >
      <defs>
        <clipPath id={clip}>
          <rect x={0} y={0} width={TRACK} height={TRACK} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clip})`}>
        <g>
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
                DOWNSTREAM
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

        </g>
      </g>
    </svg>
  );

  return (
    <Split figure={drawing}>
      {/* Which case, and over which hours. The docblock's reason for naming the
          case holds and gets stronger here: in the panel reader the console's
          own case selector has been scrolled off the top of the page, so this
          line is the only nearby statement of which scene is drawn. */}
      <FigLine
        left={`case ${run.meta.id}`}
        right={`forecast ${formatHour(oldest)} → ${formatHour(newest)}`}
        toneRight="warn"
      />
      {nowLine && (
        <FigLine
          left={nowLine}
          tone={rounded !== null && rounded > 0 ? "warn" : "ok"}
        />
      )}
      {/*
        The two lengths the plot draws and never states. "Heavy" is a weight on
        a line until it is a number: sixty kilometres of a two-hundred kilometre
        track inside the field is a different claim from two kilometres of it,
        and the drift term is computed from exactly this geometry. Stated here
        rather than in the drawing because a length is a summary, not a mark
        pinned to a coordinate.
      */}
      {track && track.length > 1 && (
        <FigLine
          left={`track ${pathLengthKm(track).toFixed(0)} km`}
          right={
            matched && matched.length > 1
              ? `matched ${pathLengthKm(matched).toFixed(0)} km`
              : "no matched segment"
          }
          toneRight={matched && matched.length > 1 ? "ok" : "dim"}
        />
      )}
      {/* The direction claim, in HTML and therefore in a sentence.
          It used to be three lines hard-limited to 44 characters, because at
          7 units inside a 220-unit viewBox a 46th character ran past the edge
          and the outer `svg` clipped it silently -- which is how the previous
          single caption lost its right-hand end without anyone noticing. Out
          here there is no such limit and no such failure mode. */}
      <p
        data-prose
        className="mt-2 text-[10.5px] leading-[1.6]"
        style={{ color: "var(--ink-dim)" }}
      >
        The forecast field: where the oil is going, running the same direction
        as the live map.
      </p>

      {/*
        A key, because this is the one instrument carrying seven distinct kinds
        of mark and it had a name for exactly one of them. Every line here
        points at something actually drawn beside it; the meaning of "heavy",
        which the caption used to carry as a clause, is the first of them.
      */}
      <div className="mt-2">
        <Row
          label="heavy"
          value={matched && matched.length > 1 ? "inside the field" : "no match"}
          tone={matched && matched.length > 1 ? "ok" : "dim"}
        />
        <Row label="dashed" value="this hour" tone="ok" />
        <Row label="faded" value="one hour per ring" />
        <Row label="filled" value="the detection" />
        <Row label="crosshair" value="track end" />
      </div>
    </Split>
  );
}
