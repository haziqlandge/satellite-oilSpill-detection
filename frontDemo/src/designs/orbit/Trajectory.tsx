/**
 * ORBIT -- the temporal strip.
 *
 * Time in this product is a spatial dimension, not a value in a field. The strip
 * spans the whole event: from the first parcel of oil entering the water,
 * through the discharge, through the hours the slick was adrift, to the
 * satellite pass, and on to the end of the forecast. Everything that happened is
 * on one axis, positioned, with the estimated release window drawn as a band
 * over it rather than printed as a number somewhere else.
 *
 * That is also why the transport is here and not inside a module. Moving the
 * mission clock moves the chart, the particle cloud, the release extent, the
 * contact list, the growth trace, the released fraction and the phase lamp at
 * once, and that simultaneity is the argument: this is a system watching one
 * event, not six panels that each happen to have a time input.
 *
 * The event playback is the central animation of the direction. It runs the
 * discharge from its first hour, so the viewer sees a small patch of oil become
 * a large one and then drift, with the traffic moving alongside it the whole
 * time. What that shows is *presence*, and the panel is careful to say so: being
 * in the water near oil is a far weaker claim than being a scored candidate, and
 * the two are never drawn in the same ink.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDesign } from "../../DesignContext";
import { ageStatement, clock, formatHour, relHour, stamp } from "../../lib/format";
import { PHASE_LABEL, eventSpan, type Moment } from "../../lib/playback";
import { alpha } from "./instruments";
import type { DesignDef } from "../../design";
import type { Run } from "../../sim/types";

/** How often the clock is allowed to push a new hour during playback. */
const PUSH_MS = 55;

const RATES = [
  { value: 2, label: "1×" },
  { value: 5, label: "2×" },
  { value: 12, label: "5×" },
];

