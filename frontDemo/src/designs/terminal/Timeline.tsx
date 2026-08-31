/**
 * The operational timeline.
 *
 * This is a structural element of the console, not a control inside a panel,
 * and the reason is that the hour is the console's other axis. Everything on
 * screen -- the map, the origin field, the traffic, the contact list, the log
 * -- is a function of it. A slider tucked into a sidebar would misrepresent
 * that; a ruled band across the foot of the workspace, marked with the events
 * of the case, states it.
 *
 * It runs from the first hour of the discharge (or the far end of the backward
 * horizon, whichever is earlier) to the forecast horizon, so the whole event is
 * one span rather than two pictures either side of the satellite pass. Marked
 * on it: release start, discharge end, the estimated release window from the
 * drift convergence, the acquisition, the current hour, and the forecast
 * horizon.
 *
 * `state.hour` is the single source of truth. This component never keeps a
 * shadow copy of it; the transport writes to it and reads it back like anything
 * else.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatHour, relHour } from "../../lib/format";
import {
  PHASE_LABEL,
  eventSpan,
  growthCurve,
  type Moment,
} from "../../lib/playback";
import type { Run } from "../../sim/types";
import { Btn, Caret, Flag, TONE } from "./components";

const H = 84;
/** Simulated hours per wall-clock second. */
const SPEEDS = [1, 4, 12] as const;

interface Mark {
  hour: number;
  label: string;
  tone: "ok" | "warn" | "dim";
  strong?: boolean;
}

