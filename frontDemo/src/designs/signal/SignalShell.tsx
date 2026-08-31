/**
 * SIGNAL -- an investigative environmental intelligence publication.
 *
 * The shell is a masthead and three sections, which is the whole navigation
 * model: a publication does not have six tabs, it has a title and the parts of
 * an issue. The reading happens by scrolling, not by clicking between screens,
 * so the investigation itself is one long piece and the other two sections are
 * the index of open cases and the standards note.
 *
 * The masthead is deliberately thin. It carries the title, the sections and the
 * dateline of whatever case is open, and nothing else -- no scenario dropdown,
 * no layer toggles, no status chips. Controls belong to the operations
 * direction; this one is read.
 */

import { useEffect } from "react";
import { hrefFor, useSection } from "../../lib/hash";
import { dateline, stamp } from "../../lib/format";
import { scenarioListing } from "../../sim/scenarios";
import type { ShellProps } from "../registry";
import Investigation from "./Investigation";
import Detection from "./Detection";
import Hindcast from "./Hindcast";
import Attribution from "./Attribution";
import Cases from "./Cases";
import Standards from "./Standards";
import { Page } from "./components";

/**
 * The sections of an issue.
 *
 * The lead piece is the investigation and it is a genuine long-form read, but a
 * publication that covers one subject seriously does not stop at the piece: it
 * runs the supporting analysis alongside it. Those three sections are where the
 * reader can work the material rather than read it -- change the case, scrub
 * the event, take the drift term out of the score and watch the ranking move.
 *
 * The vocabulary is a publication's, not an application's. There is no
 * "Dashboard" and no "Console" here; Terminal has those and means them.
 */
const SECTIONS = [
  "",
  "picture",
  "water",
  "candidates",
  "cases",
  "method",
] as const;

const NAV: { key: string; label: string }[] = [
  { key: "", label: "The investigation" },
  { key: "picture", label: "The picture" },
  { key: "water", label: "The water" },
  { key: "candidates", label: "The candidates" },
  { key: "cases", label: "Cases" },
  { key: "method", label: "Method" },
];

export default function SignalShell({ state }: ShellProps) {
  const [section, navigate] = useSection(SECTIONS, "");
  const { run } = state;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [section]);

  return (
    <div className="relative min-h-[100dvh]">
      <Newsprint />

      <header
        className="sticky top-0 z-30 border-b backdrop-blur-md"
        style={{
          borderColor: "var(--ink-faint)",
          background: "color-mix(in oklab, var(--base) 90%, transparent)",
        }}
      >
        <Page>
          <div className="flex h-[58px] items-center justify-between gap-6">
            <a
              href={hrefFor("")}
              onClick={(e) => {
                e.preventDefault();
                navigate("");
              }}
              className="shrink-0"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                letterSpacing: "-0.03em",
                fontSize: 22,
              }}
            >
              Slickline
            </a>

            <nav className="-mx-2 flex min-w-0 flex-1 items-center gap-6 overflow-x-auto px-2">
              {NAV.map((n) => {
                const active = n.key === section;
                return (
                  <a
                    key={n.key}
                    href={hrefFor(n.key)}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(n.key);
                    }}
                    aria-current={active ? "page" : undefined}
                    className="shrink-0 pb-0.5 font-mono text-[11px] tracking-[0.22em] whitespace-nowrap uppercase transition-colors"
                    style={{
                      color: active ? "var(--ink)" : "var(--ink-faint)",
                      borderBottom: `1px solid ${active ? "var(--accent)" : "transparent"}`,
                    }}
                  >
                    {n.label}
                  </a>
                );
              })}
            </nav>

            <p className="text-faint hidden shrink-0 font-mono text-[10px] tracking-[0.22em] uppercase md:block">
              Simulated throughout
            </p>
          </div>
        </Page>
      </header>

      {/* The dateline. A publication states what it is looking at and when,
          above the fold, before anything else. */}
      {run && (
        <div className="border-b" style={{ borderColor: "var(--line)" }}>
          <Page>
            <div className="text-faint flex flex-wrap items-center gap-x-6 gap-y-1 py-2.5 font-mono text-[10px] tracking-[0.22em] uppercase">
              <span style={{ color: "var(--accent)" }}>
                {scenarioListing(state.scenario).name}
              </span>
              <span>
                {run.meta.region === "gulf-of-mexico"
                  ? "Gulf of Mexico"
                  : "Indian waters"}
              </span>
              <span>{dateline(run.meta.acquiredAt)}</span>
              <span className="hidden sm:inline">{stamp(run.meta.acquiredAt)}</span>
              <span className="ml-auto">{run.detection.sceneId}</span>
            </div>
          </Page>
        </div>
      )}

      {section === "" && <Investigation state={state} />}
      {section === "picture" && <Detection state={state} />}
      {section === "water" && <Hindcast state={state} />}
      {section === "candidates" && <Attribution state={state} />}
      {section === "cases" && <Cases state={state} onOpen={() => navigate("")} />}
      {section === "method" && <Standards />}
    </div>
  );
}

/**
 * Paper grain.
 *
 * Fixed and pointer-events-none, so it never repaints on scroll. Texture over a
 * scrolling container forces a GPU repaint every frame, which is the usual way
 * a page with grain on it becomes a page that stutters.
 */
function Newsprint() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 mix-blend-soft-light"
      style={{ opacity: 0.17 }}
    >
      <svg className="h-full w-full">
        <filter id="signal-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves={3}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#signal-grain)" />
      </svg>
    </div>
  );
}
