/**
 * Drawn furniture for the home page.
 *
 * The page is a column of prose with charts in it, and its margin runs empty
 * for most of two sections. These fill it, and they are held to the same rules
 * as everything else here: line work rather than illustration, the surface's
 * own accent rather than a picture's palette, `aria-hidden` where the drawing
 * carries no information the text does not, and no colour that is not a token.
 *
 * The tanker is a drawing of the event the rest of the page only sees from
 * orbit, and it carries the detector's own class name so it is not purely
 * ornamental. The stage chain is drawn from `STAGES` in `content.ts` and
 * `PLAN/ARCHITECTURE.md`, so neither can fall out of step with the copy.
 */

import { useId } from "react";
import { createTimeline, stagger, utils } from "animejs";
import { useAnimeScopeInView } from "../lib/motion";
import { STAGES, type Stage } from "../content";

/* ------------------------------------------------------------------ *
 * The tanker, in profile
 * ------------------------------------------------------------------ */

/**
 * A ship discharging, side on.
 *
 * It sits beside the paragraph about a slick being the end of one process and
 * the start of another, and it is the one drawing on the page that shows the
 * event the rest of the page only ever sees from orbit. Everything else here is
 * a plan view of a consequence; this is the cause, at sea level.
 *
 * Which is why it is not quite decoration. The discharge is labelled with the
 * detector's own class name -- `oos`, an operational discharge, as opposed to a
 * slick whose origin is unknown -- so the ornament carries the one piece of
 * vocabulary the whole two-class scheme turns on. That is also why it has a
 * real `aria-label` rather than being hidden from the accessibility tree.
 *
 * Static, deliberately. A looping plume beside a map that is itself animating
 * would compete with the figure that matters.
 *
 * Two drawing decisions worth keeping:
 *
 *  - **the sea is drawn.** The first version had a bare horizontal rule for the
 *    waterline and nothing under it, so the hull floated on a line and the
 *    slick -- a low-opacity wash -- had no ground to read against and simply
 *    vanished. A faint band under the surface fixes both
 *  - **the hull is filled, and filled twice.** An unfilled outline on a
 *    near-black page is a wireframe; the body above the waterline takes a light
 *    wash and the part below takes a heavier one, which is what makes the ship
 *    read as sitting *in* the water rather than on it
 */
