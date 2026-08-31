/**
 * TERMINAL -- an operations workstation.
 *
 * The composition is fixed to the viewport and does not scroll. That is the
 * structural decision the whole direction rests on: a console is a room you are
 * standing in, not a document you are moving through, and everything an
 * operator needs has to be simultaneously visible. The map holds the middle,
 * the command rail runs down the left, analysis output runs down the right, and
 * the operational timeline with its log stream rules the foot of the frame.
 * Nothing here is a card, nothing is centred in a container, and there is no
 * hero -- opening the site connects you to a session that is already running.
 *
 * Six numbered panes, six real routes. The map stays mounted across all of them
 * (it is a sibling of the pane, not a child), so switching from DRIFT to TRAFFIC
 * costs a re-render of one column rather than a WebGL context.
 *
 * The single clock is `state.hour`. The timeline writes it, the map reads it,
 * the traffic table reads it, the log reads it. There is no second copy of it
 * anywhere in this direction.
 */

import { useEffect, useMemo, useState } from "react";
import { useDesign } from "../../DesignContext";
import { hrefFor, useSection } from "../../lib/hash";
import { stamp } from "../../lib/format";
import { momentAt } from "../../lib/playback";
import { DEFAULT_TOGGLES, type LayerToggles } from "../../map/basemap";
import { scenarioListing, SCENARIOS, type ScenarioId } from "../../sim/scenarios";
import type { ShellProps } from "../registry";
import { Caret, Flag, SCROLL, Toggle, useNarrow } from "./components";
import { LogPanel, useEventLog } from "./LogStream";
import { Timeline } from "./Timeline";
import { Workspace } from "./Workspace";
import { Detect, Drift, Traffic } from "./panes";
import { Attribute, Evidence, Method } from "./reports";

const SECTIONS = [
  "detect",
  "drift",
  "traffic",
  "attribute",
  "evidence",
  "method",
] as const;

const RAIL: { key: string; index: string; label: string }[] = [
  { key: "detect", index: "01", label: "detect" },
  { key: "drift", index: "02", label: "drift" },
  { key: "traffic", index: "03", label: "traffic" },
  { key: "attribute", index: "04", label: "attribute" },
  { key: "evidence", index: "05", label: "evidence" },
  { key: "method", index: "06", label: "method" },
];

/** Layer switches, in the order they stack on the map. */
const LAYERS: { key: keyof LayerToggles; label: string }[] = [
  { key: "slick", label: "detection" },
  { key: "release", label: "release extent" },
  { key: "contours", label: "origin field" },
  { key: "particles", label: "particles" },
  { key: "traffic", label: "ais traffic" },
  { key: "candidates", label: "candidates" },
  { key: "targets", label: "radar targets" },
  { key: "forecast", label: "72 h forecast" },
];

