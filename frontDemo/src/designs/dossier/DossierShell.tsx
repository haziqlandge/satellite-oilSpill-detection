/**
 * DOSSIER -- a digital evidence archive.
 *
 * Not a dashboard and not a console. Everything here is organised around a
 * CASE: the file has a cover, a numbered index, seven parts, exhibits with
 * source classifications, marginal annotations, footnotes and a finding at the
 * back with a signature block. A reader browses it the way they would browse a
 * paper file, and each part is a real route so a particular sheet can be linked
 * to and returned to.
 *
 * Three decisions in this file are load-bearing.
 *
 *  - The index is a sticky contents rail on the left, never a top nav and never
 *    a command rail. A case file's navigation is its table of contents, and the
 *    Roman numerals are the navigation: the numeral you clicked in the rail is
 *    the numeral set at document scale in the margin when you arrive, which is
 *    how a paper file confirms you turned to the right place.
 *  - The case switcher lives in that rail rather than only on the cover. A
 *    reader four parts deep must be able to open a different case without
 *    walking back to the front, and one of the five cases -- the look-alike --
 *    is the only route to the insufficient-evidence finding, which is the
 *    single most important state this system has.
 *  - The cover opens by lifting a redaction bar off the headline. It is the one
 *    piece of theatre in the direction and it is arguing the project's ethical
 *    position: what this system produces is disclosed and open to challenge,
 *    never a verdict handed down. The file opens by taking the bar off.
 */

import { useEffect, useState } from "react";
import { animate, stagger, utils } from "animejs";

import { hrefFor, useSection } from "../../lib/hash";
import { ROMAN, dateline, stamp } from "../../lib/format";
import { useAnimeScope, useReducedMotion } from "../../lib/motion";
import { SCENARIOS, type ScenarioId } from "../../sim/scenarios";
import type { ShellProps } from "../registry";

import {
  Head,
  Leaf,
  Micro,
  Prose,
  Redaction,
  Rule,
  Sheet,
  Stamp,
  caseRef,
} from "./components";
import Incident from "./parts/Incident";
import SatelliteEvidence from "./parts/SatelliteEvidence";
import Reconstruction from "./parts/Reconstruction";
import TrafficRecord from "./parts/TrafficRecord";
import CandidateAnalysis from "./parts/CandidateAnalysis";
import Finding from "./parts/Finding";
import Limitations from "./parts/Limitations";

/**
 * The parts of the file.
 *
 * The vocabulary is a case file's. There is no "Overview", no "Dashboard" and
 * no "Analytics": a file has an incident, the evidence gathered on it, the
 * reconstruction done from that evidence, the record it was checked against,
 * the analysis, the finding, and the statement of what the finding cannot
 * support. Part I is the empty route so the cover is what a bare link opens.
 */
const PARTS = [
  { key: "", title: "Incident", brief: "What happened, where, and when" },
  { key: "satellite", title: "Satellite evidence", brief: "The acquisition and the geometry" },
  { key: "drift", title: "Drift reconstruction", brief: "Where the oil came from" },
  { key: "record", title: "Traffic record", brief: "Who was in the water" },
  { key: "candidates", title: "Candidate analysis", brief: "Scores, and the case against each" },
  { key: "finding", title: "Finding", brief: "What is issued, and what is not" },
  { key: "limitations", title: "Limitations", brief: "Where this stops being reliable" },
] as const;

/** Widened to plain strings: `useSection` compares against whatever the URL
 *  carries, and the literal union would make every lookup below a cast. */
const SECTIONS: readonly string[] = PARTS.map((p) => p.key);

/**
 * The reference a file in the series is filed under.
 *
 * Only ever derived from a run that was actually built -- see `CASE_INDEX`
 * below for why the rail cannot simply print all five.
 */
interface CaseIdentity {
  number: string;
  acquired: string;
  file: string;
}

/**
 * The identities of the files the reader has actually pulled.
 *
 * A case number and an acquisition date are derived from a run, and building a
 * run costs half a second, so the rail cannot print the reference of a case
 * nobody has opened yet without either lying or stalling. It records what it
 * has seen instead: the moment a file is pulled its reference is written here
 * and stays, so a reader who switches from one case to another sees the old
 * reference still sitting on the row they left and the new one on the row they
 * clicked. The contrast is the confirmation.
 *
 * Module scope rather than component state so it survives the shell being
 * unmounted and remounted by the direction switcher.
 */
