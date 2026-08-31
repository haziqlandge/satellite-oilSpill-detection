/**
 * ORBIT -- the chart surface.
 *
 * The map is not a figure inside this product, it is the product. It runs
 * edge to edge underneath everything and the instruments float over it, which is
 * the single structural decision that separates this direction from the
 * editorial one: there the map is evidence inside an argument, here the argument
 * is arranged around the map.
 *
 * What this file adds on top of the shared `MapCanvas` is the housing: a machined
 * frame, corner registration marks, a boresight, and a one-shot acquisition
 * sweep on load. All of it is *frame* chrome and none of it is geographic. That
 * distinction is deliberate. `MapCanvas` owns the MapLibre instance and hands out
 * no projection, so anything drawn here that claimed to be a coordinate, a range
 * ring or a bearing would be decoration wearing a scientific costume, which on a
 * page that accuses vessels of pollution is not an acceptable trade. The
 * boresight is labelled as the centre of the frame, not as a position, and the
 * scale bar is MapLibre's own, measured from the live camera.
 */

import { MapCanvas } from "../../map/MapCanvas";
import { useDesign } from "../../DesignContext";
import { useAnimeScope } from "../../lib/motion";
import { animate, stagger, svg, utils } from "animejs";
import { alpha } from "./instruments";
import type { LayerToggles } from "../../map/basemap";
import type { DesignDef, MapPaint } from "../../design";
import type { Run, Suspect } from "../../sim/types";

/** The three graticule densities the frame control offers. */
export const GRID_DETENTS = [0.5, 0.25, 0.1];

type Corner = "tl" | "tr" | "bl" | "br";
const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];

export default function MissionMap({
  run,
  paint,
  hour,
  toggles,
  selected,
  onSelect,
  grid,
  onGrid,
  camera,
  onReframe,
}: {
  run: Run;
  paint: MapPaint;
  hour: number;
  toggles: LayerToggles;
  selected: Suspect | null;
  onSelect: (id: string | null) => void;
  grid: number;
  onGrid: (deg: number) => void;
  camera: { centre?: [number, number]; zoom?: number; durationMs?: number } | null;
  onReframe: () => void;
}) {
  const def = useDesign();

  /**
   * The chart coming online.
   *
   * A pass, not a spinner: a soft band crosses the frame once while the
   * registration marks draw themselves in and the boresight settles. It re-runs
   * on a scenario change because that genuinely is a different acquisition.
   * `useAnimeScope` skips the whole setup under `prefers-reduced-motion`, so the
   * resting state in the markup has to already be the correct one -- which is
   * why nothing below starts at `opacity: 0` in JSX and the sweep is parked
   * off-frame by CSS instead.
   */
  const root = useAnimeScope(() => {
    utils.set(".orbit-sweep", { opacity: 0.55, translateX: "-40%" });
    animate(".orbit-sweep", {
      translateX: ["-40%", "150%"],
      opacity: [
        { to: 0.55, duration: 240 },
        { to: 0, duration: 1000 },
      ],
      duration: 1600,
      ease: "inOut(2)",
    });

    animate(svg.createDrawable(".orbit-bracket"), {
      draw: ["0 0", "0 1"],
      duration: 760,
      delay: stagger(80, { start: 140 }),
      ease: "out(3)",
    });

    animate(".orbit-boresight", {
      scale: [1.8, 1],
      opacity: [0, 1],
      duration: 900,
      ease: "out(4)",
    });
  }, [run.meta.id]);

  return (
    <div ref={root} className="absolute inset-0">
      <MapCanvas
        run={run}
        paint={paint}
        hour={hour}
        toggles={toggles}
        selected={selected}
        onSelect={onSelect}
        className="h-full w-full"
        /* Direct manipulation: slewing and ranging the chart is done on the
           chart, the way it is on every operational map. */
        interactive
        /*
          Not "none", deliberately.

          "none" also drops MapLibre's ScaleControl, and a bathymetric chart with
          no distance scale is not a chart -- every judgement a viewer makes
          about how far a track passed from a slick depends on it. "scale" drops
          the NavigationControl, which is the chrome this direction actually
          wants gone (index.css already hides it for orbit), and keeps the one
          control that is measured from the live camera and therefore cannot be
          redrawn from outside the map component. See NOTES.md.
        */
        controls="scale"
        /*
          The chart is framed by the mission, not by a side effect.

          This used to be done by giving every mode a distinct graticule
          density, because changing it happened to make the map component
          re-run its scenario effect and recentre. That worked and was
          documented, but it tied a legibility control to a navigation one:
          you could not pick a grid for readability without also moving the
          camera, and you could not move the camera without changing the grid.
          `MapCanvas` now takes a camera, so the two are separate again.
        */
        camera={camera}
      />

      {/* --- frame chrome ------------------------------------------- *
          Everything in here is pointer-transparent. The chart underneath has to
          keep every drag and every wheel event, and an overlay that eats them is
          the usual way a full-bleed map stops being draggable. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="orbit-sweep absolute inset-y-0 w-[28%]"
          style={{
            transform: "translateX(-40%)",
            opacity: 0,
            background: `linear-gradient(90deg, transparent, ${alpha(def.map.particle, 10)} 45%, ${alpha(def.map.particle, 24)} 62%, transparent)`,
          }}
        />

        {/* Legibility grounds under the status bar and the temporal strip.
            Layering rather than texture -- this direction has no grain
            anywhere, because an instrument that looks dirty looks broken. */}
        <div
          className="absolute inset-x-0 top-0 h-28"
          style={{ background: `linear-gradient(180deg, ${alpha("var(--base)", 80)}, transparent)` }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-32"
          style={{ background: `linear-gradient(0deg, ${alpha("var(--base)", 74)}, transparent)` }}
        />

        {CORNERS.map((c) => (
          <Bracket key={c} corner={c} />
        ))}

        <div className="orbit-boresight absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden>
            <circle cx="40" cy="40" r="16" fill="none" stroke={alpha("var(--ink)", 20)} strokeWidth="1" />
            <circle cx="40" cy="40" r="1.7" fill={alpha("var(--accent)", 75)} />
            <path
              d="M40 8 V25 M40 55 V72 M8 40 H25 M55 40 H72"
              stroke={alpha("var(--ink)", 26)}
              strokeWidth="1"
            />
            <path d="M32 24 L40 16 L48 24" fill="none" stroke={alpha("var(--accent)", 50)} strokeWidth="1" />
            <text
              x="40"
              y="70"
              textAnchor="middle"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 7,
                letterSpacing: "0.16em",
                fill: alpha("var(--ink-faint)", 90),
              }}
            >
              BORESIGHT
            </text>
          </svg>
        </div>
      </div>

      <FrameControl
        def={def}
        run={run}
        grid={grid}
        onGrid={onGrid}
        onReframe={onReframe}
      />
    </div>
  );
}

