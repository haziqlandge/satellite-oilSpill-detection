/**
 * VI -- FINDING.
 *
 * The sheet the whole file is built to reach, and the one place in this
 * direction where the design is allowed to raise its voice.
 *
 * It always renders as a formal finding. Either it states a leading candidate
 * with its score, its basis, its reservations and the hypotheses that remain
 * open beside it -- or it states that the origin field is too diffuse to
 * separate the candidates and that no attribution is issued. The second state
 * is not an empty result and is not styled as one: it is a finding, it is
 * stamped, and it is the strongest thing this system can say when the evidence
 * does not support a name.
 *
 * Two rules the sheet cannot break. The language is candidate, suspected and
 * score, never responsible, confirmed or guilty. And the signature block is
 * drawn and then explicitly declined -- a finding produced by a simulation has
 * the apparatus of authority and none of the authority, and saying so on the
 * document is more honest than leaving the block off.
 */

import { KIND_LABEL, TERM_LABEL, dateline, stamp } from "../../../lib/format";
import { WEIGHTS_VERSION } from "../../../sim/scoring";
import { orderedSuspects } from "../../../useRun";
import type { ShellProps } from "../../registry";

import {
  Clause,
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
  Register,
  Rule,
  SignatureBlock,
  Stamp,
  caseRef,
} from "../components";

