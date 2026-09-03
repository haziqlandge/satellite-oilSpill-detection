/**
 * DOSSIER's plates: figures drawn the way a chart is printed, not the way a
 * dashboard renders.
 *
 * Every plate in this file is built on the same three moves, and they are the
 * moves that separate a reproduction from a screen:
 *
 *  - a neat line. The data lives inside a ruled frame with a margin of paper
 *    around it, and the coordinate labels sit in that margin. A figure that
 *    bleeds to the edge of its container is a web figure; a figure with a neat
 *    line and marginal ticks is a chart that was printed
 *  - ink only. Fills are hatched rather than tinted, because a hatch survives
 *    photocopying and a 12% alpha does not. It also means the credible regions
 *    stay legible on a light ground, which flat translucent fills do not
 *  - the annotation is on the plate. Leader lines to labels, not a legend in a
 *    corner, so the reader never has to hold a colour key in their head
 *
 * The projections come from `lib/project`, which is arithmetic all four
 * directions share. What is local here is entirely how it is drawn.
 */

import { useId, useMemo } from "react";
import { createTimeline, stagger, svg, utils } from "animejs";

import { useAnimeScope } from "../lib/motion";
import { formatHour, relHour } from "../lib/format";
import { checkpointsFor } from "../lib/playback";
import {
  forecastHours,
  fieldProjection,
  linePath,
  ringPath,
  type Projection,
} from "../lib/project";
import { windGate } from "../sim/slick";
import { SarTile, boundsFor } from "../components/SarTile";
import type { LngLat, Run } from "../sim/types";

/* ------------------------------------------------------------------ *
 * Chart frame
 * ------------------------------------------------------------------ */

/**
 * Every class the plates' timelines prime or draw.
 *
 * Handed to `useAnimeScope` as its backstop selector, so a plate whose timeline
 * never runs -- a hidden tab throttles `requestAnimationFrame` to about 1 Hz --
 * ends up drawn rather than blank. `revealOnScroll` has carried the same
 * guarantee since it was written; the plates were the last place in the file
 * that primed elements to invisible and simply hoped.
 */
const PLATE_BACKSTOP = [
  ".ds-neat",
  ".ds-grat",
  ".ds-ring",
  ".ds-hatch",
  ".ds-track",
  ".ds-leader",
  ".ds-conv-axis",
  ".ds-conv-line",
  ".ds-conv-note",
  ".ds-gate-curve",
  ".ds-gate-note",
  ".ds-prof",
  ".ds-prof-axis",
  ".ds-sar-lead",
  ".ds-sar-note",
  ".ds-strip-axis",
  ".ds-strip-line",
].join(", ");

const W = 920;
const H = 620;
/** Margin outside the neat line, where the coordinate labels live. */
const M = 46;

/**
 * Recover the geographic bounds a projection ended up showing.
 *
 * `fitProjection` hands back a forward transform and no inverse, but the
 * transform is affine, so two probe points give the scale on each axis and the
 * edges follow. Doing it this way rather than re-deriving the fit means the
 * ticks can never disagree with the geometry drawn under them, which is the bug
 * that makes a chart quietly wrong.
 */
function boundsOf(proj: Projection, ref: LngLat): [number, number, number, number] {
  const [x0, y0] = proj.toXY(ref);
  const [x1] = proj.toXY([ref[0] + 0.1, ref[1]]);
  const [, y1] = proj.toXY([ref[0], ref[1] + 0.1]);
  const dxdlon = (x1 - x0) / 0.1;
  const dydlat = (y1 - y0) / 0.1;
  return [
    ref[0] + (0 - x0) / dxdlon,
    ref[1] + (proj.height - y0) / dydlat,
    ref[0] + (proj.width - x0) / dxdlon,
    ref[1] + (0 - y0) / dydlat,
  ];
}

const NICE_DEG = [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2];

function ticksFor(lo: number, hi: number, target = 4): number[] {
  const raw = (hi - lo) / target;
  const step = NICE_DEG.reduce((b, v) =>
    Math.abs(v - raw) < Math.abs(b - raw) ? v : b,
  );
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    out.push(Number(v.toFixed(6)));
  }
  return out;
}

/** Degrees and minutes. Decimal degrees on a chart is a screenshot of a table. */
function dm(value: number, axis: "lat" | "lon"): string {
  const hemi = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const a = Math.abs(value);
  let d = Math.floor(a);
  let m = Math.round((a - d) * 60);
  // 60 minutes rolls into the next degree. Printing 29°60′ is the kind of
  // error a chart reader spots before anything else on the plate.
  if (m === 60) {
    d += 1;
    m = 0;
  }
  return `${d}°${String(m).padStart(2, "0")}′${hemi}`;
}

const TICK_TEXT: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9.5,
  fill: "var(--ink-faint)",
  letterSpacing: "0.04em",
};

const NOTE_TEXT: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  fill: "var(--ink-dim)",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};

/**
 * The neat line, its ticks, the internal graticule and the registration marks.
 *
 * Drawn once per plate and never parameterised beyond the bounds, so every
 * chart in the file frames its data identically -- which is what makes two
 * plates on facing pages comparable.
 */
