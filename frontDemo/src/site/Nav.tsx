/**
 * The masthead.
 *
 * Signal's, kept: sticky, one hairline rule under it, backdrop blur, and the
 * title set in the display face at a size that outranks everything beside it.
 * A publication states what it is before it states what is in it.
 *
 * The one addition is the console key on the right. It is the only filled
 * control anywhere on the home page, and it is filled in `--cta` rather than
 * `--accent`: the page already uses the accent for slick geometry, section
 * marks and the top-ranked candidate, so a filled button in the same ink would
 * read as one more highlight rather than as the door out of the document.
 *
 * The glow and the scale are small on purpose -- 2% and a soft bloom. A button
 * that jumps on hover reads as a toy; one that swells slightly reads as
 * something with a mechanism behind it.
 */

import { REPO_URL } from "../theme";
import { Page } from "./components";

export interface NavSection {
  id: string;
  label: string;
}

export function Nav({
  sections,
  active,
  onPalette,
}: {
  sections: NavSection[];
  /** Section currently under the reader, from the scroll spy. */
  active: string | null;
  /** Opens the colour panel. Omitted, the key is not rendered. */
  onPalette?: () => void;
}) {
  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur-md"
      style={{
        borderColor: "var(--line)",
        background: "color-mix(in oklab, var(--base) 88%, transparent)",
      }}
    >
      <Page>
        <div className="flex h-[60px] items-center gap-4">
          <a
            href="#/"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="text-ink shrink-0 text-[19px] sm:text-[23px]"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
            }}
          >
            SlickTrace
          </a>

          {/* The sections of the page, not routes. This is one document and the
              links move you within it. */}
          <nav
            className="-mx-2 hidden min-w-0 flex-1 items-center gap-5 overflow-x-auto px-2 lg:flex"
            aria-label="Sections"
          >
            {sections.map((s) => {
              const on = s.id === active;
              return (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  aria-current={on ? "location" : undefined}
                  className="shrink-0 pb-0.5 font-mono text-[10.5px] tracking-[0.2em] whitespace-nowrap uppercase transition-colors"
                  style={{
                    color: on ? "var(--ink)" : "var(--ink-faint)",
                    borderBottom: `1px solid ${on ? "var(--accent)" : "transparent"}`,
                  }}
                >
                  {s.label}
                </a>
              );
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-3 sm:gap-4 lg:ml-0">
            {/* The wordmark already goes home, so on a narrow bar this link is
                the one thing here that is purely redundant -- and dropping it is
                what stops the console key being pushed off the right edge. */}
            <a
              href="#/"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="text-faint hover:text-ink hidden font-mono text-[10.5px] tracking-[0.2em] uppercase transition-colors sm:inline"
            >
              Home
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="text-faint hover:text-ink font-mono text-[10.5px] tracking-[0.2em] uppercase transition-colors"
            >
              Repo
            </a>
            {/* The colour panel. A swatch rather than a word, because it is a
                tool for looking at the page rather than part of reading it, and
                it should not compete with the section links for width. */}
            {onPalette && (
              <button
                type="button"
                onClick={onPalette}
                title="Colour panel"
                aria-label="Open the colour panel"
                className="hidden h-[18px] w-[18px] shrink-0 cursor-pointer border transition-colors sm:block"
                style={{
                  borderColor: "var(--ink-faint)",
                  background:
                    "linear-gradient(135deg, var(--accent) 0 50%, var(--ink-dim) 50% 100%)",
                }}
              />
            )}
            <ConsoleKey />
          </div>
        </div>
      </Page>
    </header>
  );
}

/**
 * The way into the console.
 *
 * Rendered as an anchor rather than a button because it navigates, and a
 * keyboard or middle-click user should get the behaviour they expect from
 * something that changes what surface they are on.
 */
export function ConsoleKey({ large = false }: { large?: boolean }) {
  return (
    <a
      href="#/console"
      className={`group text-cta-ink relative inline-flex shrink-0 items-center gap-2 font-mono tracking-[0.18em] whitespace-nowrap uppercase transition-[transform,box-shadow,filter] duration-200 ease-out hover:scale-[1.02] hover:brightness-[1.06] focus-visible:scale-[1.02] ${
        large
          ? "px-4 py-2.5 text-[11px] sm:px-5 sm:py-3 sm:text-[12px]"
          : "px-2.5 py-[6px] text-[9.5px] sm:px-3 sm:py-[7px] sm:text-[10.5px]"
      }`}
      style={{
        background: "var(--cta)",
        color: "var(--cta-ink)",
        boxShadow: "0 0 0 0 color-mix(in oklab, var(--cta) 55%, transparent)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow =
          "0 0 22px -2px color-mix(in oklab, var(--cta) 62%, transparent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow =
          "0 0 0 0 color-mix(in oklab, var(--cta) 55%, transparent)";
      }}
    >
      {/* "Console" alone on a phone: the verb is what the arrow already says,
          and the full label is what pushes this key off a 375px bar. */}
      <span className="hidden sm:inline">Open console</span>
      <span className="sm:hidden">Console</span>
      <span
        className="transition-transform duration-200 ease-out group-hover:translate-x-[2px]"
        aria-hidden
      >
        →
      </span>
    </a>
  );
}