export function TankerProfile({ className = "" }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const SEA = 148;

  return (
    <figure data-reveal className={`mt-8 hidden lg:block ${className}`}>
      <svg
        viewBox="0 0 340 212"
        className="w-full"
        style={{ maxWidth: 320 }}
        role="img"
        aria-label="A tanker in profile, discharging oil at the waterline; the slick spreads astern"
      >
        <defs>
          <linearGradient id={`smoke-${uid}`} x1="1" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--ink-dim)" stopOpacity="0.42" />
            <stop offset="100%" stopColor="var(--ink-dim)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`slick-${uid}`} x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.5" />
            <stop offset="55%" stopColor="var(--accent)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          {/* Everything below the surface, for the heavier wash on the hull. */}
          <clipPath id={`below-${uid}`}>
            <rect x="0" y={SEA} width="340" height="212" />
          </clipPath>
          {/*
            The sea, fading out downward.

            A flat band under the surface ends in a hard horizontal edge at the
            bottom of the frame, and on a dark page that edge reads as the
            bottom of a card the ship is sitting on rather than as water. The
            fade removes the edge without removing the ground the slick needs.
          */}
          <linearGradient id={`sea-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.075" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* --- the sea ------------------------------------------------ */}
        <rect
          x="0"
          y={SEA}
          width="340"
          height={212 - SEA}
          fill={`url(#sea-${uid})`}
        />
        <line
          x1="0"
          y1={SEA}
          x2="340"
          y2={SEA}
          stroke="var(--accent)"
          strokeOpacity="0.32"
          strokeWidth="1"
        />

        {/* --- smoke -------------------------------------------------- */}
        <g fill={`url(#smoke-${uid})`}>
          <ellipse cx="66" cy="34" rx="9" ry="5" />
          <ellipse cx="54" cy="24" rx="12" ry="6.5" />
          <ellipse cx="38" cy="14" rx="15" ry="7.5" />
          <ellipse cx="18" cy="8" rx="17" ry="8" />
        </g>

        {/* --- hull --------------------------------------------------- */}
        {(() => {
          // Stern transom aft, parallel body, a raked stem forward that carries
          // on below the waterline to a forefoot.
          const hull =
            "M28,114 L300,114 L320,117 L311,148 C308,157 302,161 292,161 L44,161 C34,161 28,155 28,146 Z";
          return (
            <>
              <path d={hull} fill="var(--accent)" fillOpacity="0.1" />
              <g clipPath={`url(#below-${uid})`}>
                <path d={hull} fill="var(--accent)" fillOpacity="0.17" />
              </g>
              <path
                d={hull}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </>
          );
        })()}

        {/* --- accommodation and funnel, aft -------------------------- */}
        <g fill="var(--base)" stroke="var(--accent)" strokeWidth="1.2">
          <rect x="40" y="88" width="54" height="26" />
          {/* The bridge deck overhangs into wings either side. */}
          <rect x="34" y="76" width="66" height="12" />
          <rect x="50" y="60" width="34" height="16" />
        </g>
        {/* Funnel, raked. */}
        <path
          d="M58,60 L62,38 L77,38 L79,60 Z"
          fill="var(--base)"
          stroke="var(--accent)"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        {/* Bridge windows: two rules, not glazing. */}
        <g stroke="var(--accent)" strokeWidth="1" strokeOpacity="0.7">
          <line x1="38" y1="82" x2="64" y2="82" />
          <line x1="70" y1="82" x2="96" y2="82" />
        </g>

        {/* --- deck --------------------------------------------------- */}
        <g stroke="var(--accent)" strokeWidth="1" strokeOpacity="0.55">
          {/* The cargo manifold and its risers, amidships. */}
          <line x1="150" y1="106" x2="252" y2="106" />
          <line x1="164" y1="106" x2="164" y2="114" />
          <line x1="201" y1="106" x2="201" y2="114" />
          <line x1="238" y1="106" x2="238" y2="114" />
          {/* Foremast with a yard. */}
          <line x1="286" y1="114" x2="286" y2="84" />
          <line x1="278" y1="92" x2="294" y2="92" />
          {/* Draught marks, aft. */}
          <line x1="36" y1="128" x2="44" y2="128" />
          <line x1="36" y1="136" x2="44" y2="136" />
          <line x1="36" y1="144" x2="44" y2="144" />
        </g>
        {/* Tank hatches along the deck. */}
        <g fill="none" stroke="var(--accent)" strokeWidth="1" strokeOpacity="0.7">
          {[124, 154, 184, 214, 244, 268].map((x) => (
            <circle key={x} cx={x} cy="110" r="3" />
          ))}
        </g>

        {/* --- the discharge ------------------------------------------ */}
        {/*
          The oil, and it has to look like oil.

          The first version drew the discharge as a 1.8px stroke falling into a
          soft gradient, which reads as a ship urinating into thin air: a line
          has no volume, and a single smooth wash has no surface. Oil on water
          does two things instead, and both are drawn here -- it lies in a
          continuous sheet near the source, thick enough to have an edge, and it
          breaks into detached patches downwind as it thins. The patches are the
          part that makes it read as a substance rather than a shadow, and they
          are also true: a slick is not a solid shape, which is exactly why the
          detector segments contours rather than boxes.
        */}
        {/* The full extent, as a wash under everything else. */}
        <path
          d={`M180,${SEA} C140,${SEA - 6} 70,${SEA - 5} 4,${SEA} C70,${SEA + 6} 140,${SEA + 5} 180,${SEA} Z`}
          fill={`url(#slick-${uid})`}
        />

        {/* The continuous sheet, from the entry point astern. Irregular on
            both edges: a slick with two smooth curves for sides is a leaf. */}
        <path
          d={`M178,${SEA - 1}
              C158,${SEA - 5} 132,${SEA - 3} 108,${SEA - 4.5}
              C88,${SEA - 5.5} 70,${SEA - 2} 52,${SEA - 3}
              C60,${SEA + 2.5} 84,${SEA + 1} 106,${SEA + 3}
              C130,${SEA + 5} 158,${SEA + 3} 178,${SEA + 4} Z`}
          fill="var(--accent)"
          fillOpacity="0.42"
        />
        {/* Its windward edge, where a slick is sharpest. */}
        <path
          d={`M178,${SEA - 1} C158,${SEA - 5} 132,${SEA - 3} 108,${SEA - 4.5}
              C88,${SEA - 5.5} 70,${SEA - 2} 52,${SEA - 3}`}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.1"
          strokeOpacity="0.7"
        />

        {/* Detached patches, thinning astern. Irregular in size and offset from
            the sheet's own line, because a slick that breaks up into a tidy
            row of identical dots is a dotted line. */}
        <g fill="var(--accent)">
          <ellipse cx="92" cy={SEA + 5} rx="8" ry="2.2" fillOpacity="0.3" />
          <ellipse cx="66" cy={SEA - 5} rx="10" ry="2.6" fillOpacity="0.34" />
          <ellipse cx="52" cy={SEA + 4} rx="6.5" ry="2" fillOpacity="0.26" />
          <ellipse cx="38" cy={SEA - 2} rx="12" ry="3" fillOpacity="0.3" />
          <ellipse cx="24" cy={SEA + 4} rx="7" ry="2.2" fillOpacity="0.22" />
          <ellipse cx="14" cy={SEA - 3} rx="5" ry="1.7" fillOpacity="0.17" />
          <ellipse cx="5" cy={SEA + 1} rx="3.4" ry="1.3" fillOpacity="0.12" />
        </g>

        {/* Where it is entering the water: thickest, and pooling. */}
        <ellipse
          cx="166"
          cy={SEA + 1}
          rx="16"
          ry="4.4"
          fill="var(--accent)"
          fillOpacity="0.5"
        />

        {/* The overboard port. */}
        <rect
          x="168"
          y="128"
          width="11"
          height="7"
          fill="var(--base)"
          stroke="var(--accent)"
          strokeWidth="1.2"
        />
        {/* The stream itself, drawn as a body with width rather than a stroke,
            narrowing as it falls and swelling where it meets the surface. */}
        <path
          d={`M169.5,135
              C168.5,139 166.5,143 164.5,${SEA - 1}
              L171.5,${SEA - 1}
              C172.5,143 174,139 175,135 Z`}
          fill="var(--accent)"
          fillOpacity="0.85"
        />
        {/* Two parcels that have separated from the stream. */}
        <g fill="var(--accent)">
          <ellipse cx="163" cy="141" rx="1.7" ry="2.4" fillOpacity="0.7" />
          <ellipse cx="160.5" cy="145.5" rx="1.2" ry="1.7" fillOpacity="0.45" />
        </g>

        {/* --- the one label ------------------------------------------ */}
        <g>
          <line
            x1="178"
            y1="133"
            x2="222"
            y2="133"
            stroke="var(--accent)"
            strokeWidth="0.9"
          />
          <circle cx="178" cy="133" r="1.8" fill="var(--accent)" />
          <text
            x="226"
            y="136.5"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fill: "var(--accent)",
            }}
          >
            oos
          </text>
        </g>
      </svg>

      <figcaption
        className="text-faint mt-2 text-[11.5px] leading-[1.45]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        An operational discharge — the detector&rsquo;s <span className="font-mono text-[10.5px]">oos</span> class, as
        opposed to a slick whose origin is unknown.
      </figcaption>
    </figure>
  );
}


