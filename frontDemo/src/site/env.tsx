/**
 * The forcing, charted.
 *
 * Wind and current are the reason the oil went where it went, and until now the
 * interface asked the reader to take the trajectory on faith. These three
 * graphs are the evidence behind it.
 *
  * They are drawn in the same grammar as the plates next to them -- a neat line
 * with the ticks stepping outside it, a dotted internal grid, mono labels,
 * corner registration marks -- rather than as sparklines. That is a deliberate
 * choice about what they are: a sparkline is an ornament that suggests a shape,
 * and these are measurements a reader is invited to take values off. The frame
 * is what says so.
 *
 * `run.environment` is sampled from the very `Forcing` object the drift
 * ensemble and the release both step through, at the slick centroid, over the
 * same hours the playback covers. Nothing here is a second model.
 */

import { useMemo } from "react";
import { relHour } from "../lib/format";
import { growthCurve } from "../lib/playback";
import type { Environment, Run } from "../sim/types";

const CW = 620;
const CH = 190;
const L = 44;
const R = 18;
const T = 16;
const B = 30;

const TICK: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  fill: "var(--ink-faint)",
  letterSpacing: "0.04em",
};

const AXIS: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 8.5,
  fill: "var(--ink-faint)",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
};

function niceStep(span: number, target = 4): number {
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const norm = raw / mag;
  const step = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return step * mag;
}

/**
 * The frame every chart in this file shares.
 *
 * Parameterised only by its bounds and its labels, so two charts stacked on the
 * page frame their data identically -- which is the property that lets a reader
 * compare the wind trace against the current trace below it without having to
 * re-read both axes.
 */
function Frame({
  h0,
  h1,
  vLo,
  vHi,
  unit,
  children,
  zeroLine = false,
}: {
  h0: number;
  h1: number;
  vLo: number;
  vHi: number;
  unit: string;
  children: React.ReactNode;
  /** Draw a firm rule at v = 0. For signed series only. */
  zeroLine?: boolean;
}) {
  const x = (h: number) => L + ((h - h0) / (h1 - h0 || 1)) * (CW - L - R);
  const y = (v: number) => CH - B - ((v - vLo) / (vHi - vLo || 1)) * (CH - T - B);

  const hStep = niceStep(h1 - h0, 5);
  const hTicks: number[] = [];
  for (let h = Math.ceil(h0 / hStep) * hStep; h <= h1; h += hStep) hTicks.push(h);

  const vStep = niceStep(vHi - vLo, 3);
  const vTicks: number[] = [];
  for (let v = Math.ceil(vLo / vStep) * vStep; v <= vHi + 1e-9; v += vStep) {
    vTicks.push(Number(v.toFixed(4)));
  }

  return (
    <>
      {/* Internal grid, dotted so it never competes with a trace. */}
      {hTicks.map((h) => (
        <line
          key={`gx${h}`}
          x1={x(h)}
          y1={T}
          x2={x(h)}
          y2={CH - B}
          stroke="var(--line)"
          strokeWidth={0.7}
          strokeDasharray="1 6"
        />
      ))}
      {vTicks.map((v) => (
        <line
          key={`gy${v}`}
          x1={L}
          y1={y(v)}
          x2={CW - R}
          y2={y(v)}
          stroke="var(--line)"
          strokeWidth={0.7}
          strokeDasharray="1 6"
        />
      ))}

      {/* Acquisition. The one hour the whole page is organised around. */}
      {h0 < 0 && h1 > 0 && (
        <line
          x1={x(0)}
          y1={T - 4}
          x2={x(0)}
          y2={CH - B}
          stroke="var(--accent)"
          strokeWidth={1}
          strokeOpacity={0.7}
        />
      )}

      {zeroLine && vLo < 0 && vHi > 0 && (
        <line
          x1={L}
          y1={y(0)}
          x2={CW - R}
          y2={y(0)}
          stroke="var(--ink-faint)"
          strokeWidth={0.8}
        />
      )}

      {children}

      {/* Neat line, with the ticks stepping outside it. */}
      <rect
        x={L}
        y={T}
        width={CW - L - R}
        height={CH - T - B}
        fill="none"
        stroke="var(--ink-dim)"
        strokeWidth={0.9}
      />
      {hTicks.map((h) => (
        <g key={`tx${h}`}>
          <line
            x1={x(h)}
            y1={CH - B}
            x2={x(h)}
            y2={CH - B + 4}
            stroke="var(--ink-dim)"
            strokeWidth={0.9}
          />
          <text x={x(h)} y={CH - B + 15} textAnchor="middle" style={TICK}>
            {relHour(h)}
          </text>
        </g>
      ))}
      {vTicks.map((v) => (
        <g key={`ty${v}`}>
          <line
            x1={L - 4}
            y1={y(v)}
            x2={L}
            y2={y(v)}
            stroke="var(--ink-dim)"
            strokeWidth={0.9}
          />
          <text x={L - 7} y={y(v) + 3} textAnchor="end" style={TICK}>
            {Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0)}
          </text>
        </g>
      ))}
      <text
        x={L - 7}
        y={T - 5}
        textAnchor="end"
        style={{ ...AXIS, fontSize: 8 }}
      >
        {unit}
      </text>
      <text x={CW - R} y={CH - 4} textAnchor="end" style={AXIS}>
        hours from pass
      </text>
    </>
  );
}

