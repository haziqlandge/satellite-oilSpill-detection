/**
 * DOSSIER's component family: paper, rules, stamps and marginalia.
 *
 * There is no Card, no Panel and no Tile in this file, and the absence is the
 * design rather than an oversight. A case file is a stack of sheets: content
 * sits directly on the paper, sections are separated by ruled lines instead of
 * by boxes, annotations hang in a filing margin, and anything the document
 * intends to refer to later gets a number. Every component below is one of
 * those conventions.
 *
 * Three rules hold across the whole family.
 *
 *  - Colour comes from the tokens, never from a literal. Dossier is the only
 *    light direction in the project, so a hard-coded neutral that happens to
 *    look right on this paper is a hard-coded neutral that is invisible in the
 *    other three, and these components are read while switching between them.
 *  - Anything presented as evidence carries a source classification. It is a
 *    required prop on `Exhibit` rather than an optional caption line, because a
 *    required prop is the only mechanism that reliably stops an unattributed
 *    figure from reaching the page. Provenance is this direction's assigned
 *    idiom and it is enforced by the type system.
 *  - Numbers are mono and tabular. This document exists so six terms can be
 *    compared down a column across four candidates; digits that change width
 *    between rows break the comparison the page is for.
 */

import { useId, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { Run } from "../../sim/types";
import { useAnimeScope } from "../../lib/motion";
import { animate, utils } from "animejs";

/* ------------------------------------------------------------------ *
 * Source classification
 *
 * The project mixes three genuinely different kinds of statement and the file
 * is unreadable -- and dishonest -- if they are set the same way. C10 and the
 * provenance note in `content.ts` both turn on the reader being able to tell
 * which is which at a glance, so every exhibit is stamped with one.
 * ------------------------------------------------------------------ */

export type SourceClass = "published" | "model" | "simulated" | "authored";

export const SOURCE_LABEL: Record<SourceClass, string> = {
  published: "Published source",
  model: "Model output",
  simulated: "Simulated",
  authored: "Authored ground truth",
};

/* ------------------------------------------------------------------ *
 * The paper
 * ------------------------------------------------------------------ */

/**
 * The sheet.
 *
 * The page ground is `--base`, which is the desk; the sheet is `--base-2`,
 * which is the paper on it. That one step of value is what makes the document
 * read as an object rather than as a background colour, and it is done with a
 * hairline rather than a drop shadow because a filed sheet does not float.
 */
export function Sheet({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative mx-auto w-full max-w-[1240px] border-x"
      style={{ background: "var(--base-2)", borderColor: "var(--line)" }}
    >
      {children}
    </div>
  );
}

/**
 * One ruled block, laid on the filing grid.
 *
 * The left column is the margin: numerals, annotations, exhibit references. The
 * rule between the two columns is drawn as the margin cell's right border
 * rather than as a separate absolutely positioned line, which is what keeps it
 * continuous down the whole document -- consecutive leaves touch, so their
 * borders join. Vertical rhythm therefore lives in the cells' padding and never
 * in a gap between leaves, because a gap would break the rule into dashes.
 */
export function Leaf({
  margin,
  children,
  className = "",
  id,
  pad = "normal",
}: {
  margin?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  pad?: "normal" | "tight" | "loose";
}) {
  const py =
    pad === "tight" ? "py-4" : pad === "loose" ? "py-12 lg:py-16" : "py-7 lg:py-9";
  return (
    <section
      id={id}
      className={`grid scroll-mt-16 grid-cols-1 px-5 sm:px-8 lg:grid-cols-[7rem_minmax(0,1fr)] lg:px-10 ${className}`}
    >
      <div
        // At `lg` and up the vertical padding has to match the body column
        // exactly, or the filing rule comes up short of the content beside it
        // and the continuous line breaks into dashes between leaves. Only the
        // narrow layout, where there is no rule at all, trims it.
        className={`${py} max-lg:pb-2 lg:border-r lg:pr-6`}
        style={{
          // A legal pad's margin line, held well back from full strength: at
          // full oxide it competes with the findings, which are the only thing
          // in this document allowed to be red.
          borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)",
        }}
      >
        {margin}
      </div>
      <div className={`${py} lg:pl-8`}>{children}</div>
    </section>
  );
}