function NeatLine({
  bounds,
  proj,
}: {
  bounds: [number, number, number, number];
  proj: Projection;
}) {
  const [w, s, e, n] = bounds;
  const lons = ticksFor(w, e, 4);
  const lats = ticksFor(s, n, 3);
  const x = (lon: number) => proj.toXY([lon, (s + n) / 2])[0];
  const y = (lat: number) => proj.toXY([(w + e) / 2, lat])[1];

  return (
    <g>
      {/* Internal graticule, dotted so it never competes with a contour. */}
      {lons.map((lon) => (
        <line
          key={`gl${lon}`}
          className="ds-grat"
          x1={x(lon)}
          y1={0}
          x2={x(lon)}
          y2={proj.height}
          stroke="var(--line)"
          strokeWidth={0.7}
          strokeDasharray="1 6"
        />
      ))}
      {lats.map((lat) => (
        <line
          key={`ga${lat}`}
          className="ds-grat"
          x1={0}
          y1={y(lat)}
          x2={proj.width}
          y2={y(lat)}
          stroke="var(--line)"
          strokeWidth={0.7}
          strokeDasharray="1 6"
        />
      ))}

      {/* Neat line: one firm rule with the ticks stepping outside it. */}
      <rect
        className="ds-neat"
        x={0}
        y={0}
        width={proj.width}
        height={proj.height}
        fill="none"
        stroke="var(--ink)"
        strokeWidth={1}
      />

      {lons.map((lon) => (
        <g key={`tl${lon}`}>
          <line x1={x(lon)} y1={-5} x2={x(lon)} y2={0} stroke="var(--ink)" strokeWidth={1} />
          <line
            x1={x(lon)}
            y1={proj.height}
            x2={x(lon)}
            y2={proj.height + 5}
            stroke="var(--ink)"
            strokeWidth={1}
          />
          <text x={x(lon)} y={-11} textAnchor="middle" style={TICK_TEXT}>
            {dm(lon, "lon")}
          </text>
        </g>
      ))}
      {lats.map((lat) => (
        <g key={`ta${lat}`}>
          <line x1={-5} y1={y(lat)} x2={0} y2={y(lat)} stroke="var(--ink)" strokeWidth={1} />
          <line
            x1={proj.width}
            y1={y(lat)}
            x2={proj.width + 5}
            y2={y(lat)}
            stroke="var(--ink)"
            strokeWidth={1}
          />
          <text x={-9} y={y(lat) + 3.2} textAnchor="end" style={TICK_TEXT}>
            {dm(lat, "lat")}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Printer's registration crosses, at the corners of the sheet. */
function Registration() {
  const marks: [number, number][] = [
    [14, 14],
    [W - 14, 14],
    [14, H - 14],
    [W - 14, H - 14],
  ];
  return (
    <g aria-hidden opacity={0.5}>
      {marks.map(([cx, cy], i) => (
        <g key={i} stroke="var(--ink-faint)" strokeWidth={0.8}>
          <line x1={cx - 7} y1={cy} x2={cx + 7} y2={cy} />
          <line x1={cx} y1={cy - 7} x2={cx} y2={cy + 7} />
          <circle cx={cx} cy={cy} r={4} fill="none" />
        </g>
      ))}
    </g>
  );
}

function ScaleBar({ proj, x, y }: { proj: Projection; x: number; y: number }) {
  // Round kilometres chosen to land near a sixth of the plate, rather than a
  // fixed pixel length labelled with whatever it happens to work out to.
  const target = proj.width * 0.17 * proj.kmPerUnit;
  const nice = [1, 2, 5, 10, 20, 50, 100, 200].reduce((b, v) =>
    Math.abs(v - target) < Math.abs(b - target) ? v : b,
  );
  const px = nice / proj.kmPerUnit;
  return (
    <g aria-hidden>
      {/* Alternating filled and open halves: a chequered bar, which is how a
          chart draws a scale and is instantly different from a plain rule. */}
      <rect x={x} y={y} width={px / 2} height={5} fill="var(--ink)" />
      <rect
        x={x + px / 2}
        y={y}
        width={px / 2}
        height={5}
        fill="none"
        stroke="var(--ink)"
        strokeWidth={0.9}
      />
      <text x={x} y={y - 6} style={{ ...TICK_TEXT, fill: "var(--ink-dim)" }}>
        0
      </text>
      <text
        x={x + px}
        y={y - 6}
        textAnchor="middle"
        style={{ ...TICK_TEXT, fill: "var(--ink-dim)" }}
      >
        {nice} km
      </text>
    </g>
  );
}

function NorthArrow({ x, y }: { x: number; y: number }) {
  return (
    <g aria-hidden stroke="var(--ink)" strokeWidth={1} fill="none">
      <line x1={x} y1={y + 24} x2={x} y2={y} />
      <path d={`M${x - 4.5},${y + 8} L${x},${y} L${x + 4.5},${y + 8}`} />
      <text
        x={x}
        y={y + 36}
        textAnchor="middle"
        style={{ ...TICK_TEXT, fill: "var(--ink)" }}
        stroke="none"
      >
        N
      </text>
    </g>
  );
}

/** Diagonal hatch, for filling a credible region without tinting the paper. */
function Hatch({ id, colour, gap = 5 }: { id: string; colour: string; gap?: number }) {
  return (
    <pattern
      id={id}
      width={gap}
      height={gap}
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <line x1={0} y1={0} x2={0} y2={gap} stroke={colour} strokeWidth={0.9} />
    </pattern>
  );
}

/** A label with a leader line back to the thing it names. */
function Leader({
  from,
  to,
  text,
  anchor = "start",
  tone = "ink",
}: {
  from: [number, number];
  to: [number, number];
  text: string;
  anchor?: "start" | "end";
  tone?: "ink" | "accent";
}) {
  const colour = tone === "accent" ? "var(--accent)" : "var(--ink)";
  return (
    <g className="ds-leader">
      <circle cx={from[0]} cy={from[1]} r={2.2} fill={colour} />
      <path
        d={`M${from[0]},${from[1]} L${to[0]},${to[1]} L${to[0] + (anchor === "start" ? 16 : -16)},${to[1]}`}
        fill="none"
        stroke={colour}
        strokeWidth={0.9}
      />
      <text
        x={to[0] + (anchor === "start" ? 20 : -20)}
        y={to[1] + 3.4}
        textAnchor={anchor}
        style={{ ...NOTE_TEXT, fill: colour }}
      >
        {text}
      </text>
    </g>
  );
}

/**
 * The forecast stack as a ruled column, beside the map rather than on it.
 *
 * One row per hour drawn, in the same order the rings are stacked, so the
 * column and the map are read together without a single leader line between
 * them. Each row carries the area of that hour's 90% region -- the same
 * quantity the plate beside this one charts -- so the two figures share their
 * numbers instead of asserting the same thing twice in different units.
 *
 * The ink ramps exactly as the rings do: full weight at the pass, fading toward
 * the horizon. That ramp is the legend, which is why there is no separate key.
 */
function StackReadout({
  frames,
  x,
  width,
  height,
  passHour,
  horizonHour,
}: {
  frames: { hour: number; frame: { area90Km2: number; spreadKm: number } }[];
  x: number;
  width: number;
  height: number;
  passHour: number;
  horizonHour: number;
}) {
  if (frames.length < 2) return null;

  const top = 42;
  // Short of the neat line by enough to seat the closing note under the last
  // row rather than on the frame.
  const bottom = height - 54;
  const step = (bottom - top) / (frames.length - 1);

  return (
    <g className="ds-leader">
      {/* A hairline rule rather than a box: the column is part of the plate,
          not a panel sitting on it. */}
      <line
        x1={x}
        y1={top - 26}
        x2={x}
        y2={bottom + 14}
        stroke="var(--line)"
        strokeWidth={1}
      />

      <text x={x + 14} y={top - 26} style={{ ...NOTE_TEXT, fill: "var(--ink-dim)" }}>
        Hour
      </text>
      <text
        x={x + width}
        y={top - 26}
        textAnchor="end"
        style={{ ...NOTE_TEXT, fill: "var(--ink-dim)" }}
      >
        90% region, km²
      </text>
      <line
        x1={x + 14}
        y1={top - 20}
        x2={x + width}
        y2={top - 20}
        stroke="var(--line)"
        strokeWidth={1}
      />

      {frames.map(({ hour, frame }, i) => {
        const y = top + i * step;
        const isPass = hour === passHour;
        const isHorizon = hour === horizonHour;
        const accent = isPass || isHorizon;
        const fade = 0.45 + (1 - i / (frames.length - 1)) * 0.55;

        return (
          <g key={`row-${hour}`}>
            {/* The ring's own weight, as a rule. Solid at the pass and dashed
                onward, matching the outlines on the map exactly. */}
            <line
              x1={x + 14}
              y1={y + 4}
              x2={x + 30}
              y2={y + 4}
              stroke={accent ? "var(--accent)" : "var(--ink-dim)"}
              strokeWidth={isPass ? 1.5 : 0.9}
              strokeDasharray={isPass ? undefined : "4 3"}
              opacity={accent ? 1 : fade}
            />
            <text
              x={x + 38}
              y={y + 7.5}
              style={{
                ...TICK_TEXT,
                fill: accent ? "var(--accent)" : "var(--ink-dim)",
                opacity: accent ? 1 : fade,
              }}
            >
              {hour === 0 ? "T0" : formatHour(hour)}
            </text>
            <text
              x={x + width}
              y={y + 7.5}
              textAnchor="end"
              style={{
                ...TICK_TEXT,
                fill: accent ? "var(--accent)" : "var(--ink)",
                opacity: accent ? 1 : fade,
              }}
            >
              {frame.area90Km2 >= 1000
                ? `${(frame.area90Km2 / 1000).toFixed(1)}k`
                : frame.area90Km2.toFixed(0)}
            </text>
          </g>
        );
      })}

      {/* What the two accented rows mean, so the ramp does not need a key. */}
      <text
        x={x + 14}
        y={bottom + 30}
        style={{ ...TICK_TEXT, fill: "var(--ink-faint)" }}
      >
        Observed at the pass; hatched at the horizon.
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * Plate: the origin field
 * ------------------------------------------------------------------ */

/**
 * The forecast ensemble, drawn as an expanding stack of credible regions.
 *
 * C5's requirement is that the reader never sees a trajectory, and the strongest
 * way to honour it on paper is to give the field an outline for every hour and
 * no line anywhere connecting them. The region at the pass is hatched, because
 * it is the one hour the ensemble is not guessing about; each later hour is an
 * open outline with its hour written on the plate. What the figure says is
 * "somewhere in here, at this hour", repeated seven times.
 *
 * The stack used to run the other way -- backward from the pass to the release,
 * contracting -- and the two read very differently even though they are the
 * same arithmetic. Contracting, the figure is an argument about where the oil
 * came from. Expanding, it is a statement about how far the forecast can be
 * trusted, and the widening *is* the statement: the regions do not grow because
 * the model is getting worse, they grow because the ocean disperses oil.
 *
 * The vessel marks stay. A track laid over a forecast is not evidence the way a
 * track laid over an origin field is, but it is still the thing a reader wants
 * next to the oil, and dropping it would make the plate answer a question
 * nobody asked.
 */
export function OriginFieldPlate({ run }: { run: Run }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const hours = useMemo(() => forecastHours(run, 7), [run]);
  /**
   * The map, biased to the left of the neat line.
   *
   * A forecast stack is a tall, narrow ribbon: it runs downwind for tens of
   * kilometres and stays a few hundred metres across, so a fit-to-contain in a
   * landscape frame is limited by height and uses almost none of the width. Fit
   * it centred and the plate is a thin thread of data with two empty margins
   * either side of it, which is exactly what this figure looked like when the
   * stack was first turned around.
   *
   * So the geography is pushed left and the recovered column carries the stack
   * readout. The projection is wrapped rather than re-fitted, so the neat line,
   * its ticks and `boundsOf` all still describe the same geography.
   */
  const proj = useMemo(() => {
    const base = fieldProjection(run, W - M * 2, H - M * 2, hours, 1.2, {
      includeTrack: false,
    });
    const dx = base.width * 0.17;
    return {
      ...base,
      toXY: (p: LngLat): [number, number] => {
        const [x, y] = base.toXY(p);
        return [x - dx, y];
      },
    };
  }, [run, hours]);
  const bounds = useMemo(
    () => boundsOf(proj, run.characterisation.head),
    [proj, run],
  );

  const root = useAnimeScope(() => {
    utils.set(".ds-leader, .ds-grat", { opacity: 0 });
    createTimeline({ defaults: { ease: "out(2)" } })
      .add(svg.createDrawable(".ds-neat"), { draw: ["0 0", "0 1"], duration: 620 })
      .add(".ds-grat", { opacity: [0, 1], duration: 400 }, "-=260")
      .add(
        svg.createDrawable(".ds-ring"),
        { draw: ["0 0", "0 1"], duration: 700, delay: stagger(90) },
        "-=300",
      )
      .add(".ds-hatch", { opacity: [0, 1], duration: 520 }, "-=420")
      .add(svg.createDrawable(".ds-track"), { draw: ["0 0", "0 1"], duration: 780 }, "-=560")
      .add(".ds-leader", { opacity: [0, 1], duration: 380, delay: stagger(120) }, "-=280");
  }, [run.meta.id], { backstop: PLATE_BACKSTOP });

  const frames = hours
    .map((h) => ({ hour: h, frame: run.drift.frames.find((f) => f.hour === h) }))
    .filter((x): x is { hour: number; frame: NonNullable<typeof x.frame> } => !!x.frame);

  // Two hours carry emphasis, and they are the two ends.
  //
  // `bestHour` is the pass: observed rather than forecast, so its outline is
  // the one solid ring in the stack. The **hatch** goes on the horizon
  // instead, which is the opposite of what it did backward and is the right
  // choice here for a plain reason -- at the pass the 50% region sits almost
  // exactly under the slick outline, which is already hatched, so hatching it
  // again draws the same shape twice in the same ink and says nothing. The
  // horizon's 50% region is the one shape on the plate that appears nowhere
  // else, and it is the one a reader would act on.
  const bestHour = 0;
  const horizonHour = hours[hours.length - 1];
  const hatchFrame =
    run.drift.frames.find((f) => f.hour === horizonHour) ??
    frames[frames.length - 1]?.frame ??
    run.drift.frames[0];

  const head = proj.toXY(run.characterisation.head);
  const top = run.suspects[0];
  const truth = run.truth ? proj.toXY(run.truth.position) : null;

  // Where to hang the horizon leader: the centroid of the hatched ring rather
  // than any single vertex, so the line lands inside the shape it names.
  const hatchCentre = ((): [number, number] | null => {
    const ring = hatchFrame?.contour50[0];
    if (!ring?.length) return null;
    const pts = ring.map((p) => proj.toXY(p));
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return [cx, cy];
  })();

  // Within a label's width of the head, the two annotations overlap.
  const truthCrowded =
    !!truth && Math.hypot(truth[0] - head[0], truth[1] - head[1]) < 120;

  return (
    <div ref={root}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Chart plate: forecast credible regions for the hours after the satellite pass"
      >
        <defs>
          <Hatch id={`h50-${uid}`} colour="var(--accent)" gap={4.5} />
          <Hatch id={`hslick-${uid}`} colour="var(--accent)" gap={3} />
        </defs>

        <Registration />

        <g transform={`translate(${M},${M})`}>
          <NeatLine bounds={bounds} proj={proj} />

          {/* Clip everything geographic to the neat line: an ensemble contour
              routinely runs off the frame, and ink outside the neat line is the
              single most obvious sign a chart was not composed. */}
          <clipPath id={`clip-${uid}`}>
            <rect x={0} y={0} width={proj.width} height={proj.height} />
          </clipPath>

          <g clipPath={`url(#clip-${uid})`}>
            {frames.map(({ hour, frame }, i) =>
              frame.contour90.map((ring, j) => (
                <path
                  key={`${hour}-${j}`}
                  className="ds-ring"
                  d={ringPath(ring, proj)}
                  fill="none"
                  stroke={hour === bestHour ? "var(--accent)" : "var(--ink-dim)"}
                  strokeWidth={hour === bestHour ? 1.5 : 0.9}
                  // Solid at the pass, dashed onward: the observed hour is a
                  // measurement and the rest are projections, and the line
                  // quality is the cheapest way to say which is which.
                  strokeDasharray={i === 0 ? undefined : "6 4"}
                  opacity={hour === bestHour ? 1 : 0.78 - (i / frames.length) * 0.4}
                  vectorEffect="non-scaling-stroke"
                />
              )),
            )}

            {hatchFrame?.contour50.map((ring, j) => (
              <path
                key={`b50-${j}`}
                className="ds-hatch"
                d={ringPath(ring, proj)}
                fill={`url(#h50-${uid})`}
                fillOpacity={0.55}
                stroke="var(--accent)"
                strokeWidth={1}
                strokeOpacity={0.8}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {top?.track && (
              <path
                className="ds-track"
                d={linePath(top.track, proj)}
                fill="none"
                stroke="var(--ink)"
                strokeWidth={1}
                strokeDasharray="7 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {top?.evidence.matchedSegment && (
              <path
                className="ds-track"
                d={linePath(top.evidence.matchedSegment, proj)}
                fill="none"
                stroke="var(--ink)"
                strokeWidth={2.6}
                vectorEffect="non-scaling-stroke"
              />
            )}

            {run.detection.parts.map((ring, i) => (
              <path
                key={`slick-${i}`}
                className="ds-hatch"
                d={ringPath(ring, proj)}
                fill={`url(#hslick-${uid})`}
                stroke="var(--accent)"
                strokeWidth={1.4}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          {/*
            The stack, as a table.

            The hours used to be written on the plate beside their own ring, and
            with the rings this narrow the labels ended up floating in space
            with nothing legible next to them. A column reads better and carries
            more: it is in stack order top to bottom, which is the order the map
            is already in, so no leader lines are needed to connect the two, and
            it can print the area each ring encloses -- the quantity 2B charts,
            here as the numbers behind that curve.
          */}
          <StackReadout
            frames={frames}
            x={proj.width * 0.66}
            /* Short of the neat line, so the figures have air between them and
               the frame rather than sitting on it. */
            width={proj.width * 0.34 - 12}
            height={proj.height}
            passHour={bestHour}
            horizonHour={horizonHour}
          />

          <Leader
            from={[head[0], head[1]]}
            /* Clamped to the map's own right edge rather than the sheet's: the
               readout column starts at 0.66 and this label is long enough to
               run straight into its header. */
            to={[
              Math.min(proj.width * 0.66 - 178, head[0] + 70),
              Math.max(24, head[1] - 54),
            ]}
            text="Slick head at the pass"
            tone="accent"
          />

          {/* The hatched region, named. It is the only shape on the plate a
              reader would act on, and an unlabelled hatch is a texture.
              Routed left, because the right of the plate is the readout now. */}
          {hatchCentre && (
            <Leader
              from={hatchCentre}
              to={[
                Math.max(6, hatchCentre[0] - 150),
                Math.min(proj.height - 26, hatchCentre[1] + 42),
              ]}
              text={`50% region at ${formatHour(horizonHour)}`}
              tone="accent"
            />
          )}

          {truth && (
            <g className="ds-leader">
              <line
                x1={truth[0] - 6}
                y1={truth[1] - 6}
                x2={truth[0] + 6}
                y2={truth[1] + 6}
                stroke="var(--ink)"
                strokeWidth={1.2}
              />
              <line
                x1={truth[0] - 6}
                y1={truth[1] + 6}
                x2={truth[0] + 6}
                y2={truth[1] - 6}
                stroke="var(--ink)"
                strokeWidth={1.2}
              />
              {/*
                Set below the cross rather than beside it whenever the head's
                own leader is close by. Forward, the authored source and the
                slick head are near neighbours -- the oil has not gone far by
                the pass -- so the default placement runs this label straight
                through "Slick head at the pass".
              */}
              <text
                x={truthCrowded ? truth[0] : truth[0] + 11}
                y={truthCrowded ? truth[1] + 20 : truth[1] + 3.4}
                textAnchor={truthCrowded ? "middle" : "start"}
                style={{ ...TICK_TEXT, fill: "var(--ink)" }}
              >
                Authored source position
              </text>
            </g>
          )}

          <ScaleBar proj={proj} x={14} y={proj.height - 20} />
          {/* Top right *of the map*, not of the sheet. The readout column owns
              the right third now, and a north arrow inside it would read as one
              of its rows. */}
          <NorthArrow x={proj.width * 0.58} y={16} />
        </g>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Plate: how far the forecast spreads
 * ------------------------------------------------------------------ */

/**
 * How wide the 90% region is at each hour after the pass.
 *
 * This plate used to run the other way: the same measurement taken backward,
 * where the curve falls to a minimum and the width of that basin is the age
 * interval. That figure argued about where the oil came from. This one is about
 * how long the forecast is worth anything, and the curve only rises.
 *
 * The rise is the subject, not a defect. A forecast ensemble spreads because
 * the ocean disperses oil and because the members were stepped through slightly
 * different forcing; by the horizon the region is large enough that "the oil is
 * somewhere in here" has stopped being a useful sentence. Drawing that plainly
 * is the honest version of a forecast horizon, and it is why the plate labels
 * the area at the horizon rather than only at the start.
 *
 * The dots are the checkpoints the map draws its forecast rings at, so the two
 * figures can be read against each other hour for hour.
 */
export function ForecastSpreadPlate({ run }: { run: Run }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const CW = 920;
  // Matched to the origin-field plate beside it. The two sit on one row and a
  // half-height chart next to a full-height plate reads as an afterthought
  // rather than as the second half of one argument.
  const CH = 620;
  const L = 58;
  const R = 22;
  const T = 20;
  const B = 44;

  // Every hook in this component runs before anything can bail out. A plate
  // with no forward series still has to call `useAnimeScope`, or the hook order
  // changes between scenarios and React unmounts the whole part.
  //
  // The series starts at the pass rather than after it: T0 is the tightest the
  // region ever is, and a curve that starts one step up hides how much of the
  // spreading happens in the first hours.
  const pts = run.drift.frames
    .filter((f) => f.hour >= 0)
    .map((f) => ({ hour: f.hour, area90Km2: f.area90Km2, spreadKm: f.spreadKm }));
  const hours = pts.length ? pts.map((c) => c.hour) : [0];
  const areas = pts.length ? pts.map((c) => c.area90Km2) : [1];

  const hMin = 0;
  const hMax = Math.max(1, Math.max(...hours));
  const aMax = Math.max(...areas) * 1.08;
  const x = (h: number) => L + ((h - hMin) / (hMax - hMin || 1)) * (CW - L - R);
  const y = (a: number) => CH - B - (a / (aMax || 1)) * (CH - T - B);

  const marks = useMemo(() => checkpointsFor(run), [run]);
  const last = pts.length ? pts[pts.length - 1] : { hour: 0, area90Km2: 0, spreadKm: 0 };
  const first = pts.length ? pts[0] : last;

  const path = pts
    .map(
      (c, i) =>
        `${i === 0 ? "M" : "L"}${x(c.hour).toFixed(1)},${y(c.area90Km2).toFixed(1)}`,
    )
    .join(" ");

  const hourTicks = ticksHours(hMin, hMax);
  const areaTicks = niceAxis(0, aMax, 4);

  const root = useAnimeScope(() => {
    utils.set(".ds-conv-note", { opacity: 0 });
    createTimeline({ defaults: { ease: "out(2)" } })
      .add(svg.createDrawable(".ds-conv-axis"), { draw: ["0 0", "0 1"], duration: 520 })
      .add(svg.createDrawable(".ds-conv-line"), { draw: ["0 0", "0 1"], duration: 900 }, "-=220")
      .add(".ds-conv-note", { opacity: [0, 1], duration: 420, delay: stagger(110) }, "-=380");
  }, [run.meta.id], { backstop: PLATE_BACKSTOP });

  if (!pts.length) return null;

  return (
    <div ref={root}>
      <svg
        viewBox={`0 0 ${CW} ${CH}`}
        className="w-full"
        role="img"
        aria-label="Area of the 90 per cent forecast region against hours after acquisition"
      >
        <defs>
          <Hatch id={`hz-${uid}`} colour="var(--accent)" gap={6} />
        </defs>

        {/* The last checkpoint band: the hours the forecast is least worth
            trusting, hatched so the widening reads as a caution rather than as
            just the right-hand end of a line. */}
        {marks.length > 1 && (
          <rect
            className="ds-conv-note"
            x={x(marks[marks.length - 2])}
            y={T}
            width={Math.max(0, x(hMax) - x(marks[marks.length - 2]))}
            height={CH - T - B}
            fill={`url(#hz-${uid})`}
            fillOpacity={0.45}
          />
        )}

        {areaTicks.map((a) => (
          <g key={a}>
            <line
              x1={L}
              y1={y(a)}
              x2={CW - R}
              y2={y(a)}
              stroke="var(--line)"
              strokeWidth={0.7}
              strokeDasharray="1 6"
            />
            <text x={L - 9} y={y(a) + 3.2} textAnchor="end" style={TICK_TEXT}>
              {a >= 1000 ? `${(a / 1000).toFixed(1)}k` : a.toFixed(0)}
            </text>
          </g>
        ))}

        {hourTicks.map((h) => (
          <g key={h}>
            <line x1={x(h)} y1={CH - B} x2={x(h)} y2={CH - B + 5} stroke="var(--ink)" strokeWidth={1} />
            <text x={x(h)} y={CH - B + 17} textAnchor="middle" style={TICK_TEXT}>
              {h === 0 ? "T0" : relHour(h)}
            </text>
          </g>
        ))}

        <path
          className="ds-conv-axis"
          d={`M${L},${T} L${L},${CH - B} L${CW - R},${CH - B}`}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={1}
        />

        <path
          className="ds-conv-line"
          d={path}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
        />

        {/* The checkpoints, on the curve. Open circles rather than filled: they
            are readings off a continuous series, not separate measurements. */}
        {marks.map((h) => {
          const p = pts.find((c) => c.hour === h);
          if (!p) return null;
          return (
            <circle
              key={`mk-${h}`}
              className="ds-conv-note"
              cx={x(p.hour)}
              cy={y(p.area90Km2)}
              r={3}
              fill="var(--base-2)"
              stroke="var(--ink-dim)"
              strokeWidth={1.1}
            />
          );
        })}

        <g className="ds-conv-note">
          <circle
            cx={x(first.hour)}
            cy={y(first.area90Km2)}
            r={3.4}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.4}
          />
          <text
            x={x(first.hour) + 10}
            y={y(first.area90Km2) - 8}
            style={{ ...NOTE_TEXT, fill: "var(--accent)" }}
          >
            At the pass {first.area90Km2.toFixed(0)} km²
          </text>
        </g>

        <g className="ds-conv-note">
          <circle
            cx={x(last.hour)}
            cy={y(last.area90Km2)}
            r={3.4}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.4}
          />
          <text
            x={x(last.hour) - 10}
            y={y(last.area90Km2) - 10}
            textAnchor="end"
            style={{ ...NOTE_TEXT, fill: "var(--accent)" }}
          >
            {formatHour(last.hour)} {last.area90Km2.toFixed(0)} km² · spread{" "}
            {last.spreadKm.toFixed(1)} km
          </text>
        </g>

        <text className="ds-conv-note" x={L} y={12} style={NOTE_TEXT}>
          Area of the 90% forecast region, km²
        </text>
        <text
          className="ds-conv-note"
          x={CW - R}
          y={CH - 8}
          textAnchor="end"
          style={NOTE_TEXT}
        >
          Hours from acquisition
        </text>
      </svg>
    </div>
  );
}

function ticksHours(lo: number, hi: number): number[] {
  const span = hi - lo;
  const step = span > 60 ? 12 : span > 30 ? 6 : span > 14 ? 4 : 2;
  const out: number[] = [];
  for (let h = Math.ceil(lo / step) * step; h <= hi; h += step) out.push(h);
  return out;
}

function niceAxis(lo: number, hi: number, count: number): number[] {
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, raw))));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).reduce((b, v) =>
    Math.abs(v - raw) < Math.abs(b - raw) ? v : b,
  );
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Number(v.toFixed(4)));
  return out;
}

/* ------------------------------------------------------------------ *
 * Plate: the radar frame
 * ------------------------------------------------------------------ */

/**
 * The acquisition, as a portrait plate.
 *
 * Portrait rather than the letterboxed strip an editorial page would run,
 * because this is a print of one frame mounted on a sheet, and because a
 * portrait crop puts the whole slick and the water either side of it on the
 * same plate at a usable scale.
 *
 * The overlay annotations are drawn in the same pixel space as the tile by
 * repeating the tile's own bounds-to-pixel mapping. That duplication is
 * deliberate: `SarTile` renders to a canvas and cannot hand back positions, and
 * an SVG overlay that guessed at the mapping would drift by a few pixels, which
 * on a plate whose whole subject is geometry is worse than no annotation.
 */
export function SarPlate({ run, height = 760 }: { run: Run; height?: number }) {
  const width = Math.round(height * 0.74);
  const bounds = useMemo(
    () => boundsFor(run.detection.parts, 0.34, width / height),
    [run, width, height],
  );

  const [bw, bs, be, bn] = bounds;
  const toPx = (p: LngLat): [number, number] => [
    ((p[0] - bw) / (be - bw)) * width,
    (1 - (p[1] - bs) / (bn - bs)) * height,
  ];
  const head = toPx(run.characterisation.head);
  const tail = toPx(run.characterisation.tail);

  const root = useAnimeScope(() => {
    utils.set(".ds-sar-note", { opacity: 0 });
    createTimeline({ defaults: { ease: "out(2)" } })
      .add(svg.createDrawable(".ds-sar-lead"), { draw: ["0 0", "0 1"], duration: 620, delay: stagger(120) })
      .add(".ds-sar-note", { opacity: [0, 1], duration: 380, delay: stagger(120) }, "-=460");
  }, [run.meta.id], { backstop: PLATE_BACKSTOP });

  return (
    <div ref={root} className="relative mx-auto" style={{ maxWidth: width }}>
      <SarTile
        parts={run.detection.parts}
        bounds={bounds}
        seed={`${run.meta.id}-plate`}
        dampingDb={run.characterisation.dampingRatioDb}
        windMs={run.characterisation.windSpeedMs}
        showMask
        maskColour="var(--accent)"
        width={width}
        height={height}
        // This plate was composed for paper. On the dark editorial ground the
        // paper stretch renders as a lit white slab that dominates everything
        // around it, so the display gain comes down. The damping contrast --
        // the thing the figure is actually about -- is untouched.
        gain={205}
        className="block h-auto w-full"
      />
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden
      >
        {/* Corner crop marks: the plate is a crop of a 250 km swath, and saying
            so with marks is more honest than pretending the frame is the scene. */}
        {[
          [10, 10, 1, 1],
          [width - 10, 10, -1, 1],
          [10, height - 10, 1, -1],
          [width - 10, height - 10, -1, -1],
        ].map(([cx, cy, sx, sy], i) => (
          <g key={i} stroke="var(--base-2)" strokeWidth={1.4} opacity={0.9}>
            <line x1={cx} y1={cy} x2={cx + sx * 18} y2={cy} />
            <line x1={cx} y1={cy} x2={cx} y2={cy + sy * 18} />
          </g>
        ))}

        <g>
          <path
            className="ds-sar-lead"
            d={`M${head[0]},${head[1]} L${head[0] + 46},${head[1] - 34} L${head[0] + 92},${head[1] - 34}`}
            fill="none"
            stroke="var(--base-2)"
            strokeWidth={1.2}
          />
          <path
            className="ds-sar-lead"
            d={`M${tail[0]},${tail[1]} L${tail[0] - 46},${tail[1] + 34} L${tail[0] - 92},${tail[1] + 34}`}
            fill="none"
            stroke="var(--base-2)"
            strokeWidth={1.2}
          />
          <text
            className="ds-sar-note"
            x={head[0] + 96}
            y={head[1] - 30}
            style={{ ...NOTE_TEXT, fill: "var(--base-2)", fontSize: 11 }}
          >
            Head
          </text>
          <text
            className="ds-sar-note"
            x={tail[0] - 96}
            y={tail[1] + 38}
            textAnchor="end"
            style={{ ...NOTE_TEXT, fill: "var(--base-2)", fontSize: 11 }}
          >
            Tail
          </text>
        </g>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Plate: the plan-form width profile
 * ------------------------------------------------------------------ */

/**
 * Width sampled perpendicular to the medial axis, head to tail, mirrored about
 * the axis so the plate shows the shape rather than a line chart of it.
 *
 * The taper is the argument: an operational discharge laid down by something
 * moving is wide where the oil entered and narrow where it has been spreading
 * longest, and that asymmetry is what resolves head from tail when the drift
 * field cannot.
 */
export function WidthProfilePlate({ run }: { run: Run }) {
  const PW = 920;
  const PH = 200;
  const pad = 46;
  const profile = run.characterisation.widthMProfile;
  const max = Math.max(1, ...profile);
  const mid = PH / 2;
  const half = (v: number) => (v / max) * (PH / 2 - 26);
  const px = (i: number) => pad + (i / (profile.length - 1)) * (PW - pad * 2);

  const upper = profile.map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${(mid - half(v)).toFixed(1)}`).join(" ");
  const lower = profile
    .map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${(mid + half(v)).toFixed(1)}`)
    .join(" ");

  const root = useAnimeScope(() => {
    createTimeline({ defaults: { ease: "out(2)" } })
      .add(svg.createDrawable(".ds-prof-axis"), { draw: ["0 0", "0 1"], duration: 520 })
      .add(svg.createDrawable(".ds-prof"), { draw: ["0 0", "0 1"], duration: 900 }, "-=300");
  }, [run.meta.id], { backstop: PLATE_BACKSTOP });

  if (profile.length < 2) return null;

  return (
    <div ref={root}>
      <svg
        viewBox={`0 0 ${PW} ${PH}`}
        className="w-full"
        role="img"
        aria-label="Slick width sampled along the medial axis from head to tail"
      >
        <line
          className="ds-prof-axis"
          x1={pad}
          y1={mid}
          x2={PW - pad}
          y2={mid}
          stroke="var(--ink)"
          strokeWidth={0.9}
          strokeDasharray="4 4"
        />
        <path className="ds-prof" d={upper} fill="none" stroke="var(--accent)" strokeWidth={1.4} />
        <path className="ds-prof" d={lower} fill="none" stroke="var(--accent)" strokeWidth={1.4} />

        <text x={pad} y={PH - 8} style={NOTE_TEXT}>
          Head
        </text>
        <text x={PW - pad} y={PH - 8} textAnchor="end" style={NOTE_TEXT}>
          Tail
        </text>
        <text x={pad} y={16} style={{ ...NOTE_TEXT, fill: "var(--ink-faint)" }}>
          Widest {max.toFixed(0)} m · mean {run.characterisation.widthMMean.toFixed(0)} m
        </text>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Plate: the wind gate
 * ------------------------------------------------------------------ */

/**
 * The gate as a curve with the sampled wind marked on it.
 *
 * C9 requires the gate to be a continuous multiplier the interface shows, never
 * a hard cut that silently drops a detection. Drawing the curve is the cheapest
 * possible way to prove it is continuous: the reader can see there is no step
 * in it, and can see which part of the ramp this particular detection landed
 * on.
 */
export function WindGatePlate({ ms, value }: { ms: number; value: number }) {
  const GW = 420;
  const GH = 168;
  const pad = 36;
  const maxMs = 18;
  const x = (v: number) => pad + (v / maxMs) * (GW - pad * 2);
  const y = (v: number) => GH - pad + 6 - v * (GH - pad * 2);

  const curve = Array.from({ length: 120 }, (_, i) => {
    const v = (i / 119) * maxMs;
    return `${i === 0 ? "M" : "L"}${x(v).toFixed(1)},${y(windGate(v)).toFixed(1)}`;
  }).join(" ");

  const root = useAnimeScope(() => {
    utils.set(".ds-gate-note", { opacity: 0 });
    createTimeline({ defaults: { ease: "out(2)" } })
      .add(svg.createDrawable(".ds-gate-curve"), { draw: ["0 0", "0 1"], duration: 820 })
      .add(".ds-gate-note", { opacity: [0, 1], duration: 380 }, "-=320");
  }, [ms], { backstop: PLATE_BACKSTOP });

  return (
    <div ref={root}>
      <svg
        viewBox={`0 0 ${GW} ${GH}`}
        className="w-full"
        role="img"
        aria-label={`Wind gate multiplier against wind speed, sampled at ${ms.toFixed(1)} metres per second`}
      >
        <path
          d={`M${pad},${y(1)} L${pad},${y(0)} L${GW - pad},${y(0)}`}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={0.9}
        />
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line
              x1={pad}
              y1={y(v)}
              x2={GW - pad}
              y2={y(v)}
              stroke="var(--line)"
              strokeWidth={0.7}
              strokeDasharray="1 6"
            />
            <text x={pad - 7} y={y(v) + 3} textAnchor="end" style={TICK_TEXT}>
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {[0, 5, 10, 15].map((v) => (
          <text key={v} x={x(v)} y={GH - 12} textAnchor="middle" style={TICK_TEXT}>
            {v}
          </text>
        ))}

        <path
          className="ds-gate-curve"
          d={curve}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={1.6}
        />

        <g className="ds-gate-note">
          <line
            x1={x(ms)}
            y1={y(0)}
            x2={x(ms)}
            y2={y(value)}
            stroke="var(--accent)"
            strokeWidth={1.2}
          />
          <circle cx={x(ms)} cy={y(value)} r={3.2} fill="var(--accent)" />
          <text
            x={Math.min(GW - pad, x(ms) + 8)}
            y={y(value) - 8}
            style={{ ...NOTE_TEXT, fill: "var(--accent)" }}
          >
            {ms.toFixed(1)} m/s → ×{value.toFixed(2)}
          </text>
        </g>
        <text x={GW - pad} y={GH - 12} textAnchor="end" style={{ ...NOTE_TEXT, fill: "var(--ink-faint)" }}>
          m/s
        </text>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Plate: the event, as a timeline strip
 * ------------------------------------------------------------------ */

/**
 * Released fraction and surface extent across the whole event, with the reader's
 * current hour marked.
 *
 * This is the plate the register in Part IV is read against. A spill is not a
 * shape; it is a quantity entering the water over hours and then being carried,
 * and the two traces here are exactly those two facts. The phase boundaries are
 * ruled onto the strip so the register's rows can be located on it.
 */
export function EventStrip({
  run,
  hour,
  onScrub,
}: {
  run: Run;
  hour: number;
  onScrub?: (h: number) => void;
}) {
  const SW = 920;
  const SH = 190;
  const L = 46;
  const R = 24;
  const T = 18;
  const B = 34;

  const frames = run.release;
  const h0 = frames[0]?.hour ?? 0;
  const h1 = frames[frames.length - 1]?.hour ?? 1;
  const areaMax = Math.max(...frames.map((f) => f.areaKm2)) * 1.1 || 1;
  const x = (h: number) => L + ((h - h0) / (h1 - h0 || 1)) * (SW - L - R);
  const yFrac = (v: number) => SH - B - v * (SH - T - B);
  const yArea = (v: number) => SH - B - (v / areaMax) * (SH - T - B);

  const fracPath = frames
    .map((f, i) => `${i === 0 ? "M" : "L"}${x(f.hour).toFixed(1)},${yFrac(f.releasedFraction).toFixed(1)}`)
    .join(" ");
  const areaPath = frames
    .map((f, i) => `${i === 0 ? "M" : "L"}${x(f.hour).toFixed(1)},${yArea(f.areaKm2).toFixed(1)}`)
    .join(" ");

  const marks: { hour: number; label: string }[] = [
    { hour: run.releaseStartHour, label: "Discharge begins" },
    ...(run.releaseEndHour < -0.5
      ? [{ hour: run.releaseEndHour, label: "Discharge stops" }]
      : []),
    { hour: 0, label: "Satellite pass" },
  ];

  const root = useAnimeScope(() => {
    createTimeline({ defaults: { ease: "out(2)" } })
      .add(svg.createDrawable(".ds-strip-axis"), { draw: ["0 0", "0 1"], duration: 460 })
      .add(svg.createDrawable(".ds-strip-line"), { draw: ["0 0", "0 1"], duration: 900, delay: stagger(140) }, "-=200");
  }, [run.meta.id], { backstop: PLATE_BACKSTOP });

  if (frames.length < 2) return null;

  return (
    <div ref={root}>
      <svg
        viewBox={`0 0 ${SW} ${SH}`}
        className="w-full"
        role="img"
        aria-label="Released fraction and surface extent across the event, hour by hour"
        onClick={
          onScrub
            ? (e) => {
                // Click-to-scrub on the strip. The register below is long, and
                // being able to jump the whole document's clock by pointing at
                // an hour on the chart is the difference between a figure and a
                // working exhibit.
                const box = e.currentTarget.getBoundingClientRect();
                const u = ((e.clientX - box.left) / box.width) * SW;
                const h = h0 + ((u - L) / (SW - L - R)) * (h1 - h0);
                onScrub(Math.max(h0, Math.min(h1, Math.round(h))));
              }
            : undefined
        }
        style={onScrub ? { cursor: "crosshair" } : undefined}
      >
        {marks.map((m) => (
          <g key={m.label}>
            <line
              x1={x(m.hour)}
              y1={T}
              x2={x(m.hour)}
              y2={SH - B}
              stroke="var(--ink-faint)"
              strokeWidth={0.8}
              strokeDasharray="3 3"
            />
            <text
              x={x(m.hour) + 4}
              y={T + 9}
              style={{ ...TICK_TEXT, fill: "var(--ink-faint)" }}
            >
              {m.label}
            </text>
          </g>
        ))}

        <path
          className="ds-strip-axis"
          d={`M${L},${T} L${L},${SH - B} L${SW - R},${SH - B}`}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={1}
        />

        <path
          className="ds-strip-line"
          d={areaPath}
          fill="none"
          stroke="var(--ink-dim)"
          strokeWidth={1.3}
          strokeDasharray="6 3"
        />
        <path
          className="ds-strip-line"
          d={fracPath}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.6}
        />

        {/* The reader's hour. Rendered outside the animation so it tracks the
            scrubber immediately rather than waiting on a timeline. */}
        <g>
          <line
            x1={x(hour)}
            y1={T - 6}
            x2={x(hour)}
            y2={SH - B + 6}
            stroke="var(--ink)"
            strokeWidth={1.4}
          />
          <rect x={x(hour) - 20} y={SH - B + 8} width={40} height={14} fill="var(--ink)" />
          <text
            x={x(hour)}
            y={SH - B + 18}
            textAnchor="middle"
            style={{ ...TICK_TEXT, fill: "var(--base-2)" }}
          >
            {formatHour(hour)}
          </text>
        </g>

        <text x={L} y={12} style={{ ...NOTE_TEXT, fill: "var(--accent)" }}>
          Released fraction
        </text>
        <text x={L + 190} y={12} style={{ ...NOTE_TEXT, fill: "var(--ink-dim)" }}>
          Surface extent, {areaMax.toFixed(0)} km² full scale
        </text>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sparkline
 * ------------------------------------------------------------------ */

/**
 * The raw series behind a behavioural flag.
 *
 * C7 is the reason this exists at all: a flag with no series behind it is an
 * assertion, not evidence, and this project's own note on the behaviour term
 * says an anomaly score with nothing under it is not inspectable. So every flag
 * that carries a series prints it, at the size a document prints one.
 */
export function FlagSeries({
  series,
  label,
}: {
  series: { t: number; v: number }[];
  label: string;
}) {
  const SPW = 320;
  const SPH = 54;
  if (series.length < 2) return null;
  const values = series.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = series
    .map((p, i) => {
      const px = (i / (series.length - 1)) * SPW;
      const py = SPH - 8 - ((p.v - min) / span) * (SPH - 16);
      return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${SPW} ${SPH}`} className="w-full" role="img" aria-label={label}>
        <line x1={0} y1={SPH - 4} x2={SPW} y2={SPH - 4} stroke="var(--line)" strokeWidth={0.8} />
        <path d={d} fill="none" stroke="var(--ink)" strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="text-faint mt-1 font-mono text-[9px] tracking-[0.16em] uppercase">
        {label} · {min.toFixed(1)} to {max.toFixed(1)}
      </p>
    </div>
  );
}