/* ------------------------------------------------------------------ *
 * The chain
 * ------------------------------------------------------------------ */

/**
 * What each stage produces, and where it is kept.
 *
 * The section opens by claiming the six stages each hand the next one
 * *something it can check*, and the list above this figure describes what every
 * stage does. Between those two things there is a hole: nothing on the page
 * says what actually comes out of a stage, or what "checkable" means in
 * practice. It means the artefact is written down somewhere with a name, and
 * that is what this draws.
 *
 * **Everything in it is from `PLAN/ARCHITECTURE.md`** -- the outputs and the
 * persistence targets are its "Data flow, stage by stage" table, and the
 * process tags and stage names are `content.ts`'s. Nothing here is invented for
 * the picture, which matters more than usual on a page whose closing section is
 * about what is real on it.
 *
 * The ribbon draws the chain's *shape*, which is a funnel with one bulge. A
 * 250 km swath reduces to a handful of polygons, then the hindcast **expands**
 * it -- ARCHITECTURE is explicit that `origin_field` is large, lat by lon by
 * time, and is the one artefact too big for the database -- and the gate
 * collapses it again. The bulge is the point: the step that costs the most is
 * the step nothing else in the field does.
 *
 * Two construction notes, both about not doing the obvious thing:
 *
 *  - **the labels are HTML, not SVG text.** An SVG with type baked into it
 *    scales with its column, so the same figure would set 15px in a 1600px
 *    window and 11px in a 1280px one. Every label here is a real element at a
 *    real size, and only the ribbon is drawn
 *  - **the ribbon is one slice per row**, each stretched to its row's height
 *    with `preserveAspectRatio="none"`. Horizontal widths stay exact, vertical
 *    follows whatever the text needed, and there is no measuring pass and no
 *    second source of truth about how tall a row is
 *
 * It is one row per stage rather than a row per stage and a row per handoff.
 * The two-row version was twice the height, and the margin column it sits in
 * has a budget: it is beside a fixed body of text and a figure that outruns
 * that text stretches the section and leaves a hole under the prose.
 *
 * The ribbon is **not a measurement** and the caption says so. Width is
 * ordinal. On a page whose whole provenance discipline is about not implying
 * precision that does not exist, a figure that looked quantitative without
 * being quantitative would be the worst thing on it.
 */