/** Container width in real pixels, so the SVG can be drawn 1:1 instead of scaled. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function Timeline({
  run,
  hour,
  setHour,
  moment,
}: {
  run: Run;
  hour: number;
  setHour: (h: number) => void;
  moment: Moment | null;
}) {
  const [holder, width] = useWidth<HTMLDivElement>();
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(4);

  const [h0, h1] = useMemo(() => eventSpan(run), [run]);
  const growth = useMemo(() => growthCurve(run), [run]);

  // The transport reads the live hour without re-arming its own loop, which is
  // what keeps a 12x playback from tearing down and rebuilding a
  // requestAnimationFrame chain four times a second.
  const hourRef = useRef(hour);
  hourRef.current = hour;

  const marks: Mark[] = useMemo(() => {
    const [lo, , hi] = run.drift.ageHours;
    const out: Mark[] = [
      { hour: run.releaseStartHour, label: "release start", tone: "dim" },
      { hour: 0, label: "sar acquisition", tone: "ok", strong: true },
      { hour: run.drift.forwardHours, label: "forecast horizon", tone: "warn" },
    ];
    // A discharge still running at the pass has no end mark. Drawing one at
    // hour zero would say the release stopped when the satellite arrived, which
    // is the opposite of what `temporalState: ongoing` means.
    if (run.releaseEndHour < -0.5) {
      out.push({ hour: run.releaseEndHour, label: "discharge end", tone: "dim" });
    }
    if (hi - lo >= 1) {
      out.push({ hour: -hi, label: "est. release window", tone: "ok" });
    }
    return out.sort((a, b) => a.hour - b.hour);
  }, [run]);

  /* --- transport --------------------------------------------------- */

  const rewind = useCallback(() => setHour(h0), [setHour, h0]);

  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (p) return false;
      // Pressing play at the end restarts the event rather than doing nothing.
      if (hourRef.current >= h1 - 0.01) setHour(run.releaseStartHour);
      return true;
    });
  }, [h1, run.releaseStartHour, setHour]);

  // A new run resets the hour in `useRun`; letting playback survive that would
  // leave the transport running against a case the operator did not start.
  useEffect(() => setPlaying(false), [run]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = hourRef.current;
    let emitted = Math.round(acc);

    const tick = (t: number) => {
      // Clamped so that a backgrounded tab does not resume by leaping the whole
      // event in one frame.
      const dt = Math.min(0.25, (t - last) / 1000);
      last = t;
      acc += dt * speed;

      const next = Math.round(acc);
      if (acc >= h1) {
        setHour(h1);
        setPlaying(false);
        return;
      }
      // Only whole hours reach the application. The map rebuilds every AIS
      // track, the origin contours and the release extent on each change of
      // `hour`; emitting the fractional value would do that sixty times a
      // second for no visible gain, because every consumer rounds anyway.
      if (next !== emitted) {
        emitted = next;
        setHour(next);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, h1, setHour]);

  /* --- keyboard ---------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.key === "Home") {
        rewind();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, rewind]);

  /* --- geometry ---------------------------------------------------- */

  const W = Math.max(320, width);
  const x = (h: number) => ((h - h0) / Math.max(1e-6, h1 - h0)) * W;

  const TOP = 16;
  const BASE = 60;
  const trace = BASE - TOP;

  const areaMax = Math.max(...growth.map((g) => g.areaKm2), 0.001);
  const releasePath = growth.length
    ? growth
        .map((g, i) => `${i === 0 ? "M" : "L"}${x(g.hour).toFixed(1)},${(BASE - g.released * trace).toFixed(1)}`)
        .join(" ")
    : "";
  const areaPath = growth.length
    ? growth
        .map((g, i) => `${i === 0 ? "M" : "L"}${x(g.hour).toFixed(1)},${(BASE - (g.areaKm2 / areaMax) * trace).toFixed(1)}`)
        .join(" ")
    : "";

  const [ageLo, , ageHi] = run.drift.ageHours;
  const px = x(Math.max(h0, Math.min(h1, hour)));

  const ruler: number[] = [];
  const stepH = h1 - h0 > 120 ? 12 : 6;
  for (let h = Math.ceil(h0 / stepH) * stepH; h <= h1; h += stepH) ruler.push(h);

  const phase = moment ? PHASE_LABEL[moment.phase] : "";

  /*
    Which marks get to print their label.

    The ticks are always drawn -- they are the geometry. The labels are not: at
    the 680 pixel minimum width, RELEASE START, EST. RELEASE WINDOW and SAR
    ACQUISITION land within forty pixels of each other and overprint into an
    unreadable smear. So labels are allocated greedily in order of importance,
    the acquisition first, and a label that would collide with one already
    placed is simply dropped. Dropping a label is recoverable -- the tick is
    still there and the hour ruler is under it -- while overprinting is not.
  */
  const labelled = new Set<string>();
  {
    const placed: number[] = [];
    const byImportance = [...marks].sort(
      (a, b) => (b.strong ? 1 : 0) - (a.strong ? 1 : 0),
    );
    for (const m of byImportance) {
      const mx = ((m.hour - h0) / Math.max(1e-6, h1 - h0)) * Math.max(320, width);
      if (placed.some((p) => Math.abs(p - mx) < 108)) continue;
      placed.push(mx);
      labelled.add(`${m.label}-${m.hour}`);
    }
  }

  return (
    <section
      className="flex min-h-0 w-full flex-1 flex-col border-t"
      style={{ borderColor: "var(--line)", background: "var(--base-2)" }}
      aria-label="Operational timeline"
    >
      {/* --- transport ------------------------------------------------ */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-[6px]"
        style={{ borderColor: "var(--line)" }}
      >
        <span
          className="text-[9.5px] tracking-[0.28em] uppercase"
          style={{ color: "var(--ink-faint)" }}
        >
          Timeline
        </span>

        <div className="flex items-center gap-1">
          <Btn onClick={toggle} active={playing} title="Play or pause the event (space)">
            {playing ? "|| hold" : "> play"}
          </Btn>
          <Btn onClick={rewind} title="Jump to the first hour of the record (home)">
            |&lt; start
          </Btn>
          <Btn onClick={() => setHour(run.releaseStartHour)} title="Jump to the first hour of the discharge">
            release
          </Btn>
          <Btn onClick={() => setHour(0)} title="Jump to the satellite pass">
            t0
          </Btn>
        </div>

        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <Btn key={s} onClick={() => setSpeed(s)} active={speed === s} title={`${s} simulated hours per second`}>
              {s}x
            </Btn>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-x-4 gap-y-1 overflow-x-auto">
          <span className="num text-[13px]" style={{ color: "var(--accent)" }}>
            {formatHour(hour)}
            {playing && <Caret />}
          </span>
          <span
            className="text-[10px] tracking-[0.16em] whitespace-nowrap uppercase"
            style={{ color: "var(--ink-dim)" }}
          >
            {phase}
          </span>
          {moment && (
            <>
              <span className="num text-[10.5px] whitespace-nowrap" style={{ color: "var(--ink-faint)" }}>
                discharged {(moment.releasedFraction * 100).toFixed(0)}%
              </span>
              <span className="num text-[10.5px] whitespace-nowrap" style={{ color: "var(--ink-faint)" }}>
                surface {moment.areaKm2.toFixed(2)} km2
              </span>
              <span className="num text-[10.5px] whitespace-nowrap" style={{ color: "var(--ink-faint)" }}>
                contacts {moment.contacts.length}
              </span>
              {moment.inContact > 0 && <Flag tone="warn">in oil {moment.inContact}</Flag>}
            </>
          )}
        </div>
      </div>

      {/* --- the band ------------------------------------------------- */}
      <div className="min-h-0 flex-1 overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
        <div ref={holder} className="relative h-full min-w-[680px] px-3 py-1">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            className="block"
            aria-hidden
          >
            {/* Regimes, painted before anything is drawn on them. */}
            <rect x={0} y={TOP} width={x(0)} height={trace} fill="var(--base-3)" opacity={0.55} />
            <rect
              x={x(0)}
              y={TOP}
              width={W - x(0)}
              height={trace}
              fill="var(--base-3)"
              opacity={0.25}
            />
            <rect
              x={x(run.releaseStartHour)}
              y={TOP}
              width={Math.max(1, x(Math.min(0, run.releaseEndHour)) - x(run.releaseStartHour))}
              height={trace}
              fill="var(--ink)"
              opacity={0.06}
            />
            {ageHi - ageLo >= 1 && (
              <rect
                x={x(-ageHi)}
                y={TOP}
                width={Math.max(1, x(-ageLo) - x(-ageHi))}
                height={trace}
                fill="var(--accent)"
                opacity={0.14}
              />
            )}

            {/* Hour reticle. */}
            <g stroke="var(--line)" strokeWidth={0.5}>
              {ruler.map((h) => (
                <line key={h} x1={x(h)} y1={TOP} x2={x(h)} y2={BASE} />
              ))}
            </g>

            {/* The event itself: released fraction as an area, surface extent
                as a line. Two traces because they diverge -- the discharge can
                be complete while the slick is still spreading, and that gap is
                the whole reason the age estimate is an interval. */}
            {releasePath && (
              <>
                <path
                  d={`${releasePath} L${x(growth[growth.length - 1].hour).toFixed(1)},${BASE} L${x(growth[0].hour).toFixed(1)},${BASE} Z`}
                  fill="var(--accent)"
                  opacity={0.14}
                />
                <path d={releasePath} fill="none" stroke="var(--accent)" strokeWidth={1} />
                <path
                  d={areaPath}
                  fill="none"
                  stroke="var(--ink-dim)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
              </>
            )}

            <line x1={0} y1={BASE} x2={W} y2={BASE} stroke="var(--line)" strokeWidth={1} />

            {/* Event marks. */}
            {marks.map((m) => {
              const mx = x(m.hour);
              const anchor = mx > W - 90 ? "end" : mx < 60 ? "start" : "middle";
              return (
                <g key={`${m.label}-${m.hour}`}>
                  <line
                    x1={mx}
                    y1={TOP - 5}
                    x2={mx}
                    y2={BASE}
                    stroke={TONE[m.tone === "dim" ? "faint" : m.tone]}
                    strokeWidth={m.strong ? 1.2 : 0.8}
                    strokeDasharray={m.strong ? undefined : "3 2"}
                  />
                  {labelled.has(`${m.label}-${m.hour}`) && (
                    <text
                      x={mx + (anchor === "start" ? 3 : anchor === "end" ? -3 : 0)}
                      y={9}
                      textAnchor={anchor}
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 8,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        fill: TONE[m.tone === "dim" ? "faint" : m.tone],
                      }}
                    >
                      {`${m.label} ${relHour(m.hour)}h`}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Hour labels. */}
            {ruler.map((h) => (
              <text
                key={`l${h}`}
                x={x(h)}
                y={BASE + 12}
                textAnchor="middle"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 8,
                  fill: "var(--ink-faint)",
                }}
              >
                {relHour(h)}
              </text>
            ))}

            {/* Playhead. Drawn last so it is never occluded by a regime fill. */}
            <g>
              <line x1={px} y1={TOP - 8} x2={px} y2={BASE + 4} stroke="var(--accent)" strokeWidth={1.4} />
              <path
                d={`M${px - 4},${TOP - 8} L${px + 4},${TOP - 8} L${px},${TOP - 2} Z`}
                fill="var(--accent)"
              />
              <text
                x={Math.min(W - 4, Math.max(4, px))}
                y={BASE + 22}
                textAnchor={px > W - 40 ? "end" : px < 40 ? "start" : "middle"}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  fill: "var(--accent)",
                }}
              >
                {formatHour(hour)}
              </text>
            </g>
          </svg>

          {/*
            The real control, laid over the drawing.

            Every design in this project keeps a native range input underneath
            its time scrubber: arrow keys, Home, End, page keys and screen-reader
            announcement all come from the platform rather than being
            reimplemented badly on a div. It is transparent because the SVG above
            is the visible instrument, and the focus ring is taken by the wrapper
            so keyboard focus is still visible.
          */}
          <label className="absolute inset-0 block cursor-ew-resize focus-within:[outline:1px_solid_var(--accent)]">
            <span className="sr-only">Hour relative to the satellite pass</span>
            <input
              type="range"
              min={h0}
              max={h1}
              step={1}
              value={Math.round(hour)}
              onChange={(e) => {
                setPlaying(false);
                setHour(Number(e.target.value));
              }}
              aria-valuetext={`${formatHour(hour)}, ${phase}`}
              className="scrub absolute inset-0 h-full w-full opacity-0"
            />
          </label>
        </div>
      </div>
    </section>
  );
}
