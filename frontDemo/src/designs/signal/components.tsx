/**
 * Signal's component family. Editorial, not dashboard.
 *
 * There is no `Panel` here and there will not be one. A publication does not
 * put things in boxes; it sets them in a measure, rules them off, hangs notes in
 * the margin and numbers its exhibits. Everything below is one of those moves.
 *
 * The grid that most of these sit on is three columns -- a narrow left margin
 * carrying section numerals, a reading measure of about sixty-six characters,
 * and a right margin carrying notes and small figures. It is not a twelve
 * column layout with the gutters renamed. The measure is fixed in `ch` so the
 * line length stays readable no matter how wide the window gets, which is the
 * opposite of what a responsive card grid does.
 */

import type { CSSProperties, ReactNode } from "react";

/* ------------------------------------------------------------------ *
 * Structure
 * ------------------------------------------------------------------ */

export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1560px] px-5 sm:px-8 lg:px-12">{children}</div>;
}

/**
 * The editorial three-column spread.
 *
 * Below the large breakpoint it collapses to the measure alone and the
 * marginalia fall inline underneath the paragraph they annotate, which is how a
 * magazine handles a narrow page. It does not become a stack of cards.
 */
export function Spread({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-[7rem_minmax(0,66ch)_minmax(0,1fr)] ${className}`}
    >
      {children}
    </div>
  );
}

/** Slot helpers, so the call sites read as columns rather than as indices. */
export function Gutter({ children }: { children?: ReactNode }) {
  return <div className="lg:col-start-1">{children}</div>;
}

export function Measure({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`lg:col-start-2 ${className}`}>{children}</div>;
}

export function Margin({ children }: { children?: ReactNode }) {
  return (
    <div className="lg:col-start-3 lg:pt-1.5">
      <div className="lg:max-w-[26ch]">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Type
 * ------------------------------------------------------------------ */

/** The small mono line above a headline. */
export function Kicker({
  children,
  tone = "accent",
}: {
  children: ReactNode;
  tone?: "accent" | "dim";
}) {
  return (
    <p
      className="font-mono text-[10.5px] tracking-[0.3em] uppercase"
      style={{ color: tone === "accent" ? "var(--accent)" : "var(--ink-faint)" }}
    >
      {children}
    </p>
  );
}

/** Display type. Grotesk, tight, heavy: a headline, not a page title. */
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
      ? "text-[clamp(2.6rem,6.4vw,5.4rem)] leading-[0.92]"
      : level === 2
        ? "text-[clamp(1.9rem,3.6vw,3.1rem)] leading-[1.0]"
        : "text-[clamp(1.25rem,1.8vw,1.6rem)] leading-[1.12]";
  const Tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";

  return (
    <Tag
      className={`${size} ${className}`}
      style={{
        fontFamily: "var(--font-display)",
        fontWeight: level === 3 ? 600 : 700,
        letterSpacing: level === 1 ? "-0.035em" : "-0.025em",
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

/** Reading text. Serif, generous, set at a size a person would actually read. */
export function Body({
  children,
  size = "normal",
  className = "",
}: {
  children: ReactNode;
  size?: "normal" | "large" | "small";
  className?: string;
}) {
  const s =
    size === "large"
      ? "text-[19px] leading-[1.62]"
      : size === "small"
        ? "text-[15px] leading-[1.6]"
        : "text-[17px] leading-[1.68]";
  return (
    <p className={`text-dim ${s} ${className}`} style={{ fontFamily: "var(--font-body)" }}>
      {children}
    </p>
  );
}

/**
 * The opening paragraph, with a raised initial.
 *
 * A drop cap is doing a real job here: it marks where the reading starts, in a
 * composition whose first screen is mostly figure and metadata.
 */
export function Standfirst({ children }: { children: string }) {
  const text = children.trim();
  return (
    <p
      className="text-ink text-[21px] leading-[1.52]"
      style={{ fontFamily: "var(--font-body)" }}
    >
      <span
        className="text-accent float-left mt-[0.13em] mr-[0.09em] leading-[0.76]"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "3.9em",
          fontWeight: 700,
        }}
        aria-hidden
      >
        {text.charAt(0)}
      </span>
      {text.slice(1)}
    </p>
  );
}

/** A statistic set into running prose, at display size. */
export function Figure({
  value,
  unit,
}: {
  value: string;
  unit?: string;
}) {
  return (
    <span className="text-ink whitespace-nowrap">
      <span
        className="num text-[1.35em] tracking-tight"
        style={{ fontWeight: 500 }}
      >
        {value}
      </span>
      {unit && <span className="text-dim ml-1 text-[0.82em]">{unit}</span>}
    </span>
  );
}

export function PullQuote({
  children,
  attribution,
}: {
  children: ReactNode;
  attribution?: string;
}) {
  return (
    <blockquote className="py-3">
      <p
        className="text-ink text-[clamp(1.5rem,2.7vw,2.35rem)] leading-[1.15]"
        style={{ fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "-0.02em" }}
      >
        {children}
      </p>
      {attribution && (
        <footer className="text-faint mt-4 font-mono text-[10.5px] tracking-[0.2em] uppercase">
          {attribution}
        </footer>
      )}
    </blockquote>
  );
}

/** A note hung in the margin, tied to the paragraph beside it. */
export function Note({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <aside
      className="border-t pt-2.5"
      style={{ borderColor: "var(--line)" }}
    >
      {label && (
        <p className="text-accent mb-1.5 font-mono text-[9.5px] tracking-[0.22em] uppercase">
          {label}
        </p>
      )}
      <div
        className="text-dim text-[13.5px] leading-[1.55]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        {children}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ *
 * Section marks
 * ------------------------------------------------------------------ */

/**
 * A section opening: an oversized numeral hanging in the left margin, the
 * title on the measure, a hairline across the whole width.
 */
export function SectionMark({
  index,
  kicker,
  title,
  id,
}: {
  index: number;
  kicker: string;
  title: string;
  id?: string;
}) {
  return (
    <div id={id} className="sig-section scroll-mt-24">
      <div className="border-t pt-6" style={{ borderColor: "var(--ink-faint)" }} />
      <Spread className="pt-4 pb-10">
        <Gutter>
          <span
            className="text-faint block leading-[0.8] tabular-nums"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "clamp(3rem,5vw,4.6rem)",
            }}
            aria-hidden
          >
            {String(index).padStart(2, "0")}
          </span>
        </Gutter>
        <Measure>
          <Kicker>{kicker}</Kicker>
          <Head level={2} className="mt-3">
            {title}
          </Head>
        </Measure>
        <Margin />
      </Spread>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Exhibits
 * ------------------------------------------------------------------ */

/**
 * A figure with a numbered caption and a source line.
 *
 * Not a card. There is no border, no radius and no background: the figure sits
 * on the page and the caption hangs under its left edge in the way a printed
 * plate does. `bleed` lets it break the reading measure, which is the single
 * most editorial thing this layout does and the reason the hero does not look
 * like a hero section.
 */
export function Exhibit({
  n,
  caption,
  source,
  children,
  bleed = false,
  className = "",
}: {
  n: number;
  caption: ReactNode;
  source?: string;
  children: ReactNode;
  bleed?: boolean;
  className?: string;
}) {
  return (
    <figure
      className={className}
      style={
        bleed
          ? // Breaks the reading measure and the page padding both, out to the
            // full viewport. `overflow-x: hidden` on the body is what keeps
            // this from producing a horizontal scrollbar.
            { width: "100vw", marginLeft: "50%", transform: "translateX(-50%)" }
          : undefined
      }
    >
      {children}
      <figcaption
        className={`mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t pt-2.5 ${
          bleed ? "mx-auto max-w-[1560px] px-5 sm:px-8 lg:px-12" : ""
        }`}
        style={{ borderColor: "var(--line)" }}
      >
        <span className="text-accent shrink-0 font-mono text-[10px] tracking-[0.2em] uppercase">
          Fig. {String(n).padStart(2, "0")}
        </span>
        <span
          className="text-dim max-w-[62ch] text-[13px] leading-[1.5]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {caption}
        </span>
        {source && (
          <span className="text-faint ml-auto shrink-0 font-mono text-[9.5px] tracking-[0.16em] uppercase">
            {source}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ *
 * Data, set editorially
 * ------------------------------------------------------------------ */

/**
 * A ruled table.
 *
 * Hairlines between rows and nothing else -- no zebra fill, no container, no
 * radius. A newspaper table is rules and alignment.
 */
export function Ledger({
  head,
  rows,
  align = [],
}: {
  head: ReactNode[];
  rows: ReactNode[][];
  /** Per-column alignment. Numbers go right, always. */
  align?: ("left" | "right")[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                scope="col"
                className="text-faint border-b pb-2 font-mono text-[9.5px] font-normal tracking-[0.2em] whitespace-nowrap uppercase"
                style={{
                  borderColor: "var(--ink-faint)",
                  textAlign: align[i] ?? "left",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td
                  key={j}
                  className="text-ink border-b py-3 pr-5 align-top text-[14px] last:pr-0"
                  style={{
                    borderColor: "var(--line)",
                    textAlign: align[j] ?? "left",
                    fontFamily: "var(--font-body)",
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
 * A term and its value, drawn as a rule whose length is the value.
 *
 * Deliberately not a progress bar: no track behind it, no rounded ends, no fill
 * colour. It is a printed rule of measured length with the number set at the
 * end of it, which is how a broadsheet draws a comparison.
 */
export function ValueRule({
  label,
  value,
  weight,
  detail,
  emphasis = false,
}: {
  label: string;
  value: number;
  weight?: number;
  detail?: string;
  emphasis?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span
          className="w-[13ch] shrink-0 text-[13.5px]"
          style={{
            fontFamily: "var(--font-body)",
            color: emphasis ? "var(--accent)" : "var(--ink)",
          }}
        >
          {label}
        </span>
        <span className="relative h-[9px] min-w-0 flex-1">
          <span
            className="absolute top-1/2 left-0 h-px w-full"
            style={{ background: "var(--line)" }}
          />
          <span
            className="sig-value absolute top-1/2 left-0 h-[3px] -translate-y-[1px]"
            style={{
              width: `${pct}%`,
              background: emphasis ? "var(--accent)" : "var(--ink-dim)",
            }}
          />
        </span>
        <span className="num text-ink w-[4ch] shrink-0 text-right text-[13px]">
          {value.toFixed(2)}
        </span>
        {weight !== undefined && (
          <span className="num text-faint w-[5ch] shrink-0 text-right text-[11px]">
            ×{weight.toFixed(2)}
          </span>
        )}
      </div>
      {detail && (
        <p
          className="text-dim mt-1.5 ml-[calc(13ch+0.75rem)] max-w-[54ch] text-[12.5px] leading-[1.5]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {detail}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The finding this system must never bury
 * ------------------------------------------------------------------ */

/**
 * Insufficient evidence, set as an editor's note.
 *
 * C3 requires this to be prominent rather than an empty list. In a publication
 * the loudest available instrument is not a coloured box, it is a rule across
 * the measure and a line of display type, so that is what it gets.
 */
export function EditorsNote({
  reason,
  areaKm2,
}: {
  reason: string;
  areaKm2: number;
}) {
  return (
    <div
      className="border-y py-7"
      style={{ borderColor: "var(--accent)", borderWidth: "2px 0" }}
      role="status"
    >
      <Kicker>Finding</Kicker>
      <Head level={2} className="mt-3" style={{ color: "var(--accent)" }}>
        No attribution issued.
      </Head>
      <Body className="mt-4 max-w-[62ch]">{reason}</Body>
      <p className="num text-faint mt-3 text-[12px]">
        Tightest 90% origin contour {areaKm2.toFixed(0)} km²
      </p>
      <Body size="small" className="mt-4 max-w-[62ch]">
        The candidates below are printed so the reasoning stays open to
        challenge. None of them is a finding, and no vessel is being identified
        here.
      </Body>
    </div>
  );
}

/** A small mono tag. Used sparingly; a publication is not a tag cloud. */
export function Tag({
  children,
  tone = "dim",
}: {
  children: ReactNode;
  tone?: "accent" | "dim";
}) {
  return (
    <span
      className="inline-flex items-center font-mono text-[9.5px] tracking-[0.18em] uppercase"
      style={{
        color: tone === "accent" ? "var(--accent)" : "var(--ink-faint)",
        borderBottom: `1px solid ${tone === "accent" ? "var(--accent)" : "var(--line)"}`,
        paddingBottom: 1,
      }}
    >
      {children}
    </span>
  );
}
