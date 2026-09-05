/**
 * THE CONSOLE -- an operations workstation.
 *
 * Fixed to the viewport, no page scroll. That is the structural decision the
 * whole surface rests on: a console is a room you stand in, not a document you
 * move through, and everything an operator needs has to be simultaneously
 * visible. The map holds the middle, panels dock either side of it, and the
 * operational timeline rules the foot.
 *
 * What changed when Terminal became this: the six numbered panes stopped being
 * *routes* and became *panels*. A route means one pane at a time and the others
 * are somewhere else; a panel means the operator decides. Any of them can be
 * fronted in its dock, torn off into a window, closed, or brought back. The
 * arrangement persists, and there is always a way back to the default.
 *
 * Two things are deliberately not panels. The map is the work surface, and the
 * timeline is the console's other axis -- everything on screen is a function of
 * `hour`, so an operator who closed the clock would be scrubbing something they
 * cannot see.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { hrefFor } from "../lib/hash";
import { stamp } from "../lib/format";
import { momentAt } from "../lib/playback";
import { useSpill } from "../lib/spill";
import { DEFAULT_TOGGLES, type LayerToggles } from "../map/basemap";
import { REPO_URL } from "../theme";
import { usePaint } from "../lib/palette";
import { PalettePanel } from "../components/PalettePanel";
import { Caret, Flag, GroupHead, SCROLL, Toggle, useNarrow } from "./components";
import { LogPanel, useEventLog } from "./LogStream";
import { Timeline } from "./Timeline";
import { Workspace } from "./Workspace";
import { Detect, Drift, Traffic } from "./panes";
import { Attribute, Evidence, Method } from "./reports";
import { SpillKey } from "./SpillKey";
import { PanelsMenu } from "./PanelsMenu";
import { DockRail } from "./dock/DockRail";
import { FloatWindow } from "./dock/FloatWindow";
import { PANELS, useDock, useDockDrag, type PanelId } from "./dock/useDock";

/** Layer switches, in the order they stack on the map. */
const LAYERS: { key: keyof LayerToggles; label: string; hint: string }[] = [
  { key: "slick", label: "detection", hint: "the instance mask" },
  { key: "release", label: "release extent", hint: "oil, as it entered the water" },
  { key: "contours", label: "origin field", hint: "backward ensemble, 50% and 90%" },
  { key: "particles", label: "particles", hint: "the ensemble members themselves" },
  { key: "traffic", label: "ais traffic", hint: "tracks the gate rejected" },
  { key: "candidates", label: "candidates", hint: "tracks that survived the gate" },
  { key: "targets", label: "radar targets", hint: "bright contacts, matched or dark" },
  { key: "forecast", label: "72 h forecast", hint: "forward impact envelope" },
  { key: "labels", label: "place labels", hint: "coastline names from the basemap" },
];