export default function TerminalShell({ state }: ShellProps) {
  const def = useDesign();
  const [section, navigate] = useSection(SECTIONS, "detect");
  const { run, loading, hour, setHour, selectedId, setSelectedId } = state;

  const [toggles, setToggles] = useState<LayerToggles>({
    ...DEFAULT_TOGGLES,
    // Terminal draws no basemap, so there is no label raster to switch on and
    // a live toggle for one would be a control that does nothing.
    labels: false,
  });

  const narrow = useNarrow();
  const [sheetOpen, setSheetOpen] = useState(false);

  /* --- the one clock ------------------------------------------------ */

  // Every consumer of the hour rounds it, so the moment is derived from the
  // rounded value. Deriving it from the raw hour would rebuild the contact list
  // on every fractional step of a playback for an identical result.
  const rounded = Math.round(hour);
  const moment = useMemo(
    () => (run ? momentAt(run, rounded) : null),
    [run, rounded],
  );

  const entries = useEventLog(run, moment);
  const halt = run?.drift.insufficientEvidence ?? null;
  const selected = run?.suspects.find((s) => s.id === selectedId) ?? null;

  /* --- boot --------------------------------------------------------- */

  // The transcript plays when the session opens, not when the case changes.
  // Replaying it on every scenario switch would turn a two-second establishing
  // shot into an obstacle.
  const [booting, setBooting] = useState(true);

  /* --- pane keys ---------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= RAIL.length) {
        navigate(RAIL[n - 1].key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  /* --- panes -------------------------------------------------------- */

  const pane = run ? (
    section === "detect" ? (
      <Detect run={run} />
    ) : section === "drift" ? (
      <Drift
        run={run}
        hour={hour}
        variant={state.variant}
        setVariant={state.setVariant}
      />
    ) : section === "traffic" ? (
      <Traffic
        run={run}
        moment={moment}
        hour={rounded}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
      />
    ) : section === "attribute" ? (
      <Attribute run={run} state={state} />
    ) : section === "evidence" ? (
      <Evidence run={run} state={state} />
    ) : (
      <Method state={state} />
    )
  ) : null;

  /* --- narrow-mode geometry ----------------------------------------- */

  // Values, not a second DOM tree: the map instance has to survive the
  // breakpoint. Closed, the map keeps two fifths of the screen; open, the sheet
  // takes it and the map stays as an orientation strip rather than disappearing.
  const workspaceStyle = narrow
    ? { height: sheetOpen ? "22dvh" : "40dvh" }
    : undefined;

  return (
    <div
      className="relative flex h-[100dvh] flex-col overflow-hidden"
      style={{ background: "var(--base)" }}
    >
      <Scanlines />

      {/* ============================================================ *
       * header strip
       * ============================================================ */}
      <header
        className="flex shrink-0 items-center gap-x-3 gap-y-1 overflow-x-auto border-b px-3 py-[6px]"
        style={{ borderColor: "var(--line)", background: "var(--base-2)" }}
      >
        <span
          className="shrink-0 text-[12px] tracking-[0.18em] whitespace-nowrap uppercase"
          style={{ color: "var(--ink)" }}
        >
          slickline
        </span>
        <span
          className="shrink-0 text-[10px] tracking-[0.2em] whitespace-nowrap uppercase"
          style={{ color: "var(--ink-faint)" }}
        >
          // analysis node {def.index}
        </span>

        <span
          className="num flex shrink-0 items-center gap-1.5 text-[10px] whitespace-nowrap"
          style={{ color: loading ? "var(--warn)" : "var(--accent)" }}
        >
          {loading ? "busy" : "link ok"}
          <Caret tone={loading ? "warn" : "ok"} />
        </span>

        <label className="flex shrink-0 items-center gap-1.5">
          <span className="sr-only">Scenario</span>
          <select
            value={state.scenario}
            onChange={(e) => state.setScenario(e.target.value as ScenarioId)}
            className="num border px-1.5 py-[2px] text-[10.5px] uppercase"
            style={{
              borderColor: "var(--line)",
              background: "var(--base)",
              color: "var(--ink)",
            }}
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
        </label>

        {run && (
          <>
            <span
              className="num hidden shrink-0 text-[10px] whitespace-nowrap md:inline"
              style={{ color: "var(--ink-dim)" }}
            >
              acq {stamp(run.meta.acquiredAt)}
            </span>
            <span
              className="num hidden shrink-0 text-[10px] whitespace-nowrap xl:inline"
              style={{ color: "var(--ink-faint)" }}
            >
              {run.detection.sceneId}
            </span>
          </>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {halt && (
            <Flag tone="alarm" filled title="Attribution withheld: insufficient evidence">
              halt
            </Flag>
          )}
          <Flag tone="warn" title="Simulated. No model trained. Identities masked.">
            sim
          </Flag>
        </div>
      </header>

      {/* ============================================================ *
       * workspace row: rail | map | output
       * ============================================================ */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* command rail, desktop only */}
        <nav
          className="hidden w-[176px] shrink-0 flex-col border-r lg:flex"
          style={{ borderColor: "var(--line)", background: "var(--base-2)" }}
          aria-label="Command rail"
        >
          <div className="py-1">
            {RAIL.map((n) => {
              const active = n.key === section;
              return (
                <a
                  key={n.key}
                  href={hrefFor(n.key)}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(n.key);
                  }}
                  aria-current={active ? "page" : undefined}
                  className="flex items-baseline gap-2 px-3 py-[5px] text-[10.5px] tracking-[0.16em] uppercase transition-colors"
                  style={{
                    color: active ? "var(--ink)" : "var(--ink-faint)",
                    background: active
                      ? "color-mix(in oklab, var(--accent) 10%, transparent)"
                      : "transparent",
                    boxShadow: active ? "inset 2px 0 0 var(--accent)" : undefined,
                  }}
                >
                  <span
                    className="num"
                    style={{ color: active ? "var(--accent)" : "var(--ink-faint)" }}
                  >
                    {n.index}
                  </span>
                  <span>{n.label}</span>
                  {n.key === "attribute" && halt && (
                    <span className="ml-auto">
                      <Flag tone="alarm">!</Flag>
                    </span>
                  )}
                  {active && !(n.key === "attribute" && halt) && (
                    <span className="ml-auto">
                      <Caret />
                    </span>
                  )}
                </a>
              );
            })}
          </div>

          <div
            className="mt-2 min-h-0 flex-1 overflow-y-auto border-t px-3 py-2"
            style={{ borderColor: "var(--line)", ...SCROLL }}
          >
            <p
              className="mb-1 text-[9px] tracking-[0.26em] uppercase"
              style={{ color: "var(--ink-faint)" }}
            >
              layers
            </p>
            {LAYERS.map((l) => (
              <Toggle
                key={l.key}
                on={toggles[l.key]}
                label={l.label}
                onChange={(v) => setToggles((t) => ({ ...t, [l.key]: v }))}
              />
            ))}

            <p
              className="mt-4 mb-1 text-[9px] tracking-[0.26em] uppercase"
              style={{ color: "var(--ink-faint)" }}
            >
              keys
            </p>
            <p className="num text-[9.5px] leading-[1.7]" style={{ color: "var(--ink-faint)" }}>
              1-6 pane
              <br />
              space play / hold
              <br />
              home first hour
              <br />← → step one hour
            </p>
          </div>

          {run && (
            <div
              className="shrink-0 border-t px-3 py-2"
              style={{ borderColor: "var(--line)" }}
            >
              <p
                className="text-[9px] tracking-[0.2em] uppercase"
                style={{ color: "var(--ink-faint)" }}
              >
                {scenarioListing(state.scenario).name}
              </p>
              <p className="num mt-0.5 text-[9.5px]" style={{ color: "var(--ink-faint)" }}>
                {run.vessels.length} tracks · {run.suspects.length} cand
              </p>
            </div>
          )}
        </nav>

        {/* The map, mounted once and never unmounted by a pane change.
            A flex column so the workspace inside can take its height by
            `flex-1`; and `shrink-0` rather than `flex-1` in narrow mode,
            because `flex-1` sets `flex-basis: 0%` on the main axis and would
            silently discard the explicit height the sheet state sets. */}
        <div
          className={`flex min-h-0 min-w-0 flex-col ${narrow ? "shrink-0" : "flex-1"}`}
          style={workspaceStyle}
        >
          <Workspace
            run={run}
            paint={def.map}
            hour={hour}
            toggles={toggles}
            selected={selected}
            onSelect={setSelectedId}
            booting={booting && !!run}
            onBooted={() => setBooting(false)}
            loading={loading}
          />
        </div>

        {/* narrow mode: timeline sits directly under the map, then the tabs */}
        {narrow && run && (
          <>
            <div className="shrink-0">
              <Timeline run={run} hour={hour} setHour={setHour} moment={moment} />
            </div>
            <div
              className="flex shrink-0 items-stretch overflow-x-auto border-t border-b"
              style={{ borderColor: "var(--line)", background: "var(--base-2)" }}
              role="tablist"
              aria-label="Analysis panes"
            >
              {RAIL.map((n) => {
                const active = n.key === section;
                return (
                  <button
                    key={n.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => navigate(n.key)}
                    className="flex shrink-0 items-baseline gap-1 px-3 py-2 text-[10px] tracking-[0.16em] uppercase"
                    style={{
                      color: active ? "var(--ink)" : "var(--ink-faint)",
                      background: active
                        ? "color-mix(in oklab, var(--accent) 10%, transparent)"
                        : "transparent",
                      boxShadow: active ? "inset 0 -2px 0 var(--accent)" : undefined,
                    }}
                  >
                    <span
                      className="num"
                      style={{ color: active ? "var(--accent)" : "var(--ink-faint)" }}
                    >
                      {n.index}
                    </span>
                    {n.label}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* analysis output */}
        <aside
          className="flex min-h-0 min-w-0 flex-1 flex-col lg:w-[400px] lg:flex-none xl:w-[440px]"
          aria-label="Analysis output"
        >
          {narrow && (
            <button
              type="button"
              onClick={() => setSheetOpen((v) => !v)}
              className="flex shrink-0 items-center justify-center gap-2 border-b py-1.5 text-[9px] tracking-[0.24em] uppercase"
              style={{
                borderColor: "var(--line)",
                background: "var(--base-2)",
                color: "var(--ink-faint)",
              }}
              aria-expanded={sheetOpen}
            >
              <span
                className="h-[2px] w-8"
                style={{ background: "var(--ink-faint)" }}
                aria-hidden
              />
              {sheetOpen ? "shrink output" : "expand output"}
            </button>
          )}
          {/* Flex, so the pane frame is stretched to this column rather than
              sizing to its own content. A block child here takes its height
              from what is inside it, which overflows the aside instead of
              scrolling within it -- the pane's own `overflow-y-auto` then has
              nothing to scroll against. */}
          <div className="flex min-h-0 flex-1">{pane}</div>
        </aside>
      </div>

      {/* ============================================================ *
       * foot: operational timeline + log stream
       * ============================================================ */}
      {run && !narrow && (
        <div
          className="flex shrink-0"
          style={{ height: "clamp(150px, 19vh, 202px)" }}
        >
          {/* Flex, so the timeline is stretched to the band height rather than
              resolving a percentage against it. */}
          <div className="flex min-w-0 flex-1">
            <Timeline run={run} hour={hour} setHour={setHour} moment={moment} />
          </div>
          <section
            className="flex w-[340px] shrink-0 flex-col border-t border-l xl:w-[400px]"
            style={{ borderColor: "var(--line)", background: "var(--base-2)" }}
            aria-label="Event log"
          >
            <header
              className="flex shrink-0 items-center gap-2 border-b px-3 py-[5px]"
              style={{ borderColor: "var(--line)" }}
            >
              <span
                className="text-[9.5px] tracking-[0.28em] uppercase"
                style={{ color: "var(--ink-faint)" }}
              >
                event log
              </span>
              <span className="h-px flex-1" style={{ background: "var(--line)" }} />
              <span className="num text-[9.5px]" style={{ color: "var(--ink-faint)" }}>
                {entries.length}
              </span>
            </header>
            <LogPanel entries={entries} className="flex-1" />
          </section>
        </div>
      )}

      {/* narrow mode keeps the log as a two-line ticker at the foot: the
          transitions are the half of the playback the panes cannot show */}
      {run && narrow && (
        <section
          className="shrink-0 border-t"
          style={{ borderColor: "var(--line)", background: "var(--base-2)", height: 40 }}
          aria-label="Event log"
        >
          <LogPanel entries={entries} rows={2} className="h-full" />
        </section>
      )}
    </div>
  );
}

/**
 * CRT scanlines.
 *
 * `position: fixed` and `pointer-events-none`, on its own layer, so it never
 * repaints when anything under it scrolls. Texture inside a scrolling container
 * forces a full repaint of the composited layer every frame, which is the usual
 * way a page with grain on it becomes a page that stutters.
 *
 * The line colour is mixed from `--base` rather than being a hard-coded black,
 * so the texture darkens toward this direction's own ground instead of toward
 * an arbitrary one.
 */
function Scanlines() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50"
      style={{
        backgroundImage: [
          "repeating-linear-gradient(to bottom, color-mix(in oklab, var(--base) 74%, transparent) 0 1px, transparent 1px 3px)",
          "radial-gradient(ellipse at 50% 45%, transparent 52%, color-mix(in oklab, var(--base) 62%, transparent) 100%)",
        ].join(", "),
        opacity: 0.34,
      }}
    />
  );
}
