/**
 * The event and system log.
 *
 * This is the half of the console that answers "what just changed". The panes
 * report state; the log reports transitions, which is a different job and the
 * reason it is a separate structural element rather than a widget inside a
 * pane. Scrubbing the timeline with the log on screen is how the operator reads
 * the event as a sequence instead of as a series of disconnected snapshots.
 *
 * Everything in here is derived, never authored. A line exists because two
 * consecutive moments of the simulation differ; there is no scripted narration
 * and no line that would print whether or not the numbers changed. That is what
 * keeps it a log rather than a caption track.
 *
 * The voice is machine: lower case, no articles where a machine would drop
 * them, and no verb that implies a judgement. A contact entering the twelve
 * kilometre radius is `+contact`, never "suspect approaches".
 */

import { useEffect, useRef, useState } from "react";
import { animate } from "animejs";
import { clock, formatHour } from "../lib/format";
import { CONTACT_RADIUS_KM, PHASE_LABEL, type Moment } from "../lib/playback";
import { useReducedMotion } from "../lib/motion";
import { WEIGHTS_VERSION } from "../sim/scoring";
import { scenarioListing } from "../sim/scenarios";
import { PROVENANCE } from "../content";
import type { Run } from "../sim/types";
import { SCROLL, TONE, type Tone } from "./components";

export interface LogEntry {
  id: number;
  at: number;
  hour: number;
  tag: string;
  text: string;
  tone: Tone;
}

/** Newest last, capped. A console log scrolls; it does not paginate. */
const CAP = 160;

let nextId = 0;
function entry(at: number, hour: number, tag: string, text: string, tone: Tone = "dim"): LogEntry {
  return { id: nextId++, at, hour, tag, text, tone };
}

/* ------------------------------------------------------------------ *
 * Derivation
 * ------------------------------------------------------------------ */

function seedLines(run: Run): LogEntry[] {
  const at = run.meta.acquiredAt;
  const d = run.drift;
  const listing = scenarioListing(run.meta.id);
  const out: LogEntry[] = [
    entry(at, 0, "sys", "session open · analysis node 04", "ok"),
    entry(at, 0, "sys", `scenario ${listing.name.toLowerCase()} · ${run.meta.id}`),
    entry(at, 0, "sar", `${run.detection.sceneId} · vv · iw`),
    entry(
      at,
      0,
      "det",
      `${run.detection.parts.length} instance · ${run.detection.className} · conf ${run.detection.confidence.toFixed(2)}`,
    ),
    entry(
      at,
      0,
      "geom",
      `${run.characterisation.areaKm2.toFixed(2)} km2 · ${run.characterisation.lengthKm.toFixed(1)} km · elong ${run.characterisation.elongation.toFixed(1)}`,
    ),
    entry(
      at,
      0,
      "gate",
      `wind ${run.characterisation.windSpeedMs.toFixed(1)} m/s · multiplier x${run.characterisation.windGateMultiplier.toFixed(2)}`,
      run.characterisation.windGateMultiplier < 0.5 ? "warn" : "dim",
    ),
    entry(
      at,
      0,
      "drift",
      `ensemble ${d.ensembleSize} members · ${d.particleCount} particles · -${d.backwardHours}/+${d.forwardHours} h`,
    ),
    entry(
      at,
      0,
      "ais",
      `${run.aisPointCount.toLocaleString()} reports · ${run.vessels.length} tracks in scene`,
    ),
    entry(
      at,
      0,
      "attr",
      `${run.suspects.length} candidates · weights ${WEIGHTS_VERSION}`,
      run.suspects.length ? "dim" : "warn",
    ),
    entry(at, 0, "prov", PROVENANCE.short.toLowerCase(), "warn"),
  ];

  if (d.insufficientEvidence) {
    out.push(
      entry(
        at,
        0,
        "halt",
        `attribution withheld · 90% contour ${d.insufficientEvidence.area90Km2.toFixed(0)} km2`,
        "alarm",
      ),
    );
  }
  return out;
}

/**
 * What changed between two hours.
 *
 * Written so it reads correctly in both directions of travel. The operator
 * scrubs backward as often as forward, so nothing here says "approaches" or
 * "grows"; it says which side of a threshold the value moved to.
 */
