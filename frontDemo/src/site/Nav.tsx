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

import { prefersReducedMotion } from "../lib/motion";
import { REPO_URL } from "../theme";

export interface NavSection {
  id: string;
  label: string;
}

/**
 * Home, for the two `href="#/"` links on this bar.
 *
 * THE SCROLL IS CONDITIONED HERE BECAUSE CSS CANNOT REACH IT. `index.css`
 * carries a universal `scroll-behavior: auto !important` under
 * `prefers-reduced-motion: reduce`, and the obvious reading of that rule is
 * that it already covers every scroll on the project. It does not cover this
 * one, and the next person to look will assume it does and delete this.
 *
 * `scroll-behavior` is consulted only when the scroll itself asks for `auto`.
 * An explicit `behavior` in the options object *is* the used behaviour and
 * never consults the computed property at all. So a hard-coded `"smooth"` here
 * outruns that rule at `!important`, in any layer, at any specificity: the only
 * thing on the platform that can stop this glide is not asking for it, which is
 * what the branch below does.
 *
 * `"instant"` rather than `"auto"` for the reduced branch, for the same
 * mechanism pointed the other way. `"auto"` would defer to the computed
 * property -- which is `smooth`, from `html { scroll-behavior: smooth }`, and
 * becomes `auto` only because that media block overrides it. That would make
 * this guard correct today and silently wrong the day the CSS block is
 * narrowed, moved or out-specified, with the failure showing up here rather
 * than where it was caused. `"instant"` depends on nothing outside this
 * function. `App.tsx` already passes it on surface changes, and the project's
 * browser floor is set by Tailwind v4 (Safari 16.4, Chrome 111, Firefox 128),
 * comfortably past the 2022 releases that added the keyword -- which matters
 * because an unrecognised enum member in a dictionary is a TypeError, not a
 * graceful fallback.
 *
 * Conditioned, not dropped: a reader who asked for no motion still asked to go
 * home. There is no default scroll to fall back on either, because `#/` matches
 * no element's id and is not the empty fragment, so the browser's own
 * "scroll to the fragment" step does nothing for it.
 */
