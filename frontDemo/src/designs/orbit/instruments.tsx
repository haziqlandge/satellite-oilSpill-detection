/**
 * ORBIT -- the instrument family.
 *
 * These are not cards. A card is a rectangle with a heading and some content in
 * it; an instrument is a housing with a bezel, a legible fascia, a calibrated
 * indicator and a stated relationship to the rest of the panel. The difference
 * matters here because the product is a mission-control surface where the map is
 * the primary display and everything else is a readout mounted around it. A rack
 * of cards floating over a map reads as a dashboard that happens to have a map
 * in it. That is exactly the thing this direction is not.
 *
 * Four things every module gets, and no card has:
 *
 *  - a designator (`INS-04`) and a status lamp, so a module can be referred to
 *    and can report its own condition
 *  - a bezel: corner registration ticks, an inner rule, and a fascia that is
 *    translucent rather than opaque, because depth here comes from layering over
 *    the map instead of from texture
 *  - a calibrated indicator -- an arc with real tick marks, a segmented bar, a
 *    trace with a baseline -- rather than a number in a big font
 *  - a relation footer naming the instrument it feeds, which is a live control:
 *    clicking it changes mission mode. An instrument panel where the connections
 *    are drawn but dead is a diagram of an instrument panel.
 *
 * Colour: the caution and alarm inks are taken from the direction's own map
 * paint rather than invented. A gold ring on the chart and a gold lamp on the
 * fascia are then the same statement, and nothing in this file hard-codes a hex.
 */

import type { CSSProperties, ReactNode } from "react";
import { useDesign } from "../../DesignContext";

/* ------------------------------------------------------------------ *
 * Colour helpers
 * ------------------------------------------------------------------ */

/** `color-mix` against transparency, so translucency stays token-driven. */
export function alpha(token: string, pct: number): string {
  return `color-mix(in oklab, ${token} ${pct}%, transparent)`;
}

export type Status = "nominal" | "active" | "caution" | "hold";

/**
 * Status inks.
 *
 * `caution` and `hold` have no CSS token of their own -- only Terminal defines
 * `--warn` and `--alarm` -- so they come from the map paint, which every
 * direction defines and which is the palette the chart underneath is already
 * drawn in.
 */
export function useTone(): Record<Status, string> {
  const def = useDesign();
  return {
    nominal: "var(--ink-dim)",
    active: "var(--accent)",
    caution: def.map.infrastructure,
    hold: def.map.dark,
  };
}

/* ------------------------------------------------------------------ *
 * The housing
 * ------------------------------------------------------------------ */

export interface Relation {
  /** What this instrument feeds, in the panel's own vocabulary. */
  label: string;
  /** Mission mode the related instrument is mounted in. */
  mode?: string;
  onGo?: (mode: string) => void;
}

