/**
 * The event transport.
 *
 * Rebuilt rather than patched. The previous version was a full-width rule with
 * a display-sized hour readout above it and three text buttons beside that, and
 * it had three problems: it stretched edge to edge under a figure it was meant
 * to serve, it opened on a long pre-release run-up in which nothing is in the
 * water yet, and its controls were prose where a transport should be a
 * transport.
 *
 * What it is now:
 *
 *  - **the range starts at the satellite pass.** The hours before it are the
 *    hindcast's business, not the playback's; a reader pressing play wants to
 *    watch the oil go somewhere, and the run-up is a wait
 *  - **the line is centred and bounded**, so it reads as a control belonging to
 *    the figure above it rather than as a rule ruling the page
 *  - **dots mark the forecast checkpoints**, and they are derived from the same
 *    filter that builds `forwardImpact` in the simulation rather than
 *    hard-coded, so a scenario with a different horizon still marks its own
 *    steps and not somebody else's
 *  - **back and forward step checkpoint to checkpoint**, not by the hour. The
 *    checkpoints are the states worth comparing
 *
 * The native `<input type="range">` stays underneath at full width of the line:
 * arrow keys, Home, End and screen-reader announcement come from the platform
 * rather than being reimplemented badly on a div.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatHour, relHour } from "../lib/format";
import { PHASE_LABEL, checkpointsFor, momentAt } from "../lib/playback";
import type { Run } from "../sim/types";

/** Hours of the event per second of playback. Slow enough to read. */
const HOURS_PER_SECOND = 4;

export function EventTransport({
  run,
  hour,
  onChange,
}: {
  run: Run;
  hour: number;
  onChange: (h: number) => void;
}) {
  const min = 0;
  const max = run.drift.forwardHours;

  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const last = useRef(0);
  const hourRef = useRef(hour);
  hourRef.current = hour;

  const stop = useCallback(() => setPlaying(false), []);

  const checkpoints = useMemo(() => checkpointsFor(run), [run]);

  // A new case resets the clock; letting playback survive that would run the
  // transport against a scene the reader did not start.
  useEffect(() => setPlaying(false), [run]);

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();

    const step = (now: number) => {
      // Clamped, so a backgrounded tab does not resume by leaping the whole
      // forecast in a single frame.
      const dt = Math.min(0.25, (now - last.current) / 1000);
      last.current = now;
      const next = hourRef.current + dt * HOURS_PER_SECOND;
      if (next >= max) {
        onChange(max);
        setPlaying(false);
        return;
      }
      onChange(next);
      raf.current = requestAnimationFrame(step);
    };

    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, max, onChange]);

  const pct = (h: number) => ((h - min) / (max - min || 1)) * 100;
  const moment = momentAt(run, hour);

  const goPrev = useCallback(() => {
    stop();
    const prev = [...checkpoints].reverse().find((c) => c < hour - 0.01);
    onChange(prev ?? checkpoints[0]);
  }, [checkpoints, hour, onChange, stop]);

  const goNext = useCallback(() => {
    stop();
    const next = checkpoints.find((c) => c > hour + 0.01);
    onChange(next ?? checkpoints[checkpoints.length - 1]);
  }, [checkpoints, hour, onChange, stop]);

  const toggle = useCallback(() => {
    if (playing) {
      stop();
      return;
    }
    // Pressing play at the horizon restarts from the pass rather than doing
    // nothing at all.
    if (hourRef.current >= max - 0.01) onChange(min);
    setPlaying(true);
  }, [playing, stop, max, onChange]);

  return (
    <div>
      {/* --- the line, centred and bounded --------------------------- */}
      <div className="mx-auto w-[46%] max-w-[620px] min-w-[320px]">
        <div className="relative h-[22px]">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div
              className="absolute top-1/2 right-0 left-0 h-px"
              style={{ background: "var(--line)" }}
            />

            {/* Travelled so far, in the accent. */}
            <div
              className="absolute top-1/2 left-0 h-px"
              style={{
                width: `${pct(hour)}%`,
                background: "var(--accent)",
              }}
            />

            {checkpoints.map((c) => {
              const passed = hour >= c - 0.01;
              return (
                <span
                  key={c}
                  className="absolute top-1/2 block h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45"
                  style={{
                    left: `${pct(c)}%`,
                    background: passed ? "var(--accent)" : "var(--base)",
                    border: `1px solid ${passed ? "var(--accent)" : "var(--ink-faint)"}`,
                  }}
                />
              );
            })}

            {/* The reader's position. */}
            <span
              className="absolute top-1/2 block h-[13px] w-[2px] -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${pct(hour)}%`, background: "var(--accent)" }}
            />
          </div>

          <input
            type="range"
            min={min}
            max={max}
            step={0.25}
            value={hour}
            onChange={(e) => {
              stop();
              onChange(Number(e.target.value));
            }}
            aria-label="Hours after the satellite acquisition"
            aria-valuetext={`${formatHour(hour)}, ${PHASE_LABEL[moment.phase]}`}
            className="scrub absolute inset-0 h-full"
            style={
              {
                "--scrub-track": "transparent",
                "--scrub-thumb": "transparent",
                "--scrub-thumb-w": "16px",
                "--scrub-thumb-h": "22px",
              } as React.CSSProperties
            }
          />
        </div>

        {/* Hour marks under the checkpoints. Without them the dots are
            decoration; with them the line can be read as a scale. */}
        <div aria-hidden className="relative mt-1 h-4">
          {checkpoints.map((c) => (
            <span
              key={c}
              className="num absolute text-[9.5px] whitespace-nowrap"
              style={{
                left: `${pct(c)}%`,
                transform: "translateX(-50%)",
                color:
                  Math.abs(hour - c) < 0.5 ? "var(--accent)" : "var(--ink-faint)",
              }}
            >
              {c === 0 ? "T0" : relHour(c)}
            </span>
          ))}
        </div>
      </div>

      {/* --- transport ----------------------------------------------- */}
      <div className="mt-3 flex items-center justify-center gap-2">
        <Key onClick={goPrev} label="Previous forecast step" disabled={hour <= min + 0.01}>
          ◀
        </Key>
        <Key onClick={toggle} label={playing ? "Pause" : "Play the forecast"} wide>
          {playing ? "❚❚" : "▶"}
        </Key>
        <Key onClick={goNext} label="Next forecast step" disabled={hour >= max - 0.01}>
          ▶
        </Key>
      </div>
    </div>
  );
}

function Key({
  children,
  onClick,
  label,
  disabled = false,
  wide = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`text-dim hover:text-accent hover:border-accent cursor-pointer border py-1 text-[11px] leading-none transition-colors disabled:cursor-default disabled:opacity-30 disabled:hover:text-[var(--ink-dim)] ${
        wide ? "px-5" : "px-3"
      }`}
      style={{ borderColor: "var(--line)" }}
    >
      {children}
    </button>
  );
}