export default function ConsoleShell() {
  // Merged over `SURFACES.console.map` by the colour panel. `MapCanvas` already
  // re-applies paint live, so this needs no other wiring.
  const paint = usePaint();
  const state = useSpill("gom-berthed", { eager: true, syncUrl: true });
  const dock = useDock();
  /*
    The drag controller belongs here and cannot belong anywhere lower.

    Dropping a window on a tab strip docks it *while the pointer is still
    down*, which unmounts the `FloatWindow` doing the dragging; tearing a tab
    off unmounts the tab that started it. Whatever holds the pointer listeners
    therefore has to outlive both ends of the gesture, and this component --
    which owns `useDock` and is mounted for as long as the console is -- is the
    lowest place in the tree that does. See `useDockDrag` for the two designs
    that were costed against this one.
  */
  const drag = useDockDrag(dock);
  const { run, loading, hour, setHour, selectedId, setSelectedId } = state;

  const [toggles, setToggles] = useState<LayerToggles>(DEFAULT_TOGGLES);
  const narrow = useNarrow();
  const [booting, setBooting] = useState(true);

  /* --- the one clock ------------------------------------------------ */

  // Every consumer rounds the hour, so the moment is derived from the rounded
  // value. Deriving it from the raw hour would rebuild the contact list on
  // every fractional step of a playback for an identical result.
  const rounded = Math.round(hour);
  const moment = useMemo(
    () => (run ? momentAt(run, rounded) : null),
    [run, rounded],
  );

  const entries = useEventLog(run, moment);
  const halt = run?.drift.insufficientEvidence ?? null;
  const selected = run?.suspects.find((s) => s.id === selectedId) ?? null;

  /* --- panel keys --------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const hit = PANELS.find((p) => p.key && p.key === e.key);
      if (!hit) return;
      const place = dock.layout[hit.id];
      // The number keys front a pane wherever it currently lives. If it was
      // closed, reopen it -- a shortcut that silently does nothing because the
      // panel is not docked is worse than no shortcut.
      if (place.kind === "dock") dock.setActive(place.side, hit.id);
      else if (place.kind === "closed") dock.reopen(hit.id);
      else dock.raise(hit.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dock]);

  /* --- panel bodies -------------------------------------------------- */

  const renderPanel = (id: PanelId) => {
    if (id === "layers") {
      return (
        <div
          /* A control panel, not a report: `data-pane-narrow` keeps it at rail
             width in the panel reader instead of stretching a column of
             switches across the whole page. */
          data-pane-narrow
          className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
          style={SCROLL}
        >
          <GroupHead hint="What the chart draws. Each switch is one layer.">
            control attributes
          </GroupHead>
          <div className="mt-1.5">
            {LAYERS.map((l) => (
              <Toggle
                key={l.key}
                on={toggles[l.key]}
                label={l.label}
                title={l.hint}
                onChange={(v) => setToggles((t) => ({ ...t, [l.key]: v }))}
              />
            ))}
          </div>

          <GroupHead hint="Panels tear off with a double-click on their tab.">
            keys
          </GroupHead>
          <p
            className="num mt-1.5 px-2 text-[9.5px] leading-[1.7]"
            style={{ color: "var(--ink-faint)" }}
          >
            1-6 panel
            <br />
            space play / hold
            <br />
            home first hour
            <br />
            esc dock a window
            <br />← → step one hour
          </p>

          {run && (
            <GroupHead right={<Flag tone="warn">sim</Flag>}>case</GroupHead>
          )}
          {run && (
            <div className="mt-1.5 px-2">
              <p
                className="text-[9.5px] tracking-[0.16em] uppercase"
                style={{ color: "var(--ink-dim)" }}
              >
                {state.listing.name}
              </p>
              <p
                className="num mt-0.5 text-[9.5px]"
                style={{ color: "var(--ink-faint)" }}
              >
                {run.vessels.length} tracks · {run.suspects.length} cand
              </p>
              <p
                className="mt-1 text-[9px] leading-[1.5]"
                style={{ color: "var(--ink-faint)" }}
              >
                {state.listing.tests}
              </p>
            </div>
          )}
        </div>
      );
    }

    if (id === "palette")
      return (
        <div data-pane-narrow className="flex min-h-0 flex-1 flex-col">
          <PalettePanel />
        </div>
      );

    if (id === "log") {
      return (
        <div data-pane-narrow className="flex min-h-0 flex-1 flex-col">
          <div
            className="flex shrink-0 items-center gap-2 border-b px-2 py-[5px]"
            style={{ borderColor: "var(--line)" }}
          >
            <span
              className="text-[9.5px] tracking-[0.26em] uppercase"
              style={{ color: "var(--ink-faint)" }}
            >
              transitions
            </span>
            <span className="h-px flex-1" style={{ background: "var(--line)" }} />
            <span
              className="num text-[9.5px]"
              style={{ color: "var(--ink-faint)" }}
            >
              {entries.length}
            </span>
          </div>
          <LogPanel entries={entries} className="flex-1" />
        </div>
      );
    }

    if (!run) return null;
    if (id === "detect") return <Detect run={run} />;
    if (id === "drift")
      return (
        <Drift
          run={run}
          hour={hour}
          variant={state.variant}
          setVariant={state.setVariant}
        />
      );
    if (id === "traffic")
      return (
        <Traffic
          run={run}
          moment={moment}
          hour={rounded}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
        />
      );
    if (id === "attribute") return <Attribute run={run} state={state} />;
    if (id === "evidence") return <Evidence run={run} state={state} />;
    return <Method state={state} />;
  };

  return (
    <div
      /*
        The page scrolls now; the workstation does not.

        The console used to be `h-[100dvh] overflow-hidden` at the root, which
        made the whole surface a fixed room. The room is still a room -- see the
        wrapper below, which is exactly one viewport tall and clips its own
        contents -- but there is a readable section under it now, because a dock
        rail is a good place to *monitor* a pane and a poor place to read one.
      */
      className="relative flex min-h-[100dvh] flex-col"
      style={{ background: "var(--base)" }}
    >
      <Scanlines />

      {/* ============================================================ *
       * the workstation: one viewport, header to timeline
       * ============================================================ */}
      <div className="flex h-[100dvh] shrink-0 flex-col overflow-hidden">

      {/* ============================================================ *
       * header strip
       * ============================================================ */}
      {/*
        No `overflow-x-auto` here, and it must not come back.

        A scrolling header sounds like the right answer for a narrow viewport,
        and it silently breaks both dropdowns hung off it: an absolutely
        positioned menu inside an `overflow: auto` ancestor is clipped to that
        ancestor, so the spill key and the panels menu both opened correctly and
        rendered as a few-pixel sliver with its own scrollbar. The controls
        looked broken while the state was entirely right.

        Wrapping instead costs a second row on a narrow console and clips
        nothing.
      */}
      <header
        className="relative z-40 flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-b px-2.5 py-[6px]"
        style={{ borderColor: "var(--line)", background: "var(--base-2)" }}
      >
        <a
          href="#/"
          /* 11.5px: the Panel title rung. This is the title of the whole
             surface, and it was the only 12px in the console -- half a pixel
             clear of a rung it is already indistinguishable from. */
          className="shrink-0 text-[11.5px] tracking-[0.16em] whitespace-nowrap uppercase transition-colors"
          style={{ color: "var(--ink)" }}
          title="SlickTrace — back to the home page"
        >
          SlickTrace
        </a>
        <span
          className="hidden shrink-0 text-[10px] tracking-[0.2em] whitespace-nowrap uppercase md:inline"
          style={{ color: "var(--ink-faint)" }}
        >
          // console
        </span>

        <span
          className="num flex shrink-0 items-center gap-1.5 text-[10px] whitespace-nowrap"
          style={{ color: loading ? "var(--warn)" : "var(--accent)" }}
        >
          {loading ? "busy" : "link ok"}
          <Caret tone={loading ? "warn" : "ok"} />
        </span>

        <SpillKey
          scenario={state.scenario}
          setScenario={state.setScenario}
          busy={loading}
        />

        {run && (
          <span
            className="num hidden shrink-0 text-[10px] whitespace-nowrap lg:inline"
            style={{ color: "var(--ink-dim)" }}
          >
            acq {stamp(run.meta.acquiredAt)}
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {halt && (
            <Flag
              tone="alarm"
              filled
              title="Attribution withheld: insufficient evidence"
            >
              halt
            </Flag>
          )}
          {/*
            Both of these are desktop-only, and for the same reason: below
            `useNarrow`'s breakpoint the docks are not rendered at all, so a
            menu that moves panels between them has nothing to act on, and the
            header has no room to spend on a badge once the case key, the link
            state and the two exits have wrapped.

            The `sim` disclosure is not lost with it. It is on the `case` group
            in the control-attributes panel, and the detect pane opens with the
            provenance note that says in full which parts of this run are
            simulated -- both of which a narrow viewport reaches through the
            panel reader.
          */}
          {!narrow && (
            <Flag tone="warn" title="Simulated. No model trained. Identities masked.">
              sim
            </Flag>
          )}

          {!narrow && <PanelsMenu dock={dock} />}

          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="border px-1.5 py-[2px] text-[9.5px] tracking-[0.16em] uppercase transition-colors"
            style={{ borderColor: "var(--line)", color: "var(--ink-dim)" }}
          >
            repo
          </a>
          <a
            href={hrefFor("")}
            className="border px-1.5 py-[2px] text-[9.5px] tracking-[0.16em] uppercase transition-colors"
            style={{ borderColor: "var(--line)", color: "var(--ink-dim)" }}
          >
            home
          </a>
        </div>
      </header>

      {/* ============================================================ *
       * workspace row: left dock | map | right dock
       * ============================================================ */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {!narrow && (
          <DockRail side="left" dock={dock} drag={drag} render={renderPanel} />
        )}

        {/* The map, mounted once. A flex column so the workspace inside takes
            its height by `flex-1`; never height-by-content, which collapses to
            zero and leaves MapLibre compositing nothing at its construction
            size with no error anywhere. */}
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <Workspace
            run={run}
            paint={paint}
            hour={hour}
            toggles={toggles}
            selected={selected}
            onSelect={setSelectedId}
            booting={booting && !!run}
            onBooted={() => setBooting(false)}
            loading={loading}
          />
        </div>

        {/*
          No narrow fallback pane here any more.

          The console used to carry a second, completely separate way of reading
          a panel below 1024px -- a scrolling tab strip with one pane under it --
          because docking is a pointer affordance and there is no room for two
          rails on a phone. The deck below the workstation is that same idea done
          once, for every viewport, so a narrow console now has one mechanism
          rather than a miniature of a mechanism it cannot use.
        */}
        {!narrow && (
          <DockRail side="right" dock={dock} drag={drag} render={renderPanel} />
        )}
      </div>

        {/* ========================================================== *
         * foot: the operational timeline. Structural, never a panel.
         * ========================================================== */}
        {run && (
          <div
            className="flex shrink-0"
            style={{ height: narrow ? 96 : "clamp(150px, 18vh, 196px)" }}
          >
            <div className="flex min-w-0 flex-1">
              <Timeline run={run} hour={hour} setHour={setHour} moment={moment} />
            </div>
          </div>
        )}
      </div>

      {/* ============================================================ *
       * below the fold: the same panels, at a width you can read
       * ============================================================ */}
      <PanelDeck dock={dock} render={renderPanel} />

      {/* Floating windows, above everything but the scanlines. */}
      {dock.floating.map((id) => (
        <FloatWindow key={id} id={id} dock={dock} drag={drag}>
          {renderPanel(id)}
        </FloatWindow>
      ))}
    </div>
  );
}

/**
 * The same panels, below the workstation, at a width you can read them at.
 *
 * A dock rail is the right shape for *monitoring* a pane -- narrow, always
 * present, one glance away from the map -- and the wrong shape for reading one.
 * The evidence card and the method pane in particular are prose and tables
 * squeezed into three hundred pixels, and an operator who wants to actually
 * study either of them has had no way to do it short of tearing off a window
 * and dragging it larger.
 *
 * So: the console scrolls, and under it every panel is available at page width,
 * one at a time, chosen from a row of buttons that sticks to the top of the
 * viewport while you read. One at a time rather than all of them stacked
 * because these are nine dense panels and a single column of all nine is a page
 * nobody reaches the bottom of.
 *
 * The bodies are the same components the docks render -- `render` is the
 * console's own `renderPanel` -- so there is exactly one definition of what a
 * panel *is*, and nothing here can drift away from what the rail shows.
 *
 * **The pane does not scroll inside itself here.** It flows with the page, laid
 * out by scoped CSS in `index.css` (see `[data-panel-reader]`) as a margin
 * column of labels beside a measure of content -- a technical manual rather
 * than a rail.
 *
 * This comment used to describe dock-width columns, which were tried and
 * rejected before any of this shipped; it then survived the layout that
 * replaced them. Both facts are recorded in the CSS, which is where the reader
 * actually lives and the only place worth keeping the reasoning.
 */
function PanelDeck({
  dock,
  render,
}: {
  dock: ReturnType<typeof useDock>;
  render: (id: PanelId) => ReactNode;
}) {
  const [open, setOpen] = useState<PanelId>("detect");

  return (
    <section
      data-panel-reader
      className="border-t"
      style={{ borderColor: "var(--line)", background: "var(--base)" }}
      aria-label="Panel reader"
    >
      <div className="w-full px-4 pb-10 sm:px-6 lg:px-8">
        {/*
          The tab bar sticks. The panes below it are long -- a full attribution
          report runs several screens -- and a switcher you have to scroll back
          up to is a switcher nobody uses twice.
        */}
        <div
          className="sticky top-0 z-20 -mx-4 border-b px-4 pt-6 pb-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
          style={{
            borderColor: "var(--line)",
            background: "color-mix(in oklab, var(--base) 92%, transparent)",
            backdropFilter: "blur(6px)",
          }}
        >
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2
              className="text-[11px] tracking-[0.26em] uppercase"
              style={{ color: "var(--accent)" }}
            >
              Panel reader
            </h2>
            <p className="text-[10.5px]" style={{ color: "var(--ink-faint)" }}>
              The same panels as the docks above, laid out to be read. Nothing
              here is a second copy of the data.
            </p>
          </div>

        <div
          role="tablist"
          aria-label="Panels"
          className="mt-3 flex flex-wrap gap-1"
        >
          {PANELS.map((p) => {
            const on = p.id === open;
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setOpen(p.id)}
                className="flex cursor-pointer items-baseline gap-1.5 border px-2.5 py-[5px] text-[10px] tracking-[0.16em] uppercase transition-colors"
                style={{
                  borderColor: on ? "var(--accent)" : "var(--line)",
                  color: on ? "var(--ink)" : "var(--ink-faint)",
                  background: on
                    ? "color-mix(in oklab, var(--accent) 12%, transparent)"
                    : "transparent",
                }}
              >
                <span
                  className="num text-[9px]"
                  style={{ color: on ? "var(--accent)" : "var(--ink-faint)" }}
                >
                  {p.index}
                </span>
                {p.title}
              </button>
            );
          })}
        </div>

        </div>

        {/* Where the panel currently is, so the reader and the docks never
            disagree about the one arrangement the operator set up. */}
        <p
          className="mt-3 text-[9.5px] tracking-[0.14em] uppercase"
          style={{ color: "var(--ink-faint)" }}
        >
          {(() => {
            const place = dock.layout[open];
            if (place.kind === "dock") return `also in the ${place.side} dock`;
            if (place.kind === "float") return "also in a floating window";
            return "closed in the workstation above";
          })()}
        </p>

        {/* No second header here: every pane that uses `Pane` draws its own,
            and the two stacked read as the panel's name printed twice. */}
        <div
          data-pane-host
          className="mt-5 mb-4 border"
          style={{ borderColor: "var(--line)" }}
        >
          {render(open)}
        </div>
      </div>
    </section>
  );
}

/**
 * CRT scanlines.
 *
 * `position: fixed`, `pointer-events-none`, on its own layer, so it never
 * repaints when anything under it scrolls. Texture inside a scrolling container
 * forces a full repaint of the composited layer every frame, which is the usual
 * way a page with grain on it becomes a page that stutters.
 *
 * Much lighter than Terminal's was, and the vignette is gone.
 *
 * Measured in the browser: at the old weight this layer was undoing the whole
 * point of the lighter map. The lift was correctly applied at the map layer --
 * the paint properties read back exactly as set -- and then a full-viewport
 * wash on top of it put the grey straight back to near-black, with a radial
 * gradient darkening the corners on top of that. Texture over a surface has to
 * be cheap enough to be free; this one was charging for itself.
 */
function Scanlines() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60]"
      style={{
        backgroundImage:
          "repeating-linear-gradient(to bottom, color-mix(in oklab, var(--base) 74%, transparent) 0 1px, transparent 1px 3px)",
        opacity: 0.1,
      }}
    />
  );
}