/**
 * A corner registration mark.
 *
 * Its own 26 x 26 SVG rather than one document-sized overlay: a path drawn in a
 * percentage viewBox skews with the window aspect, and a registration mark that
 * is not square is not a registration mark. Each carries a `.orbit-bracket`
 * path so the boot timeline can draw all four in sequence.
 */
function Bracket({ corner }: { corner: Corner }) {
  const v = corner[0] === "t" ? { top: 56 } : { bottom: 118 };
  const h = corner[1] === "l" ? { left: 18 } : { right: 18 };
  const flipX = corner[1] === "r";
  const flipY = corner[0] === "b";

  return (
    <svg
      aria-hidden
      width="26"
      height="26"
      viewBox="0 0 26 26"
      className="absolute hidden lg:block"
      style={{
        ...v,
        ...h,
        transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`,
      }}
    >
      <path
        className="orbit-bracket"
        d="M0.5 25.5 V0.5 H25.5"
        fill="none"
        stroke={alpha("var(--ink-dim)", 45)}
        strokeWidth="1"
      />
    </svg>
  );
}

/**
 * The frame control.
 *
 * Two independent levers, which is what they always should have been. GRID sets
 * graticule density and does nothing else, so it can be chosen for legibility.
 * RE-FRAME eases the camera back to the scenario datum through the map's camera
 * prop -- a real recentre, not a graticule change that recentres as a side
 * effect. Slew and range stay direct on the chart, the way they are on every
 * operational map; faking them with a CSS transform would blur the raster and
 * desynchronise MapLibre's own hit testing.
 */
function FrameControl({
  def,
  run,
  grid,
  onGrid,
  onReframe,
}: {
  def: DesignDef;
  run: Run;
  grid: number;
  onGrid: (deg: number) => void;
  onReframe: () => void;
}) {
  const [lon, lat] = run.meta.centre;
  const rule = (
    <span aria-hidden className="h-5 w-px" style={{ background: alpha("var(--line)", 100) }} />
  );

  return (
    <div
      className="absolute bottom-4 left-1/2 hidden -translate-x-1/2 items-center gap-3 rounded-[11px] px-3 py-2 lg:flex"
      style={{
        border: `1px solid ${alpha("var(--line)", 100)}`,
        background: alpha("var(--base-2)", 76),
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="text-[9px] tracking-[0.2em] uppercase"
          style={{ fontFamily: "var(--font-display)", color: "var(--ink-faint)", fontWeight: 600 }}
        >
          Grid
        </span>
        {GRID_DETENTS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onGrid(d)}
            title={`${d}° graticule spacing`}
            className="num rounded-[3px] px-1.5 py-[3px] text-[9px]"
            style={{
              color: grid === d ? "var(--accent)" : "var(--ink-faint)",
              border: `1px solid ${grid === d ? alpha("var(--accent)", 55) : alpha("var(--line)", 100)}`,
              background: grid === d ? alpha("var(--accent)", 12) : "transparent",
            }}
          >
            {d.toFixed(2)}
          </button>
        ))}
      </div>

      {rule}

      <button
        type="button"
        onClick={onReframe}
        title="Ease the camera back to the scenario datum"
        className="num rounded-[4px] px-2 py-[4px] text-[9px] tracking-[0.14em] uppercase"
        style={{
          color: "var(--ink)",
          border: `1px solid ${alpha("var(--ink-faint)", 70)}`,
          background: alpha("var(--base-3)", 80),
        }}
      >
        Re-frame
      </button>

      {rule}

      <div className="flex flex-col leading-tight">
        <span className="num text-[9px]" style={{ color: "var(--ink-dim)" }}>
          {`${Math.abs(lat).toFixed(3)}${lat < 0 ? "S" : "N"} ${Math.abs(lon).toFixed(3)}${lon < 0 ? "W" : "E"}`}
        </span>
        <span className="num text-[8.5px]" style={{ color: "var(--ink-faint)" }}>
          {`DATUM · Z${run.meta.zoom} · ${def.map.basemap.toUpperCase()} CHART`}
        </span>
      </div>

      {rule}

      <span
        className="max-w-[15ch] text-[9.5px] leading-[1.28]"
        style={{ fontFamily: "var(--font-body)", color: "var(--ink-faint)" }}
      >
        Slew and range direct on the chart
      </span>
    </div>
  );
}
