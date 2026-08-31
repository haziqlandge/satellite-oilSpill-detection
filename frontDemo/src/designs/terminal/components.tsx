/**
 * TERMINAL's console furniture.
 *
 * There is no `Card` here and there will not be one. A workstation does not put
 * things in rounded boxes with drop shadows; it rules a frame, prints a label
 * on the rule, aligns values in a column and leaves the gutter between them
 * empty. Everything below is one of those moves.
 *
 * Three rules hold the whole family together:
 *
 *  - one type family and a narrow size range, 9px to 13px, because the density
 *    is the design. A heading twice the size of its value has stolen the row it
 *    was meant to introduce
 *  - values right-align on a tabular column, labels left-align, and a dotted
 *    leader carries the eye across. That leader is the reason a forty-row pane
 *    is readable at all
 *  - meters are drawn in characters rather than divs. `####......` is a
 *    quantity you can read at a glance and it quantises to whole cells, which
 *    is the honest resolution for a weighted term
 *
 * Nothing here is imported by the other three directions and nothing here is
 * generalised for them.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { animate } from "animejs";
import { useReducedMotion } from "../../lib/motion";
import { seriesPath } from "../../lib/project";

/* ------------------------------------------------------------------ *
 * Tone
 *
 * Four states and three neutrals. `warn` and `alarm` exist only under this
 * direction's `[data-design]` block, which is deliberate: a console is the one
 * of the four with genuine machine states to report, and an editorial page has
 * no business owning an amber.
 * ------------------------------------------------------------------ */

export type Tone = "ok" | "warn" | "alarm" | "ink" | "dim" | "faint";

export const TONE: Record<Tone, string> = {
  ok: "var(--accent)",
  warn: "var(--warn)",
  alarm: "var(--alarm)",
  ink: "var(--ink)",
  dim: "var(--ink-dim)",
  faint: "var(--ink-faint)",
};

/* ------------------------------------------------------------------ *
 * Blinking cursor
 * ------------------------------------------------------------------ */

/**
 * The block cursor.
 *
 * Driven by anime against a direct element ref rather than by a React interval:
 * a cursor that re-renders twice a second re-renders whatever it is inside, and
 * this one sits in a header that also carries a live readout. `steps(2)` is
 * what makes it blink rather than pulse -- a fade reads as a notification, a
 * hard on/off reads as a terminal.
 */