const CASE_INDEX: Record<string, CaseIdentity> = {};

export default function DossierShell({ state }: ShellProps) {
  const [section, navigate] = useSection(SECTIONS, "");
  const { run } = state;
  const scenario = state.scenario;

  // Turning to a different sheet and pulling a different file both put the
  // reader at the front of what they are now reading. Keyed on the section
  // alone this left a reader who switched case exactly where they were --
  // frequently in blank space, because the next case's document is a different
  // length, and always far below the running head that was the only thing to
  // have changed.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [section, scenario]);

  const [known, setKnown] = useState<Record<string, CaseIdentity>>(CASE_INDEX);

  useEffect(() => {
    if (!run || CASE_INDEX[run.meta.id]) return;
    const r = caseRef(run);
    CASE_INDEX[run.meta.id] = {
      number: r.number,
      acquired: dateline(run.meta.acquiredAt),
      file: r.file,
    };
    setKnown({ ...CASE_INDEX });
  }, [run]);

  /**
   * The page turn.
   *
   * Keyed on the case rather than on the section, because the case is the
   * change the reader was not able to see. It is a settle, not a transition:
   * the sheet drops in from fourteen pixels over four hundred milliseconds, the
   * identity line in the running head comes down behind it, and an oxide rule
   * sweeps the foot of the head band and goes. A file being laid on the desk,
   * not a panel animating.
   *
   * Nothing here is primed to `opacity: 0`, and that is deliberate rather than
   * stylistic. Priming an element to invisible is a bet that a later frame will
   * put it back, and the target here is the entire document -- a tab opened in
   * the background, an animation frame that never arrives, an engine suspended
   * while the page was hidden, and the reader has a blank sheet with no error
   * anywhere to say why. Every property animated below is one whose worst case
   * is a fourteen-pixel offset or a hairline that never draws. `animate` also
   * sets its own from-value on the first tick, so no separate `utils.set` is
   * needed to prime and none is used.
   *
   * `useAnimeScope` sits the whole thing out under reduced motion, where the
   * swap is instantaneous and the running head is the confirmation.
   */
  const sheet = useAnimeScope(() => {
    animate(".ds-turn", {
      translateY: [14, 0],
      duration: 400,
      ease: "out(3)",
    });
    animate(".ds-refile", {
      translateY: [-3, 0],
      duration: 320,
      delay: stagger(55),
      ease: "out(2)",
    });
    animate(".ds-refile-rule", {
      scaleX: [0, 1],
      opacity: [1, 0],
      duration: 720,
      ease: "out(2)",
    });
  }, [run?.meta.id]);

  const index = Math.max(0, SECTIONS.indexOf(section));
  const ref = run ? caseRef(run) : null;
  // Read from the listing rather than from the run, so the head names the file
  // the reader just asked for during the half second the run takes to build.
  const listing = SCENARIOS.find((s) => s.id === scenario) ?? SCENARIOS[0];

  return (
    <div className="relative min-h-[100dvh]">
      <PaperTooth />

      <div className="mx-auto w-full max-w-[1560px] xl:grid xl:grid-cols-[14rem_minmax(0,1fr)] xl:gap-9 xl:px-8">
        <IndexRail
          active={section}
          onNavigate={navigate}
          scenario={scenario}
          onScenario={state.setScenario}
          caseNumber={ref?.number ?? null}
          known={known}
          loading={state.loading}
        />

        <div className="min-w-0">
          <Sheet>
            <div ref={sheet}>
              <RunningHead
                caseNumber={ref?.number ?? null}
                caseName={listing.name}
                file={ref?.file ?? null}
                part={index}
                acquiredAt={run?.meta.acquiredAt ?? null}
                insufficient={!!run?.drift.insufficientEvidence}
                loading={state.loading}
              />

              {/* The contents list on a narrow page. Collapsed by default: a
                  reader on a phone wants the sheet, not seven links, and a
                  <details> is the one disclosure control that works with no
                  script and announces itself correctly. */}
              <details className="border-b xl:hidden" style={{ borderColor: "var(--line)" }}>
                <summary className="cursor-pointer list-none px-5 py-3 sm:px-8">
                  <Micro tone="ink">Contents · Part {ROMAN[index]}</Micro>
                </summary>
                <div className="px-5 pb-5 sm:px-8">
                  <PartList active={section} onNavigate={navigate} />
                  <div className="mt-6">
                    <CaseList
                      scenario={scenario}
                      onScenario={state.setScenario}
                      known={known}
                      loading={state.loading}
                    />
                  </div>
                </div>
              </details>

              <div className="ds-turn">
                {section === "" && <Cover state={state} />}

                {!run || state.loading ? (
                  <Retrieving />
                ) : (
                  <>
                    {section === "" && <Incident state={state} />}
                    {section === "satellite" && <SatelliteEvidence state={state} />}
                    {section === "drift" && <Reconstruction state={state} />}
                    {section === "record" && <TrafficRecord state={state} />}
                    {section === "candidates" && <CandidateAnalysis state={state} />}
                    {section === "finding" && <Finding state={state} />}
                    {section === "limitations" && <Limitations state={state} />}
                    <Colophon
                      next={index < PARTS.length - 1 ? index + 1 : null}
                      onNavigate={navigate}
                    />
                  </>
                )}
              </div>
            </div>
          </Sheet>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The cover
 * ------------------------------------------------------------------ */

function Cover({ state }: ShellProps) {
  const { run } = state;
  const reduced = useReducedMotion();
  const ref = run ? caseRef(run) : null;

  const root = useAnimeScope(() => {
    // The stamp is pressed, not faded: it comes in slightly oversized and
    // settles. Scale lives on a wrapper rather than on the stamp itself,
    // because the stamp carries its own rotation as an inline transform and
    // anime composes transforms from scratch -- animating the element directly
    // would drop the tilt that makes it read as a stamp at all.
    utils.set(".ds-press", { opacity: 0 });
    animate(".ds-press", {
      opacity: [0, 1],
      scale: [1.14, 1],
      duration: 520,
      delay: 900,
      ease: "out(4)",
    });
    utils.set(".ds-cover-line", { opacity: 0 });
    animate(".ds-cover-line", {
      opacity: [0, 1],
      duration: 420,
      delay: stagger(70, { start: 1050 }),
      ease: "out(2)",
    });
  }, [run?.meta.id]);

  const insufficient = !!run?.drift.insufficientEvidence;

  return (
    <div ref={root}>
      <Leaf
        pad="loose"
        margin={
          <div>
            <Micro>Archive</Micro>
            <p
              className="mt-2 text-[11px] leading-[1.5]"
              style={{ fontFamily: "var(--font-body)", color: "var(--ink-faint)" }}
            >
              Slickline evidence archive. Detection, reconstruction and
              attribution, filed as one case per acquisition.
            </p>
          </div>
        }
      >
        <Rule weight="double" className="mb-7" />

        <Micro tone="accent">Case {ref?.number ?? "pending"}</Micro>

        <Head level={1} className="mt-4">
          {/* The bar sits over the two words that would be the accusation if
              this were one. Lifting it is the argument. */}
          {reduced ? (
            "Maritime pollution event"
          ) : (
            <>
              <Redaction>Maritime pollution</Redaction> event
            </>
          )}
        </Head>

        <div className="mt-7 flex flex-wrap items-center gap-5">
          <span className="ds-press inline-block">
            <Stamp tone={insufficient ? "ink" : "accent"} angle={-2.6}>
              Status · Under review
            </Stamp>
          </span>
          <span className="ds-press inline-block">
            <Stamp tone="faint" angle={2.1} size="small">
              Simulated throughout
            </Stamp>
          </span>
        </div>

        <div className="mt-9 grid max-w-[62rem] grid-cols-2 gap-x-8 gap-y-0 sm:grid-cols-3 lg:grid-cols-4">
          <CoverField label="Location" value={ref?.region ?? "—"} />
          <CoverField
            label="Acquired"
            value={run ? dateline(run.meta.acquiredAt) : "—"}
          />
          <CoverField
            label="Detection"
            value={
              run
                ? run.detection.className === "oos"
                  ? "Operational discharge"
                  : "Slick, origin unknown"
                : "—"
            }
          />
          <CoverField
            label="Origin"
            value={
              run
                ? run.drift.insufficientEvidence
                  ? "Field too diffuse"
                  : `${run.drift.ensembleSize}-member hindcast`
                : "—"
            }
          />
          <CoverField
            label="Candidates"
            value={run ? String(run.suspects.length) : "—"}
          />
          <CoverField
            label="Evidence"
            value={run ? `${run.aisPointCount.toLocaleString()} AIS reports` : "—"}
          />
          <CoverField
            label="Alternative hypotheses"
            value={
              run
                ? String(
                    run.suspects.filter((s) => s.kind !== "ais_vessel").length,
                  )
                : "—"
            }
          />
          <CoverField label="File" value={ref?.file ?? "—"} />
        </div>

        <Prose className="mt-9 ds-cover-line" size="lede">
          This file records a slick detected in synthetic-aperture radar, the
          backward drift reconstruction run from it, the historical traffic that
          reconstruction was checked against, and a scored list of candidate
          sources. Every figure in it carries a source classification. Nothing in
          it is a determination.
        </Prose>
      </Leaf>
    </div>
  );
}

function CoverField({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="ds-cover-line border-t py-3"
      style={{ borderColor: "var(--line)" }}
    >
      <Micro>{label}</Micro>
      <p
        className="num mt-1.5 text-[12.5px] leading-[1.35]"
        style={{ color: "var(--ink)" }}
      >
        {value}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Chrome
 * ------------------------------------------------------------------ */

/**
 * The band printed across the top of every sheet in the file.
 *
 * Sticky, because in a document whose parts are long the reference you need
 * most is which case you are reading and which sheet of it you are on. It was
 * sticky before and it still went unnoticed, because everything in it was set
 * at the same faint nine-and-a-half point and half of it -- the acquisition and
 * the scene -- was dropped below `md`. So the identity is now a line of its own
 * at reading size: the case number in oxide, the file's name beside it, the
 * acquisition date after that. The apparatus that does not change between cases
 * is demoted to the second line under it.
 *
 * The name is taken from the scenario listing rather than from the run, so it
 * changes on the click rather than half a second later when the ensemble
 * finishes building. Waiting for the run to answer is what made the click feel
 * like it had done nothing.
 */
function RunningHead({
  caseNumber,
  caseName,
  file,
  part,
  acquiredAt,
  insufficient,
  loading,
}: {
  caseNumber: string | null;
  caseName: string;
  file: string | null;
  part: number;
  acquiredAt: number | null;
  insufficient: boolean;
  loading: boolean;
}) {
  return (
    <div
      className="sticky top-0 z-20 border-b px-5 py-2 sm:px-8 lg:px-10"
      style={{ borderColor: "var(--ink-faint)", background: "var(--base-2)" }}
    >
      {/* The mark a file gets when it is re-filed. Rests at `scaleX(0)`, so a
          reader who never gets an animation frame is missing a hairline rather
          than looking at a stray rule. */}
      <span
        aria-hidden
        className="ds-refile-rule pointer-events-none absolute inset-x-0 bottom-0 block h-px"
        style={{
          background: "var(--accent)",
          transform: "scaleX(0)",
          transformOrigin: "left",
        }}
      />

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
        <span
          className="ds-refile num shrink-0 text-[12.5px] tracking-[0.06em]"
          style={{ color: "var(--accent)" }}
        >
          Case {caseNumber ?? "—"}
        </span>
        <span
          className="ds-refile min-w-0 text-[14px] leading-[1.25]"
          style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
        >
          {caseName}
        </span>
        <span
          className="ds-refile num text-[11px]"
          style={{ color: "var(--ink-dim)" }}
        >
          {acquiredAt ? dateline(acquiredAt) : "—"}
        </span>
        {insufficient && (
          <span
            className="ml-auto shrink-0 border px-1.5 py-[1px] font-mono text-[9px] tracking-[0.2em] uppercase"
            style={{ color: "var(--accent)", borderColor: "var(--accent)" }}
          >
            No attribution issued
          </span>
        )}
      </div>

      <div className="text-faint mt-0.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 font-mono text-[9px] tracking-[0.2em] uppercase">
        <span>
          Sheet {ROMAN[part]} of {ROMAN[PARTS.length - 1]}
        </span>
        <span className="hidden sm:inline">Maritime pollution event</span>
        {acquiredAt && <span className="num">{stamp(acquiredAt)}</span>}
        {loading && <span style={{ color: "var(--accent)" }}>Retrieving</span>}
        {/* The scene is the one identifier that is too long to set inline, and
            also the one a reader checks a sheet against, so it is kept on every
            width and truncated rather than dropped below a breakpoint. */}
        <span className="ds-refile ml-auto max-w-full min-w-0 truncate">
          {file ?? ""}
        </span>
      </div>
    </div>
  );
}

function IndexRail({
  active,
  onNavigate,
  scenario,
  onScenario,
  caseNumber,
  known,
  loading,
}: {
  active: string;
  onNavigate: (key: string) => void;
  scenario: ScenarioId;
  onScenario: (id: ScenarioId) => void;
  caseNumber: string | null;
  known: Record<string, CaseIdentity>;
  loading: boolean;
}) {
  return (
    <aside className="sticky top-0 hidden h-[100dvh] flex-col overflow-y-auto py-8 xl:flex">
      <Micro tone="accent">Case {caseNumber ?? "—"}</Micro>
      <p
        className="mt-2 mb-6 text-[11px] leading-[1.5]"
        style={{ fontFamily: "var(--font-body)", color: "var(--ink-faint)" }}
      >
        Contents of file
      </p>
      <PartList active={active} onNavigate={onNavigate} />
      <div className="mt-9">
        <CaseList
          scenario={scenario}
          onScenario={onScenario}
          known={known}
          loading={loading}
        />
      </div>
    </aside>
  );
}

/**
 * The index proper.
 *
 * A numeral, a title and a dotted leader out to nothing -- the leader is what
 * makes it read as a table of contents rather than as a list of links. The
 * active part is marked with an oxide rule down its left edge, which is the
 * mark someone makes on a file to say this is the sheet they are on.
 */
function PartList({
  active,
  onNavigate,
}: {
  active: string;
  onNavigate: (key: string) => void;
}) {
  return (
    <nav className="border-t" style={{ borderColor: "var(--ink-faint)" }}>
      {PARTS.map((p, i) => {
        const on = p.key === active;
        return (
          <a
            key={p.key || "incident"}
            href={hrefFor(p.key)}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(p.key);
            }}
            aria-current={on ? "page" : undefined}
            className="flex items-baseline gap-3 border-b py-2.5 pl-2 transition-colors"
            style={{
              borderColor: "var(--line)",
              borderLeft: `2px solid ${on ? "var(--accent)" : "transparent"}`,
            }}
          >
            <span
              className="num w-[2.5ch] shrink-0 text-[10px]"
              style={{ color: on ? "var(--accent)" : "var(--ink-faint)" }}
            >
              {ROMAN[i]}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block text-[13.5px] leading-[1.2]"
                style={{
                  fontFamily: "var(--font-display)",
                  color: on ? "var(--ink)" : "var(--ink-dim)",
                }}
              >
                {p.title}
              </span>
              <span
                className="mt-0.5 block text-[10.5px] leading-[1.35]"
                style={{ fontFamily: "var(--font-body)", color: "var(--ink-faint)" }}
              >
                {p.brief}
              </span>
            </span>
          </a>
        );
      })}
    </nav>
  );
}

/**
 * The other files in the series.
 *
 * In the rail rather than only on the cover, because the look-alike case is the
 * only route to the insufficient-evidence finding and a reader who has just
 * read a finding is exactly the reader who should be able to open the case
 * where no finding is issued.
 *
 * Each row carries the reference of the file it opens, once that file has been
 * pulled. A name and a one-line description are not an identity, and a rail
 * whose rows are interchangeable descriptions cannot confirm that a click did
 * anything: the reader's eye is here, so the change has to be legible here.
 * With the reference on the row, switching case rewrites the line under the
 * cursor and leaves the previous case's number sitting two rows up.
 */
function CaseList({
  scenario,
  onScenario,
  known,
  loading,
}: {
  scenario: ScenarioId;
  onScenario: (id: ScenarioId) => void;
  known: Record<string, CaseIdentity>;
  loading: boolean;
}) {
  return (
    <div>
      <Micro>Other files in this series</Micro>
      <div className="mt-2.5 border-t" style={{ borderColor: "var(--ink-faint)" }}>
        {SCENARIOS.map((s) => {
          const on = s.id === scenario;
          const id = known[s.id];
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onScenario(s.id)}
              aria-pressed={on}
              aria-label={
                id
                  ? `${s.name}. Case ${id.number}, acquired ${id.acquired}.`
                  : s.name
              }
              className="flex w-full items-baseline gap-2.5 border-b py-2.5 pl-2 text-left transition-colors"
              style={{
                borderColor: "var(--line)",
                borderLeft: `2px solid ${on ? "var(--accent)" : "transparent"}`,
                // The open file is tinted rather than boxed. A filing tab is a
                // wash of colour on the same paper, not a card lifted off it.
                background: on
                  ? "color-mix(in oklab, var(--accent) 8%, transparent)"
                  : "transparent",
              }}
            >
              <span
                className="num mt-[1px] shrink-0 text-[10px]"
                style={{ color: on ? "var(--accent)" : "var(--ink-faint)" }}
                aria-hidden
              >
                [{on ? "×" : " "}]
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block font-mono text-[9.5px] tracking-[0.14em] uppercase"
                  style={{ color: on ? "var(--ink)" : "var(--ink-dim)" }}
                >
                  {s.name}
                </span>
                <span
                  className="mt-0.5 block text-[10.5px] leading-[1.35]"
                  style={{ fontFamily: "var(--font-body)", color: "var(--ink-faint)" }}
                >
                  {s.short}
                </span>
                {/* A case number and an acquisition date are properties of a
                    built run, so a file nobody has opened has neither and says
                    so rather than showing a placeholder that looks like one. */}
                <span
                  className="mt-1 flex flex-wrap items-baseline gap-x-2.5 font-mono text-[9px] tracking-[0.12em] uppercase"
                  style={{ color: on ? "var(--accent)" : "var(--ink-faint)" }}
                >
                  {id ? (
                    <>
                      <span className="num">Case {id.number}</span>
                      <span className="num">{id.acquired}</span>
                    </>
                  ) : (
                    <span>{on && loading ? "Retrieving" : "Not yet pulled"}</span>
                  )}
                </span>
                {on && id && (
                  <span
                    className="mt-0.5 block truncate font-mono text-[8.5px] tracking-[0.08em]"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    {id.file}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The turn-the-page control at the foot of every part. */
function Colophon({
  next,
  onNavigate,
}: {
  next: number | null;
  onNavigate: (key: string) => void;
}) {
  return (
    <Leaf
      pad="loose"
      margin={<Micro>End of sheet</Micro>}
    >
      <Rule weight="firm" />
      {next !== null ? (
        <a
          href={hrefFor(PARTS[next].key)}
          onClick={(e) => {
            e.preventDefault();
            onNavigate(PARTS[next].key);
          }}
          className="mt-5 inline-flex items-baseline gap-4"
        >
          <span className="num text-[11px]" style={{ color: "var(--accent)" }}>
            {ROMAN[next]}
          </span>
          <span
            className="text-[clamp(1.2rem,2vw,1.7rem)] leading-[1.1]"
            style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
          >
            {PARTS[next].title}
          </span>
          <span className="text-faint font-mono text-[10px] tracking-[0.22em] uppercase">
            Continued
          </span>
        </a>
      ) : (
        <p
          className="mt-5 text-[13px]"
          style={{ fontFamily: "var(--font-body)", color: "var(--ink-faint)" }}
        >
          End of file. Nothing follows.
        </p>
      )}
    </Leaf>
  );
}

/** The state between one case being closed and the next being pulled. */
function Retrieving() {
  return (
    <Leaf pad="loose" margin={<Micro>Status</Micro>}>
      <Rule weight="firm" className="mb-6" />
      <Micro tone="accent">Retrieval in progress</Micro>
      <Head level={2} className="mt-3">
        Pulling the file
      </Head>
      <Prose className="mt-4">
        The ensemble, the traffic and every score on the sheets that follow are
        being generated now. Nothing is cached from the previous case.
      </Prose>
    </Leaf>
  );
}

/* ------------------------------------------------------------------ *
 * Texture
 * ------------------------------------------------------------------ */

/**
 * Paper tooth.
 *
 * Fixed and pointer-events-none so it never repaints on scroll -- grain inside
 * a scrolling container forces a full GPU repaint every frame, which is the
 * usual way a textured page becomes a page that stutters.
 *
 * `multiply` rather than the `soft-light` a dark direction would use: on a
 * light ground, multiply darkens the noise into the paper and reads as fibre,
 * while soft-light lifts it into a grey haze over the type.
 */
function PaperTooth() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 mix-blend-multiply"
      style={{ opacity: 0.055 }}
    >
      <svg className="h-full w-full">
        <filter id="dossier-tooth">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.92"
            numOctaves={4}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#dossier-tooth)" />
      </svg>
    </div>
  );
}