export function Instrument({
  code,
  title,
  status = "nominal",
  source,
  relation,
  children,
  className = "",
  style,
}: {
  code: string;
  title: string;
  status?: Status;
  /**
   * Where the numbers came from.
   *
   * Orbit carries provenance as telemetry metadata rather than as a footnote:
   * every module states its own source channel, `PUB` for a value that exists in
   * the published literature and `SIM` for one this page generated. A viewer who
   * never reads the brief still cannot mistake a simulated field for a
   * measurement, because the fascia says so.
   */
  source?: "SIM" | "PUB";
  relation?: Relation;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const tone = useTone();
  // An instrument that is cautioning or holding says so at the housing, not
  // only at the lamp. On a surface this dense a 6 px dot is not enough to be
  // found from across the room, and `hold` is the state the whole product is
  // built to make unmissable.
  const alerting = status === "caution" || status === "hold";
  const edge = alerting ? tone[status] : "var(--line)";

  return (
    <section
      data-instrument={code}
      className={`orbit-ins relative rounded-[13px] ${className}`}
      style={{
        border: `1px solid ${alpha(edge, alerting ? 55 : 92)}`,
        background: alpha("var(--base-2)", 76),
        backdropFilter: "blur(14px) saturate(1.15)",
        WebkitBackdropFilter: "blur(14px) saturate(1.15)",
        boxShadow: alerting
          ? `inset 0 0 0 1px ${alpha(tone[status], 12)}, 0 18px 40px -28px ${alpha("var(--base)", 92)}`
          : `inset 0 1px 0 ${alpha("var(--ink)", 7)}, 0 18px 40px -28px ${alpha("var(--base)", 92)}`,
        ...style,
      }}
    >
      <Corners />

      <header className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <span
          className="num shrink-0 text-[9px] tracking-[0.16em]"
          style={{ color: "var(--ink-faint)" }}
        >
          {code}
        </span>
        <h3
          className="min-w-0 flex-1 truncate text-[10.5px] tracking-[0.2em] uppercase"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            color: "var(--ink)",
          }}
        >
          {title}
        </h3>
        {source && <Tag>{source}</Tag>}
        <Lamp status={status} />
      </header>

      <div
        className="h-px w-full"
        style={{
          background: `linear-gradient(90deg, ${alpha("var(--line)", 20)}, ${alpha("var(--line)", 100)} 18%, ${alpha("var(--line)", 100)} 82%, ${alpha("var(--line)", 20)})`,
        }}
      />

      <div className="px-3 py-2.5">{children}</div>

      {relation && (
        <footer
          className="px-3 pb-2.5"
          style={{ borderTop: `1px solid ${alpha("var(--line)", 55)}`, paddingTop: 7 }}
        >
          {relation.mode && relation.onGo ? (
            <button
              type="button"
              onClick={() => relation.onGo?.(relation.mode!)}
              className="group flex w-full items-center gap-1.5 text-left"
            >
              <Feed />
              <span
                className="num flex-1 truncate text-[9px] tracking-[0.14em] uppercase transition-colors group-hover:text-[color:var(--accent)]"
                style={{ color: "var(--ink-faint)" }}
              >
                {relation.label}
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <Feed />
              <span
                className="num flex-1 truncate text-[9px] tracking-[0.14em] uppercase"
                style={{ color: "var(--ink-faint)" }}
              >
                {relation.label}
              </span>
            </div>
          )}
        </footer>
      )}

      <span className="sr-only">
        {`Instrument ${code}, ${title}, status ${status}.`}
      </span>
    </section>
  );
}

/** Registration ticks. A housing is machined; a card is not. */
function Corners() {
  const c = alpha("var(--ink-faint)", 55);
  const base: CSSProperties = { position: "absolute", width: 7, height: 7 };
  return (
    <span aria-hidden className="pointer-events-none">
      <span style={{ ...base, top: 4, left: 4, borderTop: `1px solid ${c}`, borderLeft: `1px solid ${c}`, borderTopLeftRadius: 4 }} />
      <span style={{ ...base, top: 4, right: 4, borderTop: `1px solid ${c}`, borderRight: `1px solid ${c}`, borderTopRightRadius: 4 }} />
      <span style={{ ...base, bottom: 4, left: 4, borderBottom: `1px solid ${c}`, borderLeft: `1px solid ${c}`, borderBottomLeftRadius: 4 }} />
      <span style={{ ...base, bottom: 4, right: 4, borderBottom: `1px solid ${c}`, borderRight: `1px solid ${c}`, borderBottomRightRadius: 4 }} />
    </span>
  );
}

/** The little junction glyph on a relation footer. */
function Feed() {
  return (
    <svg width="13" height="8" viewBox="0 0 13 8" aria-hidden className="shrink-0">
      <path
        d="M0 4 H8"
        stroke="var(--ink-faint)"
        strokeWidth="1"
        fill="none"
      />
      <path d="M8 1.4 L12 4 L8 6.6 Z" fill="var(--ink-faint)" />
    </svg>
  );
}