export default function Trajectory({
  run,
  hour,
  setHour,
  moment,
}: {
  run: Run;
  hour: number;
  setHour: (h: number) => void;
  moment: Moment;
}) {
  const def = useDesign();
  const [lo, hi] = eventSpan(run);
  const age = ageStatement(run.drift);

  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [rate, setRate] = useState(RATES[0].value);

  /* --- playback ---------------------------------------------------- */

  /**
   * The clock advances on its own accumulator, not on the `hour` prop.
   *
   * Reading the prop inside the frame loop couples playback speed to React's
   * render rate: every push re-runs the map's time effect, which rebuilds the
   * AIS polylines, and on a heavy scenario the loop then advances by whatever
   * fraction of an hour survived the render. The accumulator keeps wall-clock
   * time authoritative and pushes at a fixed cadence, so playback runs at the
   * stated hours-per-second whatever the frame budget is doing. `hourRef` is
   * only consulted to notice that the *user* moved the clock underneath us.
   */
  const hourRef = useRef(hour);
  hourRef.current = hour;
  const pushedRef = useRef(hour);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const loopRef = useRef(loop);
  loopRef.current = loop;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let pos = hourRef.current >= hi - 0.01 ? lo : hourRef.current;
    let last = performance.now();
    let lastPush = 0;

    const tick = (now: number) => {
      // The user scrubbed while it was running: adopt their position.
      if (Math.abs(hourRef.current - pushedRef.current) > 0.02) {
        pos = hourRef.current;
      }
      pos += ((now - last) / 1000) * rateRef.current;
      last = now;

      if (pos >= hi) {
        if (loopRef.current) {
          pos = lo;
        } else {
          pushedRef.current = hi;
          setHour(hi);
          setPlaying(false);
          return;
        }
      }

      if (now - lastPush >= PUSH_MS) {
        lastPush = now;
        pushedRef.current = pos;
        setHour(pos);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, lo, hi, setHour]);

  const jump = (h: number) => {
    pushedRef.current = h;
    setHour(Math.max(lo, Math.min(hi, h)));
  };

  /* --- geometry ---------------------------------------------------- */

  const boxRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setW(Math.max(320, el.clientWidth));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const H = 96;
  const PAD = 16;
  const AXIS = 52;
  const inner = Math.max(80, w - PAD * 2);
  const x = (h: number) => PAD + ((h - lo) / (hi - lo || 1)) * inner;

  /* Phase segments. The axis is drawn in four inks because the event is in four
     states, and a single-colour axis would make the discharge and the forecast
     look like the same kind of time. */
  const segments: { from: number; to: number; tone: string; width: number; dash?: string }[] = [
    { from: lo, to: run.releaseStartHour, tone: alpha("var(--ink-faint)", 55), width: 1 },
    { from: run.releaseStartHour, to: run.releaseEndHour, tone: def.map.slick, width: 3 },
    { from: run.releaseEndHour, to: 0, tone: alpha(def.map.contour50, 60), width: 2 },
    { from: 0, to: hi, tone: def.map.forecast, width: 2, dash: "4 3" },
  ].filter((s) => s.to > s.from);

  /* The estimated release window, as a band rather than a printed interval.
     C1: an age is never a scalar, and this is the interval made geometric. */
  const [ageLo, ageBest, ageHi] = run.drift.ageHours;
  const bandFrom = -Math.max(1, ageHi);
  const bandTo = age.degenerate ? 0 : -ageLo;

  const nodes = buildNodes(run, lo, hi, ageBest, age.degenerate);
  const placed = placeLabels(nodes, x, 96);

  const ticks: number[] = [];
  const step = hi - lo > 96 ? 24 : hi - lo > 48 ? 12 : 6;
  for (let h = Math.ceil(lo / step) * step; h <= hi; h += step) ticks.push(h);

  return (
    <div
      className="pointer-events-auto relative z-30 w-full"
      style={{
        borderTop: `1px solid ${alpha("var(--line)", 100)}`,
        background: alpha("var(--base)", 82),
        backdropFilter: "blur(18px) saturate(1.2)",
        WebkitBackdropFilter: "blur(18px) saturate(1.2)",
      }}
    >
      <div className="flex items-stretch gap-3 px-3 py-2 sm:gap-4 sm:px-4">
        {/* --- transport --------------------------------------------- */}
        <div className="flex shrink-0 flex-col justify-between gap-1.5 py-0.5">
          <div className="flex items-center gap-1">
            <Key title="To the first parcel" onClick={() => jump(lo)} glyph="start" />
            <Key title="Back one hour" onClick={() => jump(hour - 1)} glyph="prev" />
            <Key
              title={playing ? "Hold the event" : "Run the event"}
              onClick={() => setPlaying((p) => !p)}
              glyph={playing ? "pause" : "play"}
              primary
            />
            <Key title="Forward one hour" onClick={() => jump(hour + 1)} glyph="next" />
            <Key title="To the forecast horizon" onClick={() => jump(hi)} glyph="end" />
          </div>

          <div className="flex items-center gap-1">
            {RATES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRate(r.value)}
                className="num rounded-[3px] px-1.5 py-[3px] text-[9px] tracking-[0.1em]"
                style={{
                  color: rate === r.value ? "var(--accent)" : "var(--ink-faint)",
                  border: `1px solid ${rate === r.value ? alpha("var(--accent)", 55) : alpha("var(--line)", 100)}`,
                  background: rate === r.value ? alpha("var(--accent)", 12) : "transparent",
                }}
              >
                {r.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setLoop((l) => !l)}
              aria-pressed={loop}
              title="Repeat the event"
              className="num rounded-[3px] px-1.5 py-[3px] text-[9px] tracking-[0.1em]"
              style={{
                color: loop ? "var(--accent)" : "var(--ink-faint)",
                border: `1px solid ${loop ? alpha("var(--accent)", 55) : alpha("var(--line)", 100)}`,
                background: loop ? alpha("var(--accent)", 12) : "transparent",
              }}
            >
              RPT
            </button>
          </div>
        </div>

        {/* --- the axis ----------------------------------------------- */}
        <div ref={boxRef} className="relative min-w-0 flex-1">
          <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block">
            {/* Release window band. Drawn above the axis and labelled with the
                statement, never with a bare number. */}
            <g>
              <rect
                x={x(bandFrom)}
                y={8}
                width={Math.max(2, x(bandTo) - x(bandFrom))}
                height={13}
                fill={alpha(def.map.contour50, 14)}
                stroke={alpha(def.map.contour50, 55)}
                strokeWidth="1"
                strokeDasharray={age.degenerate ? "3 2" : undefined}
                rx="2"
              />
              {!age.degenerate && (
                <line
                  x1={x(-ageBest)}
                  y1={6}
                  x2={x(-ageBest)}
                  y2={23}
                  stroke={def.map.contour50}
                  strokeWidth="1.4"
                />
              )}
              <text
                x={Math.min(w - 6, x(bandTo) + 6)}
                y={18}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 8.5,
                  fill: "var(--ink-dim)",
                  letterSpacing: "0.12em",
                }}
              >
                {`RELEASE WINDOW ${age.value.toUpperCase()}`}
              </text>
            </g>

            {/* Discharge band: how long oil was actually entering the water. */}
            <g>
              <rect
                x={x(run.releaseStartHour)}
                y={27}
                width={Math.max(2, x(run.releaseEndHour) - x(run.releaseStartHour))}
                height={9}
                fill={alpha(def.map.slick, 18)}
                stroke={alpha(def.map.slick, 65)}
                strokeWidth="1"
                rx="2"
              />
              <text
                x={Math.min(w - 6, x(run.releaseEndHour) + 6)}
                y={35}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 8.5,
                  fill: "var(--ink-faint)",
                  letterSpacing: "0.12em",
                }}
              >
                {`DISCHARGE ${Math.round(run.releaseEndHour - run.releaseStartHour)}h`}
              </text>
            </g>

            {/* The axis itself, in four inks. */}
            {segments.map((s, i) => (
              <line
                key={i}
                x1={x(s.from)}
                y1={AXIS}
                x2={x(s.to)}
                y2={AXIS}
                stroke={s.tone}
                strokeWidth={s.width}
                strokeDasharray={s.dash}
                strokeLinecap="round"
              />
            ))}

            {/* Hour graduations. */}
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={x(t)}
                  y1={AXIS + 4}
                  x2={x(t)}
                  y2={AXIS + (t === 0 ? 11 : 8)}
                  stroke={t === 0 ? "var(--ink-dim)" : alpha("var(--ink-faint)", 70)}
                  strokeWidth="1"
                />
                <text
                  x={x(t)}
                  y={AXIS + 21}
                  textAnchor="middle"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 8.5,
                    fill: "var(--ink-faint)",
                  }}
                >
                  {relHour(t)}
                </text>
              </g>
            ))}

            {/* Event nodes. */}
            {placed.map((n) => (
              <g key={n.label}>
                <line
                  x1={x(n.h)}
                  y1={AXIS}
                  x2={x(n.h)}
                  y2={n.row === 0 ? 76 : 85}
                  stroke={alpha(n.tone(def), 45)}
                  strokeWidth="1"
                />
                <circle
                  cx={x(n.h)}
                  cy={AXIS}
                  r={n.primary ? 4.2 : 3}
                  fill={n.primary ? n.tone(def) : "var(--base)"}
                  stroke={n.tone(def)}
                  strokeWidth="1.4"
                />
                <text
                  x={x(n.h)}
                  y={n.row === 0 ? 84 : 93}
                  textAnchor={n.anchor}
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 8.5,
                    fontWeight: 600,
                    letterSpacing: "0.14em",
                    fill: n.primary ? "var(--ink)" : "var(--ink-faint)",
                  }}
                >
                  {n.label}
                </text>
              </g>
            ))}

            {/* Playhead. */}
            <g>
              <line
                x1={x(hour)}
                y1={2}
                x2={x(hour)}
                y2={H - 2}
                stroke="var(--accent)"
                strokeWidth="1"
                opacity={0.75}
              />
              <path
                d={`M${x(hour) - 5} 2 L${x(hour) + 5} 2 L${x(hour)} 10 Z`}
                fill="var(--accent)"
              />
              <circle cx={x(hour)} cy={AXIS} r="3" fill="var(--accent)" />
            </g>
          </svg>

          {/*
            A real range input sits over the axis, transparent.

            Arrow keys, Home, End, page steps and the screen-reader announcement
            all come from the platform. Reimplementing that on a div is how a
            time control ends up mouse-only.
          */}
          <input
            type="range"
            className="scrub absolute inset-x-0"
            style={
              {
                top: AXIS - 13,
                "--scrub-track": "transparent",
                "--scrub-thumb": "transparent",
                "--scrub-thumb-w": "16px",
                "--scrub-thumb-h": "26px",
              } as React.CSSProperties
            }
            min={lo}
            max={hi}
            step={0.5}
            value={hour}
            onChange={(e) => {
              setPlaying(false);
              jump(Number(e.target.value));
            }}
            aria-label="Mission clock, hours from the satellite acquisition"
            aria-valuetext={`${formatHour(hour)}, ${PHASE_LABEL[moment.phase]}`}
          />
        </div>

        {/* --- mission clock ------------------------------------------ */}
        <div className="hidden w-[168px] shrink-0 flex-col justify-center gap-0.5 sm:flex">
          <div className="flex items-baseline gap-1.5">
            <span
              className="num leading-none"
              style={{ fontSize: 26, color: "var(--accent)", fontWeight: 500 }}
            >
              {formatHour(hour)}
            </span>
            <span className="num text-[10px]" style={{ color: "var(--ink-faint)" }}>
              {clock(moment.at)}Z
            </span>
          </div>
          <p
            className="text-[10px] tracking-[0.14em] uppercase"
            style={{ fontFamily: "var(--font-display)", color: "var(--ink-dim)", fontWeight: 600 }}
          >
            {PHASE_LABEL[moment.phase]}
          </p>
          <p className="num text-[9px]" style={{ color: "var(--ink-faint)" }}>
            {stamp(moment.at)}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Nodes
 * ------------------------------------------------------------------ */

