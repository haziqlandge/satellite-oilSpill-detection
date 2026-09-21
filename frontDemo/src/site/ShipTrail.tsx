/**
 * A tanker that sails down the gutter as the page is read, paying out a wake.
 *
 * The ship follows a very gentle serpentine down the lane and the wake is the
 * part of that track already run. Both numbers below were pulled hard: an
 * earlier version swung seventeen pixels every five hundred and sixty, which
 * read as a decorative squiggle rather than as a vessel on passage, and a
 * version after that ran dead straight, which read as a rule. Seven pixels over
 * eleven hundred is a course correction you notice only if you look.
 *
 * The hull rides the track rather than sliding along beside it: it is offset to
 * the wake's own x, and turned by the track's slope, which at this amplitude is
 * never more than a couple of degrees. Translating without turning makes a ship
 * that crabs sideways, which is the one thing that would draw the eye.
 *
 * Three things it has to get right, all of which are easy to get wrong:
 *
 *  - **the wake comes out of the stern.** It is paid out behind the ship as it
 *    goes, never drawn ahead of it and never sitting there complete before the
 *    reader has scrolled. The path is revealed exactly to the transom, which
 *    means `strokeDasharray` has to be the path's own measured length -- set it
 *    to some large number instead and the whole wake is visible from the first
 *    frame, because a dash longer than the path is just a solid line
 *  - **it is moored to the page, not to the document.** The voyage runs from
 *    the opening kicker to the closing provenance block, both located from the
 *    DOM rather than from a guessed offset, so the ship is level with the
 *    headline at rest and parked at "What is real on this page" at the end
 *  - **it sails in the gutter beside the measure**, not against the window
 *    edge. The page is a centred 1120px column; anchoring at `left: 0` on a
 *    wide monitor puts the ship four hundred pixels from anything
 *
 * It is `xl` and up. Below that there is no gutter -- the measure runs to the
 * edge of the viewport -- and nowhere for a ship to be that is not on the text.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "../lib/motion";

/** The lane the ship runs in, and its course down the middle of it. */
const LANE = 72;
const COURSE = LANE / 2;
/** How far the track wanders either side of that course. Deliberately small. */
const SWING = 7;
/** Vertical distance of one full oscillation. Deliberately long. */
const PERIOD = 1100;
/** Half the hull's length, in the ship's own units. */
const STERN = 44;
/** The gap between the transom and the head of the wake. */
const WAKE_GAP = 4;

/**
 * Where the voyage starts and ends, in document coordinates.
 *
 * Both ends are marked in the page with `data-ship-start` / `data-ship-end`
 * rather than computed from a section index, so moving a block around the
 * document cannot silently leave the ship sailing to the wrong place.
 */
function anchorY(selector: string, fallback: number): number {
  const el = document.querySelector(selector);
  if (!el) return fallback;
  return el.getBoundingClientRect().top + window.scrollY;
}

/** Where the track sits at a given height in the document. */
function wakeX(y: number): number {
  return COURSE + Math.sin((y / PERIOD) * Math.PI * 2) * SWING;
}

/**
 * The track's slope, as the angle to turn the hull by.
 *
 * The analytic derivative rather than a difference between two sampled points:
 * it is one cosine, it is exact, and it does not go wrong at the ends.
 */
function wakeAngle(y: number): number {
  const dxdy = Math.cos((y / PERIOD) * Math.PI * 2) * SWING * ((Math.PI * 2) / PERIOD);
  return (Math.atan(dxdy) * 180) / Math.PI;
}

/**
 * The whole track, start anchor to end anchor.
 *
 * A sine sampled sixteen times per period and joined with straight segments. At
 * seven pixels of amplitude the facets are invisible, and a polyline is cheap
 * for the browser to measure.
 */
function wakePath(from: number, to: number): string {
  const step = PERIOD / 16;
  const points: string[] = [];
  for (let y = from; y <= to; y += step) {
    points.push(`${wakeX(y).toFixed(1)},${y.toFixed(1)}`);
  }
  points.push(`${wakeX(to).toFixed(1)},${to.toFixed(1)}`);
  return `M${points.join(" L")}`;
}

