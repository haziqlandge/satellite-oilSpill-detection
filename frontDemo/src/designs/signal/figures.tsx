/**
 * Signal's figures.
 *
 * Every one of these is an annotated exhibit rather than a chart in a card. The
 * annotation is the point: a publication does not hand a reader a plot and a
 * legend, it writes on the picture and draws a line to the thing it is writing
 * about. The leader lines are stroke-drawn on scroll, which is the one piece of
 * motion in this direction that is doing editorial work rather than decoration.
 *
 * Nothing here is imported by the other three directions and nothing here is
 * generalised for them. Terminal draws the same field as a wireframe scope and
 * Dossier draws it as a ruled plate; those are different pictures of the same
 * numbers, which is the entire premise.
 */

import { useMemo } from "react";
import { createTimeline, stagger, svg, utils } from "animejs";
import { SarTile, boundsFor } from "../../components/SarTile";
import { useAnimeScope } from "../../lib/motion";
import {
  fieldHours,
  fieldProjection,
  fitProjection,
  linePath,
  ringPath,
  seriesPath,
  type Projection,
} from "../../lib/project";
import { formatHour, relHour } from "../../lib/format";
import { growthCurve, momentAt } from "../../lib/playback";
import { windGate } from "../../sim/slick";
import type { LngLat, Run } from "../../sim/types";

/* ------------------------------------------------------------------ *
 * Exhibit 1: the radar strip, written on
 * ------------------------------------------------------------------ */

// Letterboxed, but not so extreme that a five-kilometre slick becomes a
// thread in a field of speckle. The bounds are fitted to this aspect so the
// geometry is never stretched -- a stretched slick misrepresents the one thing
// this whole section is measuring.
const STRIP_W = 1440;
const STRIP_H = 700;

interface Callout {
  /** Where on the picture the note points. */
  at: LngLat;
  /** Where the note sits, in fractions of the strip. */
  x: number;
  y: number;
  label: string;
  value: string;
  align: "start" | "end";
}

/**
 * The satellite tile, annotated the way a picture desk would annotate it.
 *
 * Not in a card, not rounded, and it bleeds past the reading measure when the
 * page asks it to. Coordinate ticks run along the bottom edge because this is a
 * geolocated picture and saying so is part of the caption.
 */
