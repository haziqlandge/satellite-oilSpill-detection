/**
 * V -- CANDIDATE ANALYSIS.
 *
 * Every candidate gets an exhibit, and every exhibit is the same size.
 *
 * That uniformity is the argument of the sheet. A leaderboard makes the
 * top-ranked entry the subject and the rest a tail; a case file gives each
 * hypothesis its own numbered exhibit, at the same scale, with the same
 * apparatus. Unlit contacts and fixed installations are filed exactly as
 * vessels are, because the alternative hypotheses have to stay visible next to
 * the leading one rather than collapse into a footnote under it.
 *
 * Each exhibit carries the score decomposed into its six named terms with their
 * weights (C4 -- a bare total is not a permitted output), and then two facing
 * columns: what the evidence supports, and what argues against it. The second
 * column is not a disclaimer. It is built from the same data as the first: the
 * caveats the scorer emitted and the terms that scored weakest.
 */

import { useMemo } from "react";

import {
  KIND_LABEL,
  TERM_LABEL,
  TERM_ORDER,
  TERM_SHORT,
} from "../../../lib/format";
import { orderedSuspects } from "../../../useRun";
import {
  PROXIMITY_LAMBDA_KM,
  WEIGHTS,
  WEIGHTS_VERSION,
  type DriftVariant,
} from "../../../sim/scoring";
import { TERM_NOTE, TERM_ORIGIN } from "../../../content";
import type { Suspect } from "../../../sim/types";
import type { ShellProps } from "../../registry";

import {
  ChoiceRule,
  Clause,
  Exhibit,
  Facing,
  FacingColumn,
  FieldRow,
  Footnotes,
  Head,
  Leaf,
  MarginNote,
  Micro,
  PartTitle,
  Prose,
  Ref,
  Register,
  Rule,
  ScoreLedger,
  Stamp,
  TickBox,
} from "../components";
import { FlagSeries } from "../plates";

const VARIANTS: { id: DriftVariant; name: string; detail: string }[] = [
  {
    id: "integral",
    name: "Integral",
    detail:
      "Peak field agreement scaled by how long the track stayed inside the field. Rewards a candidate that lingered, which is what a berthed discharge looks like.",
  },
  {
    id: "max",
    name: "Maximum",
    detail:
      "The single best moment on the track. Rewards a candidate that passed through the high-probability region, which is what a moving discharge looks like.",
  },
];

