/**
 * ORBIT -- a scientific mission-control system.
 *
 * The structural claim of this direction is one sentence: the chart is the
 * product and everything else orbits it. So there is no page, no scroll and no
 * column grid. There is a viewport, a full-bleed bathymetric chart underneath
 * everything, a thin mission status bar across the top, two rails of instruments
 * floating over the chart at the edges, and the temporal strip along the bottom.
 * Nothing here is a section of a document; every one of them is a fixture around
 * a live display.
 *
 * Navigation is by mission mode rather than by page. Switching mode re-racks the
 * instruments and re-frames the chart, and deliberately keeps the mission clock,
 * the scenario and the selected candidate, because those are the mission and the
 * mode is only the configuration you are viewing it in. `useSection` still backs
 * it, so a mode is linkable and the back button works, but the surface never
 * navigates away from itself.
 *
 * Two things in here are load-bearing and non-obvious:
 *
 *  - the chart config (`toggles`, `grid`) is shell state seeded from the mode
 *    rather than read from the mode directly. A mode sets the emphasis; the
 *    viewer can then override any channel, and the override survives until the
 *    mode changes again. Reading straight from the mode would make the channel
 *    switches in INS-00 dead controls
 *  - `insufficientEvidence` suppresses the title treatment entirely and adds a
 *    course to the top furniture: a permanent annunciator band under the status
 *    bar, a HOLD key that is also the reopen control, and a panel docked beneath
 *    them. C3 asks for that state to be prominent; prominent is not the same as
 *    modal, and the chart stays reachable while it is on screen
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animate, stagger } from "animejs";
import { useDesign } from "../../DesignContext";
import { useAnimeScope, useReducedMotion } from "../../lib/motion";
import { hrefFor, useSection } from "../../lib/hash";
import { dateline, stamp } from "../../lib/format";
import { momentAt } from "../../lib/playback";
import { SCENARIOS, scenarioListing, type ScenarioId } from "../../sim/scenarios";
import type { LayerToggles } from "../../map/basemap";
import type { ShellProps } from "../registry";
import Brief from "./Brief";
import MissionMap from "./MissionMap";
import Trajectory from "./Trajectory";
import { INSTRUMENTS, type Deck } from "./panels";
import { MODES, MODE_KEYS, modeFor } from "./modes";
import { Lamp, Rail, Strip, alpha } from "./instruments";

const TITLE = "TRACE THE ORIGIN";

/** Bottom-sheet stops, as a fraction of the viewport. */
const DETENTS = [0, 0.42, 0.78];

/** Status bar height, in px. The rails and the hold band are hung off it. */
const HEADER_H = 44;

/** The permanent hold annunciator, mounted directly under the status bar. */
const HOLD_BAND_H = 18;

const HOLD_PANEL_ID = "orbit-hold-panel";