interface Node {
  h: number;
  label: string;
  primary: boolean;
  tone: (d: DesignDef) => string;
}

interface Placed extends Node {
  row: 0 | 1;
  anchor: "start" | "middle" | "end";
}

function buildNodes(
  run: Run,
  lo: number,
  hi: number,
  ageBest: number,
  degenerate: boolean,
): Node[] {
  const nodes: Node[] = [
    {
      h: lo,
      label: "HINDCAST LIMIT",
      primary: false,
      tone: () => "var(--ink-faint)",
    },
    {
      h: run.releaseStartHour,
      label: "RELEASE BEGINS",
      primary: true,
      tone: (d) => d.map.slick,
    },
    {
      h: 0,
      label: "SAR ACQUISITION",
      primary: true,
      tone: () => "var(--ink)",
    },
    {
      h: hi,
      label: `FORECAST +${Math.round(hi)}h`,
      primary: false,
      tone: (d) => d.map.forecast,
    },
  ];

  // An ongoing discharge has no stop node: the release had not ended when the
  // satellite passed, and drawing a marker there would invent the moment it did.
  if (run.releaseEndHour < -0.5) {
    nodes.splice(2, 0, {
      h: run.releaseEndHour,
      label: "DISCHARGE ENDS",
      primary: false,
      tone: (d) => d.map.slick,
    });
  }

  if (!degenerate) {
    nodes.splice(nodes.length - 2, 0, {
      h: -ageBest,
      label: "BEST ESTIMATE",
      primary: false,
      tone: (d) => d.map.contour50,
    });
  }

  return nodes.sort((a, b) => a.h - b.h);
}

