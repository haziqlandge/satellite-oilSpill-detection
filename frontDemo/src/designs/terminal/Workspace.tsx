/**
 * The workspace: the map, the instrument furniture drawn over it, and the boot
 * transcript that runs once when the session opens.
 *
 * The map is the surface this direction is built around rather than an
 * illustration inside it. Terminal's `MapPaint` sets `basemap: "none"`, so
 * there is no raster world underneath at all -- only the locally generated
 * 0.1 degree graticule, which is what makes it read as an instrument display
 * rather than as a slippy map with a dark theme on it. MapLibre's own controls
 * are switched off (`controls="none"`) and replaced with furniture drawn here,
 * because the default zoom buttons are a website's chrome and this is not a
 * website.
 *
 * Everything overlaid is `pointer-events-none` except the transport furniture,
 * so panning and picking still reach the map.
 */

import { useEffect, useRef, useState } from "react";
import { animate } from "animejs";
import { MapCanvas } from "../../map/MapCanvas";
import type { LayerToggles } from "../../map/basemap";
import { useAnimeScope, useReducedMotion } from "../../lib/motion";
import { ageStatement, stamp } from "../../lib/format";
import { WEIGHTS_VERSION } from "../../sim/scoring";
import type { MapPaint } from "../../design";
import type { Run, Suspect } from "../../sim/types";
import { Alarm, Btn, Caret, Flag } from "./components";

/* ------------------------------------------------------------------ *
 * The live map instance
 * ------------------------------------------------------------------ */

/**
 * Just enough of MapLibre's `Map` to drive the furniture.
 *
 * Declared structurally rather than imported, so this file does not depend on
 * the map library at all -- it depends on something with these four methods,
 * which is a much weaker coupling and cannot drift with a MapLibre major.
 */
interface MapHandle {
  unproject(p: [number, number]): { lng: number; lat: number };
  getBounds(): {
    getWest(): number;
    getEast(): number;
    getNorth(): number;
    getSouth(): number;
  };
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  zoomIn(): void;
  zoomOut(): void;
  jumpTo(opts: { center: [number, number]; zoom: number }): void;
  on(type: string, cb: () => void): void;
  off(type: string, cb: () => void): void;
}

function readHandle(): MapHandle | null {
  const raw = (window as unknown as { __map?: unknown }).__map;
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<MapHandle>;
  return typeof c.unproject === "function" &&
    typeof c.getBounds === "function" &&
    typeof c.getZoom === "function"
    ? (raw as MapHandle)
    : null;
}

interface View {
  zoom: number;
  west: number;
  east: number;
  north: number;
  south: number;
  lat: number;
}

/**
 * The map instance, and the view it is currently showing.
 *
 * `MapCanvas` does not hand its instance to its parent, and this direction is
 * not allowed to change it, so the instance is picked up from the debug handle
 * the component publishes on construction. That is a workaround and it is
 * recorded as such in NOTES.md; every use of it here is guarded and every piece
 * of furniture it drives degrades to a dash rather than to a crash.
 *
 * The view is refreshed on `moveend` and `zoomend` only, never on `move`. A
 * corner readout that re-renders React on every frame of a drag is how a
 * console starts dropping frames while being demonstrated.
 */
function useMapInstrument(): { handle: MapHandle | null; view: View | null } {
  const [handle, setHandle] = useState<MapHandle | null>(null);
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    let stop = false;
    const find = () => {
      if (stop) return;
      const h = readHandle();
      if (h) setHandle(h);
      else window.setTimeout(find, 120);
    };
    find();
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    if (!handle) return;
    const read = () => {
      try {
        const b = handle.getBounds();
        setView({
          zoom: handle.getZoom(),
          west: b.getWest(),
          east: b.getEast(),
          north: b.getNorth(),
          south: b.getSouth(),
          lat: handle.getCenter().lat,
        });
      } catch {
        /* the map is mid-teardown; the previous view stays on screen */
      }
    };
    read();
    handle.on("moveend", read);
    handle.on("zoomend", read);
    handle.on("load", read);
    return () => {
      handle.off("moveend", read);
      handle.off("zoomend", read);
      handle.off("load", read);
    };
  }, [handle]);

  return { handle, view };
}