interface Handoff {
  /** What the stage produces. `ARCHITECTURE.md`, Output column. */
  out: React.ReactNode;
  /** Where it is kept. `ARCHITECTURE.md`, "Persisted as". */
  store: string;
  /** Ribbon half-width once the stage has run. Ordinal, not measured. */
  width: number;
}

/** An identifier, set in the machine face inside a line of prose. */
function Id({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[11px]" style={{ fontStyle: "normal" }}>
      {children}
    </span>
  );
}

/**
 * What goes in at the top, before any stage has run.
 */
const INTAKE = {
  out: "A Sentinel-1 GRD scene",
  note: "IW · VV · 10 m · 250 km swath",
  width: 23,
};

/** One per stage, in `STAGES` order. */
const HANDOFF: Handoff[] = [
  {
    out: (
      <>
        Geocoded <Id>σ0</Id> dB GeoTIFF, tiled with overlap
      </>
    ),
    store: "scenes",
    width: 20,
  },
  {
    out: "Instance masks, with class and confidence",
    store: "detections",
    width: 10,
  },
  {
    out: "Geometry, damping, head and tail, wind gate",
    store: "characterisations",
    width: 7,
  },
  {
    // The one artefact that does not fit in the database, which is why the
    // ribbon bulges here and the only place on the page that says so.
    out: (
      <>
        <Id>origin_field P(lat, lon, t)</Id> — NetCDF on disk, too large to keep
        in the database
      </>
    ),
    store: "drift_runs",
    width: 18,
  },
  {
    out: "Tracks that survived the gate, dark vessels, infrastructure",
    store: "candidates",
    width: 5.5,
  },
  {
    out: "Ranked suspects, six terms and their weights",
    store: "scores",
    width: 4,
  },
];

/** The rail column, in px and in the slices' own units. They are the same. */
const RAIL = 54;
const MID = RAIL / 2;

