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
import { formatHour, relHour } from "../lib/format";
import {
  PHASE_LABEL,
  checkpointsFor,
  eventSpan,
  type Moment,
} from "../lib/playback";
import type { Run } from "../sim/types";
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
  /**
   * The trace under the ruler.
   *
   * It used to be the discharge: released fraction as an area, surface extent
   * as a dashed line, both from `growthCurve`. Every hour of that series is
   * *before* the pass, so on a scale that starts at T0 the whole thing collapses
   * onto the left-hand edge and draws nothing.
   *
   * What belongs on a forward scale is how wide the forecast has got, which is
   * the same 90% region area the home page charts as figure 2B. Scrubbing then
   * shows the thing an operator actually needs to weigh: the further the
   * playhead goes, the less the region rules out.
   */
  const spread = useMemo(
    () =>
      run.drift.frames
        .filter((f) => f.hour >= 0)
        .map((f) => ({ hour: f.hour, area: f.area90Km2 })),
    [run],
  );

  // The transport reads the live hour without re-arming its own loop, which is
  // what keeps a 12x playback from tearing down and rebuilding a
  // requestAnimationFrame chain four times a second. The playback effect reads
  // it exactly once, when it arms, and an effect runs after the commit whose
  // render wrote it -- so at that instant the ref is the hour the operator can
  // actually see.
  const hourRef = useRef(hour);
  hourRef.current = hour;

  /**
   * The marks on the scale.
   *
   * The span starts at the satellite pass now, so everything that used to live
   * to the left of it -- the release start, the discharge end, the estimated
   * release window -- has no position on this ruler and has been taken off it.
   * That is a real loss of information from the timeline and a deliberate one:
   * a scale that opens deep in negative hours makes the forecast, the part of
   * the event that has not happened yet, a sliver at the right-hand end.
   *
   * What replaces them is the forecast's own checkpoints, from the same
   * `checkpointsFor` the home page's transport uses, so the two surfaces cannot
   * disagree about where a step is. T0 and the horizon are named; the twelve
   * hourly steps between them are marks without labels, because they are a
   * cadence rather than events.
   */
  const marks: Mark[] = useMemo(() => {
    const out: Mark[] = [
      { hour: 0, label: "sar acquisition", tone: "ok", strong: true },
      { hour: run.drift.forwardHours, label: "forecast horizon", tone: "warn" },
    ];
    // The twelve-hourly steps are marks, not events: they get a tick and no
    // label. The ruler under them already prints the hour, and a label reading
    // "+12 +12h" is the same number twice.
    for (const c of checkpointsFor(run)) {
      if (c === 0 || c >= run.drift.forwardHours) continue;
      out.push({ hour: c, label: "", tone: "dim" });
    }
    return out.sort((a, b) => a.hour - b.hour);
  }, [run]);

  /** The checkpoint hours, for the step-to-step transport. */
  const steps = useMemo(() => {
    const c = checkpointsFor(run);
    const last = run.drift.forwardHours;
    return c.includes(last) ? c : [...c, last];
  }, [run]);

  /* --- transport --------------------------------------------------- */

  const rewind = useCallback(() => setHour(h0), [setHour, h0]);

  /**
   * Play and pause. Nothing else, and the "nothing else" is the whole point.
   *
   * This updater used to restart the event as a side effect -- `if
   * (hourRef.current >= h1 - 0.01) setHour(h0)` before returning `true` -- and
   * that one line made pressing play at the horizon work about half the time.
   * The mechanism is worth writing out, because the shape is an easy one to
   * reach for again and it does not look wrong.
   *
   * React does not specify *where* a functional updater runs, and
   * `dispatchSetState` has two sites for it. When the fiber has no pending lanes
   * it evaluates the updater eagerly, inside the click, to find out whether the
   * result even differs from the current state. On that path the nested
   * `setHour` was an ordinary event-handler update, batched with `setPlaying`
   * into one render, and the restart worked. When the fiber *does* carry a
   * pending lane the eager path is skipped and the updater runs during the
   * render phase instead. `setHour` then belongs to a parent that has already
   * rendered in this pass, so React cannot fold it into it: it warns ("Cannot
   * update a component (`ConsoleShell`) while rendering a different component
   * (`Timeline`)") and defers the hour to a second render.
   *
   * The second render is one commit too late. The commit in between carries
   * `playing: true` with the hour still at the horizon; React flushes passive
   * effects synchronously at the end of a sync-lane commit, so the playback
   * effect below armed with `acc` at 48, and its first frame satisfied `acc >=
   * h1` and immediately did `setHour(h1); setPlaying(false)`. Hour and label
   * flickered out and back inside a frame or two, which is exactly why sampling
   * every 300 ms read it as "the toggle did nothing".
   *
   * Which of the two sites runs is decided by `fiber.lanes` -- an internal
   * scheduling detail, and one that is *reliably* dirty in the case that
   * matters, because the loop's own auto-stop dispatches `setPlaying(false)` on
   * this fiber and leaves a lane on its alternate until something re-renders
   * this component. Hence: intermittent, and worst right after an auto-stop.
   *
   * So no setters inside updaters. `p => !p` is pure, which is also what
   * StrictMode expects -- it invokes updaters twice on every path, eager or not,
   * so a side effect in here fired twice even when the restart worked.
   */
  const toggle = useCallback(() => setPlaying((p) => !p), []);

  // A new run resets the hour in `useRun`; letting playback survive that would
  // leave the transport running against a case the operator did not start.
  useEffect(() => setPlaying(false), [run]);

  useEffect(() => {
    if (!playing) return;

    /*
      Where this run of the loop starts -- decided here rather than in the
      transport, and that relocation is the fix rather than a tidy-up.

      Arming at (or past) the horizon means "play it again": there is nothing
      left to run forward, so the loop rewinds to the start of the span instead
      of stopping on its own first frame. The question "are we at the end?" and
      the answer "then begin at h0" are now one read of one value at one moment,
      inside the same effect body that seeds `acc` from it. They cannot land in
      different commits, because there is only one. That is what the old shape
      could not promise: it asked the question in a state updater whose
      execution site React chooses, and answered it with a setter on a component
      that had already rendered.

      Publishing `from` is deliberate. `emitted` starts at `Math.round(from)`,
      so the loop would not call `setHour` again until `acc` crossed the next
      half hour and the playhead would sit at the horizon for an emit period
      before jumping. One `setHour` from an effect body -- the ordinary,
      supported place for one -- moves it immediately. It re-renders this
      component but does not re-arm this effect: `hour` is not a dependency, by
      design, and every other dependency is stable.
    */
    const from = hourRef.current >= h1 - 0.01 ? h0 : hourRef.current;
    if (from !== hourRef.current) setHour(from);

    let raf = 0;
    let last = performance.now();
    let acc = from;
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
  }, [playing, speed, h0, h1, setHour]);

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

  const areaMax = Math.max(...spread.map((g) => g.area), 0.001);
  const spreadPath = spread.length
    ? spread
        .map((g, i) => `${i === 0 ? "M" : "L"}${x(g.hour).toFixed(1)},${(BASE - (g.area / areaMax) * trace).toFixed(1)}`)
        .join(" ")
    : "";

  const px = x(Math.max(h0, Math.min(h1, hour)));

  // The span is now the forecast horizon rather than the whole record, so the
  // ruler steps in sixes: a 12 h tick over 48 h leaves four numbers on a scale
  // eight hundred pixels wide.
  const ruler: number[] = [];
  const stepH = h1 - h0 > 96 ? 12 : 6;
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
          {/* Step checkpoint to checkpoint rather than hour by hour: the
              checkpoints are the states worth comparing, and the scrubber and
              the arrow keys already handle single hours. */}
          <Btn
            onClick={() => {
              const prev = [...steps].reverse().find((c) => c < hour - 0.01);
              setHour(prev ?? h0);
            }}
            title="Back to the previous checkpoint"
          >
            &lt;&lt;
          </Btn>
          <Btn onClick={rewind} title="Jump to the satellite pass (home)">
            t0
          </Btn>
          <Btn
            onClick={() => {
              const next = steps.find((c) => c > hour + 0.01);
              setHour(next ?? h1);
            }}
            title="On to the next checkpoint"
          >
            &gt;&gt;
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
            {/* One regime now, because there is only one: everything on this
                scale is after the pass. The two-tone split that used to divide
                hindcast from forecast had nothing left to divide. */}
            <rect
              x={0}
              y={TOP}
              width={W}
              height={trace}
              fill="var(--base-3)"
              opacity={0.25}
            />
            {/* The last twelve hours, where the region is widest and the
                forecast is worth least. */}
            {steps.length > 1 && (
              <rect
                x={x(steps[steps.length - 2])}
                y={TOP}
                width={Math.max(1, W - x(steps[steps.length - 2]))}
                height={trace}
                fill="var(--warn)"
                opacity={0.07}
              />
            )}

            {/* Hour reticle. */}
            <g stroke="var(--line)" strokeWidth={0.5}>
              {ruler.map((h) => (
                <line key={h} x1={x(h)} y1={TOP} x2={x(h)} y2={BASE} />
              ))}
            </g>

            {/* How wide the 90% forecast region is, hour by hour. It only
                rises: reversal is not the only thing that spreads. */}
            {spreadPath && (
              <>
                <path
                  d={`${spreadPath} L${x(spread[spread.length - 1].hour).toFixed(1)},${BASE} L${x(spread[0].hour).toFixed(1)},${BASE} Z`}
                  fill="var(--accent)"
                  opacity={0.12}
                />
                <path d={spreadPath} fill="none" stroke="var(--accent)" strokeWidth={1} />
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
                  {m.label && labelled.has(`${m.label}-${m.hour}`) && (
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