/** `28.914°N  090.221°W`. Signed decimals are ambiguous on an operations display. */
function coord(lon: number, lat: number): string {
  const ns = `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? "N" : "S"}`;
  const ew = `${Math.abs(lon).toFixed(3)}°${lon >= 0 ? "E" : "W"}`;
  return `${ns}  ${ew}`;
}

/**
 * Ground resolution at the centre of the view.
 *
 * MapLibre's zoom is defined against a 512 pixel tile, so the equatorial
 * circumference divides by 512 rather than by the 256 most web-mercator
 * formulae assume. Getting this wrong puts the scale bar out by a factor of
 * two, which on a map with no basemap under it nobody would catch.
 */
function metresPerPixel(lat: number, zoom: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * Math.pow(2, zoom));
}

function niceScale(metres: number): { label: string; ratio: number } {
  // Runs down to 10 m so that even at maxZoom a nice value still fits inside
  // the nominal bar. Clamping the drawn length instead would be the wrong fix:
  // the bar would no longer be as long as the distance printed under it, which
  // on a map with no basemap to sanity-check against is a lie nobody can catch.
  const candidates = [
    0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500,
  ];
  const km = metres / 1000;
  let pick = candidates[0];
  for (const c of candidates) if (c <= km) pick = c;
  return {
    label: pick < 1 ? `${Math.round(pick * 1000)} m` : `${pick} km`,
    ratio: (pick * 1000) / metres,
  };
}

/* ------------------------------------------------------------------ *
 * Boot transcript
 * ------------------------------------------------------------------ */

/**
 * What the session prints when it opens.
 *
 * Every line is a real number this run just produced. That is the whole point:
 * a decorative fake boot sequence would be the one piece of this interface that
 * is not reporting anything, on a product whose entire argument is that its
 * outputs are inspectable. It also does the job a hero image would do in the
 * other three directions -- it states the case, the geometry, the age and the
 * candidate count before the operator has clicked anything.
 */
function transcript(run: Run): { text: string; tone: "ok" | "dim" | "warn" | "alarm" }[] {
  const d = run.drift;
  const c = run.characterisation;
  const age = ageStatement(d);
  const first = d.convergence[0];
  const min = d.convergence.reduce(
    (m, p) => (p.area90Km2 < m.area90Km2 ? p : m),
    d.convergence[0] ?? { hour: 0, area90Km2: 0, spreadKm: 0 },
  );

  const lines: { text: string; tone: "ok" | "dim" | "warn" | "alarm" }[] = [
    { text: "slickline // analysis node 04 · link established", tone: "ok" },
    { text: `scene ${run.detection.sceneId} · ${stamp(run.meta.acquiredAt)}`, tone: "dim" },
    {
      text: `detect.instance  ${run.detection.parts.length} instance · ${run.detection.className} · conf ${run.detection.confidence.toFixed(2)}`,
      tone: "dim",
    },
    {
      text: `geom.characterise  ${c.areaKm2.toFixed(2)} km2 · ${c.lengthKm.toFixed(1)} km · ${c.widthMMean.toFixed(0)} m mean · elong ${c.elongation.toFixed(1)}`,
      tone: "dim",
    },
    {
      text: `ais.gate  wind ${c.windSpeedMs.toFixed(1)} m/s · multiplier x${c.windGateMultiplier.toFixed(2)}`,
      tone: c.windGateMultiplier < 0.5 ? "warn" : "dim",
    },
    {
      text: `drift.backward  ${d.ensembleSize} members · ${d.particleCount} particles · -${d.backwardHours}/+${d.forwardHours} h`,
      tone: "dim",
    },
    {
      text: `field 90%  ${first ? first.area90Km2.toFixed(0) : "--"} km2 at T${first ? first.hour : 0}h -> ${min ? min.area90Km2.toFixed(0) : "--"} km2 at T${min ? min.hour : 0}h`,
      tone: "dim",
    },
    {
      text: `age  ${age.value} · ${age.method} · ${age.state}`,
      tone: age.degenerate ? "warn" : "ok",
    },
    {
      text: `ais.query  ${run.aisPointCount.toLocaleString()} reports · ${run.vessels.length} tracks`,
      tone: "dim",
    },
    {
      text: `attrib.collate  ${run.suspects.length} candidates · weights ${WEIGHTS_VERSION}`,
      tone: "dim",
    },
    { text: "provenance  simulated · no model trained · identities masked", tone: "warn" },
  ];

  lines.push(
    d.insufficientEvidence
      ? { text: "halt: insufficient evidence — attribution withheld", tone: "alarm" }
      : { text: "done", tone: "ok" },
  );

  return lines;
}