export function StageChain({ className = "" }: { className?: string }) {
  const root = useAnimeScopeInView(() => {
    // Everything primed here is primed with `opacity` as well as whatever else
    // it needs, so the backstop below has one uniform signal to look for. A
    // band collapsed by `scaleY` alone is invisible without being transparent,
    // and a rescue that only checks opacity would walk straight past it.
    utils.set(".sc-band", { scaleY: 0, opacity: 0 });
    utils.set(".sc-copy, .sc-node", { opacity: 0 });
    createTimeline({ defaults: { ease: "out(2)" } })
      // The ribbon arrives first and top to bottom, so the figure reads as
      // something travelling down a chain rather than as a diagram fading up.
      .add(".sc-band", {
        scaleY: [0, 1],
        opacity: [0, 1],
        duration: 220,
        delay: stagger(70),
      })
      .add(
        ".sc-node",
        { opacity: [0, 1], scale: [0.7, 1], duration: 240, delay: stagger(70) },
        "-=760",
      )
      .add(
        ".sc-copy",
        { opacity: [0, 1], translateX: [-6, 0], duration: 300, delay: stagger(70) },
        "-=800",
      );
  }, [], { backstop: ".sc-copy, .sc-node, .sc-band" });

  return (
    <figure
      className={`mt-9 border-t pt-2.5 ${className}`}
      style={{ borderColor: "var(--line)" }}
    >
      <figcaption>
        <p className="text-accent font-mono text-[9.5px] tracking-[0.22em] uppercase">
          What comes out of each stage
        </p>
        <p
          className="text-dim mt-1.5 text-[13px] leading-[1.5]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          Each stage writes a named artefact the next one reads, which is what
          makes the chain checkable at every joint. The ribbon is drawn to its
          shape rather than to a measurement: it narrows where a stage discards
          something and widens at the hindcast, the one artefact too large to
          keep in the database.
        </p>
      </figcaption>

      <div ref={root} className="mt-4">
        {/* --- what goes in ------------------------------------------ */}
        <Row band={<Band from={INTAKE.width} to={INTAKE.width} />} pad="py-2">
          <p
            className="font-mono text-[8px] tracking-[0.28em] uppercase"
            style={{ color: "var(--ink-faint)" }}
          >
            In
          </p>
          <p
            className="mt-[3px] text-[12.5px] leading-[1.35]"
            style={{
              fontFamily: "var(--font-body)",
              fontStyle: "italic",
              color: "var(--ink-dim)",
            }}
          >
            {INTAKE.out}
          </p>
          <p
            className="mt-[2px] font-mono text-[8.5px] leading-[1.4]"
            style={{ color: "var(--ink-faint)" }}
          >
            {INTAKE.note}
          </p>
        </Row>

        {/* --- the stages -------------------------------------------- */}
        {STAGES.map((stage, i) => (
          <StageRow
            key={stage.key}
            index={i}
            stage={stage}
            handoff={HANDOFF[i]}
            from={i === 0 ? INTAKE.width : HANDOFF[i - 1].width}
          />
        ))}

        {/* --- and what comes out ------------------------------------ */}
        <Row
          band={
            <Band
              from={HANDOFF[HANDOFF.length - 1].width}
              to={HANDOFF[HANDOFF.length - 1].width}
            />
          }
          pad="py-2"
        >
          <p
            className="font-mono text-[8px] tracking-[0.28em] uppercase"
            style={{ color: "var(--ink-faint)" }}
          >
            Out
          </p>
          <p
            className="mt-[3px] text-[12.5px] leading-[1.35]"
            style={{
              fontFamily: "var(--font-body)",
              fontStyle: "italic",
              color: "var(--ink-dim)",
            }}
          >
            An evidence card per suspect
          </p>
        </Row>
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ *
 * Parts
 * ------------------------------------------------------------------ */

/**
 * One row: a fixed rail on the left carrying its slice of ribbon, and whatever
 * the row is about on the right.
 *
 * The rail is a fixed pixel column rather than a fraction, which is what lets
 * the slice's widths stay exact at any container width.
 */
function Row({
  band,
  children,
  pad = "py-2.5",
}: {
  band: React.ReactNode;
  children: React.ReactNode;
  pad?: string;
}) {
  return (
    <div className="grid" style={{ gridTemplateColumns: `${RAIL}px 1fr` }}>
      <div className="relative">{band}</div>
      <div className={`sc-copy min-w-0 pl-4 ${pad}`}>{children}</div>
    </div>
  );
}

/**
 * A slice of ribbon, stretched to whatever height its row turned out to be.
 *
 * `preserveAspectRatio="none"` is doing the work: the viewBox is 54 wide and
 * 100 tall, the element is 54px wide and 100% tall, so horizontal units stay
 * px-exact while vertical ones follow the text. `vectorEffect` keeps the edges
 * hairlines through that stretch, which is the whole reason they are separate
 * paths rather than a stroke on the fill.
 */
function Band({ from, to }: { from: number; to: number }) {
  const l0 = MID - from;
  const r0 = MID + from;
  const l1 = MID - to;
  const r1 = MID + to;

  return (
    <svg
      className="sc-band absolute inset-0 h-full"
      width={RAIL}
      height="100%"
      viewBox={`0 0 ${RAIL} 100`}
      preserveAspectRatio="none"
      aria-hidden
      style={{ transformOrigin: "top center" }}
    >
      <path
        d={`M${l0},0 L${r0},0 L${r1},100 L${l1},100 Z`}
        fill="var(--accent)"
        fillOpacity={0.1}
      />
      <path
        d={`M${l0},0 L${l1},100`}
        stroke="var(--accent)"
        strokeOpacity={0.48}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        fill="none"
      />
      <path
        d={`M${r0},0 L${r1},100`}
        stroke="var(--accent)"
        strokeOpacity={0.48}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        fill="none"
      />
    </svg>
  );
}

/**
 * A stage: the taper in the ribbon, the numbered station drawn over it, the
 * stage's name and process tag, and underneath them the artefact it produces
 * and the table it lands in.
 *
 * Name flush left and process flush right is the same setting the stage list
 * above the figure uses, and the artefact line repeats it with the store name.
 * Two aligned right edges rather than a ragged column, which is what makes six
 * short rows read as a table of one kind of thing.
 */
function StageRow({
  index,
  stage,
  handoff,
  from,
}: {
  index: number;
  stage: Stage;
  handoff: Handoff;
  from: number;
}) {
  return (
    <div className="grid" style={{ gridTemplateColumns: `${RAIL}px 1fr` }}>
      <div className="relative">
        <Band from={from} to={handoff.width} />
        {/* The station, punched out in the page ground so the ribbon reads as
            passing through it rather than behind it. */}
        <div
          className="sc-node absolute top-1/2 left-1/2 flex h-[20px] w-[27px] -translate-x-1/2 -translate-y-1/2 items-center justify-center border"
          style={{
            background: "var(--base)",
            borderColor: "var(--accent)",
            borderWidth: 1.3,
          }}
        >
          <span
            className="font-mono text-[9.5px] leading-none"
            style={{ color: "var(--accent)" }}
          >
            {String(index + 1).padStart(2, "0")}
          </span>
        </div>
      </div>

      {/*
        Two lines, two voices, and no more than that.

        The process tag that used to sit on the right of this row is gone. It is
        already set on every entry of the stage list directly above the figure,
        at a size with room around it, and repeating it here put two tiny
        monospace things in the same corner competing for the same edge. What
        belongs on that edge is the store name, because that is the part of the
        row the reader has not already been told.
      */}
      <div className="sc-copy min-w-0 py-[9px] pl-4">
        <div className="flex items-baseline gap-2.5">
          <h4
            className="shrink-0 text-[14.5px] leading-none"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "var(--ink)",
            }}
          >
            {stage.name}
          </h4>
          <span
            className="h-px min-w-3 flex-1"
            style={{ background: "var(--line)" }}
            aria-hidden
          />
          <span
            className="shrink-0 font-mono text-[9.5px] whitespace-nowrap"
            style={{ color: "var(--ink-faint)" }}
            title="The table this stage's output is written to"
          >
            {handoff.store}
          </span>
        </div>

        <p
          className="mt-[5px] text-[12.5px] leading-[1.35]"
          style={{
            fontFamily: "var(--font-body)",
            fontStyle: "italic",
            color: "var(--ink-dim)",
          }}
        >
          {handoff.out}
        </p>
      </div>
    </div>
  );
}