export default function CandidateAnalysis({ state }: ShellProps) {
  const { run } = state;

  const rows = useMemo(
    () => (run ? orderedSuspects(run, state.ablated) : []),
    [run, state.ablated],
  );

  if (!run) return null;

  const diffuse = run.drift.insufficientEvidence;
  const ablatedTop = [...run.suspects].sort(
    (a, b) => a.rankWithoutDrift - b.rankWithoutDrift,
  )[0];
  const separability =
    rows.length >= 2
      ? Math.abs(
          (state.ablated ? rows[0].totalWithoutDrift : rows[0].total) -
            (state.ablated ? rows[1].totalWithoutDrift : rows[1].total),
        )
      : null;

  return (
    <>
      <PartTitle
        numeral="V"
        title="Candidate analysis"
        standfirst="Six weighted terms, collated so that vessels, unlit contacts and fixed installations compete on one scale. Each candidate is filed as its own exhibit with the working printed. None of them is a determination."
      />

      {diffuse && (
        <Leaf
          margin={
            <div className="mt-1">
              <Stamp tone="accent" angle={-4}>
                Not decisive
              </Stamp>
            </div>
          }
        >
          <div
            className="border-y py-6"
            style={{ borderColor: "var(--accent)", borderWidth: "2px 0" }}
            role="status"
          >
            <Micro tone="accent">Read this first</Micro>
            <Prose className="mt-3" tone="ink">
              The origin field in this case does not separate these candidates.
              The exhibits below are still printed in full, because the reasoning
              has to stay open to challenge and suppressing it would hide the
              basis of the finding. They are not a ranking of suspicion, and Part
              VI issues no attribution.
            </Prose>
          </div>
        </Leaf>
      )}

      {/* ---------------------------------------------------------------- *
          Settings
       * ---------------------------------------------------------------- */}
      <Leaf
        margin={
          <MarginNote label="Weights">
            Hand-set from the term definitions and printed, never fitted. Three
            ground-truth cases cannot support fitting six weights, and a weight
            fitted to make a fixture pass is not evidence of anything.
          </MarginNote>
        }
      >
        <Head level={3}>Analytical settings</Head>
        <Prose className="mt-3" size="small">
          Both settings below change the analysis, not its presentation. They are
          on the sheet because the claims this project makes are claims about the
          drift term, and a claim about a term is only checkable if the term can
          be taken out.
        </Prose>

        <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div>
            <ChoiceRule
              label="Drift term formulation"
              options={VARIANTS}
              value={state.variant}
              onChange={state.setVariant}
              note="Both are computed for every candidate. The choice is exposed so the difference between them is visible rather than asserted."
            />

            <div className="mt-7">
              <Micro tone="ink">Term ablation</Micro>
              <div className="mt-2 border-t" style={{ borderColor: "var(--line)" }}>
                <TickBox
                  on={state.ablated}
                  label="Recompute without the drift term"
                  onChange={state.setAblated}
                />
              </div>
              <p
                className="text-faint mt-2 max-w-[34ch] text-[11px] leading-[1.45]"
                style={{ fontFamily: "var(--font-body)" }}
              >
                Nothing else changes, so what moves in the ranking is exactly the
                contribution of the one term nothing in the reviewed literature
                computes.
              </p>
            </div>
          </div>

          <div>
            <Micro tone="ink" className="mb-3">
              Weighting, version {WEIGHTS_VERSION}
            </Micro>
            <Register
              head={["Term", "Weight", "Origin", "What it measures"]}
              align={["left", "right", "left", "left"]}
              width={["8rem", "4.5rem", "7rem", undefined]}
              dense
              rows={TERM_ORDER.map((k) => ({
                key: k,
                mark: k === "drift",
                cells: [
                  <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase">
                    {TERM_LABEL[k]}
                  </span>,
                  <span className="num">{WEIGHTS[k].toFixed(2)}</span>,
                  <span className="font-mono text-[10px] tracking-[0.1em] uppercase">
                    {TERM_ORIGIN[k]}
                  </span>,
                  <span className="text-[11.5px] leading-[1.5]">{TERM_NOTE[k]}</span>,
                ],
              }))}
            />
            <p
              className="text-faint mt-3 text-[11px] leading-[1.45]"
              style={{ fontFamily: "var(--font-body)" }}
            >
              Proximity decays as exp(−d / {PROXIMITY_LAMBDA_KM.toFixed(1)} km).
              Every total on this sheet is additionally multiplied by the wind
              gate from Part II, ×
              {run.characterisation.windGateMultiplier.toFixed(2)} for this
              case.<Ref n={1} />
            </p>
          </div>
        </div>
      </Leaf>

      {/* ---------------------------------------------------------------- *
          The matrix
       * ---------------------------------------------------------------- */}
      <Leaf
        margin={
          <MarginNote label="Exhibit 10">
            All candidates on one scale. A platform outranks a passing tanker
            here when it should, and no rule in the code says so — the terms do
            it.
          </MarginNote>
        }
      >
        <Exhibit
          n={10}
          title="Score matrix"
          source="model"
          caption={
            <>
              Every candidate against every term. The rightmost column is the
              rank the same candidate takes when the drift term is removed and
              the remaining five are recombined; a candidate whose two ranks
              differ is a candidate the drift term is carrying.
              {separability !== null && (
                <>
                  {" "}
                  The margin between the first and second entries is{" "}
                  {separability.toFixed(3)}.
                </>
              )}
            </>
          }
        >
          <div className="p-2">
            <Register
              head={[
                "#",
                "Candidate",
                "Kind",
                ...TERM_ORDER.map((k) => TERM_SHORT[k]),
                "Total",
                "Rank −drift",
              ]}
              align={[
                "left",
                "left",
                "left",
                "right",
                "right",
                "right",
                "right",
                "right",
                "right",
                "right",
                "right",
              ]}
              dense
              rows={rows.map((s, i) => ({
                key: s.id,
                mark: i === 0,
                cells: [
                  <span className="num">{i + 1}</span>,
                  <span className="num text-[11.5px]">{s.label}</span>,
                  <span className="font-mono text-[9.5px] tracking-[0.14em] uppercase">
                    {KIND_LABEL[s.kind]}
                  </span>,
                  ...TERM_ORDER.map((k) => (
                    <span className="num">{s.terms[k].toFixed(2)}</span>
                  )),
                  <span className="num" style={{ fontWeight: 500 }}>
                    {(state.ablated ? s.totalWithoutDrift : s.total).toFixed(2)}
                  </span>,
                  <span className="num text-faint">{s.rankWithoutDrift}</span>,
                ],
              }))}
            />
          </div>
        </Exhibit>

        {ablatedTop && ablatedTop.id !== run.suspects[0]?.id && (
          <Prose className="mt-5" tone="ink">
            With the drift term removed the first-ranked candidate changes from{" "}
            {run.suspects[0]?.label} to {ablatedTop.label}. That is the ablation
            this project exists to make checkable, and it is reported here whether
            or not it flatters the method.
          </Prose>
        )}
      </Leaf>

      {/* ---------------------------------------------------------------- *
          One exhibit per candidate
       * ---------------------------------------------------------------- */}
      {rows.map((s, i) => (
        <CandidateExhibit
          key={s.id}
          n={11 + i}
          rank={i + 1}
          suspect={s}
          ablated={state.ablated}
          selected={state.selectedId === s.id}
          onCite={() => state.setSelectedId(s.id)}
        />
      ))}

      <Leaf pad="tight" margin={<Micro>Notes</Micro>}>
        <Footnotes
          items={[
            <>
              The gate multiplier scales every candidate equally, so it cannot
              reorder a ranking. What it does is state how much confidence the
              whole detection carries, which is a different question from which
              candidate is best supported.
            </>,
            <>
              No score on these sheets is a measurement. No model has been trained
              yet, and the language in this file is candidate, suspected and
              score throughout.
            </>,
          ]}
        />
      </Leaf>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * One candidate
 * ------------------------------------------------------------------ */

function CandidateExhibit({
  n,
  rank,
  suspect,
  ablated,
  selected,
  onCite,
}: {
  n: number;
  rank: number;
  suspect: Suspect;
  ablated: boolean;
  selected: boolean;
  onCite: () => void;
}) {
  const terms = suspect.evidence.terms;

  // What supports the candidate: the terms carrying the most weighted score,
  // stated in the words the scorer produced rather than paraphrased here. A
  // paraphrase in the interface is a second, unversioned explanation of the
  // model, and the two drift apart.
  const supporting = [...terms]
    .filter((t) => t.value >= 0.2)
    .sort((a, b) => b.value * b.weight - a.value * a.weight)
    .slice(0, 3);

  // What argues against it: the terms that scored weakest, and the caveats the
  // scorer emitted for this candidate. Both come from the same evidence card as
  // the column beside them.
  const weakest = [...terms].sort((a, b) => a.value - b.value).slice(0, 2);

  return (
    <Leaf
      margin={
        <div>
          <Micro tone={rank === 1 ? "accent" : "faint"}>Exhibit {String(n).padStart(2, "0")}</Micro>
          <p
            className="num mt-2 text-[11px]"
            style={{ color: "var(--ink-dim)" }}
          >
            Rank {rank}
            {ablated ? " (ablated)" : ""}
          </p>
          <div className="mt-3">
            <Stamp
              tone={suspect.kind === "ais_vessel" ? "faint" : "ink"}
              size="small"
              angle={rank % 2 === 0 ? 2.2 : -2.6}
            >
              {KIND_LABEL[suspect.kind]}
            </Stamp>
          </div>
          {suspect.kind === "dark_vessel" && (
            <p
              className="mt-3 text-[11px] leading-[1.45]"
              style={{ fontFamily: "var(--font-body)", color: "var(--ink-faint)" }}
            >
              Ranked, never named. A radar contact with no association carries no
              identity and is not resolvable to a vessel.
            </p>
          )}
        </div>
      }
    >
      <Rule weight="firm" className="mb-6" />

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <Micro tone="ink">Candidate</Micro>
        <h3
          className="num text-[clamp(1.15rem,2vw,1.55rem)]"
          style={{ color: "var(--ink)", letterSpacing: "0.02em" }}
        >
          {suspect.label}
        </h3>
        <span
          className="text-[12px]"
          style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}
        >
          {suspect.detail}
        </span>
        <button
          type="button"
          onClick={onCite}
          aria-pressed={selected}
          className="ml-auto font-mono text-[9.5px] tracking-[0.2em] uppercase"
          style={{
            color: selected ? "var(--accent)" : "var(--ink-faint)",
            borderBottom: `1px solid ${selected ? "var(--accent)" : "var(--line)"}`,
          }}
        >
          {selected ? "Cited on the working exhibit" : "Cite on the working exhibit"}
        </button>
      </div>

      <div className="mt-7 grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div>
          <ScoreLedger
            rows={TERM_ORDER.map((k) => ({
              key: k,
              label: TERM_LABEL[k],
              value: suspect.terms[k],
              weight: suspect.weights[k],
              muted: suspect.terms[k] < 0.05,
            }))}
            total={ablated ? suspect.totalWithoutDrift : suspect.total}
            totalLabel={ablated ? "Total, no drift" : "Total"}
            ablatedTotal={ablated ? undefined : suspect.totalWithoutDrift}
          />
          <p
            className="text-faint mt-4 max-w-[32ch] text-[11px] leading-[1.45]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            The total is the weighted sum of the six lines above it, scaled by the
            wind gate. It is never printed anywhere in this system without them.
          </p>
        </div>

        <div>
          <Facing>
            <FacingColumn label="What the evidence supports">
              <ol>
                {supporting.map((t, i) => (
                  <Clause key={t.key} n={i + 1}>
                    <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
                      {TERM_LABEL[t.key]} {t.value.toFixed(2)}.
                    </strong>{" "}
                    {t.detail}
                  </Clause>
                ))}
                {suspect.evidence.anomalies.map((a, i) => (
                  <Clause key={a.code} n={supporting.length + i + 1}>
                    <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
                      {a.label}.
                    </strong>{" "}
                    {a.detail}
                  </Clause>
                ))}
                {supporting.length === 0 &&
                  suspect.evidence.anomalies.length === 0 && (
                    <Clause n={1}>
                      No term on this candidate reaches a value worth stating. It
                      is filed so the list of what was considered is complete.
                    </Clause>
                  )}
              </ol>
            </FacingColumn>

            <FacingColumn label="Counter-evidence" tone="accent" ruled>
              <ol>
                {weakest.map((t, i) => (
                  <Clause key={t.key} n={i + 1} tone="accent">
                    <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
                      {TERM_LABEL[t.key]} {t.value.toFixed(2)}.
                    </strong>{" "}
                    {t.detail}
                  </Clause>
                ))}
                {suspect.evidence.caveats.map((c, i) => (
                  <Clause key={c} n={weakest.length + i + 1} tone="accent">
                    {c}
                  </Clause>
                ))}
              </ol>
            </FacingColumn>
          </Facing>

          {suspect.evidence.anomalies.some((a) => a.series.length > 1) && (
            <div className="mt-8">
              <Micro tone="ink">Series behind the behavioural flags</Micro>
              <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
                {suspect.evidence.anomalies
                  .filter((a) => a.series.length > 1)
                  .map((a) => (
                    <FlagSeries
                      key={a.code}
                      series={a.series}
                      label={`${a.label} · ${a.seriesLabel}`}
                    />
                  ))}
              </div>
              <p
                className="text-faint mt-3 max-w-[56ch] text-[11px] leading-[1.45]"
                style={{ fontFamily: "var(--font-body)" }}
              >
                A flag with no series behind it is an assertion rather than
                evidence, so every flag that raised one prints it. A reception gap
                is normalised against the density the region actually supports
                before it counts at all.
              </p>
            </div>
          )}

          <div className="mt-7 max-w-[30rem]">
            <FieldRow
              label="Origin window"
              value={`${Math.round(
                (suspect.evidence.originWindow[1] -
                  suspect.evidence.originWindow[0]) /
                  3600_000,
              )} h`}
              note="The span of the backward run this candidate was tested against."
            />
            <FieldRow
              label="Weighting"
              value={WEIGHTS_VERSION}
            />
          </div>
        </div>
      </div>
    </Leaf>
  );
}