export function ShipTrail() {
  const reduced = useReducedMotion();
  const [span, setSpan] = useState<{ from: number; to: number } | null>(null);
  const wake = useRef<SVGPathElement>(null);
  const ship = useRef<SVGGElement>(null);

  /* --- where the voyage runs ---------------------------------------- */

  useEffect(() => {
    const measure = () => {
      const from = anchorY("[data-ship-start]", 160);
      const to = anchorY("[data-ship-end]", from + 2000);
      setSpan((prev) =>
        prev && Math.abs(prev.from - from) < 1 && Math.abs(prev.to - to) < 1
          ? prev
          : { from, to: Math.max(to, from + 400) },
      );
    };
    measure();
    // The page grows as each block builds its run and swaps out of `Loading`,
    // so one measurement at mount is not enough. A ResizeObserver on the body
    // catches every one of those without polling.
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  /* --- how far she has got ------------------------------------------ */

  useEffect(() => {
    if (!span) return;
    const path = wake.current;
    const hull = ship.current;
    if (!path || !hull) return;

    // Measured once per span rather than per frame: `getTotalLength` walks the
    // path, and this one has several hundred segments. It has to be the path's
    // own length for the reveal to end exactly at the transom.
    const total = path.getTotalLength();
    path.style.strokeDasharray = `${total}`;

    let frame = 0;
    const paint = () => {
      frame = 0;
      // The scroll position at which the closing block is comfortably on
      // screen. Past that the ship is moored and nothing moves.
      const finish = Math.max(1, span.to - window.innerHeight * 0.62);
      const p = Math.min(1, Math.max(0, window.scrollY / finish));

      // The head of the wake is where the transom is; the hull is drawn from
      // there forward, so the wake is always paying out of the back of the ship
      // and never running ahead of the bow.
      //
      // The hull sits on the track and turns with it. The rotation is applied
      // about the ship's own origin, after the translation, so she pivots on
      // herself rather than swinging around the top of the lane.
      const head = span.from + p * (span.to - span.from);
      const hullY = head + STERN + WAKE_GAP;
      path.style.strokeDashoffset = `${total * (1 - p)}`;
      hull.setAttribute(
        "transform",
        `translate(${(wakeX(hullY) - COURSE).toFixed(2)} ${hullY.toFixed(1)}) ` +
          `rotate(${wakeAngle(hullY).toFixed(2)})`,
      );
    };

    // Under reduced motion the ship is moored at the start and no wake is
    // drawn: a full-length line would claim a voyage that, for this reader,
    // never happens.
    if (reduced) {
      const hullY = span.from + STERN + WAKE_GAP;
      path.style.strokeDashoffset = `${total}`;
      hull.setAttribute(
        "transform",
        `translate(${(wakeX(hullY) - COURSE).toFixed(2)} ${hullY.toFixed(1)}) ` +
          `rotate(${wakeAngle(hullY).toFixed(2)})`,
      );
      return;
    }

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [span, reduced]);

  // Rebuilt only when the voyage's ends move, never on scroll.
  const d = useMemo(
    () => (span ? wakePath(span.from, span.to) : ""),
    [span],
  );

  if (!span) return null;

  const height = span.to + 120;

  return (
    <div
      aria-hidden
      /*
        In the gutter immediately left of the measure, not against the window.
        `Page` is a centred 1120px column, so its left edge is at
        `50% - 560px`; the lane sits just outside that, and falls back to the
        window edge on the narrowest viewport that still shows it.
      */
      className="pointer-events-none absolute top-0 z-20 hidden xl:block"
      style={{
        left: `max(6px, calc(50% - 560px - ${LANE + 14}px))`,
        width: LANE,
        height,
      }}
    >
      <svg
        width={LANE}
        height={height}
        viewBox={`0 0 ${LANE} ${height}`}
        style={{ display: "block", overflow: "visible" }}
        role="presentation"
      >
        <path
          ref={wake}
          d={d}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeOpacity={0.34}
          // Primed as fully hidden. The effect measures the path and sets both
          // properties on its first paint, before the browser shows anything.
          style={{ strokeDasharray: 1, strokeDashoffset: 1 }}
        />

        <g ref={ship}>
          <Tanker />
        </g>
      </svg>
    </div>
  );
}

/**
 * The ship, seen from above, bow down.
 *
 * Drawn around an origin amidships so the parent group moves it by translation
 * alone. Line work in the accent over the page ground -- the same treatment as
 * the plates, because an ornament drawn in a different idiom from the figures
 * reads as clip art dropped into a chart.
 *
 * The proportions are the thing that has to be right, and the first attempt got
 * them wrong in a way worth recording: a long fine bow taper over a narrow
 * parallel body does not read as a ship from above, it reads as a **pencil**.
 * A product tanker in plan is blunt. The parallel body runs almost the whole
 * length, the entry is short, and the stem is a rounded point rather than a
 * spike. Beam is about a fifth of length here rather than a true ship's eighth,
 * because at eighty pixels a true ratio is a line with some marks on it.
 *
 * What makes it read as a *tanker* specifically is the deck: the cargo manifold
 * down the centreline, tank hatches in pairs either side of it, transverse
 * walkways, and the accommodation block and funnel stacked right aft with the
 * whole forward two-thirds left flat. That arrangement is unique to the type
 * and it is the only reason this is not a generic boat.
 */
function Tanker() {
  return (
    <g transform={`translate(${COURSE} 0)`}>
      {/* Hull. Rounded transom at the top, parallel sides most of the length,
          a short entry to a rounded stem at the bottom -- bow down, because
          that is the direction of travel. */}
      <path
        d={`M-14.5,${-STERN + 3}
            Q-14.5,${-STERN} -11.5,${-STERN}
            L11.5,${-STERN}
            Q14.5,${-STERN} 14.5,${-STERN + 3}
            L14.5,26
            Q14.5,36 8,44
            Q3,49.5 0,50.5
            Q-3,49.5 -8,44
            Q-14.5,36 -14.5,26
            Z`}
        fill="var(--accent)"
        fillOpacity={0.12}
        stroke="var(--accent)"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />

      {/* --- aft: poop deck, accommodation, funnel ------------------- */}
      <g fill="var(--base)" stroke="var(--accent)" strokeWidth={1.15}>
        {/* Poop deck, full beam. */}
        <path d={`M-14.5,${-STERN + 3} L14.5,${-STERN + 3} L14.5,-36 L-14.5,-36 Z`} />
        {/* The house. */}
        <rect x={-9} y={-36} width={18} height={11} />
      </g>
      {/* Bridge front, and the wings either side of it. */}
      <g stroke="var(--accent)" strokeWidth={1} strokeOpacity={0.75}>
        <line x1={-9} y1={-27.5} x2={9} y2={-27.5} />
        <line x1={-12.5} y1={-28.5} x2={-9} y2={-28.5} />
        <line x1={9} y1={-28.5} x2={12.5} y2={-28.5} />
      </g>
      {/* Funnel. */}
      <rect
        x={-3.5}
        y={-24}
        width={7}
        height={6}
        fill="var(--base)"
        stroke="var(--accent)"
        strokeWidth={1.1}
      />

      {/* --- the tank deck ------------------------------------------- */}
      <g stroke="var(--accent)" strokeWidth={1} strokeOpacity={0.55}>
        {/* The cargo manifold, down the centreline. This is the single mark
            that most says "tanker" from above. */}
        <line x1={0} y1={-16} x2={0} y2={30} />
        {/* Transverse walkways. */}
        <line x1={-14.5} y1={-8} x2={14.5} y2={-8} />
        <line x1={-14.5} y1={6} x2={14.5} y2={6} />
        <line x1={-14.5} y1={20} x2={14.5} y2={20} />
      </g>

      {/* Tank hatches, in pairs either side of the manifold. */}
      <g fill="none" stroke="var(--accent)" strokeWidth={1} strokeOpacity={0.72}>
        {[-13, 1, 15].map((y) => (
          <g key={y}>
            <rect x={-9.5} y={y} width={5.5} height={5.5} />
            <rect x={4} y={y} width={5.5} height={5.5} />
          </g>
        ))}
      </g>

      {/* --- forward ------------------------------------------------- */}
      <g stroke="var(--accent)" strokeWidth={1.1} strokeOpacity={0.8}>
        {/* Forecastle break. */}
        <line x1={-14} y1={30} x2={14} y2={30} />
        {/* Windlass and the stem line. */}
        <line x1={0} y1={34} x2={0} y2={41} />
        <line x1={-4} y1={36} x2={4} y2={36} />
      </g>
    </g>
  );
}
