/**
 * Signal's transport control.
 *
 * A publication does not have a media player. It has a caption that changes,
 * and a rule with marks on it. So the control is typographic: the state of the
 * event is a sentence in the reading face, the hour is set in display type at
 * the size a pull quote would be, and the scrubber itself is a hairline with
 * named marks hung under it.
 *
 * A real `<input type="range">` sits on top of the hairline at full width and
 * full height, transparent. Arrow keys, Home, End and screen-reader
 * announcement then come from the platform rather than being reimplemented on a
 * div, which is the usual way a custom scrubber ends up unusable without a
 * mouse. The visible furniture is drawn underneath it and is `aria-hidden`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { formatHour, stamp } from "../../lib/format";
import { PHASE_LABEL, eventSpan, momentAt } from "../../lib/playback";
import type { Run } from "../../sim/types";
import { Kicker } from "./components";

/** Hours of the event per second of playback. Slow enough to read. */
const HOURS_PER_SECOND = 4;

interface Mark {
  hour: number;
  label: string;
  strong?: boolean;
}

export function EventTransport({
  run,
  hour,
  onChange,
}: {
  run: Run;
  hour: number;
  onChange: (h: number) => void;
}) {
  const [min, max] = eventSpan(run);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const last = useRef(0);
  const hourRef = useRef(hour);
  hourRef.current = hour;

  const stop = useCallback(() => setPlaying(false), []);

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();

    const step = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      // Playback runs forward, always. Running it backward would show the model
      // working; running it forward shows the ocean working, which is the thing
      // the reader is here to understand.
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

  const moment = momentAt(run, hour);
  const pct = (h: number) => ((h - min) / (max - min || 1)) * 100;

  const marks: Mark[] = [
    { hour: run.releaseStartHour, label: "Release begins", strong: true },
    ...(run.releaseEndHour < -0.5
      ? [{ hour: run.releaseEndHour, label: "Discharge ends" }]
      : []),
    { hour: 0, label: "Satellite pass", strong: true },
    { hour: run.drift.forwardHours, label: "Forecast horizon" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div>
          <Kicker>{PHASE_LABEL[moment.phase]}</Kicker>
          <p
            className="text-ink mt-2 text-[clamp(2rem,3.4vw,3rem)] leading-none"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
            }}
          >
            {formatHour(hour)}
          </p>
          <p className="num text-faint mt-1.5 text-[12px]">{stamp(moment.at)}</p>
        </div>

        <div className="flex items-baseline gap-7">
          <button
            type="button"
            onClick={() => {
              if (playing) stop();
              else {
                if (hour >= max - 0.01) onChange(min);
                setPlaying(true);
              }
            }}
            className="text-accent pb-0.5 font-mono text-[11px] tracking-[0.22em] uppercase transition-opacity hover:opacity-70"
            style={{ borderBottom: "1px solid var(--accent)" }}
          >
            {playing ? "Pause" : "Play the event"}
          </button>
          <button
            type="button"
            onClick={() => {
              stop();
              onChange(run.releaseStartHour);
            }}
            className="text-faint hover:text-ink pb-0.5 font-mono text-[11px] tracking-[0.22em] uppercase transition-colors"
            style={{ borderBottom: "1px solid var(--line)" }}
          >
            Back to the start
          </button>
          <button
            type="button"
            onClick={() => {
              stop();
              onChange(0);
            }}
            className="text-faint hover:text-ink pb-0.5 font-mono text-[11px] tracking-[0.22em] uppercase transition-colors"
            style={{ borderBottom: "1px solid var(--line)" }}
          >
            The pass
          </button>
        </div>
      </div>

      {/* The rule. */}
      <div className="relative mt-8 h-[26px]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
        >
          <div
            className="absolute top-1/2 right-0 left-0 h-px"
            style={{ background: "var(--line)" }}
          />

          {/* The estimated release window, shaded across the rule. */}
          <div
            className="absolute top-1/2 h-[7px] -translate-y-1/2"
            style={{
              left: `${pct(-run.drift.ageHours[2])}%`,
              width: `${Math.max(0.4, pct(-run.drift.ageHours[0]) - pct(-run.drift.ageHours[2]))}%`,
              background: "color-mix(in oklab, var(--accent) 26%, transparent)",
            }}
          />

          {/* Discharge span, as a heavier rule. */}
          <div
            className="absolute top-1/2 h-[2px] -translate-y-[1px]"
            style={{
              left: `${pct(run.releaseStartHour)}%`,
              width: `${Math.max(0.4, pct(Math.min(0, run.releaseEndHour)) - pct(run.releaseStartHour))}%`,
              background: "var(--ink-dim)",
            }}
          />

          {marks.map((m) => (
            <div
              key={m.label}
              className="absolute top-1/2 -translate-y-1/2"
              style={{ left: `${pct(m.hour)}%` }}
            >
              <div
                className="h-[13px] w-px"
                style={{
                  background: m.strong ? "var(--ink)" : "var(--ink-faint)",
                }}
              />
            </div>
          ))}

          {/* The reader's position, as a full-height hairline. */}
          <div
            className="absolute inset-y-0"
            style={{ left: `${pct(hour)}%`, width: 1, background: "var(--accent)" }}
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
          aria-label="Hours from the satellite acquisition"
          aria-valuetext={`${formatHour(hour)}, ${stamp(moment.at)}, ${PHASE_LABEL[moment.phase]}`}
          className="scrub absolute inset-0 h-full"
          style={
            {
              "--scrub-track": "transparent",
              "--scrub-thumb": "var(--accent)",
              "--scrub-thumb-w": "9px",
              "--scrub-thumb-h": "9px",
            } as React.CSSProperties
          }
        />
      </div>

      <div aria-hidden className="relative mt-2 h-8">
        {marks.map((m) => (
          <span
            key={m.label}
            className="text-faint absolute font-mono text-[9.5px] tracking-[0.16em] whitespace-nowrap uppercase"
            style={{
              left: `${pct(m.hour)}%`,
              transform:
                pct(m.hour) > 80
                  ? "translateX(-100%)"
                  : pct(m.hour) < 8
                    ? "none"
                    : "translateX(-50%)",
              color: m.strong ? "var(--ink-dim)" : "var(--ink-faint)",
            }}
          >
            {m.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * What is in the water right now, in a sentence and four figures.
 *
 * Deliberately prose-led. The same numbers appear in Terminal as an aligned
 * column and in Orbit as instrument readouts; here they are read.
 */
export function MomentReadout({ run, hour }: { run: Run; hour: number }) {
  const m = momentAt(run, hour);

  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
      <Readout
        label="Discharged"
        value={`${(m.releasedFraction * 100).toFixed(0)}%`}
        note={
          m.phase === "pre"
            ? "Nothing in the water yet"
            : `${Math.max(0, m.sinceStart).toFixed(0)} h since it began`
        }
      />
      <Readout
        label="Surface extent"
        value={m.areaKm2.toFixed(2)}
        unit="km²"
        note="Modelled at the detection threshold"
      />
      <Readout
        label="Within 12 km"
        value={String(m.contacts.length)}
        note={`of ${run.vessels.length} tracks in the scene. Presence, not a ranking`}
      />
      {/* The nearest contact rather than a count of vessels inside the oil.
          In a working port the count is almost always zero and stays zero,
          because oil leaves the berth it came from within the hour -- which is
          the whole reason proximity alone cannot attribute a spill, and a
          readout that reads 0 all evening says none of that. */}
      <Readout
        label="Nearest contact"
        value={
          m.contacts.length
            ? m.contacts[0].distanceKm < 0.05
              ? "in it"
              : m.contacts[0].distanceKm.toFixed(1)
            : "—"
        }
        unit={
          m.contacts.length && m.contacts[0].distanceKm >= 0.05 ? "km" : undefined
        }
        note={
          m.contacts.length
            ? `${m.contacts[0].label}${m.inContact ? `, ${m.inContact} inside the oil` : ""}`
            : "Nothing reporting within 12 km"
        }
      />
    </div>
  );
}

function Readout({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
}) {
  return (
    <div>
      <p className="text-faint font-mono text-[9.5px] tracking-[0.2em] uppercase">
        {label}
      </p>
      <p className="num text-ink mt-1.5 text-[26px] leading-none">
        {value}
        {unit && <span className="text-dim ml-1 text-[12px]">{unit}</span>}
      </p>
      <p
        className="text-dim mt-1.5 text-[12.5px] leading-[1.45]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        {note}
      </p>
    </div>
  );
}