function diffLines(run: Run, before: Moment, now: Moment): LogEntry[] {
  const out: LogEntry[] = [];
  const h = now.hour;
  const at = now.at;

  if (before.phase !== now.phase) {
    out.push(
      entry(
        at,
        h,
        "phase",
        `${before.phase} -> ${now.phase} · ${PHASE_LABEL[now.phase].toLowerCase()}`,
        now.phase === "acquisition" ? "ok" : "ink",
      ),
    );
  }

  if (now.phase === "acquisition" && before.phase !== "acquisition") {
    out.push(
      entry(at, h, "sar", `pass · ${run.detection.sceneId} · mask committed`, "ok"),
    );
  }

  // Released fraction, reported on decade crossings rather than every hour.
  // Printing 0.03 of a percent per hour would bury the transitions that matter
  // in noise the operator cannot act on.
  const step = (v: number) => Math.floor(v * 10);
  if (step(now.releasedFraction) !== step(before.releasedFraction)) {
    out.push(
      entry(
        at,
        h,
        "rel",
        `discharged ${(now.releasedFraction * 100).toFixed(0)}% · surface ${now.areaKm2.toFixed(2)} km2`,
      ),
    );
  }

  const wasNear = new Set(before.contacts.map((c) => c.mmsi));
  const isNear = new Set(now.contacts.map((c) => c.mmsi));

  for (const c of now.contacts) {
    if (wasNear.has(c.mmsi)) continue;
    out.push(
      entry(
        at,
        h,
        "ais",
        `+contact ${c.label} · ${c.distanceKm.toFixed(1)} km · ${c.sog.toFixed(1)} kn · ${Math.round(c.cog)}deg${c.candidate ? " · scored" : ""}`,
        c.candidate ? "ok" : "dim",
      ),
    );
  }
  for (const c of before.contacts) {
    if (isNear.has(c.mmsi)) continue;
    out.push(
      entry(at, h, "ais", `-contact ${c.label} · outside ${CONTACT_RADIUS_KM} km`, "faint"),
    );
  }

  if (now.inContact !== before.inContact) {
    out.push(
      entry(
        at,
        h,
        "oil",
        now.inContact
          ? `${now.inContact} track${now.inContact > 1 ? "s" : ""} inside the surface extent`
          : "no track inside the surface extent",
        now.inContact ? "warn" : "faint",
      ),
    );
  }

  if (h >= run.drift.forwardHours && before.hour < run.drift.forwardHours) {
    out.push(entry(at, h, "fcst", "forecast horizon · no forcing beyond this hour", "warn"));
  }

  return out;
}

/**
 * The log, accumulated across the session.
 *
 * Lives in the shell rather than in the panel so that the desktop log and the
 * narrow-mode strip are two views of one stream. Two independent accumulators
 * would drift the moment one of them unmounted.
 */
export function useEventLog(run: Run | null, moment: Moment | null): LogEntry[] {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  // Keyed on the run object rather than on its id: switching the drift variant
  // rebuilds the run without changing `meta.id`, and the log has to restart for
  // that too because every number in the seed changed.
  const seeded = useRef<Run | null>(null);
  const prev = useRef<Moment | null>(null);

  useEffect(() => {
    if (!run || seeded.current === run) return;
    seeded.current = run;
    prev.current = null;
    setEntries(seedLines(run));
  }, [run]);

  useEffect(() => {
    if (!run || !moment || seeded.current !== run) return;
    const before = prev.current;
    prev.current = moment;
    if (!before || before.hour === moment.hour) return;
    const lines = diffLines(run, before, moment);
    if (!lines.length) return;
    setEntries((e) => {
      const next = [...e, ...lines];
      return next.length > CAP ? next.slice(next.length - CAP) : next;
    });
  }, [run, moment]);

  return entries;
}

/* ------------------------------------------------------------------ *
 * Panel
 * ------------------------------------------------------------------ */

/**
 * The stream itself.
 *
 * Auto-scroll only when the operator is already at the tail. Forcing the view
 * down while somebody is reading back through the discharge is the single most
 * annoying thing a log panel can do, and the fix is four lines.
 */
export function LogPanel({
  entries,
  className = "",
  rows,
}: {
  entries: LogEntry[];
  className?: string;
  rows?: number;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const tail = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const count = entries.length;

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const nearTail = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (nearTail) el.scrollTop = el.scrollHeight;
  }, [count]);

  useEffect(() => {
    const el = tail.current;
    if (!el || reduced) return;
    // A one-frame arrival, not a fade-in. Console output appears; it does not
    // ease into place.
    const a = animate(el, {
      opacity: [0.25, 1],
      translateX: [-3, 0],
      duration: 140,
      ease: "linear",
    });
    return () => {
      a.revert();
    };
  }, [count, reduced]);

  const visible = rows ? entries.slice(-rows) : entries;

  return (
    <div
      ref={holder}
      className={`min-h-0 overflow-y-auto px-3 py-2 ${className}`}
      style={SCROLL}
      role="log"
      aria-live="off"
      aria-label="System and event log"
    >
      {visible.map((e, i) => (
        <div
          key={e.id}
          ref={i === visible.length - 1 ? tail : undefined}
          className="flex gap-2 py-[1px] text-[10.5px] leading-[1.45] whitespace-nowrap"
        >
          <span className="num shrink-0" style={{ color: "var(--ink-faint)" }}>
            {clock(e.at)}
          </span>
          <span
            className="num w-[5ch] shrink-0 text-right"
            style={{ color: "var(--ink-faint)" }}
          >
            {formatHour(e.hour)}
          </span>
          <span
            className="w-[5ch] shrink-0 uppercase"
            style={{ color: TONE[e.tone === "dim" ? "faint" : e.tone] }}
          >
            {e.tag}
          </span>
          <span className="min-w-0 truncate" style={{ color: TONE[e.tone] }}>
            {e.text}
          </span>
        </div>
      ))}
    </div>
  );
}