/** A ruled divider. `double` is the printer's section break. */
export function Rule({
  weight = "hair",
  className = "",
}: {
  weight?: "hair" | "firm" | "double";
  className?: string;
}) {
  if (weight === "double") {
    return (
      <div className={className} aria-hidden>
        <div style={{ height: 2, background: "var(--ink)" }} />
        <div style={{ height: 3 }} />
        <div style={{ height: 1, background: "var(--ink)" }} />
      </div>
    );
  }
  return (
    <div
      className={className}
      aria-hidden
      style={{
        height: 1,
        background: weight === "firm" ? "var(--ink-faint)" : "var(--line)",
      }}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Type
 * ------------------------------------------------------------------ */

/**
 * Display type: Newsreader, moderate weight, tight.
 *
 * Serif display over a sans body is the whole typographic thesis of this
 * direction. Signal runs the identical pair the other way round and reads as a
 * magazine; run this way it reads as something issued by an institution. The
 * weight is deliberately not heavy -- a heavy serif headline is a newspaper,
 * and a newspaper is the other design.
 */
export function Head({
  children,
  level = 2,
  className = "",
  style,
}: {
  children: ReactNode;
  level?: 1 | 2 | 3;
  className?: string;
  style?: CSSProperties;
}) {
  const size =
    level === 1
      ? "text-[clamp(2.1rem,5vw,3.9rem)] leading-[1.02]"
      : level === 2
        ? "text-[clamp(1.5rem,2.6vw,2.3rem)] leading-[1.1]"
        : "text-[clamp(1.05rem,1.5vw,1.32rem)] leading-[1.24]";
  const Tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
  return (
    <Tag
      className={`text-ink ${size} ${className}`}
      style={{
        fontFamily: "var(--font-display)",
        fontWeight: level === 3 ? 600 : 500,
        letterSpacing: level === 1 ? "-0.018em" : "-0.008em",
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

/** Running text. Archivo, set small and plain: this is a report, not a read. */
export function Prose({
  children,
  size = "normal",
  className = "",
  tone = "dim",
}: {
  children: ReactNode;
  size?: "normal" | "small" | "lede";
  className?: string;
  tone?: "ink" | "dim";
}) {
  const s =
    size === "lede"
      ? "text-[16.5px] leading-[1.62]"
      : size === "small"
        ? "text-[12.5px] leading-[1.55]"
        : "text-[14.5px] leading-[1.62]";
  return (
    <p
      className={`${s} ${className}`}
      style={{
        fontFamily: "var(--font-body)",
        color: tone === "ink" ? "var(--ink)" : "var(--ink-dim)",
        maxWidth: "74ch",
      }}
    >
      {children}
    </p>
  );
}

/** The small letterspaced mono line that labels everything in this document. */
export function Micro({
  children,
  tone = "faint",
  className = "",
}: {
  children: ReactNode;
  tone?: "accent" | "ink" | "dim" | "faint";
  className?: string;
}) {
  const colour =
    tone === "accent"
      ? "var(--accent)"
      : tone === "ink"
        ? "var(--ink)"
        : tone === "dim"
          ? "var(--ink-dim)"
          : "var(--ink-faint)";
  return (
    <span
      className={`block font-mono text-[9.5px] tracking-[0.26em] uppercase ${className}`}
      style={{ color: colour }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Part openings
 * ------------------------------------------------------------------ */

/**
 * A part opening: Roman numeral in the margin, title on the body column.
 *
 * The numeral is the navigation made visible. A reader who arrives here from
 * the index sees the same numeral they clicked, at document scale, which is how
 * a paper file confirms you turned to the right place.
 */
export function PartTitle({
  numeral,
  title,
  standfirst,
  id,
}: {
  numeral: string;
  title: string;
  standfirst?: string;
  id?: string;
}) {
  return (
    <Leaf
      id={id}
      pad="loose"
      margin={
        <span
          className="text-[clamp(2.2rem,4vw,3.4rem)] leading-[0.8] tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--ink-faint)" }}
          aria-hidden
        >
          {numeral}
        </span>
      }
    >
      <Rule weight="double" className="mb-5" />
      <Micro tone="accent">Part {numeral}</Micro>
      <Head level={2} className="mt-3">
        {title}
      </Head>
      {standfirst && (
        <Prose size="lede" tone="ink" className="mt-5">
          {standfirst}
        </Prose>
      )}
    </Leaf>
  );
}

/* ------------------------------------------------------------------ *
 * Stamps
 * ------------------------------------------------------------------ */

/**
 * A rubber stamp.
 *
 * Double-ruled, letterspaced, slightly off-square. The rotation is small and
 * fixed per call site rather than random, because a stamp that lands at a
 * different angle on every render is a novelty and this one is load-bearing
 * furniture: it is how status reaches the reader before the prose does.
 */
export function Stamp({
  children,
  tone = "accent",
  angle = -3.2,
  size = "normal",
  className = "",
}: {
  children: ReactNode;
  tone?: "accent" | "ink" | "faint";
  angle?: number;
  size?: "small" | "normal" | "large";
  className?: string;
}) {
  const colour =
    tone === "accent"
      ? "var(--accent)"
      : tone === "ink"
        ? "var(--ink)"
        : "var(--ink-faint)";
  const metrics =
    size === "large"
      ? "px-6 py-3 text-[15px] tracking-[0.3em]"
      : size === "small"
        ? "px-2.5 py-1 text-[9px] tracking-[0.2em]"
        : "px-3.5 py-1.5 text-[10.5px] tracking-[0.24em]";
  return (
    <span
      className={`ds-stamp inline-block font-mono uppercase ${metrics} ${className}`}
      style={{
        color: colour,
        border: `2px solid ${colour}`,
        // Inner rule drawn with insets rather than a second element: an outer
        // 2px stroke, a gap of paper, then a 1px line. That is what a stamp die
        // actually looks like and it costs no extra DOM.
        boxShadow: `inset 0 0 0 2px var(--base-2), inset 0 0 0 3px ${colour}`,
        transform: `rotate(${angle}deg)`,
        opacity: 0.88,
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Exhibits
 * ------------------------------------------------------------------ */

/**
 * A numbered exhibit.
 *
 * The header is a reference number, a title, and a rule running out to the
 * source classification on the right. The plate sits inside a hairline frame
 * with a margin of paper around it, which is how a figure is mounted in a
 * document rather than bled to the edge of a spread.
 *
 * `working` marks the one exhibit in this file the reader can operate. A
 * reproduction and an instrument are different kinds of evidence and the
 * document says which it is holding, because a plate the reader has changed is
 * no longer the plate the finding was written against.
 */
export function Exhibit({
  n,
  title,
  caption,
  source,
  sourceNote,
  children,
  working = false,
  className = "",
}: {
  n: number;
  title: string;
  caption: ReactNode;
  source: SourceClass;
  sourceNote?: string;
  children: ReactNode;
  working?: boolean;
  className?: string;
}) {
  return (
    <figure className={`ds-exhibit ${className}`}>
      <div className="flex items-baseline gap-3">
        <span
          className="shrink-0 font-mono text-[10.5px] tracking-[0.24em] uppercase"
          style={{ color: "var(--accent)", fontWeight: 500 }}
        >
          {working ? "Working exhibit" : "Exhibit"} {String(n).padStart(2, "0")}
        </span>
        <span
          className="text-dim shrink-0 font-mono text-[10.5px] tracking-[0.18em] uppercase"
          style={{ color: "var(--ink-dim)" }}
        >
          {title}
        </span>
        <span
          className="ds-exhibit-rule mt-[-2px] min-w-4 flex-1 origin-left"
          style={{ height: 1, background: "var(--line)" }}
          aria-hidden
        />
        <span className="text-faint hidden shrink-0 font-mono text-[9px] tracking-[0.2em] uppercase sm:block">
          {SOURCE_LABEL[source]}
        </span>
      </div>

      <div
        className="mt-3 border p-2"
        style={{ borderColor: "var(--line)", background: "var(--base)" }}
      >
        {children}
      </div>

      <figcaption className="mt-2.5 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span
          className="max-w-[76ch] text-[12.5px] leading-[1.5]"
          style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}
        >
          {caption}
        </span>
        <span className="text-faint ml-auto shrink-0 font-mono text-[9px] tracking-[0.18em] uppercase">
          {sourceNote ?? SOURCE_LABEL[source]}
        </span>
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ *
 * Ruled data
 * ------------------------------------------------------------------ */

/**
 * A register: hairlines, tabular figures, no fill of any kind.
 *
 * This is the shape almost all of Dossier's data takes. There is no zebra
 * striping and no container, because a register in a real file is ruled paper
 * with entries written on it.
 */
export function Register({
  head,
  rows,
  align = [],
  width = [],
  caption,
  dense = false,
}: {
  head: ReactNode[];
  rows: { key: string; cells: ReactNode[]; mark?: boolean }[];
  align?: ("left" | "right")[];
  width?: (string | undefined)[];
  caption?: string;
  dense?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        {caption && (
          <caption className="text-faint pb-2 text-left font-mono text-[9.5px] tracking-[0.24em] uppercase">
            {caption}
          </caption>
        )}
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                scope="col"
                className="text-faint border-b pb-1.5 font-mono text-[9px] font-normal tracking-[0.18em] whitespace-nowrap uppercase"
                style={{
                  borderColor: "var(--ink-faint)",
                  textAlign: align[i] ?? "left",
                  width: width[i],
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((cell, j) => (
                <td
                  key={j}
                  className={`border-b align-top ${dense ? "py-1.5" : "py-2.5"} pr-4 text-[12.5px] last:pr-0`}
                  style={{
                    borderColor: "var(--line)",
                    textAlign: align[j] ?? "left",
                    fontFamily: "var(--font-body)",
                    // A marked row is the one the reader is meant to find, not
                    // a highlight: the ink changes, the paper does not.
                    color: r.mark ? "var(--accent)" : "var(--ink)",
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A label, a dotted leader, a value.
 *
 * The leader is the reason this is not a two-column table: it ties a label to a
 * value across a variable gap, which is what a filled-in form does, and it lets
 * the value column stay right-aligned without a grid.
 */
export function FieldRow({
  label,
  value,
  note,
  tone = "ink",
}: {
  label: string;
  value: ReactNode;
  note?: string;
  tone?: "ink" | "accent";
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-dim shrink-0 font-mono text-[9.5px] tracking-[0.18em] uppercase">
          {label}
        </span>
        <span
          className="min-w-4 flex-1 translate-y-[-0.24em] border-b border-dotted"
          style={{ borderColor: "var(--line)" }}
          aria-hidden
        />
        <span
          className="num shrink-0 text-right text-[13px]"
          style={{ color: tone === "accent" ? "var(--accent)" : "var(--ink)" }}
        >
          {value}
        </span>
      </div>
      {note && (
        <p
          className="text-faint mt-1 max-w-[62ch] text-[11.5px] leading-[1.45]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {note}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Marginalia
 * ------------------------------------------------------------------ */

/**
 * A note in the filing margin.
 *
 * On a narrow page there is no margin, so it falls inline with an oxide rule
 * down its left edge -- still visibly an annotation on the sheet rather than
 * another paragraph of the report.
 */
export function MarginNote({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <aside className="mb-5 border-l-2 pl-3 lg:border-l-0 lg:pl-0" style={{ borderColor: "var(--accent)" }}>
      {label && <Micro tone="accent">{label}</Micro>}
      <div
        className="mt-1.5 text-[11.5px] leading-[1.5]"
        style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}
      >
        {children}
      </div>
    </aside>
  );
}

/** A superscript reference into the footnote apparatus at the foot of a part. */
export function Ref({ n }: { n: number }) {
  return (
    <sup
      className="num ml-[1px] text-[9px]"
      style={{ color: "var(--accent)", verticalAlign: "super" }}
    >
      {n}
    </sup>
  );
}

export function Footnotes({ items }: { items: ReactNode[] }) {
  return (
    <div className="mt-2">
      <Rule weight="firm" className="mb-3 max-w-[22rem]" />
      <ol className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="num shrink-0 text-[10px]" style={{ color: "var(--accent)" }}>
              {i + 1}
            </span>
            <span
              className="max-w-[70ch] text-[11.5px] leading-[1.5]"
              style={{ fontFamily: "var(--font-body)", color: "var(--ink-faint)" }}
            >
              {item}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Redaction
 * ------------------------------------------------------------------ */

/**
 * A redaction bar that retracts.
 *
 * The one piece of theatre in this direction, and it is arguing something. The
 * system's ethical position is that what it produces is disclosed and open to
 * challenge -- a case file the subject can read, never a verdict handed down --
 * so the file opens by taking the bar off rather than by putting one on.
 *
 * The bar is only mounted when motion is allowed. Rendering it unconditionally
 * and animating it away would leave a reduced-motion reader with a permanently
 * blacked-out headline if the scope never ran, which is the one failure mode
 * this element cannot have. `useAnimeScope` already no-ops under reduced
 * motion, so the check has to happen at the markup level too.
 */
export function Redaction({
  children,
  delay = 260,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const root = useAnimeScope(() => {
    const bar = utils.$(`.ds-redact-${id}`);
    if (!bar.length) return;
    animate(bar, {
      // Retracts to the right rather than fading: ink is lifted off paper by
      // moving it, and a fade would read as a loading state.
      scaleX: [1, 0],
      duration: 720,
      delay,
      ease: "inOut(3)",
    });
  }, []);

  return (
    // The scope ref is typed for a div; this element is a span because it lives
    // inside a heading, where a div would be invalid markup.
    <span
      ref={root as unknown as RefObject<HTMLSpanElement>}
      className={`relative inline-block ${className}`}
    >
      {children}
      <span
        aria-hidden
        className={`ds-redact-${id} pointer-events-none absolute inset-x-[-0.16em] inset-y-[0.06em] origin-right`}
        style={{ background: "var(--ink)" }}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Facing columns
 * ------------------------------------------------------------------ */

/**
 * Two facing columns with a rule between them.
 *
 * Used for the claim and the answer to it. On a narrow page they stack, and the
 * second column keeps its own heading and its oxide rule so the counter-evidence
 * still reads as a reply to the claim immediately above it rather than as the
 * next block in a list.
 */
export function Facing({ children }: { children: ReactNode }) {
  return (
    <div className="ds-facing grid grid-cols-1 gap-x-8 gap-y-7 md:grid-cols-2">{children}</div>
  );
}

export function FacingColumn({
  label,
  tone = "ink",
  children,
  ruled = false,
}: {
  label: string;
  tone?: "ink" | "accent";
  children: ReactNode;
  ruled?: boolean;
}) {
  return (
    <div className={ruled ? "md:border-l md:pl-8" : ""} style={ruled ? { borderColor: "var(--line)" } : undefined}>
      <div
        className="mb-3 border-b pb-1.5"
        style={{ borderColor: tone === "accent" ? "var(--accent)" : "var(--ink-faint)" }}
      >
        <Micro tone={tone === "accent" ? "accent" : "ink"}>{label}</Micro>
      </div>
      {children}
    </div>
  );
}

/** A numbered clause in one of the facing columns. */
export function Clause({
  n,
  children,
  tone = "dim",
}: {
  n: number;
  children: ReactNode;
  tone?: "dim" | "accent";
}) {
  return (
    <li className="mb-3 flex gap-3">
      <span
        className="num mt-[2px] shrink-0 text-[10px]"
        style={{ color: tone === "accent" ? "var(--accent)" : "var(--ink-faint)" }}
      >
        {String(n).padStart(2, "0")}
      </span>
      <span
        className="text-[12.5px] leading-[1.55]"
        style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}
      >
        {children}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Score ledger
 * ------------------------------------------------------------------ */

/**
 * Six terms, their weights, their values and a ruled total.
 *
 * C4 forbids a bare total, so the total cannot be rendered without the terms:
 * they are one component and there is no prop that suppresses the rows. The
 * layout is a printed account -- labels left, figures right, a rule above the
 * sum -- because that is a form whose reader already knows the total is
 * supposed to be checkable against the lines above it.
 */
export function ScoreLedger({
  rows,
  total,
  totalLabel = "Total",
  ablatedTotal,
}: {
  rows: { key: string; label: string; value: number; weight: number; muted?: boolean }[];
  total: number;
  totalLabel?: string;
  ablatedTotal?: number;
}) {
  return (
    <div className="font-mono text-[11.5px]">
      <div className="text-faint flex items-baseline gap-3 pb-1.5 text-[9px] tracking-[0.18em] uppercase">
        <span className="flex-1">Term</span>
        <span className="w-[4.5ch] text-right">Wt</span>
        <span className="w-[4.5ch] text-right">Value</span>
      </div>
      <div style={{ height: 1, background: "var(--ink-faint)" }} aria-hidden />
      {rows.map((r) => (
        <div
          key={r.key}
          className="flex items-baseline gap-3 border-b py-[5px]"
          style={{ borderColor: "var(--line)" }}
        >
          <span
            className="flex-1 tracking-[0.1em] uppercase"
            style={{ color: r.muted ? "var(--ink-faint)" : "var(--ink)" }}
          >
            {r.label}
          </span>
          <span className="num text-faint w-[4.5ch] text-right text-[10.5px]">
            {r.weight.toFixed(2)}
          </span>
          <span
            className="num w-[4.5ch] text-right tabular-nums"
            style={{ color: r.muted ? "var(--ink-faint)" : "var(--ink)" }}
          >
            {r.value.toFixed(2)}
          </span>
        </div>
      ))}
      <div className="mt-2 flex items-baseline gap-3">
        <span className="flex-1" />
        <span className="w-[4.5ch]" />
        <span className="w-[4.5ch]" style={{ borderTop: "1px solid var(--ink)" }} />
      </div>
      <div className="flex items-baseline gap-3 pt-1">
        <span className="flex-1 tracking-[0.18em] uppercase" style={{ color: "var(--ink)" }}>
          {totalLabel}
        </span>
        <span className="w-[4.5ch]" />
        <span
          className="num w-[4.5ch] text-right text-[13px]"
          style={{ color: "var(--accent)", fontWeight: 500 }}
        >
          {total.toFixed(2)}
        </span>
      </div>
      {ablatedTotal !== undefined && (
        <div className="text-faint flex items-baseline gap-3 pt-1 text-[10px]">
          <span className="flex-1 tracking-[0.16em] uppercase">Without drift term</span>
          <span className="w-[4.5ch]" />
          <span className="num w-[4.5ch] text-right">{ablatedTotal.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Forms
 * ------------------------------------------------------------------ */

/**
 * A ruled choice list, drawn as the tick boxes on a filing form.
 *
 * Dossier has no dropdowns. A select element is application chrome; a case file
 * that offers a choice offers it as a printed list with a box beside each line.
 */
export function ChoiceRule<T extends string>({
  label,
  options,
  value,
  onChange,
  note,
}: {
  label: string;
  options: { id: T; name: string; detail?: string }[];
  value: T;
  onChange: (id: T) => void;
  note?: string;
}) {
  return (
    <fieldset>
      <legend className="text-faint mb-2 font-mono text-[9.5px] tracking-[0.24em] uppercase">
        {label}
      </legend>
      <div className="border-t" style={{ borderColor: "var(--ink-faint)" }}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              aria-pressed={on}
              className="flex w-full items-baseline gap-3 border-b py-2 text-left transition-colors"
              style={{ borderColor: "var(--line)" }}
            >
              <span
                className="num mt-[1px] shrink-0 text-[11px]"
                style={{ color: on ? "var(--accent)" : "var(--ink-faint)" }}
                aria-hidden
              >
                [{on ? "×" : " "}]
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block font-mono text-[10.5px] tracking-[0.14em] uppercase"
                  style={{ color: on ? "var(--ink)" : "var(--ink-dim)" }}
                >
                  {o.name}
                </span>
                {o.detail && (
                  <span
                    className="mt-0.5 block text-[11.5px] leading-[1.45]"
                    style={{ fontFamily: "var(--font-body)", color: "var(--ink-faint)" }}
                  >
                    {o.detail}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {note && (
        <p
          className="text-faint mt-2 max-w-[46ch] text-[11px] leading-[1.45]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {note}
        </p>
      )}
    </fieldset>
  );
}

/** A single tick box, for the plate-composition list on the working exhibit. */
export function TickBox({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className="flex items-baseline gap-2 py-[3px] text-left"
    >
      <span
        className="num text-[11px]"
        style={{ color: on ? "var(--accent)" : "var(--ink-faint)" }}
        aria-hidden
      >
        [{on ? "×" : " "}]
      </span>
      <span
        className="font-mono text-[9.5px] tracking-[0.16em] uppercase"
        style={{ color: on ? "var(--ink)" : "var(--ink-faint)" }}
      >
        {label}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Signature
 * ------------------------------------------------------------------ */

/**
 * The block at the foot of a finding.
 *
 * A real one would carry a signature. This one carries a ruled line and a
 * statement that nothing signed it, which is the honest form for a document
 * produced by a simulation: the apparatus of authority is drawn, and then the
 * authority is explicitly declined.
 */
export function SignatureBlock({
  rows,
  statement,
}: {
  rows: { label: string; value: string }[];
  statement: string;
}) {
  return (
    <div className="mt-8">
      <Rule weight="firm" />
      <dl className="mt-5 grid grid-cols-1 gap-x-10 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((r) => (
          <div key={r.label}>
            <dt>
              <Micro>{r.label}</Micro>
            </dt>
            <dd
              className="num mt-1.5 text-[12px]"
              style={{ color: "var(--ink)" }}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-8 max-w-[26rem]">
        <div style={{ height: 1, background: "var(--ink)" }} aria-hidden />
        <p
          className="text-faint mt-2 text-[11.5px] leading-[1.5]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {statement}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Case identity
 * ------------------------------------------------------------------ */

/**
 * The reference this file is filed under.
 *
 * Derived from the acquisition rather than authored, so it cannot drift out of
 * step with the case it names: year and day-of-year give a number that is
 * unique per scene and that a reader can check against the timestamp printed
 * three lines below it. Inventing a case number would be inventing the one
 * piece of metadata a case file is indexed by.
 */
export function caseRef(run: Run): {
  number: string;
  file: string;
  region: string;
} {
  const d = new Date(run.meta.acquiredAt);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const doy = Math.floor((run.meta.acquiredAt - start) / 86_400_000) + 1;
  const yy = String(d.getUTCFullYear()).slice(2);
  const gom = run.meta.region === "gulf-of-mexico";
  return {
    number: `${yy}-${String(doy).padStart(3, "0")}`,
    file: `SL/${gom ? "GOM" : "IND"}/${run.detection.sceneId}`,
    region: gom ? "Gulf of Mexico" : "Indian waters",
  };
}