export function Lamp({
  status = "nominal",
  label,
}: {
  status?: Status;
  label?: string;
}) {
  const tone = useTone();
  const c = tone[status];
  return (
    <span className="flex shrink-0 items-center gap-1.5" title={label ?? status}>
      {label && (
        <span
          className="num text-[9px] tracking-[0.14em] uppercase"
          style={{ color: c }}
        >
          {label}
        </span>
      )}
      <span
        aria-hidden
        className={status === "hold" ? "orbit-pulse" : undefined}
        style={{
          width: 6,
          height: 6,
          borderRadius: 99,
          background: c,
          boxShadow: `0 0 0 3px ${alpha(c, 14)}`,
        }}
      />
    </span>
  );
}

export function Tag({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span
      className="num shrink-0 rounded-[3px] px-1 py-[1px] text-[8.5px] tracking-[0.14em] uppercase"
      style={{
        color: tone ?? "var(--ink-faint)",
        border: `1px solid ${alpha(tone ?? "var(--ink-faint)", 45)}`,
        background: alpha(tone ?? "var(--ink-faint)", 8),
      }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Readouts
 * ------------------------------------------------------------------ */

/** The headline value of an instrument. Mono, tabular, with its unit set apart. */
export function Readout({
  value,
  unit,
  caption,
  tone = "var(--ink)",
  size = 30,
}: {
  value: string;
  unit?: string;
  caption?: string;
  tone?: string;
  size?: number;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span
          className="num leading-none"
          style={{ fontSize: size, color: tone, fontWeight: 500, letterSpacing: "-0.02em" }}
        >
          {value}
        </span>
        {unit && (
          <span
            className="num text-[10px] tracking-[0.12em] uppercase"
            style={{ color: "var(--ink-faint)" }}
          >
            {unit}
          </span>
        )}
      </div>
      {caption && (
        <p
          className="mt-1 text-[11px] leading-[1.42]"
          style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}
        >
          {caption}
        </p>
      )}
    </div>
  );
}

/** A telemetry line. Label left in display type, value right in mono. */
export function Row({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  title?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 py-[3px]" title={title}>
      <span
        className="shrink-0 text-[9.5px] tracking-[0.16em] uppercase"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink-faint)", fontWeight: 500 }}
      >
        {label}
      </span>
      <span
        aria-hidden
        className="min-w-3 flex-1 translate-y-[-3px]"
        style={{ borderBottom: `1px dotted ${alpha("var(--line)", 90)}` }}
      />
      <span className="num shrink-0 text-[11px]" style={{ color: tone ?? "var(--ink)" }}>
        {value}
      </span>
    </div>
  );
}

/** Descriptive text. Manrope, never mono -- mono is for values only in Orbit. */
export function Note({
  children,
  tone = "var(--ink-dim)",
  className = "",
}: {
  children: ReactNode;
  tone?: string;
  className?: string;
}) {
  return (
    <p
      className={`text-[11px] leading-[1.48] ${className}`}
      style={{ fontFamily: "var(--font-body)", color: tone }}
    >
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * Indicators
 * ------------------------------------------------------------------ */

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * A 270-degree arc gauge with a needle.
 *
 * `band` draws a second arc over the scale: the stretch of the range that means
 * something operationally. The wind gauge uses it for the 3 to 12 m/s window in
 * which oil is detectable at all, which is the difference between a gauge that
 * shows a number and one that shows whether the number is usable.
 */
export function Gauge({
  value,
  min = 0,
  max = 1,
  size = 92,
  band,
  unit,
  format,
  tone = "var(--accent)",
  ticks = 10,
}: {
  value: number;
  min?: number;
  max?: number;
  size?: number;
  band?: [number, number];
  unit?: string;
  format?: (v: number) => string;
  tone?: string;
  ticks?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 9;
  const START = -135;
  const SWEEP = 270;
  const clamp = Math.max(min, Math.min(max, value));
  const frac = (clamp - min) / (max - min || 1);
  const deg = START + frac * SWEEP;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
      {/* Scale */}
      <path d={arcPath(cx, cy, r, START, START + SWEEP)} stroke={alpha("var(--line)", 100)} strokeWidth="5" fill="none" strokeLinecap="round" />

      {band && (
        <path
          d={arcPath(
            cx,
            cy,
            r,
            START + ((band[0] - min) / (max - min || 1)) * SWEEP,
            START + ((band[1] - min) / (max - min || 1)) * SWEEP,
          )}
          stroke={alpha("var(--ink-dim)", 45)}
          strokeWidth="5"
          fill="none"
        />
      )}

      {/* Value */}
      <path
        d={arcPath(cx, cy, r, START, deg)}
        stroke={tone}
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
      />

      {/* Tick marks. A gauge without them is a progress ring. */}
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const d = START + (i / ticks) * SWEEP;
        const major = i % 5 === 0;
        const [x0, y0] = polar(cx, cy, r - 5, d);
        const [x1, y1] = polar(cx, cy, r - (major ? 10 : 8), d);
        return (
          <line
            key={i}
            x1={x0}
            y1={y0}
            x2={x1}
            y2={y1}
            stroke={major ? "var(--ink-faint)" : alpha("var(--ink-faint)", 45)}
            strokeWidth={major ? 1 : 0.75}
          />
        );
      })}

      {/* Needle */}
      <line
        x1={cx}
        y1={cy}
        x2={polar(cx, cy, r - 12, deg)[0]}
        y2={polar(cx, cy, r - 12, deg)[1]}
        stroke={tone}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r="2.6" fill="var(--base)" stroke={tone} strokeWidth="1.2" />

      <text
        x={cx}
        y={size - 2}
        textAnchor="middle"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10, fill: "var(--ink)" }}
      >
        {format ? format(value) : value.toFixed(2)}
        {unit && (
          <tspan style={{ fill: "var(--ink-faint)", fontSize: 8 }}>{` ${unit}`}</tspan>
        )}
      </text>
    </svg>
  );
}