function path(
  xs: number[],
  vs: number[],
  x: (h: number) => number,
  y: (v: number) => number,
): string {
  return xs
    .map((h, i) => `${i === 0 ? "M" : "L"}${x(h).toFixed(1)},${y(vs[i]).toFixed(1)}`)
    .join(" ");
}

/* ------------------------------------------------------------------ *
 * Current and tide
 * ------------------------------------------------------------------ */

/**
 * Surface current speed, with the semidiurnal tide broken out under it.
 *
 * The two are drawn together because the tide is a *component* of the current
 * rather than a separate forcing, and separating them onto two figures would
 * lose the thing worth seeing: the current is a mean flow with a 12.42 hour
 * oscillation riding on it, and the oscillation is what makes a backward
 * trajectory wander rather than run straight.
 */
export function CurrentChart({ env }: { env: Environment }) {
  const h0 = env.hours[0];
  const h1 = env.hours[env.hours.length - 1];
  const vHi = Math.max(0.3, Math.max(...env.currentMs) * 1.25);
  const tideAmp = Math.max(0.02, Math.max(...env.tideMs.map(Math.abs)));
  const x = (h: number) => L + ((h - h0) / (h1 - h0 || 1)) * (CW - L - R);
  const y = (v: number) => CH - B - (v / (vHi || 1)) * (CH - T - B);

  // The tide is plotted on its own scale, centred in the frame: it is a signed
  // component of the quantity above it, not another value on the same axis, and
  // sharing the axis would flatten it to a line.
  const mid = (T + (CH - B)) / 2;
  const tideY = (v: number) => mid - (v / tideAmp) * ((CH - T - B) / 6);

  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" role="img"
      aria-label="Surface current speed with the semidiurnal tidal component">
      <Frame h0={h0} h1={h1} vLo={0} vHi={vHi} unit="m/s">
        <path
          d={path(env.hours, env.tideMs, x, tideY)}
          fill="none"
          stroke="var(--ink-faint)"
          strokeWidth={1}
          strokeDasharray="3 2"
        />
        <path
          d={`${path(env.hours, env.currentMs, x, y)} L${x(h1)},${CH - B} L${x(h0)},${CH - B} Z`}
          fill="var(--ink-dim)"
          opacity={0.1}
        />
        <path
          d={path(env.hours, env.currentMs, x, y)}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={1.3}
        />
      </Frame>
      <text x={L} y={T - 5} style={AXIS}>
        current speed · dashed: m2 tide, own scale
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Growth
 * ------------------------------------------------------------------ */

/**
 * How much oil was released, and how far it had spread, hour by hour.
 *
 * The two traces diverge, and the divergence is the point: the discharge can be
 * complete while the slick is still spreading, and that gap is the whole reason
 * the age estimate is an interval rather than a number.
 */
export function GrowthChart({ run }: { run: Run }) {
  const growth = useMemo(() => growthCurve(run), [run]);
  if (growth.length < 2) return null;

  const h0 = growth[0].hour;
  const h1 = growth[growth.length - 1].hour;
  const areaMax = Math.max(...growth.map((g) => g.areaKm2), 0.001) * 1.15;
  const x = (h: number) => L + ((h - h0) / (h1 - h0 || 1)) * (CW - L - R);
  const yArea = (v: number) => CH - B - (v / areaMax) * (CH - T - B);
  const yFrac = (v: number) => CH - B - v * (CH - T - B);

  const hours = growth.map((g) => g.hour);

  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" role="img"
      aria-label="Released fraction and surface extent across the event">
      <Frame h0={h0} h1={h1} vLo={0} vHi={areaMax} unit="km²">
        <path
          d={`${path(hours, growth.map((g) => g.released), x, yFrac)} L${x(h1)},${CH - B} L${x(h0)},${CH - B} Z`}
          fill="var(--accent)"
          opacity={0.12}
        />
        <path
          d={path(hours, growth.map((g) => g.released), x, yFrac)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.2}
          strokeDasharray="3 2"
        />
        <path
          d={path(hours, growth.map((g) => g.areaKm2), x, yArea)}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={1.4}
        />
      </Frame>
      <text x={L} y={T - 5} style={AXIS}>
        surface extent · dashed: fraction released
      </text>
    </svg>
  );
}