export default function OrbitShell({ state }: ShellProps) {
  const def = useDesign();
  const reduced = useReducedMotion();
  const [section, navigate] = useSection(MODE_KEYS, "observe");
  const mode = modeFor(section);
  const { run } = state;

  /* --- chart configuration ----------------------------------------- */

  const [toggles, setToggles] = useState<LayerToggles>(mode.toggles);
  const [grid, setGrid] = useState(mode.graticule);

  useEffect(() => {
    setToggles(mode.toggles);
    setGrid(mode.graticule);
  }, [mode]);

  /**
   * The camera, framed by the mission.
   *
   * A mode is a way of looking at one event, so each declares how close it wants
   * to be: surveying traffic pulls back, picking a candidate out of it moves in.
   * `nudge` exists so RE-FRAME can re-issue the same camera -- the map compares
   * by value, so easing back to a position you are already nominally at needs
   * something in the object to have changed.
   */
  const [nudge, setNudge] = useState(0);
  const camera = useMemo(() => {
    if (!run) return null;
    return {
      centre: run.meta.centre,
      zoom: run.meta.zoom + mode.zoomOffset,
      durationMs: 900,
      // Consumed only to make the memo and the map's value comparison move.
      ...(nudge ? { durationMs: 900 + (nudge % 2) } : {}),
    };
  }, [run, mode.zoomOffset, nudge]);

  /**
   * Paint is memoised on the graticule alone.
   *
   * `MapCanvas` keys its theme effect on the paint object's identity and its
   * scenario effect on `paint.graticuleStepDeg`, so a fresh object per render
   * would re-apply every layer's paint properties on every frame of a playback
   * scrub, and a changed step re-centres the camera. Both are wanted -- once
   * each, on a mode change -- and neither is wanted sixty times a second.
   */
  const paint = useMemo(
    () => ({ ...def.map, graticuleStepDeg: grid }),
    [def.map, grid],
  );

  /* --- the one derivation every instrument reads -------------------- */

  const moment = useMemo(() => (run ? momentAt(run, state.hour) : null), [run, state.hour]);
  const selected = useMemo(
    () => run?.suspects.find((s) => s.id === state.selectedId) ?? null,
    [run, state.selectedId],
  );
  const go = useCallback((m: string) => navigate(m), [navigate]);

  const deck: Deck | null = useMemo(
    () => (run && moment ? { run, state, moment, go, toggles, setToggles } : null),
    [run, moment, state, go, toggles],
  );

  const held = run?.drift.insufficientEvidence ?? null;

  /* --- the withheld attribution -------------------------------------- */

  /**
   * The refusal, docked rather than centred.
   *
   * It used to take the middle of the surface, which made it the loudest thing
   * on screen -- and also made the chart underneath unreachable, with no way to
   * put it away. Both halves of that are wrong: C3 asks for the finding to be
   * prominent, not for the instrument to be disabled while it is on screen.
   *
   * So the state now lives in three places at once and only one of them can be
   * closed: a permanent annunciator band across the top of the surface, a
   * pulsing HOLD key in the status bar that is also the reopen control, and this
   * panel, docked under both. Dismissing the panel leaves the first two, so the
   * state can never be dismissed into invisibility -- which is the actual
   * requirement, and is not the same thing as a panel that cannot be shut.
   *
   * Acknowledgement is keyed on the mission, not on a boolean, so switching to
   * another withheld scene announces itself again instead of inheriting a
   * dismissal that was about a different field.
   */
  const holdKey = run?.meta.id ?? null;
  const [holdAck, setHoldAck] = useState<string | null>(null);
  const holdOpen = held !== null && holdKey !== null && holdAck !== holdKey;
  const holdKeyRef = useRef<HTMLButtonElement>(null);

  const closeHold = useCallback(() => {
    setHoldAck(holdKey);
    // Focus would otherwise fall to the body when the panel unmounts. It goes
    // to the control that brings the panel back, which is where a keyboard
    // reader needs to be standing next.
    requestAnimationFrame(() => holdKeyRef.current?.focus());
  }, [holdKey]);

  useEffect(() => {
    if (!holdOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeHold();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [holdOpen, closeHold]);

  // The rails hang off whatever the top furniture actually is, so the band
  // adds a course to the stack rather than sitting on top of the first
  // instrument.
  const railTop = HEADER_H + (held ? HOLD_BAND_H : 0);

  /* --- the title treatment ------------------------------------------ */

  const [title, setTitle] = useState(true);
  const titleSpent = useRef(false);

  useEffect(() => {
    if (!run || titleSpent.current) return;
    titleSpent.current = true;
    const t = window.setTimeout(() => setTitle(false), reduced ? 1600 : 3100);
    return () => window.clearTimeout(t);
  }, [run, reduced]);

  // A withheld attribution is the headline. Nothing gets to sit on top of it.
  const showTitle = title && !held;

  /* --- instruments coming online ------------------------------------ */

  const booted = useRef(false);
  const root = useAnimeScope(() => {
    animate(".orbit-ins", {
      opacity: [0, 1],
      translateY: [14, 0],
      duration: 540,
      delay: stagger(42),
      ease: "out(3)",
    });

    if (!booted.current) {
      booted.current = true;
      animate(".orbit-hud-item", {
        opacity: [0, 1],
        translateY: [-6, 0],
        duration: 420,
        delay: stagger(34),
        ease: "out(3)",
      });
    }
    // Re-racking on a mode change is the moment the instruments change, so the
    // stagger belongs to the mode and to the scenario, not to every render.
  }, [section, run?.meta.id]);

  /* --- which arrangement ------------------------------------------- */

  /**
   * The two arrangements are mounted exclusively, not hidden with CSS.
   *
   * Rails and the mobile strip carry the same instruments, so a media-query
   * `hidden` would leave both copies mounted: two SarTile canvases running the
   * per-pixel speckle loop, two field-scope projections, and every `.orbit-ins`
   * counted twice by the boot stagger. Branching on the breakpoint costs one
   * matchMedia listener and mounts each instrument exactly once.
   */
  const wide = useWide();

  /* --- mobile bottom sheet ------------------------------------------ */

  const [vh, setVh] = useState(() =>
    typeof window === "undefined" ? 800 : window.innerHeight,
  );
  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const [detent, setDetent] = useState(0);
  const [dragH, setDragH] = useState<number | null>(null);
  const dragFrom = useRef<{ y: number; h: number } | null>(null);
  const sheetH = dragH ?? DETENTS[detent] * vh;

  const onHandleDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragFrom.current = { y: e.clientY, h: sheetH };
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const from = dragFrom.current;
    if (!from) return;
    const next = from.h - (e.clientY - from.y);
    setDragH(Math.max(0, Math.min(vh * 0.82, next)));
  };
  const onHandleUp = (e: React.PointerEvent) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    const h = dragH ?? sheetH;
    setDragH(null);
    // A tap is not a drag. Without this the sheet can only be opened by
    // dragging, which is undiscoverable on a surface with no other affordance.
    if (from && Math.abs(e.clientY - from.y) < 6) {
      setDetent((d) => (d === 0 ? 1 : 0));
      return;
    }
    let best = 0;
    DETENTS.forEach((d, i) => {
      if (Math.abs(d * vh - h) < Math.abs(DETENTS[best] * vh - h)) best = i;
    });
    setDetent(best);
  };

  /* --- racks --------------------------------------------------------- */

  const leftKeys = mode.key === "brief" ? [] : [...mode.left, "channels"];
  const rightKeys = mode.key === "brief" ? [] : mode.right;

  const rack = (keys: string[]) =>
    deck
      ? keys.map((k) => {
          const Module = INSTRUMENTS[k];
          return Module ? <Module key={k} deck={deck} /> : null;
        })
      : null;

  return (
    <div ref={root} className="relative h-[100dvh] w-full overflow-hidden">
      <ScopedStyle />

      {/* --- the chart, under everything ---------------------------- */}
      {run && (
        <MissionMap
          run={run}
          paint={paint}
          hour={state.hour}
          toggles={toggles}
          selected={selected}
          onSelect={state.setSelectedId}
          grid={grid}
          onGrid={setGrid}
          camera={camera}
          onReframe={() => setNudge((n) => n + 1)}
        />
      )}

      {/* --- mission status bar ------------------------------------- */}
      <header
        className="absolute inset-x-0 top-0 z-40 flex h-11 items-stretch gap-3 px-3 sm:gap-4 sm:px-4"
        style={{
          borderBottom: `1px solid ${alpha(held ? def.map.dark : "var(--line)", 100)}`,
          background: alpha("var(--base)", 80),
          backdropFilter: "blur(18px) saturate(1.2)",
          WebkitBackdropFilter: "blur(18px) saturate(1.2)",
        }}
      >
        <div className="orbit-hud-item flex shrink-0 items-center gap-2">
          <span
            className="text-[13px] tracking-[0.16em] uppercase"
            style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--ink)" }}
          >
            Slickline
          </span>
          <span className="num text-[9px] tracking-[0.18em]" style={{ color: "var(--ink-faint)" }}>
            {`${def.index}/${def.name.toUpperCase()}`}
          </span>
        </div>

        <span
          aria-hidden
          className="my-2 hidden w-px shrink-0 sm:block"
          style={{ background: alpha("var(--line)", 100) }}
        />

        {/* Mission select. A native control on purpose: it is a list of five
            things on a surface that already has enough bespoke chrome. */}
        <label className="orbit-hud-item flex shrink-0 items-center gap-1.5">
          <span
            className="hidden text-[9px] tracking-[0.2em] uppercase md:inline"
            style={{ fontFamily: "var(--font-display)", fontWeight: 600, color: "var(--ink-faint)" }}
          >
            Mission
          </span>
          <select
            value={state.scenario}
            onChange={(e) => state.setScenario(e.target.value as ScenarioId)}
            className="num max-w-[42vw] appearance-none rounded-[4px] py-[3px] pr-5 pl-2 text-[10px] sm:max-w-none"
            style={{
              color: "var(--accent)",
              border: `1px solid ${alpha("var(--accent)", 45)}`,
              background: `${alpha("var(--accent)", 10)}`,
            }}
            aria-label="Mission scenario"
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id} style={{ background: "var(--base-2)", color: "var(--ink)" }}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {/* Mode bank. Not a nav bar: five detented mode keys with designators
            and lamps, which is what selects a configuration on a console. */}
        <nav className="orbit-hud-item hidden min-w-0 flex-1 items-stretch lg:flex" aria-label="Mission mode">
          {MODES.map((m) => {
            const active = m.key === section;
            return (
              <a
                key={m.key}
                href={hrefFor(m.key)}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(m.key);
                }}
                aria-current={active ? "page" : undefined}
                title={m.caption}
                className="flex shrink-0 items-center gap-1.5 px-3 transition-colors"
                style={{
                  borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                  background: active ? alpha("var(--accent)", 8) : "transparent",
                }}
              >
                <span
                  className="num text-[9px]"
                  style={{ color: active ? "var(--accent)" : "var(--ink-faint)" }}
                >
                  {m.code}
                </span>
                <span
                  className="text-[10px] tracking-[0.18em] uppercase"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    color: active ? "var(--ink)" : "var(--ink-dim)",
                  }}
                >
                  {m.label}
                </span>
              </a>
            );
          })}
        </nav>

        {/* Below lg the mode bank collapses to a selector rather than wrapping:
            the surface stays one screen at every width. */}
        <label className="orbit-hud-item flex min-w-0 flex-1 items-center lg:hidden">
          <select
            value={section}
            onChange={(e) => navigate(e.target.value)}
            className="w-full appearance-none rounded-[4px] py-[3px] pr-5 pl-2 text-[10px] tracking-[0.16em] uppercase"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              color: "var(--ink)",
              border: `1px solid ${alpha("var(--line)", 100)}`,
              background: alpha("var(--base-3)", 80),
            }}
            aria-label="Mission mode"
          >
            {MODES.map((m) => (
              <option key={m.key} value={m.key} style={{ background: "var(--base-2)" }}>
                {`${m.code} · ${m.label}`}
              </option>
            ))}
          </select>
        </label>

        {/* Telemetry metadata. Orbit's idiom for provenance: channel flags on
            the status bar, not a footnote at the bottom of a page. */}
        <div className="orbit-hud-item hidden shrink-0 items-center gap-2 xl:flex">
          <Flag label="SRC" value="SIM" tone={def.map.infrastructure} />
          <Flag label="MODEL" value="NONE" tone={def.map.infrastructure} />
          <Flag label="ID" value="MASKED" tone={def.map.infrastructure} />
        </div>

        {run && (
          <div className="orbit-hud-item hidden shrink-0 items-center gap-2 md:flex">
            <span className="num text-[9px]" style={{ color: "var(--ink-dim)" }}>
              {dateline(run.meta.acquiredAt)}
            </span>
            <span className="num hidden text-[9px] 2xl:inline" style={{ color: "var(--ink-faint)" }}>
              {stamp(run.meta.acquiredAt)}
            </span>
          </div>
        )}

        {/* The mission lamp. When the mission is holding it is not only an
            indicator: it is the detented key that puts the withheld-attribution
            panel back on the surface, so the state is never one click from
            being unrecoverable. */}
        <div className="orbit-hud-item flex shrink-0 items-center">
          {held ? (
            <button
              ref={holdKeyRef}
              type="button"
              onClick={() => (holdOpen ? closeHold() : setHoldAck(null))}
              aria-expanded={holdOpen}
              // Only while the panel is mounted: `aria-controls` pointing at an
              // id that is not in the document is a dangling reference.
              aria-controls={holdOpen ? HOLD_PANEL_ID : undefined}
              aria-label={
                holdOpen
                  ? "Attribution withheld for this mission. Hide the withheld attribution panel."
                  : "Attribution withheld for this mission. Show the withheld attribution panel."
              }
              title="Attribution withheld — the origin field is too wide to discriminate"
              className="flex shrink-0 items-center gap-1.5 rounded-[4px] px-1.5 py-[3px] transition-colors"
              style={{
                border: `1px solid ${alpha(def.map.dark, 62)}`,
                background: alpha(def.map.dark, 14),
              }}
            >
              <Lamp status="hold" label="HOLD" />
              <span
                className="hidden text-[9px] tracking-[0.16em] uppercase md:inline"
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  color: def.map.dark,
                }}
              >
                Withheld
              </span>
            </button>
          ) : (
            <Lamp
              status={state.loading ? "caution" : "active"}
              label={state.loading ? "BUILD" : "LIVE"}
            />
          )}
        </div>
      </header>

      {/* --- the hold annunciator ----------------------------------- *
          Permanent while the mission holds, whether or not the panel is open.
          This is the part that cannot be dismissed: a band of the hold ink
          across the whole width of the surface, reading the finding out in
          plain words, mounted in the status furniture rather than over the
          chart. It costs 18 px of the top edge and nothing of the centre. */}
      {held && (
        <div
          className="absolute inset-x-0 z-40 flex items-center gap-2 overflow-hidden px-3 sm:px-4"
          style={{
            top: HEADER_H,
            height: HOLD_BAND_H,
            background: alpha(def.map.dark, 16),
            borderBottom: `1px solid ${alpha(def.map.dark, 55)}`,
            backdropFilter: "blur(18px) saturate(1.2)",
            WebkitBackdropFilter: "blur(18px) saturate(1.2)",
          }}
        >
          <span
            aria-hidden
            className="orbit-pulse shrink-0"
            style={{
              width: 5,
              height: 5,
              borderRadius: 99,
              background: def.map.dark,
            }}
          />
          <p
            className="num min-w-0 flex-1 truncate text-[9px] tracking-[0.2em] uppercase"
            style={{ color: def.map.dark }}
          >
            Mission hold · attribution withheld · 0 candidates named · the chart,
            the clock and the origin field stay live
          </p>
          {!holdOpen && (
            <span
              className="num hidden shrink-0 text-[9px] tracking-[0.16em] uppercase lg:inline"
              style={{ color: alpha(def.map.dark, 70) }}
            >
              HOLD reopens the finding
            </span>
          )}
        </div>
      )}

      {/* --- instrument rails --------------------------------------- */}
      {deck && wide && mode.key !== "brief" && (
        <div className="pointer-events-none absolute inset-0 z-20">
          <Rail side="left" top={railTop}>
            {rack(leftKeys)}
          </Rail>
          <Rail side="right" top={railTop}>
            {rack(rightKeys)}
          </Rail>
        </div>
      )}

      {mode.key === "brief" && run && <Brief />}

      {/* --- withheld attribution ----------------------------------- *
          Docked under the annunciator on the same edge as the HOLD key it
          drops from, never over the middle of the chart. The centre of the
          surface belongs to the map at all times, including this one. */}
      {held && run && holdOpen && (
        <section
          id={HOLD_PANEL_ID}
          role="alert"
          className="absolute right-2 z-40 w-[min(432px,calc(100vw-16px))] rounded-[13px] px-4 py-3.5 sm:right-3 sm:px-5 sm:py-4"
          style={{
            top: railTop + 8,
            // Below the rail breakpoint the panel is nearly the width of the
            // surface, so its height is what decides whether the chart is still
            // reachable. Capped so the middle of the viewport is never under
            // it; the panel scrolls instead, which costs a gesture rather than
            // the map.
            maxHeight: wide ? `calc(100dvh - ${railTop + 8}px - 132px)` : "40dvh",
            overflowY: "auto",
            border: `1px solid ${alpha(def.map.dark, 55)}`,
            background: alpha("var(--base-2)", 94),
            backdropFilter: "blur(20px) saturate(1.2)",
            WebkitBackdropFilter: "blur(20px) saturate(1.2)",
            boxShadow: `0 40px 90px -46px ${alpha("var(--base)", 100)}, inset 0 0 0 1px ${alpha(def.map.dark, 12)}`,
          }}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Lamp status="hold" label="MISSION HOLD" />
              <h2
                className="mt-2 text-[clamp(1.25rem,2.6vw,1.6rem)] leading-[1.02] tracking-[0.02em] uppercase"
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  color: "var(--ink)",
                }}
              >
                Attribution withheld
              </h2>
            </div>
            <button
              type="button"
              onClick={closeHold}
              aria-label="Dismiss the withheld attribution panel. The hold stays on the status bar."
              title="Dismiss (Esc) — the HOLD key on the status bar brings it back"
              className="-mt-0.5 -mr-1 shrink-0 rounded-[4px] px-1.5 py-0.5 text-[13px] leading-none transition-colors"
              style={{
                color: def.map.dark,
                border: `1px solid ${alpha(def.map.dark, 45)}`,
                background: alpha(def.map.dark, 8),
              }}
            >
              ✕
            </button>
          </div>

          <p
            className="mt-2.5 text-[12.5px] leading-[1.55]"
            style={{ fontFamily: "var(--font-body)", color: "var(--ink)" }}
          >
            {held.reason}
          </p>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <div>
              <span className="num text-[21px]" style={{ color: def.map.dark }}>
                {held.area90Km2.toFixed(0)}
              </span>
              <span className="num ml-1.5 text-[9.5px]" style={{ color: "var(--ink-faint)" }}>
                KM² AT 90%
              </span>
            </div>
            <div>
              <span className="num text-[21px]" style={{ color: "var(--ink-dim)" }}>
                0
              </span>
              <span className="num ml-1.5 text-[9.5px]" style={{ color: "var(--ink-faint)" }}>
                CANDIDATES NAMED
              </span>
            </div>
          </div>
          <p
            className="mt-3 text-[12px] leading-[1.55]"
            style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}
          >
            This is the finding, not a missing result. Reversing a spreading
            process spreads it further, and a ranking issued from a field this
            wide would be a guess with a number attached to it. The chart, the
            clock and the origin field all stay live — only the accusation is
            withheld.
          </p>
          <p
            className="num mt-3 text-[9px] tracking-[0.16em] uppercase"
            style={{
              color: "var(--ink-faint)",
              borderTop: `1px solid ${alpha("var(--line)", 70)}`,
              paddingTop: 8,
            }}
          >
            Esc dismisses · the hold stays on the status bar and reopens this
          </p>
        </section>
      )}

      {/* --- title treatment ---------------------------------------- */}
      {showTitle && <Title />}

      {/* --- building ----------------------------------------------- */}
      {!run && (
        <div className="absolute inset-0 z-10 flex items-end justify-center pb-[22vh]">
          <div className="text-center">
            <p
              className="num text-[10px] tracking-[0.3em]"
              style={{ color: "var(--ink-faint)" }}
            >
              BUILDING ENSEMBLE · GATING TRAFFIC · SCORING
            </p>
            <p
              className="mt-2 text-[11px]"
              style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}
            >
              {scenarioListing(state.scenario).short}
            </p>
          </div>
        </div>
      )}

      {/* --- bottom furniture --------------------------------------- */}
      <div className="absolute inset-x-0 bottom-0 z-30">
        {deck && !wide && mode.key !== "brief" && (
          <>
            {/* Sheet: the analysis rail, on a surface too narrow to carry two. */}
            <div>
              <div
                onPointerDown={onHandleDown}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
                role="button"
                tabIndex={0}
                aria-label="Analysis panel"
                aria-expanded={detent > 0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDetent((d) => (d === 0 ? 1 : 0));
                  }
                }}
                className="flex touch-none items-center justify-center gap-2 py-2"
                style={{
                  background: alpha("var(--base-2)", 88),
                  borderTop: `1px solid ${alpha("var(--line)", 100)}`,
                  backdropFilter: "blur(16px)",
                  WebkitBackdropFilter: "blur(16px)",
                  cursor: "ns-resize",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 34,
                    height: 3,
                    borderRadius: 3,
                    background: alpha("var(--ink-faint)", 80),
                  }}
                />
                <span
                  className="text-[9px] tracking-[0.2em] uppercase"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    color: "var(--ink-faint)",
                  }}
                >
                  {mode.label} analysis
                </span>
              </div>
              <div
                className="orbit-scroll overflow-y-auto"
                style={{
                  height: sheetH,
                  background: alpha("var(--base)", 90),
                  backdropFilter: "blur(16px)",
                  WebkitBackdropFilter: "blur(16px)",
                  transition: dragH === null ? "height 240ms cubic-bezier(.22,1,.36,1)" : undefined,
                }}
              >
                <div className="flex flex-col gap-2.5 px-3 py-3">{rack(rightKeys)}</div>
              </div>
            </div>

            {/* Strip: the observation rail, scrolled sideways. The map stays the
                centre of the screen at every width -- this never becomes a page. */}
            <Strip>{rack(leftKeys)}</Strip>
          </>
        )}

        {run && moment && (
          <Trajectory run={run} hour={state.hour} setHour={state.setHour} moment={moment} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The title treatment
 *
 * The hero of this direction is a geographic phenomenon, not a headline, so the
 * headline is set *over* the phenomenon and then gets out of the way. It is
 * pointer-transparent for its whole life, because the chart underneath is
 * already live and draggable while the title is still on screen -- the point is
 * that the instrument is working before it introduces itself.
 * ------------------------------------------------------------------ */

function Title() {
  const scope = useAnimeScope(() => {
    animate(".orbit-title-char", {
      opacity: [0, 1],
      translateY: [30, 0],
      scale: [1.12, 1],
      duration: 900,
      delay: stagger(32),
      ease: "out(4)",
    });
    animate(".orbit-title-rule", {
      scaleX: [0, 1],
      duration: 900,
      delay: 320,
      ease: "inOut(3)",
    });
    animate(".orbit-title-sub", {
      opacity: [0, 1],
      translateY: [10, 0],
      duration: 620,
      delay: 760,
      ease: "out(3)",
    });
    // The recede. The instruments are already coming online underneath.
    animate(".orbit-title", {
      opacity: [{ to: 1, duration: 1 }, { to: 0, duration: 760 }],
      translateY: [{ to: 0, duration: 1 }, { to: -18, duration: 760 }],
      delay: 2150,
      ease: "inOut(2)",
    });
  }, []);

  return (
    <div
      ref={scope}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-6"
    >
      <div className="orbit-title text-center">
        <p
          className="num text-[9.5px] tracking-[0.34em]"
          style={{ color: "var(--accent)" }}
        >
          SAR · BACKWARD DRIFT · AIS ATTRIBUTION
        </p>
        <h1
          className="mt-3 text-[clamp(2.2rem,7.4vw,6rem)] leading-[0.92] uppercase"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            letterSpacing: "0.01em",
            color: "var(--ink)",
            textShadow: `0 8px 60px ${alpha("var(--base)", 90)}`,
          }}
        >
          {TITLE.split("").map((ch, i) => (
            <span
              key={i}
              className="orbit-title-char inline-block"
              style={{ whiteSpace: "pre" }}
            >
              {ch === " " ? " " : ch}
            </span>
          ))}
        </h1>
        <span
          aria-hidden
          className="orbit-title-rule mx-auto mt-4 block h-px w-[min(360px,60vw)]"
          style={{ background: "var(--accent)", transformOrigin: "center" }}
        />
        <p
          className="orbit-title-sub mx-auto mt-4 max-w-[52ch] text-[13px] leading-[1.55]"
          style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}
        >
          Run the drift backwards from a slick to a credible region, gate the
          traffic that was there against it, and decline to name anyone when the
          field is too wide to tell.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Bits
 * ------------------------------------------------------------------ */

/** Tracks the `lg` breakpoint, live, so a window resize re-arranges the panel. */
function useWide(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

function Flag({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="num text-[8.5px] tracking-[0.14em]" style={{ color: "var(--ink-faint)" }}>
        {label}
      </span>
      <span
        className="num rounded-[3px] px-1 py-[1px] text-[8.5px] tracking-[0.12em]"
        style={{ color: tone, border: `1px solid ${alpha(tone, 40)}`, background: alpha(tone, 8) }}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * Rules that cannot be expressed inline.
 *
 * Scrollbar suppression, scroll snapping on the mobile strip and the hold-lamp
 * keyframes are all pseudo-element or keyframe rules, which a style attribute
 * cannot carry. They belong in `index.css`, but that file is shared by all four
 * directions and this one does not own it -- so they are scoped behind an
 * `orbit-` prefix and mounted with the shell instead. See NOTES.md.
 */
function ScopedStyle() {
  return (
    <style>{`
.orbit-rail::-webkit-scrollbar,
.orbit-strip::-webkit-scrollbar,
.orbit-scroll::-webkit-scrollbar { width: 0; height: 0; }
.orbit-rail, .orbit-scroll { scrollbar-width: none; }
.orbit-rail .orbit-ins { pointer-events: auto; }
.orbit-strip > * { scroll-snap-align: start; flex: 0 0 clamp(240px, 78vw, 320px); }
@keyframes orbit-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.32 } }
.orbit-pulse { animation: orbit-pulse 1.6s ease-in-out infinite; }
`}</style>
  );
}