/**
 * A segmented bar.
 *
 * Segments rather than a continuous fill because the eye reads a count faster
 * than it reads a length, and every bar in this panel is a proportion that gets
 * compared against the bar above it.
 */
export function Segments({
  value,
  count = 20,
  tone = "var(--accent)",
  height = 8,
}: {
  value: number;
  count?: number;
  tone?: string;
  height?: number;
}) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * count);
  return (
    <div className="flex w-full gap-[2px]" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="flex-1 rounded-[1px]"
          style={{
            height,
            background: i < lit ? tone : alpha("var(--line)", 90),
            opacity: i < lit ? 0.35 + 0.65 * (1 - i / count) : 1,
          }}
        />
      ))}
    </div>
  );
}

/**
 * A small live plot.
 *
 * `mark` is the index the playhead sits on, so a trace inside an instrument
 * moves when the mission clock moves. That simultaneity is the whole reason the
 * time control lives at the bottom of the surface rather than inside one module.
 */
export function Trace({
  values,
  width = 220,
  height = 40,
  mark,
  tone = "var(--accent)",
  fill = true,
  baseline,
}: {
  values: number[];
  width?: number;
  height?: number;
  mark?: number;
  tone?: string;
  fill?: boolean;
  /** Index of a labelled feature, e.g. the convergence minimum. */
  baseline?: number;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      {fill && (
        <path d={`${d} L${width},${height} L0,${height} Z`} fill={alpha(tone, 12)} />
      )}
      <path d={d} stroke={tone} strokeWidth="1.2" fill="none" vectorEffect="non-scaling-stroke" />
      {baseline !== undefined && baseline >= 0 && baseline < values.length && (
        <>
          <line
            x1={x(baseline)}
            y1={0}
            x2={x(baseline)}
            y2={height}
            stroke="var(--ink-faint)"
            strokeWidth="1"
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={x(baseline)} cy={y(values[baseline])} r="2.4" fill="var(--ink)" />
        </>
      )}
      {mark !== undefined && mark >= 0 && mark < values.length && (
        <>
          <line
            x1={x(mark)}
            y1={0}
            x2={x(mark)}
            y2={height}
            stroke={tone}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={x(mark)} cy={y(values[mark])} r="2.6" fill={tone} />
        </>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Controls
 * ------------------------------------------------------------------ */

/** A rocker. Physical-feeling, because everything else on the panel is. */
export function Rocker({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center gap-2.5 py-1 text-left"
      title={hint}
    >
      <span
        aria-hidden
        className="relative shrink-0 rounded-[3px] transition-colors"
        style={{
          width: 30,
          height: 15,
          background: on ? alpha("var(--accent)", 22) : alpha("var(--base-3)", 100),
          border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
        }}
      >
        <span
          className="absolute top-[2px] rounded-[2px] transition-all"
          style={{
            width: 11,
            height: 9,
            left: on ? 15 : 2,
            background: on ? "var(--accent)" : "var(--ink-faint)",
          }}
        />
      </span>
      <span
        className="min-w-0 flex-1 truncate text-[9.5px] tracking-[0.16em] uppercase"
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 500,
          color: on ? "var(--ink)" : "var(--ink-faint)",
        }}
      >
        {label}
      </span>
    </button>
  );
}

/** A detented selector. */
export function Selector<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex overflow-hidden rounded-[5px]"
      style={{ border: `1px solid ${alpha("var(--line)", 100)}` }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className="num flex-1 px-2 py-[5px] text-[9.5px] tracking-[0.14em] uppercase transition-colors"
            style={{
              background: active ? alpha("var(--accent)", 16) : "transparent",
              color: active ? "var(--accent)" : "var(--ink-faint)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Rails
 * ------------------------------------------------------------------ */

/**
 * A rail of instruments floating over the map.
 *
 * On a wide viewport this is a vertical stack pinned to one edge with the chart
 * running underneath it. Below `lg` the same instruments become one horizontally
 * scrolling strip with scroll snapping, because the alternative -- stacking them
 * into a scrolling page -- turns a viewport application into a document, and the
 * map is the product.
 */
export function Rail({
  side,
  top = 44,
  children,
}: {
  side: "left" | "right";
  /**
   * Where the top furniture ends, in px.
   *
   * Defaults to the status bar alone. The shell raises it when it mounts the
   * hold annunciator underneath, so a rail always starts below whatever is
   * actually up there rather than sliding under it.
   */
  top?: number;
  children: ReactNode;
}) {
  return (
    <div
      className={`orbit-rail pointer-events-none absolute z-20 hidden lg:flex ${side === "left" ? "left-0" : "right-0"}`}
      style={{
        top,
        bottom: 0,
        width: 322,
        paddingInline: 14,
        paddingTop: 12,
        // Clears the temporal strip. The rail scrolls behind it rather than
        // stopping above it, so the last instrument would otherwise come to rest
        // under a blurred panel and read as broken rather than as layered.
        paddingBottom: 128,
        flexDirection: "column",
        gap: 10,
        overflowY: "auto",
        overflowX: "hidden",
        // Mask stops, not palette values: `black` here means "fully opaque" to
        // the mask, and carries no colour into the rendered rail.
        maskImage:
          "linear-gradient(to bottom, transparent 0, black 14px, black calc(100% - 18px), transparent 100%)",
      }}
    >
      {children}
    </div>
  );
}

/** The mobile counterpart: one strip, scrolled sideways, snapped. */
export function Strip({ children }: { children: ReactNode }) {
  return (
    <div
      className="orbit-strip pointer-events-auto flex gap-2.5 overflow-x-auto px-3 pb-2 lg:hidden"
      style={{ scrollSnapType: "x mandatory", scrollbarWidth: "none" }}
    >
      {children}
    </div>
  );
}