/**
 * Two label rows, used only when the labels would otherwise overlap.
 *
 * A fixed alternating pattern wastes the second row on strips where everything
 * fits; measuring first and only dropping a label when its neighbour is inside
 * the minimum gap keeps the common case on one line.
 */
function placeLabels(nodes: Node[], x: (h: number) => number, minGap: number): Placed[] {
  const out: Placed[] = [];
  let lastRow0 = -Infinity;

  for (let i = 0; i < nodes.length; i++) {
    const px = x(nodes[i].h);
    const row: 0 | 1 = px - lastRow0 < minGap ? 1 : 0;
    if (row === 0) lastRow0 = px;
    const anchor: Placed["anchor"] =
      i === 0 ? "start" : i === nodes.length - 1 ? "end" : "middle";
    out.push({ ...nodes[i], row, anchor });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Transport keys
 * ------------------------------------------------------------------ */

type Glyph = "start" | "prev" | "play" | "pause" | "next" | "end";

function Key({
  glyph,
  title,
  onClick,
  primary = false,
}: {
  glyph: Glyph;
  title: string;
  onClick: () => void;
  primary?: boolean;
}) {
  const size = primary ? 30 : 24;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex items-center justify-center rounded-[5px] transition-colors"
      style={{
        width: size,
        height: size,
        border: `1px solid ${primary ? alpha("var(--accent)", 60) : alpha("var(--line)", 100)}`,
        background: primary ? alpha("var(--accent)", 14) : alpha("var(--base-2)", 70),
        color: primary ? "var(--accent)" : "var(--ink-dim)",
      }}
    >
      <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
        {glyph === "start" && <path d="M2 1h1.6v10H2zM11 1v10L4.4 6z" />}
        {glyph === "prev" && <path d="M9.5 1v10L2.5 6z" />}
        {glyph === "play" && <path d="M2.5 1l8 5-8 5z" />}
        {glyph === "pause" && <path d="M2.6 1h2.6v10H2.6zM6.8 1h2.6v10H6.8z" />}
        {glyph === "next" && <path d="M2.5 1v10l7-5z" />}
        {glyph === "end" && <path d="M8.4 1H10v10H8.4zM1 1v10l6.6-5z" />}
      </svg>
    </button>
  );
}