export function SarStrip({
  run,
  showMask = true,
  annotate = true,
}: {
  run: Run;
  showMask?: boolean;
  /** The deeper section turns the writing off, so the reader can see the raw tile. */
  annotate?: boolean;
}) {
  const bounds = useMemo(
    () => boundsFor(run.detection.parts, 0.26, STRIP_W / STRIP_H),
    [run],
  );
  const c = run.characterisation;

  const toXY = (p: LngLat): [number, number] => {
    const [w, s, e, n] = bounds;
    return [
      ((p[0] - w) / (e - w)) * STRIP_W,
      (1 - (p[1] - s) / (n - s)) * STRIP_H,
    ];
  };

  const callouts: Callout[] = [
    {
      at: c.head,
      x: 0.08,
      y: 0.2,
      label: "Head, freshest oil",
      value: `${c.head[1].toFixed(3)}°N ${Math.abs(c.head[0]).toFixed(3)}°W`,
      align: "start",
    },
    {
      at: c.tail,
      x: 0.9,
      y: 0.78,
      label: "Tail, oldest oil",
      value: `${c.lengthKm.toFixed(1)} km away`,
      align: "end",
    },
    {
      at: c.medialAxis[Math.floor(c.medialAxis.length / 2)] ?? c.head,
      x: 0.5,
      y: 0.14,
      label: "Mean width",
      value: `${c.widthMMean.toFixed(0)} m`,
      align: "start",
    },
  ];

  const root = useAnimeScope(() => {
    utils.set(".sig-callout", { opacity: 0 });
    createTimeline({ defaults: { ease: "out(3)" } })
      .add(svg.createDrawable(".sig-leader"), {
        draw: ["0 0", "0 1"],
        duration: 700,
        delay: stagger(150),
      })
      .add(
        ".sig-callout",
        { opacity: [0, 1], duration: 500, delay: stagger(150) },
        "-=800",
      );
  }, [run.meta.id]);

  const [w, s, e, n] = bounds;
  const ticks = 6;

  return (
    <div ref={root} className="relative">
      <SarTile
        parts={run.detection.parts}
        bounds={bounds}
        seed={run.meta.id}
        dampingDb={c.dampingRatioDb}
        windMs={c.windSpeedMs}
        showMask={showMask}
        maskColour="var(--accent)"
        width={STRIP_W}
        height={STRIP_H}
        className="block w-full"
      />

      <svg
        viewBox={`0 0 ${STRIP_W} ${STRIP_H}`}
        className="pointer-events-none absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
        aria-hidden
      >
        {/* Scrims. Coordinate ticks in the page's faint ink are invisible
            against bright speckle, and lightening them would fight the
            picture. A gradient wash along the edges is what a picture desk
            does and costs the image nothing where it matters. */}
        <defs>
          <linearGradient id="sar-scrim-bottom" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--base)" stopOpacity="0.92" />
            <stop offset="100%" stopColor="var(--base)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sar-scrim-left" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--base)" stopOpacity="0.8" />
            <stop offset="100%" stopColor="var(--base)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect
          x={0}
          y={STRIP_H - 90}
          width={STRIP_W}
          height={90}
          fill="url(#sar-scrim-bottom)"
        />
        <rect x={0} y={0} width={260} height={STRIP_H} fill="url(#sar-scrim-left)" />

        {(annotate ? callouts : []).map((k, i) => {
          const [tx, ty] = toXY(k.at);
          const lx = k.x * STRIP_W;
          const ly = k.y * STRIP_H;
          // An elbow rather than a straight line: it keeps the label on its own
          // baseline and reads as draughting rather than as a tooltip stem.
          const midY = ly;
          return (
            <g key={i}>
              <path
                className="sig-leader"
                d={`M${lx},${ly} L${(lx + tx) / 2},${midY} L${tx},${ty}`}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                opacity={0.85}
              />
              <circle cx={tx} cy={ty} r={3.5} fill="var(--accent)" />
              <circle
                cx={tx}
                cy={ty}
                r={10}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1}
                opacity={0.45}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {/* Coordinate ticks. This is a geolocated picture; the edge says so. */}
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const x = (i / ticks) * STRIP_W;
          const lon = w + (i / ticks) * (e - w);
          return (
            <g key={`t${i}`}>
              <line
                x1={x}
                y1={STRIP_H - 14}
                x2={x}
                y2={STRIP_H}
                stroke="var(--ink-faint)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={x + 6}
                y={STRIP_H - 20}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  fill: "var(--ink-faint)",
                }}
              >
                {lon.toFixed(2)}
              </text>
            </g>
          );
        })}
        <text
          x={12}
          y={26}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            letterSpacing: "0.2em",
            fill: "var(--ink-faint)",
          }}
        >
          {n.toFixed(2)}°N
        </text>
        <text
          x={12}
          y={STRIP_H - 40}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            letterSpacing: "0.2em",
            fill: "var(--ink-faint)",
          }}
        >
          {s.toFixed(2)}°N
        </text>
      </svg>

      {/*
        The callout text is HTML rather than SVG <text>, deliberately.

        A radar amplitude image is bright, uneven and speckled, and accent-on-
        speckle is unreadable at any size. Type on a picture needs a plate
        behind it, and a plate needs real text metrics -- which SVG will not
        give you without measuring and hand-drawing a rect per label. Positioned
        HTML gets padding, wrapping and the page's own background for free, and
        the leader lines stay in the SVG underneath where they belong.
      */}
      {annotate &&
        callouts.map((k) => (
          <div
            key={k.label}
            className="sig-callout pointer-events-none absolute"
            style={{
              left: `${k.x * 100}%`,
              top: `${k.y * 100}%`,
              transform: `translate(${k.align === "end" ? "-100%" : "0"}, -100%)`,
              paddingBottom: 10,
            }}
          >
            <div
              className="inline-block px-2.5 py-1.5"
              style={{
                background: "color-mix(in oklab, var(--base) 88%, transparent)",
                borderLeft: "2px solid var(--accent)",
                backdropFilter: "blur(3px)",
              }}
            >
              <p className="text-accent font-mono text-[9.5px] tracking-[0.2em] whitespace-nowrap uppercase">
                {k.label}
              </p>
              <p className="num text-ink mt-0.5 text-[13px] whitespace-nowrap">
                {k.value}
              </p>
            </div>
          </div>
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Exhibit 2: the backward field, as a printed plate
 * ------------------------------------------------------------------ */

const PLATE_W = 1180;
const PLATE_H = 520;

/**
 * The origin field contracting through the hours before the pass.
 *
 * Drawn as a stack of hour contours with each ring labelled on the page rather
 * than in a legend, because a legend asks the reader to hold six colours in
 * their head and a label does not. The vessel track draws last: the argument
 * the figure makes is that the field arrives at it.
 */
export function BackwardPlate({ run }: { run: Run }) {
  const hours = useMemo(() => fieldHours(run, 7), [run]);
  const proj = useMemo(
    () => fieldProjection(run, PLATE_W, PLATE_H, hours, 1.22),
    [run, hours],
  );

  const root = useAnimeScope(() => {
    utils.set(".plate-label, .plate-mark", { opacity: 0 });
    createTimeline({ defaults: { ease: "out(2)" } })
      .add(svg.createDrawable(".plate-ring"), {
        draw: ["0 0", "0 1"],
        duration: 760,
        delay: stagger(110),
      })
      .add(
        ".plate-label",
        { opacity: [0, 1], duration: 380, delay: stagger(110) },
        "-=760",
      )
      .add(svg.createDrawable(".plate-track"), { draw: ["0 0", "0 1"], duration: 900 }, "-=520")
      .add(".plate-slick", { opacity: [0, 1], duration: 560 }, "-=700")
      .add(".plate-mark", { opacity: [0, 1], duration: 420 }, "-=300");
  }, [run.meta.id]);

  const frames = hours
    .map((h) => ({ hour: h, frame: run.drift.frames.find((f) => f.hour === h) }))
    .filter((x) => x.frame);

  const top = run.suspects[0];
  const head = proj.toXY(run.characterisation.head);

  return (
    <div ref={root}>
      <svg
        viewBox={`0 0 ${PLATE_W} ${PLATE_H}`}
        className="w-full"
        role="img"
        aria-label="Backward drift contours contracting through the hours before acquisition"
      >
        {frames.map(({ hour, frame }, i) => {
          const rings = frame!.contour90;
          const outermost = rings[0];
          const anchor = outermost
            ? proj.toXY(
                outermost.reduce(
                  (best, p) => (p[1] > best[1] ? p : best),
                  outermost[0],
                ),
              )
            : null;
          return (
            <g key={hour}>
              {rings.map((ring, j) => (
                <path
                  key={j}
                  className="plate-ring"
                  d={ringPath(ring, proj)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={1}
                  strokeDasharray={i === frames.length - 1 ? undefined : "5 4"}
                  opacity={0.22 + (i / frames.length) * 0.62}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {anchor && i % 2 === 0 && (
                <text
                  className="plate-label"
                  x={anchor[0]}
                  y={anchor[1] - 7}
                  textAnchor="middle"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    fill: "var(--ink-faint)",
                  }}
                >
                  {formatHour(hour)}
                </text>
              )}
            </g>
          );
        })}

        {top?.track && (
          <path
            className="plate-track"
            d={linePath(top.track, proj)}
            fill="none"
            stroke="var(--ink-dim)"
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {run.detection.parts.map((ring, i) => (
          <path
            key={i}
            className="plate-slick"
            d={ringPath(ring, proj)}
            fill="var(--accent)"
            fillOpacity={0.32}
            stroke="var(--accent)"
            strokeWidth={1.4}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <g className="plate-mark">
          <circle cx={head[0]} cy={head[1]} r={4} fill="var(--accent)" />
          <line
            x1={head[0]}
            y1={head[1]}
            x2={head[0] + 74}
            y2={head[1] - 40}
            stroke="var(--accent)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={head[0] + 80}
            y={head[1] - 42}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fill: "var(--accent)",
            }}
          >
            Slick head at the pass
          </text>
        </g>

        <ScaleBar proj={proj} y={PLATE_H - 22} x={26} />
      </svg>
    </div>
  );
}

function ScaleBar({ proj, x, y }: { proj: Projection; x: number; y: number }) {
  // Pick a round number of kilometres that lands somewhere sensible on the
  // plate rather than a fixed pixel length labelled with whatever it works out
  // to, which is the usual way a scale bar ends up saying 7.3 km.
  const target = proj.width * 0.16 * proj.kmPerUnit;
  const nice = [1, 2, 5, 10, 20, 50, 100, 200].reduce((best, v) =>
    Math.abs(v - target) < Math.abs(best - target) ? v : best,
  );
  const px = nice / proj.kmPerUnit;

  return (
    <g aria-hidden>
      <line x1={x} y1={y} x2={x + px} y2={y} stroke="var(--ink-dim)" strokeWidth={1.5} />
      <line x1={x} y1={y - 4} x2={x} y2={y + 4} stroke="var(--ink-dim)" strokeWidth={1.5} />
      <line
        x1={x + px}
        y1={y - 4}
        x2={x + px}
        y2={y + 4}
        stroke="var(--ink-dim)"
        strokeWidth={1.5}
      />
      <text
        x={x + px / 2}
        y={y - 9}
        textAnchor="middle"
        style={{ fontFamily: "var(--font-mono)", fontSize: 12, fill: "var(--ink-dim)" }}
      >
        {nice} km
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * Exhibit 3: the release, as small multiples
 *
 * The spill did not arrive finished. This is the sequence a picture editor
 * would run across a spread: six frames of the same water, hours apart, with
 * the oil growing from almost nothing and the traffic that was there at each
 * moment counted underneath. It is the forward half of the argument the plate
 * above makes backward.
 * ------------------------------------------------------------------ */

export function ReleaseSequence({ run, frames = 6 }: { run: Run; frames?: number }) {
  const hours = useMemo(() => {
    const start = run.releaseStartHour;
    return Array.from({ length: frames }, (_, i) =>
      Math.round(start + ((0 - start) * i) / (frames - 1)),
    );
  }, [run, frames]);

  const moments = useMemo(
    () => hours.map((h) => momentAt(run, h)),
    [run, hours],
  );

  // One projection across every frame, so the growth is a real comparison and
  // not six independently fitted pictures.
  const proj = useMemo(() => {
    const pts: LngLat[] = [];
    for (const m of moments) for (const ring of m.release?.extent ?? []) pts.push(...ring);
    for (const ring of run.detection.parts) pts.push(...ring);
    return fitProjection(pts, 240, 200, 1.3);
  }, [moments, run]);

  const root = useAnimeScope(() => {
    utils.set(".seq-cell", { opacity: 0, translateY: 16 });
    createTimeline({ defaults: { ease: "out(3)" } }).add(".seq-cell", {
      opacity: [0, 1],
      translateY: [16, 0],
      duration: 620,
      delay: stagger(90),
    });
  }, [run.meta.id]);

  return (
    <div ref={root} className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
      {moments.map((m, i) => (
        <div key={m.hour} className="seq-cell">
          <div className="flex items-baseline justify-between">
            <span className="text-accent font-mono text-[10px] tracking-[0.18em]">
              {formatHour(m.hour)}
            </span>
            <span className="text-faint font-mono text-[9.5px]">
              {String(i + 1).padStart(2, "0")}
            </span>
          </div>

          <svg
            viewBox="0 0 240 200"
            className="mt-2 w-full"
            style={{ borderTop: "1px solid var(--line)" }}
            role="img"
            aria-label={`Surface extent of the oil ${Math.abs(m.hour)} hours before acquisition`}
          >
            {/* The eventual detection, ghosted, so every frame is read against
                where the slick ends up rather than against itself. */}
            {run.detection.parts.map((ring, j) => (
              <path
                key={`g${j}`}
                d={ringPath(ring, proj)}
                fill="none"
                stroke="var(--ink-faint)"
                strokeWidth={0.8}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                opacity={0.5}
              />
            ))}
            {(m.release?.extent ?? []).map((ring, j) => (
              <path
                key={j}
                d={ringPath(ring, proj)}
                fill="var(--accent)"
                fillOpacity={0.38}
                stroke="var(--accent)"
                strokeWidth={1.1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {m.contacts.slice(0, 6).map((ct) => {
              const [x, y] = proj.toXY(ct.position);
              return (
                <g key={ct.mmsi}>
                  <circle
                    cx={x}
                    cy={y}
                    r={ct.candidate ? 3.2 : 2}
                    fill={ct.candidate ? "var(--ink)" : "none"}
                    stroke="var(--ink-dim)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
          </svg>

          <p className="num text-ink mt-2 text-[15px]">
            {m.areaKm2.toFixed(2)}
            <span className="text-dim ml-1 text-[10px]">km²</span>
          </p>
          <p className="text-faint mt-0.5 font-mono text-[10px]">
            {(m.releasedFraction * 100).toFixed(0)}% discharged
          </p>
          <p className="text-dim mt-1.5 text-[12px] leading-[1.4]" style={{ fontFamily: "var(--font-body)" }}>
            {m.contacts.length === 0
              ? "No traffic within 12 km"
              : `${m.contacts.length} vessel${m.contacts.length === 1 ? "" : "s"} within 12 km${
                  m.inContact ? `, ${m.inContact} in the oil` : ""
                }`}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Marginal figures
 * ------------------------------------------------------------------ */

/** A small plot for the margin. No axes, no frame, one labelled endpoint. */
export function MarginPlot({
  values,
  caption,
  markFraction,
}: {
  values: number[];
  caption: string;
  markFraction?: number;
}) {
  const W = 200;
  const H = 46;
  const d = seriesPath(values, W, H, 3);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} aria-hidden>
        <path d={d} fill="none" stroke="var(--ink-dim)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        {markFraction !== undefined && (
          <line
            x1={markFraction * W}
            y1={0}
            x2={markFraction * W}
            y2={H}
            stroke="var(--accent)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <p className="text-faint mt-1 font-mono text-[9.5px] tracking-[0.1em] uppercase">
        {caption}
      </p>
    </div>
  );
}

/** The wind gate curve, with the sampled wind marked on it. */
export function WindGateFigure({ ms, value }: { ms: number; value: number }) {
  const W = 200;
  const H = 60;
  const maxMs = 18;
  const pts: string[] = [];
  for (let i = 0; i <= 90; i++) {
    const v = (i / 90) * maxMs;
    const x = (v / maxMs) * W;
    const y = H - windGate(v) * (H - 6) - 3;
    pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const markX = (Math.min(ms, maxMs) / maxMs) * W;
  const markY = H - value * (H - 6) - 3;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} aria-hidden>
        <path d={pts.join(" ")} fill="none" stroke="var(--ink-dim)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        <line x1={markX} y1={0} x2={markX} y2={H} stroke="var(--accent)" strokeWidth={1} strokeDasharray="2 2" />
        <circle cx={markX} cy={markY} r={3} fill="var(--accent)" />
      </svg>
      <div className="text-faint mt-1 flex justify-between font-mono text-[9.5px]">
        <span>0</span>
        <span>3</span>
        <span>12</span>
        <span>18 m/s</span>
      </div>
    </div>
  );
}

/**
 * How the origin field widens the further back you look.
 *
 * The curve this project refuses to tune away, drawn at editorial width because
 * it is an argument rather than a diagnostic.
 */
export function WideningFigure({ run }: { run: Run }) {
  const W = 1180;
  const H = 240;
  const series = run.drift.convergence;
  const maxArea = Math.max(...series.map((s) => s.area90Km2), 1);
  const minHour = Math.min(...series.map((s) => s.hour));
  const x = (h: number) => ((h - minHour) / (0 - minHour || 1)) * W;
  const y = (a: number) => H - (a / maxArea) * (H - 26) - 12;

  const path = series
    .map((s, i) => `${i === 0 ? "M" : "L"}${x(s.hour).toFixed(1)},${y(s.area90Km2).toFixed(1)}`)
    .join(" ");

  const root = useAnimeScope(() => {
    createTimeline().add(svg.createDrawable(".widen-line"), {
      draw: ["0 0", "0 1"],
      duration: 1200,
      ease: "inOut(2)",
    });
  }, [run.meta.id]);

  const [lo, , hi] = run.drift.ageHours;

  return (
    <div ref={root}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ninety per cent origin contour area against hours before acquisition">
        <rect
          x={x(-hi)}
          y={0}
          width={Math.max(3, x(-lo) - x(-hi))}
          height={H}
          fill="var(--accent)"
          opacity={0.12}
        />
        <text
          x={x(-hi) + 8}
          y={18}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            fill: "var(--accent)",
          }}
        >
          Estimated release window
        </text>
        <path
          className="widen-line"
          d={path}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
        />
        {series
          .filter((_, i) => i % Math.ceil(series.length / 7) === 0)
          .map((s) => (
            <g key={s.hour}>
              <line
                x1={x(s.hour)}
                y1={H - 10}
                x2={x(s.hour)}
                y2={H}
                stroke="var(--ink-faint)"
                strokeWidth={1}
              />
              <text
                x={x(s.hour)}
                y={H - 14}
                textAnchor="middle"
                style={{ fontFamily: "var(--font-mono)", fontSize: 12, fill: "var(--ink-faint)" }}
              >
                {relHour(s.hour)}h
              </text>
            </g>
          ))}
        <text
          x={W - 4}
          y={y(series[0]?.area90Km2 ?? 0) - 10}
          textAnchor="end"
          style={{ fontFamily: "var(--font-mono)", fontSize: 13, fill: "var(--ink-dim)" }}
        >
          {maxArea.toFixed(0)} km² at the far end
        </text>
      </svg>
    </div>
  );
}

/** Total oil on the surface through the whole event. Margin-sized. */
export function GrowthFigure({ run }: { run: Run }) {
  const curve = useMemo(() => growthCurve(run), [run]);
  return (
    <MarginPlot
      values={curve.map((c) => c.areaKm2)}
      caption={`Surface extent, ${Math.abs(run.releaseStartHour)} h of event`}
    />
  );
}