function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: prefersReducedMotion() ? "instant" : "smooth",
  });
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
      {/*
        The masthead is the one band on this page that is *not* held to `Page`'s
        measure, and it is deliberate. Inside it the wordmark sat 229px in from
        the edge of a 1512px viewport with 243px of nothing past the console
        key: the bar was crowded in the middle and empty at both ends at the
        same time. Full width gives the wordmark the corner it should have had
        and turns that crowding into the gap the sections needed. The rule under
        it already spanned the viewport -- only the contents were boxed -- so
        this aligns the two.

        Going full width was only half of it, though, because a full-width band
        with a 40px inset still starts its contents where a column would. The
        insets here are small and asymmetric, and both halves of that are on
        purpose.

        Small, because the wordmark's job is to hold the corner and 40px made it
        read as the first line of a column instead. Sixteen is comfortably under
        the ~21px of air the 60px bar leaves above and below the cap height, so
        the wordmark sits nearer its corner horizontally than vertically, which
        is what "flush" actually looks like. It is 16 and not 0 because Archivo
        carries only about a pixel of left side bearing on the `S` -- nothing
        like enough to stand in for an optical margin -- and a wordmark hard
        against the viewport edge stops reading as placed and starts reading as
        clipped. It does not change across breakpoints: the rule beneath it is
        full-bleed at every width, so the corner it is measured from never
        moves, and neither should it.

        Asymmetric, because the two ends of the bar are different kinds of
        object. The left end is a letterform, with side bearings and open
        counters; the right end is the console key, a filled block whose ink
        runs to its own boundary. Given the same number the block looks nearer
        the edge than the type does, so the block gets the extra eight.

        Between them this hands the bar 40px of width back at every size, which
        is the point -- see the note on the nav below for why width, and only
        width, is what buys separation here.
      */}
      <div className="w-full pl-4 pr-6">
        {/*
          Below `lg` this row is a different object, and it had never been
          examined as one. The section nav is `display: none` there, which means
          it is not a flex item at all -- no width, and no gap allocated for it,
          since gaps are only placed between items that exist. The row reduces
          to two clusters pinned to opposite ends with the whole remainder
          between them. There are two such bars rather than one, because six
          things change at `sm` in the same pixel.

          Below 640 the row is: the wordmark at 19px (95.8), `Repo` (33.6), and
          the console key in its short form -- "Console" rather than "Open
          console", `px-2.5` rather than `px-3`, 9.5px rather than 10.5 --
          at 86.9, joined by the `gap-3` setting of the actions cluster. `Home`
          and the colour swatch are both `hidden … sm:*`, so neither is present
          and neither costs a gap. With `pl-4 pr-6` and the row's own `gap-4`
          that is 284.3px, so this bar stops fitting *inside its own padding*
          at about 285. Every floor worth naming clears it: 320 leaves 36px of
          slack, 360 leaves 76, 375 leaves 91, 390 leaves 106, 414 leaves 130.

          285 is not where anything is lost, though, and the two numbers are
          worth keeping apart. Padding is not a floor: the row overflows its
          padding box before it overflows the viewport, and `pr-6` is spent
          first. Ink only leaves the screen below `pl-4 + 244.3 = 260.3px`.
          Measured at a 280px viewport the actions cluster ends at x=260.3,
          still 19.7px clear of the edge -- the bar is over its padding by four
          pixels there and has lost nothing. So 285 is the width to design to
          and 260 is the width that actually breaks, and no real device is
          near either.

          Both of the things that make it 285 are load-bearing, and each used to
          be described below as though it were the whole answer. Put `Home` back
          below `sm` and the row needs 329.9; put the long console label back
          instead and it needs 335.4; put both back and it needs 381.0. On a
          375px phone only the last of those overflows, and only by six pixels
          -- so at 375 you need one of the two mitigations and either alone is
          enough, which is not what either comment claimed. At 320 the
          arithmetic reverses and both are required, because 329.9 and 335.4
          overflow it on their own. 320 is the width these two decisions are
          actually for and the width they should be argued against; 375 never
          tested either of them.

          The margin matters more than the numbers suggest, because of how this
          bar fails. `body` is `overflow-x: clip` (see `index.css`, and the note
          there for why it is `clip` and not `hidden`), the row is a default
          `nowrap` flex, and both ends carry `shrink-0`. So a bar too narrow for
          its contents does not wrap to a second line -- the 60px height is
          safe at every width, and the only item holding an internal space, the
          long console label, carries `whitespace-nowrap` besides -- and it does
          not grow a scrollbar either. Below 260px it silently loses the right
          edge of the console key off the side of the viewport while
          `document.scrollWidth` goes on reporting the viewport width. A
          scrollWidth probe cannot see that failure at all -- it was checked
          with one at 375 and the check was measuring nothing. Only the
          arithmetic can, or a comparison of the cluster`s right edge against
          `clientWidth`, which is why both are written down here.

          Between 640 and 1023 the row is the wordmark at 23px (116) and the
          full actions cluster at `gap-4` -- `Home`, `Repo`, the swatch, the
          long console key, 271.2 together -- and nothing else. That is 427.2px
          of ink at every width in the band, so the clear space between the two
          clusters runs from 213px at 640 to 596px at 1023: a third of the bar
          at the bottom of the band, nearly three fifths of it at the top.

          That space is the thing this note exists to answer for, and it is
          right as it stands. It is not vacancy, it is the nav's slot standing
          empty. The bar keeps one skeleton at every width and populates the
          middle when there is room, and "room" is a hard number: six labels
          are 420px of glyph run, five `gap-4`s add 80, and with `Home` already
          dropped that wants 877.6px of viewport before it fits at all and
          about 910 before it has as much air on each side as the gap it sits
          in. Below that the slot cannot hold the thing it is for, and every
          other way of filling it is worse than leaving it open. A subset of the
          labels invents an editorial ranking this document does not have. A
          disclosure menu puts them behind a click and implies they are how the
          page is reached, when this is one document read by scrolling and every
          section arrives on its own whether or not the reader ever uses a link.
          Centring the wordmark, or holding the bar to the column measure below
          `lg`, gives up the corner -- and the corner is measured from a rule
          that is full-bleed at every width, so the wordmark's inset is the one
          value in this bar that must not move with the breakpoint. What is left
          is two anchors on a rule, identity at one end and the door out at the
          other, which is where the reader's hands already are.

          The step at 640 is large, and it is disclosed rather than smoothed.
          Six things fire together and all six push the same way: the wordmark
          grows 20, `Home` and its gap add 50, the swatch and its gap add 34,
          the surviving actions gap widens 4, and the console key adds 51
          between its label and its padding. Ink goes 268.3 -> 427.2 and the bar
          goes from 42% full to 67% full across one pixel. Neither side is near
          overflow and nobody who is not dragging a window edge will ever see
          it, so splitting it over a second breakpoint would buy a smoother
          resize at the price of a band that exists for nothing else.
        */}
        <div className="flex h-[60px] items-center gap-4">
          <a
            href="#/"
            onClick={scrollToTop}
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
          {/*
            `safe center` rather than plain centring. Between about 1024 and
            1150 the six section labels are wider than the space left over
            beside the wordmark and the console key, and this is a scroll
            container: `center` in an overflowing scroller pushes the first
            items off the *start* edge, where nothing can scroll back to them.
            `safe` centres while it fits and falls back to flex-start the moment
            it does not, which is also what an engine without the keyword does
            with the declaration -- the behaviour this bar had before.

            Read this before reaching for a bigger gap to cure crowding on this
            bar, because the obvious fix does nothing. `-mx-2` and `px-2` cancel
            exactly, so the nav's content box is the bar minus the wordmark, the
            actions and the two flex gaps; centring then splits what is left of
            it evenly. Compose the two and the air on each side of the label
            group is

                (bar width - wordmark - actions - labels) / 2

            with the flex gap gone from the expression entirely -- widen it and
            the centring slack gives back exactly what the gap took. Separation
            here is bought with width or not at all: a narrower inset, or one
            fewer control. Both of those are what changed.

            The gap does still set the floor. The formula holds down to the
            point where it would fall below the gap; there the slack is spent,
            `safe` clamps to flex-start, and everything past that is overflow.
            So "sep < gap" and "the bar has a scrollbar" are the same condition,
            which is the one worth checking when this is next touched.
          */}
          <nav
            /* `gap-4` at the large breakpoint, `gap-5` above it. This began as a
               fix: at exactly 1024 the six labels ran ten pixels past the space
               left over and the bar grew a scrollbar under them; four pixels off
               each of the five gaps buys twenty and the overflow went away,
               which is a better answer than hiding the scrollbar and keeping the
               overflow. Above `xl` there is room for the wider setting.

               That ten pixels is the only hard measurement this bar has ever
               produced, so the rest of the arithmetic around here is pinned to
               it rather than to a guess: it puts the wordmark and the full
               action cluster together at 402px, which is what the labels at
               their wider setting were ten pixels too fat to sit beside in 944.

               It no longer binds. The trimmed insets and the dropped `Home`
               below leave the labels about 100px of slack at 1024 where they
               used to have ten, so `gap-5` would now fit here too. `gap-4`
               stays because that 100px is headroom over an *estimate* -- the
               font metrics behind these numbers are computed, not measured --
               and headroom on this bar is worth more than four pixels of
               tracking, since the failure mode it protects against is a
               scrollbar appearing under the masthead. */
            className="-mx-2 hidden min-w-0 flex-1 items-center gap-4 overflow-x-auto px-2 lg:flex xl:gap-5"
            style={{ justifyContent: "safe center" }}
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
            {/* The wordmark already goes home, so this link is the one control
                on the bar that is purely redundant, and it is spent wherever
                the width is worth more than it is.

                Below `sm` it is spent for the narrowest phones, and for those
                only. It is not what saves a 375px bar: with `Home` present that
                bar still fits, with 45px to spare. At 320 it is half of what
                saves it, the console key's short label being the other half and
                neither being sufficient alone -- the arithmetic is in the note
                above this row. It is now also spent between `lg` and `xl`,
                which is the band where the section links appear and have the
                least room to appear in -- 1024 is the tightest the bar ever
                gets, and this link plus its gap is 50px of the roughly 130
                that separate a comfortable label group there from one sitting
                on the wordmark's shoulder. Above `xl` there is room for it
                again and the redundancy costs nothing, so it comes back.

                It does mean the link blinks out across one resize band. That is
                the honest trade and it is the right way round: the bar is read
                far more often than it is resized, and in that band the reader
                is being offered six section links whose spacing is the thing
                actually carrying meaning. */}
            <a
              href="#/"
              onClick={scrollToTop}
              className="text-faint hover:text-ink hidden font-mono text-[10.5px] tracking-[0.2em] uppercase transition-colors sm:inline lg:hidden xl:inline"
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
      </div>
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
          and the 51px the long label costs in text and padding is half of what
          keeps this key on a 320px bar. It is not what keeps it on a 375px one
          -- the long label fits there with 40px spare, because `Home` is
          already gone by then -- so 320 is the width to check this against.
          The note above the masthead row carries the rest of it. */}
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