export default function Finding({ state }: ShellProps) {
  const { run } = state;
  if (!run) return null;

  const ref = caseRef(run);
  const diffuse = run.drift.insufficientEvidence;
  const rows = orderedSuspects(run, state.ablated);
  const top = rows[0] ?? null;
  // No candidate at all is the same finding as a field too diffuse to choose
  // between them, and it must never fall through to the candidate branch: the
  // scorer already sets insufficient evidence in that case, and this is the
  // guard that stops a future change to it printing a finding about nobody.
  const noFinding = !!diffuse || !top;
  const topTotal = top ? (state.ablated ? top.totalWithoutDrift : top.total) : 0;
  const margin =
    rows.length >= 2
      ? topTotal - (state.ablated ? rows[1].totalWithoutDrift : rows[1].total)
      : null;

  const supporting = top
    ? [...top.evidence.terms]
        .filter((t) => t.value >= 0.2)
        .sort((a, b) => b.value * b.weight - a.value * a.weight)
        .slice(0, 3)
    : [];

  return (
    <>
      <PartTitle
        numeral="VI"
        title="Finding"
        standfirst={`Issued on case ${ref.number}, on the evidence filed in Parts I to V of this document and on nothing else.`}
      />

      {/* ---------------------------------------------------------------- *
          The finding
       * ---------------------------------------------------------------- */}
      <Leaf
        pad="loose"
        margin={
          <div>
            <Micro>Status</Micro>
            <p
              className="mt-2 text-[11px] leading-[1.5]"
              style={{ fontFamily: "var(--font-body)", color: "var(--ink-faint)" }}
            >
              A finding on this file is a statement about the strength of
              evidence. It is not a determination of responsibility and it is not
              a referral.
            </p>
          </div>
        }
      >
        <div
          className="relative py-9"
          style={{ borderTop: "3px solid var(--ink)", borderBottom: "3px solid var(--ink)" }}
          role="status"
        >
          {/* The stamp overhangs the top rule, the way a stamp pressed onto a
              filed sheet sits across whatever was printed there. */}
          <div className="absolute -top-6 right-0 sm:right-4">
            <Stamp
              tone="accent"
              size={noFinding ? "large" : "normal"}
              angle={noFinding ? -5.4 : -3}
            >
              {noFinding ? "No attribution issued" : "Candidate only"}
            </Stamp>
          </div>

          <Micro tone="accent">Finding status</Micro>

          {noFinding ? (
            <>
              <Head level={1} className="mt-4" style={{ color: "var(--accent)" }}>
                Insufficient evidence
              </Head>
              <Prose className="mt-6" size="lede" tone="ink">
                The 90% origin region remains too diffuse to separate the
                candidate sources considered in Part V.
              </Prose>
              <Prose className="mt-4">
                {diffuse?.reason ??
                  "No candidate intersected the origin field anywhere inside the backward horizon, so there is nothing on this case to rank."}
              </Prose>

              <div className="mt-7 max-w-[34rem]">
                <FieldRow
                  label="Tightest 90% region"
                  value={diffuse ? `${diffuse.area90Km2.toFixed(0)} km²` : "—"}
                  tone="accent"
                />
                {/* The gate's own numbers, not the length of the list that
                    survived it. A finding that says "51 candidates considered"
                    when 51 is what was left after 258 tracks were filtered has
                    understated the filtering by a factor of five, and the
                    filtering is the part of this system that does the work. */}
                <FieldRow
                  label="Tracks considered"
                  value={run.gate.considered.toLocaleString()}
                />
                <FieldRow
                  label="Admitted by the gate"
                  value={String(run.gate.admitted)}
                />
                <FieldRow
                  label="Candidates scored"
                  value={String(run.suspects.length)}
                />
                <FieldRow label="Candidates named" value="None" tone="accent" />
              </div>

              <div className="mt-9">
                <Rule weight="double" className="max-w-[30rem]" />
                <p
                  className="mt-5 text-[clamp(1.3rem,2.4vw,2rem)] leading-[1.1]"
                  style={{
                    fontFamily: "var(--font-display)",
                    color: "var(--accent)",
                  }}
                >
                  No attribution issued.
                </p>
                <Prose className="mt-5">
                  This is the finding, not the absence of one. Reversing a
                  spreading process spreads it further, and past a certain age
                  the region an origin could lie in becomes wider than the
                  distance between the candidates in it. A system that produced a
                  ranked source anyway would be producing one on every case it
                  ever saw, which is the same as producing one on none of
                  them.
                </Prose>
              </div>
            </>
          ) : (
            <>
              <Head level={1} className="mt-4">
                Candidate identified
              </Head>
              <Prose className="mt-6" size="lede" tone="ink">
                On the evidence filed, the best-supported candidate source for the
                slick recorded in case {ref.number} is{" "}
                <span className="num" style={{ color: "var(--accent)" }}>
                  {top?.label}
                </span>
                , a {KIND_LABEL[top!.kind].toLowerCase()}, scoring{" "}
                <span className="num">{topTotal.toFixed(2)}</span> under weighting{" "}
                {WEIGHTS_VERSION}.
              </Prose>
              <Prose className="mt-4" tone="ink">
                This is a candidate. It is not a determination of responsibility,
                no party is identified by this file, and the alternative
                hypotheses below remain open.
              </Prose>

              <div className="mt-7 grid max-w-[46rem] grid-cols-1 gap-x-12 sm:grid-cols-2">
                <div>
                  <FieldRow label="Score" value={topTotal.toFixed(3)} tone="accent" />
                  <FieldRow
                    label="Margin to next"
                    value={margin === null ? "—" : margin.toFixed(3)}
                    note={
                      margin !== null && margin < 0.05
                        ? "A narrow margin. The two leading candidates are not well separated, and the second is reported here for that reason."
                        : "Reported, never targeted. The weighting was not adjusted to widen it."
                    }
                  />
                  <FieldRow
                    label="Formulation"
                    value={state.variant === "integral" ? "Integral" : "Maximum"}
                  />
                </div>
                <div>
                  <FieldRow
                    label="Gate multiplier"
                    value={`×${run.characterisation.windGateMultiplier.toFixed(2)}`}
                  />
                  <FieldRow
                    label="Rank without drift"
                    value={String(top?.rankWithoutDrift ?? "—")}
                    note={
                      top && top.rankWithoutDrift !== 1
                        ? "Removing the drift term costs this candidate the first rank. The finding rests on the term this project adds."
                        : "This candidate holds the first rank with or without the drift term."
                    }
                  />
                  <FieldRow label="Ablation applied" value={state.ablated ? "Yes" : "No"} />
                </div>
              </div>
            </>
          )}
        </div>
      </Leaf>

      {/* ---------------------------------------------------------------- *
          Basis and reservations
       * ---------------------------------------------------------------- */}
      {top && !noFinding && (
        <Leaf
          margin={
            <MarginNote label="Both columns">
              Built from the same evidence card. The reservations are not a
              disclaimer appended to the finding; they are the terms that scored
              weakest and the caveats the scorer emitted.
            </MarginNote>
          }
        >
          <Head level={3}>Basis of the finding</Head>
          <div className="mt-6">
            <Facing>
              <FacingColumn label="Supports the candidate">
                <ol>
                  {supporting.map((t, i) => (
                    <Clause key={t.key} n={i + 1}>
                      <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
                        {TERM_LABEL[t.key]} {t.value.toFixed(2)}.
                      </strong>{" "}
                      {t.detail}
                    </Clause>
                  ))}
                  {top.evidence.anomalies.map((a, i) => (
                    <Clause key={a.code} n={supporting.length + i + 1}>
                      <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
                        {a.label}.
                      </strong>{" "}
                      {a.detail}
                    </Clause>
                  ))}
                </ol>
              </FacingColumn>

              <FacingColumn label="Reservations on the finding" tone="accent" ruled>
                <ol>
                  {top.evidence.caveats.map((c, i) => (
                    <Clause key={c} n={i + 1} tone="accent">
                      {c}
                    </Clause>
                  ))}
                </ol>
              </FacingColumn>
            </Facing>
          </div>
        </Leaf>
      )}

      {/* ---------------------------------------------------------------- *
          Alternative hypotheses
       * ---------------------------------------------------------------- */}
      <Leaf
        margin={
          <MarginNote label="Kept on the sheet">
            Alternative hypotheses stay next to the leading candidate rather than
            in an appendix. A finding that prints only its own conclusion is not
            a finding a reader can argue with.
          </MarginNote>
        }
      >
        <Rule weight="firm" className="mb-6" />
        <Head level={3}>Hypotheses remaining open</Head>
        <Prose className="mt-3" size="small">
          Every candidate considered on this case, in the order Part V ranks them.
          Unlit contacts and fixed installations are listed on the same scale as
          transmitting vessels, because the point of scoring them together is that
          nothing in the code privileges one kind over another.
        </Prose>

        <div className="mt-5">
          <Register
            head={["#", "Candidate", "Kind", "Score", "Standing"]}
            align={["left", "left", "left", "right", "left"]}
            width={["3rem", "10rem", "9rem", "5rem", undefined]}
            rows={rows.map((s, i) => ({
              key: s.id,
              mark: i === 0 && !noFinding,
              cells: [
                <span className="num">{i + 1}</span>,
                <span className="num text-[11.5px]">{s.label}</span>,
                <span className="font-mono text-[9.5px] tracking-[0.14em] uppercase">
                  {KIND_LABEL[s.kind]}
                </span>,
                <span className="num">
                  {(state.ablated ? s.totalWithoutDrift : s.total).toFixed(2)}
                </span>,
                <span className="text-[11.5px] leading-[1.5]">
                  {noFinding
                    ? "Not separated from the others by the origin field."
                    : i === 0
                      ? "Best-supported candidate. Not a determination."
                      : s.kind === "dark_vessel"
                        ? "Ranked as a hypothesis. Carries no identity and is not resolvable to a vessel."
                        : s.kind === "infrastructure"
                          ? "Fixed installation. Leak and routine discharge are both plausible."
                          : "Considered and outranked. Remains open."}
                </span>,
              ],
            }))}
          />
        </div>
      </Leaf>

      {/* ---------------------------------------------------------------- *
          Signature
       * ---------------------------------------------------------------- */}
      <Leaf
        margin={
          <div className="mt-1">
            <Stamp tone="ink" size="small" angle={2.6}>
              Unsigned
            </Stamp>
          </div>
        }
      >
        <SignatureBlock
          rows={[
            { label: "Prepared by", value: "Slickline, automated" },
            {
              label: "Method",
              value: noFinding ? "Declined at reconstruction" : "Six-term collation",
            },
            { label: "Weighting", value: WEIGHTS_VERSION },
            { label: "Issued", value: dateline(run.meta.acquiredAt) },
          ]}
          statement="No signature. This finding was produced by a simulation of a system that has not been trained, on data generated for demonstration, and carries no authority of any kind. It is filed here to show the shape a finding would take, including the shape it takes when the evidence does not support one."
        />
      </Leaf>

      <Leaf pad="tight" margin={<Micro>Notes</Micro>}>
        <Footnotes
          items={[
            <>
              Acquisition {stamp(run.meta.acquiredAt)}, scene{" "}
              {run.detection.sceneId}, file {ref.file}. {run.meta.provenance}
            </>,
            <>
              The output of this system names specific vessels as suspected
              polluters, which carries real consequences for real crews and
              operators. Identities are masked throughout, no ranked candidate is
              presented as a determination, and the score breakdown and the
              caveats travel with every name.
            </>,
          ]}
        />
      </Leaf>
    </>
  );
}