const TONE_VAR: Record<string, string> = {
  ok: "var(--accent)",
  dim: "var(--ink-dim)",
  warn: "var(--warn)",
  alarm: "var(--alarm)",
};

/**
 * The transcript, printed line by line and then cleared.
 *
 * Sequenced with an interval rather than an animation library because what is
 * animating is the *number of lines that exist*, not a property of an element.
 * Under reduced motion the whole thing is printed at once and held briefly, so
 * the information is still delivered without anything moving.
 */
function BootTranscript({ run, onDone }: { run: Run; onDone: () => void }) {
  const lines = transcript(run);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? lines.length : 0);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    // 12 lines at 150 ms plus a 420 ms hold sits just inside the 2.5 s budget.
    // Longer than that and it stops being a boot sequence and starts being a
    // splash screen the operator has to sit through.
    if (reduced) {
      const t = window.setTimeout(() => done.current(), 1100);
      return () => window.clearTimeout(t);
    }
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setShown(n);
      if (n >= lines.length) {
        window.clearInterval(id);
        window.setTimeout(() => done.current(), 420);
      }
    }, 150);
    return () => window.clearInterval(id);
  }, [reduced, lines.length]);

  // Any key, any click. A transcript you cannot skip is a loading screen.
  useEffect(() => {
    const skip = () => done.current();
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, []);

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col justify-end overflow-hidden px-4 py-4 sm:px-6 sm:py-6"
      style={{ background: "color-mix(in oklab, var(--base) 94%, transparent)" }}
      role="status"
      aria-label="Session boot transcript"
    >
      <div className="max-w-[76ch]">
        {lines.slice(0, shown).map((l, i) => (
          <p
            key={i}
            className="text-[11px] leading-[1.65] sm:text-[12px]"
            style={{ color: TONE_VAR[l.tone] }}
          >
            <span style={{ color: "var(--ink-faint)" }}>{"> "}</span>
            {l.text}
          </p>
        ))}
        <p className="mt-1 text-[11px] sm:text-[12px]">
          <Caret />
        </p>
      </div>
      <p
        className="mt-4 text-[9.5px] tracking-[0.24em] uppercase"
        style={{ color: "var(--ink-faint)" }}
      >
        press any key to skip
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Workspace
 * ------------------------------------------------------------------ */

export function Workspace({
  run,
  paint,
  hour,
  toggles,
  selected,
  onSelect,
  booting,
  onBooted,
  loading,
}: {
  run: Run | null;
  paint: MapPaint;
  hour: number;
  toggles: LayerToggles;
  selected: Suspect | null;
  onSelect: (id: string | null) => void;
  booting: boolean;
  onBooted: () => void;
  loading: boolean;
}) {
  const { handle, view } = useMapInstrument();
  const box = useRef<HTMLDivElement>(null);
  const vLine = useRef<HTMLDivElement>(null);
  const hLine = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLDivElement>(null);

  /**
   * The crosshair.
   *
   * Written straight to the DOM inside a rAF rather than held in React state.
   * A pointer moving across a 900 pixel workspace fires well over a hundred
   * events a second; routing those through a setState would re-render the whole
   * console, including the contact table, on every one of them.
   */
  useEffect(() => {
    const el = box.current;
    if (!el || !handle) return;
    let frame = 0;
    let px = 0;
    let py = 0;

    const paintCross = () => {
      frame = 0;
      const v = vLine.current;
      const h = hLine.current;
      const r = readout.current;
      if (!v || !h || !r) return;
      v.style.transform = `translateX(${px}px)`;
      h.style.transform = `translateY(${py}px)`;
      const rect = el.getBoundingClientRect();
      r.style.transform = `translate(${Math.min(px + 10, rect.width - 150)}px, ${Math.min(py + 10, rect.height - 26)}px)`;
      try {
        const p = handle.unproject([px, py]);
        r.textContent = coord(p.lng, p.lat);
      } catch {
        r.textContent = "---";
      }
    };

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      px = e.clientX - rect.left;
      py = e.clientY - rect.top;
      if (!frame) frame = requestAnimationFrame(paintCross);
    };
    const onEnter = () => el.setAttribute("data-cross", "1");
    const onLeave = () => el.setAttribute("data-cross", "0");

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [handle]);

  /**
   * The scan sweep.
   *
   * One line, sixteen seconds, linear. Slow enough to read as an instrument
   * refreshing rather than as a loading animation, and it is the only motion on
   * the map surface. `useAnimeScope` skips it entirely under reduced motion.
   */
  const scope = useAnimeScope(() => {
    animate(".tm-sweep", {
      translateY: ["-2%", "102%"],
      duration: 16000,
      loop: true,
      ease: "linear",
    });
  }, []);

  const mpp = view ? metresPerPixel(view.lat, view.zoom) : null;
  const scale = mpp ? niceScale(mpp * 120) : null;
  const halt = run?.drift.insufficientEvidence ?? null;

  return (
    /*
      `flex-1`, not `h-full`, and never height-by-content.

      Everything inside this element is absolutely positioned, so a plain block
      here has no in-flow content and collapses to zero. MapLibre then keeps the
      400x300 canvas it was constructed with, reports a perfectly healthy
      `loaded()` and twenty live layers, and composites nothing -- a black
      rectangle with no error anywhere, which is exactly the failure `MapCanvas`
      warns about in its own render comment. The shell hands this a flex column
      with a definite height; taking that height through flex rather than
      through a percentage means it never depends on the parent chain resolving
      one.
    */
    <div
      ref={scope}
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
      style={{ background: "var(--base)" }}
    >
      <div ref={box} className="absolute inset-0" data-cross="0">
        {run ? (
          <MapCanvas
            run={run}
            paint={paint}
            hour={hour}
            toggles={toggles}
            selected={selected}
            onSelect={onSelect}
            className="h-full w-full"
            interactive
            controls="none"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-[11px] tracking-[0.3em] uppercase" style={{ color: "var(--ink-faint)" }}>
              awaiting run <Caret />
            </p>
          </div>
        )}

        {/* --- instrument overlay ---------------------------------- */}
        <div className="pointer-events-none absolute inset-0 z-10">
          {/* Sweep. */}
          <div
            className="tm-sweep absolute inset-x-0 top-0 h-[64px]"
            style={{
              background:
                "linear-gradient(to bottom, transparent, color-mix(in oklab, var(--accent) 9%, transparent), transparent)",
            }}
          />

          {/* Crosshair. Hidden until the pointer is inside the workspace, so a
              stale reticle does not sit on the map after the operator has moved
              to a pane. */}
          <div
            ref={vLine}
            className="absolute top-0 bottom-0 left-0 w-px opacity-0 transition-opacity"
            style={{ background: "color-mix(in oklab, var(--accent) 42%, transparent)" }}
            data-cross-part
          />
          <div
            ref={hLine}
            className="absolute top-0 right-0 left-0 h-px opacity-0 transition-opacity"
            style={{ background: "color-mix(in oklab, var(--accent) 42%, transparent)" }}
            data-cross-part
          />
          <div
            ref={readout}
            className="num absolute top-0 left-0 border px-1.5 py-[2px] text-[10px] whitespace-nowrap opacity-0 transition-opacity"
            style={{
              borderColor: "var(--line)",
              background: "color-mix(in oklab, var(--base) 88%, transparent)",
              color: "var(--accent)",
            }}
            data-cross-part
          />

          {/* Corner coordinates. Four corners, because on a display with no
              coastline under it these are the only geographic reference the
              operator has apart from the graticule. */}
          {view && (
            <>
              <Corner className="top-2 left-2" text={coord(view.west, view.north)} />
              <Corner className="top-2 right-2" text={coord(view.east, view.north)} align="right" />
            </>
          )}

          {/* Frame corners. Cheap, and they turn a rectangle of map into a
              viewport with an edge. */}
          {(["top-0 left-0", "top-0 right-0", "bottom-0 left-0", "bottom-0 right-0"] as const).map(
            (pos) => (
              <span
                key={pos}
                className={`absolute h-3 w-3 ${pos}`}
                style={{
                  borderTop: pos.includes("top-0") ? "1px solid var(--accent)" : undefined,
                  borderBottom: pos.includes("bottom-0") ? "1px solid var(--accent)" : undefined,
                  borderLeft: pos.includes("left-0") ? "1px solid var(--accent)" : undefined,
                  borderRight: pos.includes("right-0") ? "1px solid var(--accent)" : undefined,
                  opacity: 0.55,
                }}
              />
            ),
          )}
        </div>

        {/* --- transport furniture, interactive ---------------------
            Parked against the right edge at mid-height rather than in a
            corner. All four corners are spoken for by coordinate readouts, and
            on a 375 pixel viewport a corner-anchored zoom stack lands directly
            on top of one. */}
        <div className="absolute top-1/2 right-3 z-20 flex -translate-y-1/2 flex-col items-end gap-1">
          <div className="flex gap-1">
            <Btn onClick={() => handle?.zoomIn()} disabled={!handle} title="Zoom in">
              +
            </Btn>
            <Btn onClick={() => handle?.zoomOut()} disabled={!handle} title="Zoom out">
              −
            </Btn>
            <Btn
              onClick={() =>
                run && handle?.jumpTo({ center: run.meta.centre, zoom: run.meta.zoom })
              }
              disabled={!handle || !run}
              title="Recentre on the scene"
            >
              home
            </Btn>
          </div>
          <div
            className="num border px-1.5 py-[2px] text-[10px]"
            style={{
              borderColor: "var(--line)",
              background: "color-mix(in oklab, var(--base) 85%, transparent)",
              color: "var(--ink-dim)",
            }}
          >
            z {view ? view.zoom.toFixed(2) : "--"}
          </div>
        </div>

        {/*
          The bottom status strip.

          Scale bar, provenance flag and the two southern corner coordinates on
          one ruled line rather than as four independently positioned overlays.
          Floating them separately is what puts the SIM flag underneath the
          scale label and the SE coordinate underneath the zoom readout the
          moment the workspace gets narrow, and a status overlay that overprints
          itself is worse than no overlay.
        */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end gap-3 border-t px-2 py-1"
          style={{
            borderColor: "var(--line)",
            background: "color-mix(in oklab, var(--base) 72%, transparent)",
          }}
        >
          <Flag tone="warn" title="Simulated. No model trained. Identities masked.">
            sim
          </Flag>
          {scale && (
            <div className="flex items-end gap-1.5">
              <div
                className="h-[5px] border-r border-b border-l"
                style={{
                  borderColor: "var(--ink-dim)",
                  width: `${(120 * scale.ratio).toFixed(1)}px`,
                }}
              />
              <span className="num text-[9.5px] leading-none" style={{ color: "var(--ink-dim)" }}>
                {scale.label}
              </span>
            </div>
          )}
          {view && (
            <>
              <span
                className="num ml-auto truncate text-[9.5px] leading-none"
                style={{ color: "var(--ink-faint)" }}
              >
                sw {coord(view.west, view.south)}
              </span>
              <span
                className="num hidden truncate text-[9.5px] leading-none sm:inline"
                style={{ color: "var(--ink-faint)" }}
              >
                se {coord(view.east, view.south)}
              </span>
            </>
          )}
        </div>

        {/* --- refusal ---------------------------------------------- */}
        {halt && !booting && (
          <div className="absolute inset-x-0 top-0 z-20 p-2 sm:p-3">
            <Alarm code="E-C3" title="attribution withheld · insufficient evidence" compact>
              <p>
                90% origin contour {halt.area90Km2.toFixed(0)} km². {halt.reason} No candidate is
                ranked from this field, and the list in pane 04 is suppressed rather than emptied.
              </p>
            </Alarm>
          </div>
        )}

        {loading && !booting && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center p-2">
            <span
              className="num border px-2 py-1 text-[10px] tracking-[0.2em] uppercase"
              style={{
                borderColor: "var(--accent)",
                background: "color-mix(in oklab, var(--base) 88%, transparent)",
                color: "var(--accent)",
              }}
            >
              building run <Caret />
            </span>
          </div>
        )}

        {booting && run && <BootTranscript run={run} onDone={onBooted} />}
      </div>

      {/* Reveal the crosshair only while the pointer is over the workspace.
          Done with an attribute selector so the pointer handler never has to
          touch React. */}
      <style>{`[data-cross="1"] [data-cross-part]{opacity:1}`}</style>
    </div>
  );
}

function Corner({
  className,
  text,
  align = "left",
}: {
  className: string;
  text: string;
  align?: "left" | "right";
}) {
  return (
    <span
      className={`num absolute text-[9.5px] tracking-[0.06em] ${className} ${align === "right" ? "text-right" : ""}`}
      style={{ color: "var(--ink-faint)" }}
    >
      {text}
    </span>
  );
}