export function Caret({ tone = "ok" }: { tone?: Tone }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    const a = animate(el, {
      opacity: [1, 0],
      duration: 1060,
      loop: true,
      ease: "steps(2)",
    });
    return () => {
      a.revert();
    };
  }, [reduced]);

  return (
    <span
      ref={ref}
      aria-hidden
      className="inline-block align-baseline"
      style={{
        width: "0.55em",
        height: "1em",
        marginBottom: "-0.15em",
        background: TONE[tone],
      }}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Frames
 * ------------------------------------------------------------------ */

/**
 * A framed output pane.
 *
 * The header rule runs through the title rather than sitting under it, which is
 * the difference between a console frame and a heading. `right` carries the
 * frame's own status, so everything on screen states what it is doing without a
 * separate status area to keep in sync.
 */
export function Pane({
  index,
  title,
  right,
  tone = "ok",
  children,
  className = "",
}: {
  index?: string;
  title: string;
  right?: ReactNode;
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 min-w-0 flex-1 flex-col border ${className}`}
      style={{ borderColor: "var(--line)", background: "var(--base-2)" }}
    >
      <header
        className="flex shrink-0 items-center gap-2 border-b px-3 py-[7px]"
        style={{ borderColor: "var(--line)", background: "var(--base-3)" }}
      >
        {index && (
          <span className="num text-[10px]" style={{ color: TONE[tone] }}>
            {index}
          </span>
        )}
        <h2
          className="text-[10.5px] tracking-[0.28em] uppercase"
          style={{ color: "var(--ink)" }}
        >
          {title}
        </h2>
        <span className="h-px flex-1" style={{ background: "var(--line)" }} />
        {right}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

/** Sub-section inside a pane. Label, rule, optional right-hand count. */
export function Block({
  label,
  right,
  tone = "dim",
  children,
  className = "",
}: {
  label: string;
  right?: ReactNode;
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mt-4 first:mt-0 ${className}`}>
      <header className="flex items-center gap-2">
        <h3
          className="shrink-0 text-[9.5px] tracking-[0.26em] uppercase"
          style={{ color: TONE[tone] }}
        >
          {label}
        </h3>
        <span className="h-px flex-1" style={{ background: "var(--line)" }} />
        {right !== undefined && (
          <span
            className="num shrink-0 text-[9.5px]"
            style={{ color: "var(--ink-faint)" }}
          >
            {right}
          </span>
        )}
      </header>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Rows and values
 * ------------------------------------------------------------------ */

/**
 * Label, dotted leader, value.
 *
 * The leader is nudged up off the baseline rather than vertically centred,
 * because a dotted rule running through the middle of the x-height reads as a
 * strike through the label.
 */
export function Row({
  label,
  value,
  unit,
  tone = "ink",
  title,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: Tone;
  title?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 py-[2.5px]" title={title}>
      <span
        className="shrink-0 text-[10px] tracking-[0.14em] uppercase"
        style={{ color: "var(--ink-faint)" }}
      >
        {label}
      </span>
      <span
        aria-hidden
        className="min-w-[10px] flex-1 -translate-y-[3px] border-b border-dotted"
        style={{ borderColor: "var(--line)" }}
      />
      <span className="num shrink-0 text-[11.5px]" style={{ color: TONE[tone] }}>
        {value}
        {unit && (
          <span
            className="ml-1 text-[9.5px]"
            style={{ color: "var(--ink-faint)" }}
          >
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}

/** A boxed readout, for values the console keeps permanently in view. */
export function Field({
  label,
  value,
  unit,
  tone = "ink",
  title,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: Tone;
  title?: string;
}) {
  return (
    <div
      className="border px-2 py-1.5"
      style={{ borderColor: "var(--line)", background: "var(--base)" }}
      title={title}
    >
      <p
        className="text-[9px] tracking-[0.2em] uppercase"
        style={{ color: "var(--ink-faint)" }}
      >
        {label}
      </p>
      <p
        className="num mt-1 text-[13px] leading-none"
        style={{ color: TONE[tone] }}
      >
        {value}
        {unit && (
          <span
            className="ml-1 text-[9.5px]"
            style={{ color: "var(--ink-faint)" }}
          >
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Meters
 * ------------------------------------------------------------------ */

/**
 * A character meter.
 *
 * Drawn in `#` and `.` rather than as a filled div, so it lands on the same
 * monospace grid as everything around it. A bar 61.4% of 88 pixels wide implies
 * a precision none of these numbers have; fourteen cells says "about nine in
 * fourteen", which is what a hand-set weight actually supports.
 */
export function AsciiBar({
  value,
  width = 14,
  tone = "ok",
}: {
  value: number;
  width?: number;
  tone?: Tone;
}) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const filled = Math.round(v * width);
  return (
    <span className="whitespace-pre text-[11px]" aria-hidden>
      <span style={{ color: TONE[tone] }}>{"#".repeat(filled)}</span>
      <span style={{ color: "var(--ink-faint)" }}>
        {".".repeat(width - filled)}
      </span>
    </span>
  );
}

/** Label, meter, number. The standard three-part console line. */
export function Meter({
  label,
  value,
  display,
  tone = "ok",
  width = 14,
  title,
}: {
  label: string;
  value: number;
  display: string;
  tone?: Tone;
  width?: number;
  title?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 py-[2.5px]" title={title}>
      <span
        className="w-[7ch] shrink-0 text-[10px] tracking-[0.08em] uppercase"
        style={{ color: "var(--ink-faint)" }}
      >
        {label}
      </span>
      <AsciiBar value={value} width={width} tone={tone} />
      <span
        className="num ml-auto shrink-0 text-[11px]"
        style={{ color: TONE[tone] }}
      >
        {display}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Flags, buttons, switches
 * ------------------------------------------------------------------ */

/** A machine status flag. `SIM`, `HALT`, `LIVE`, `IN OIL`. */
export function Flag({
  tone = "ok",
  children,
  title,
  filled = false,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
  filled?: boolean;
}) {
  return (
    <span
      className="inline-block shrink-0 border px-1 py-px text-[9px] leading-[1.4] tracking-[0.18em] whitespace-nowrap uppercase"
      title={title}
      style={{
        borderColor: TONE[tone],
        color: filled ? "var(--accent-ink)" : TONE[tone],
        background: filled ? TONE[tone] : "transparent",
      }}
    >
      {children}
    </span>
  );
}

/** `[ LABEL ]`. The border is the button; there is no fill and no radius. */
export function Btn({
  children,
  onClick,
  active = false,
  tone = "ok",
  title,
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  tone?: Tone;
  title?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`shrink-0 border px-2 py-[3px] text-[10px] tracking-[0.16em] whitespace-nowrap uppercase transition-colors disabled:opacity-40 ${className}`}
      style={{
        borderColor: active ? TONE[tone] : "var(--line)",
        color: active ? TONE[tone] : "var(--ink-dim)",
        background: active
          ? "color-mix(in oklab, var(--accent) 12%, transparent)"
          : "transparent",
      }}
    >
      {children}
    </button>
  );
}

/** `[x] LABEL`. A real switch, drawn the way a config file writes one. */
export function Toggle({
  on,
  label,
  onChange,
  tone = "ok",
  title,
}: {
  on: boolean;
  label: string;
  onChange: (next: boolean) => void;
  tone?: Tone;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      title={title}
      className="flex w-full items-baseline gap-1.5 py-[1.5px] text-left text-[10.5px] tracking-[0.06em] uppercase transition-colors"
      style={{ color: on ? "var(--ink)" : "var(--ink-faint)" }}
    >
      <span
        className="num shrink-0"
        style={{ color: on ? TONE[tone] : "var(--ink-faint)" }}
      >
        [{on ? "x" : " "}]
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Tables
 * ------------------------------------------------------------------ */

/**
 * A dense table.
 *
 * No zebra striping, no row borders, no hover fill. Alignment does the work,
 * which is what lets a fourteen-row contact list occupy two hundred pixels and
 * still be scannable. Rows become clickable only when `onSelect` is supplied,
 * because a table that looks interactive and is not is worse than one that
 * looks inert.
 */
export function Table({
  head,
  align,
  rows,
  keys,
  onSelect,
  activeKey,
  empty = "no rows",
}: {
  head: string[];
  align?: ("left" | "right")[];
  rows: ReactNode[][];
  keys?: string[];
  onSelect?: (key: string) => void;
  activeKey?: string | null;
  empty?: string;
}) {
  const at = (i: number) => (align?.[i] === "right" ? "text-right" : "text-left");

  if (!rows.length) {
    return (
      <p className="py-2 text-[10.5px]" style={{ color: "var(--ink-faint)" }}>
        {empty}
      </p>
    );
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={i}
              scope="col"
              className={`border-b pb-1 text-[9px] font-normal tracking-[0.18em] uppercase ${at(i)}`}
              style={{ borderColor: "var(--line)", color: "var(--ink-faint)" }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, r) => {
          const key = keys?.[r];
          const active = key != null && key === activeKey;
          return (
            <tr
              key={key ?? r}
              onClick={onSelect && key ? () => onSelect(key) : undefined}
              className={onSelect ? "cursor-pointer" : undefined}
              style={{
                background: active
                  ? "color-mix(in oklab, var(--accent) 10%, transparent)"
                  : "transparent",
                boxShadow: active ? "inset 2px 0 0 var(--accent)" : undefined,
              }}
            >
              {cells.map((c, i) => (
                <td
                  key={i}
                  className={`num py-[3px] align-baseline text-[11px] ${at(i)} ${i === 0 ? "pl-1.5" : ""} ${i === cells.length - 1 ? "pr-1.5" : ""}`}
                  style={{ color: "var(--ink-dim)" }}
                >
                  {c}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ *
 * Prose, in machine voice
 * ------------------------------------------------------------------ */

/**
 * A note.
 *
 * A console is allowed sentences, but only where a number would lie. The rule
 * on the left is the marginal bar a log file would use; it keeps prose from
 * being mistaken for output.
 */
export function Note({
  children,
  tone = "faint",
  label,
}: {
  children: ReactNode;
  tone?: Tone;
  label?: string;
}) {
  return (
    <div
      className="mt-2 border-l pl-2.5"
      style={{ borderColor: tone === "faint" ? "var(--line)" : TONE[tone] }}
    >
      {label && (
        <p
          className="mb-0.5 text-[9px] tracking-[0.22em] uppercase"
          style={{ color: TONE[tone] }}
        >
          {label}
        </p>
      )}
      <div
        className="text-[10.5px] leading-[1.6]"
        style={{ color: "var(--ink-dim)" }}
      >
        {children}
      </div>
    </div>
  );
}

/** `node04:~$ command`. Used where the interface reports an operation. */
export function Prompt({
  children,
  caret = false,
  tone = "ok",
}: {
  children: ReactNode;
  caret?: boolean;
  tone?: Tone;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
      <span className="shrink-0" style={{ color: TONE[tone] }}>
        node04:~$
      </span>
      <span className="min-w-0" style={{ color: "var(--ink)" }}>
        {children}
      </span>
      {caret && <Caret tone={tone} />}
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * Alarm
 * ------------------------------------------------------------------ */

/**
 * The refusal state, drawn as a machine alarm.
 *
 * C3 requires that a field too diffuse to discriminate degrades to a stated
 * finding rather than an empty list, and the ethics constraints require that
 * finding to be prominent rather than buried. On a console the loudest
 * available idiom is a hazard-striped banner, so that is what it gets: hatched
 * border, alarm ink, and a code an operator could read down a phone line.
 */
export function Alarm({
  code,
  title,
  children,
  compact = false,
}: {
  code: string;
  title: string;
  children?: ReactNode;
  compact?: boolean;
}) {
  const hatch: CSSProperties = {
    backgroundImage:
      "repeating-linear-gradient(-45deg, color-mix(in oklab, var(--alarm) 62%, transparent) 0 6px, transparent 6px 12px)",
  };
  return (
    <div
      role="status"
      className="border"
      style={{
        borderColor: "var(--alarm)",
        background: "color-mix(in oklab, var(--alarm) 9%, var(--base-2))",
      }}
    >
      <div aria-hidden className="h-[5px] w-full" style={hatch} />
      <div className={compact ? "px-3 py-2" : "px-3 py-3"}>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="num text-[10px] tracking-[0.16em]"
            style={{ color: "var(--alarm)" }}
          >
            {code}
          </span>
          <span
            className="text-[11.5px] tracking-[0.2em] uppercase"
            style={{ color: "var(--alarm)" }}
          >
            {title}
          </span>
        </p>
        {children && (
          <div
            className="mt-1.5 text-[10.5px] leading-[1.6]"
            style={{ color: "var(--ink)" }}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Small instruments
 * ------------------------------------------------------------------ */

/** A profile trace, for series that only need a shape. */
export function Spark({
  values,
  width = 200,
  height = 26,
  tone = "ok",
  fill = false,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: Tone;
  fill?: boolean;
}) {
  if (values.length < 2) return null;
  const d = seriesPath(values, width, height, 2);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      preserveAspectRatio="none"
      style={{ height }}
      aria-hidden
    >
      {fill && (
        <path
          d={`${d} L${width},${height} L0,${height} Z`}
          fill={TONE[tone]}
          opacity={0.14}
        />
      )}
      <path
        d={d}
        fill="none"
        stroke={TONE[tone]}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Viewport
 * ------------------------------------------------------------------ */

/**
 * Whether the console is in its narrow mode.
 *
 * Read through matchMedia, and used to change *values* rather than to swap DOM
 * trees. Branching the tree on a breakpoint would unmount and rebuild the
 * MapLibre instance every time the window crossed 1024px, which costs a WebGL
 * context and a full reload of every source on it.
 */
export function useNarrow(query = "(max-width: 1023px)"): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return narrow;
}

/** Thin scrollbars, set inline because this direction owns no stylesheet. */
export const SCROLL: CSSProperties = {
  scrollbarWidth: "thin",
  scrollbarColor: "var(--line) transparent",
};
