/**
 * "The candidates" -- the section where the project's claim is tested.
 *
 * The control at the top is the whole argument in one switch: score the same
 * candidates with the drift term removed and watch what moves. If nothing moves
 * on a given case, that is what the section shows, because a comparison that can
 * only come out one way is not a comparison.
 *
 * Every candidate gets a full evidence sheet, not just the leader. A ranking
 * that only publishes its winner has quietly decided the question it was asked.
 */

import { useMemo } from "react";
import { TERM_NOTE, TERM_ORIGIN } from "../../content";
import { KIND_LABEL, TERM_LABEL, TERM_ORDER, signed } from "../../lib/format";
import { PROXIMITY_LAMBDA_KM, WEIGHTS, WEIGHTS_VERSION } from "../../sim/scoring";
import { orderedSuspects, type RunState } from "../../useRun";
import { EvidenceSheet, AblationNote, WeightsNote } from "./EvidenceSheet";
import {
  Body,
  EditorsNote,
  Figure,
  Gutter,
  Head,
  Kicker,
  Ledger,
  Margin,
  Measure,
  Note,
  Page,
  SectionMark,
  Spread,
  Standfirst,
  Tag,
} from "./components";

export default function Attribution({ state }: { state: RunState }) {
  const { run, loading, ablated, selectedId, setSelectedId } = state;

  const suspects = useMemo(
    () => (run ? orderedSuspects(run, ablated) : []),
    [run, ablated],
  );

  if (loading || !run) {
    return (
      <Page>
        <div className="flex min-h-[60vh] items-center">
          <Kicker>Scoring</Kicker>
        </div>
      </Page>
    );
  }

  const selected =
    suspects.find((s) => s.id === selectedId) ?? suspects[0] ?? null;
  const truth = run.suspects.find((s) => s.isTruth) ?? null;
  const margin =
    suspects.length >= 2
      ? (ablated ? suspects[0].totalWithoutDrift : suspects[0].total) -
        (ablated ? suspects[1].totalWithoutDrift : suspects[1].total)
      : null;

  return (
    <div>
      <Page>
        <section className="pt-12 pb-8 lg:pt-16">
          <Kicker>Analysis · Attribution</Kicker>
          <Head level={1} className="mt-5 max-w-[17ch]">
            Who was there, and what says so.
          </Head>
        </section>

        <Spread className="pb-10">
          <Gutter />
          <Measure>
            <Standfirst>
              Historic traffic is filtered against the origin field first. What
              survives is scored on six terms and collated with infrastructure
              and unlit contacts onto a single scale, so a platform can outrank a
              passing tanker without any rule in the code saying that it should.
            </Standfirst>
          </Measure>
          <Margin>
            <Note label="The gate">
              {run.aisPointCount.toLocaleString()} reports ·{" "}
              {run.vessels.length} tracks ·{" "}
              {run.suspects.filter((s) => s.kind === "ais_vessel").length}{" "}
              admitted. One physically motivated filter removes the overwhelming
              majority of traffic in a single step.
            </Note>
          </Margin>
        </Spread>

        {run.drift.insufficientEvidence && (
          <Spread className="pb-12">
            <Gutter />
            <Measure>
              <EditorsNote
                reason={run.drift.insufficientEvidence.reason}
                areaKm2={run.drift.insufficientEvidence.area90Km2}
              />
            </Measure>
            <Margin />
          </Spread>
        )}
      </Page>

      {/* The ablation */}
      <Page>
        <SectionMark
          index={1}
          kicker="The test"
          title="Take the drift term away"
        />

        <Spread className="pb-14">
          <Gutter />
          <Measure>
            <div
              className="mb-7 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t pt-4"
              style={{ borderColor: "var(--ink-faint)" }}
            >
              <span className="text-faint font-mono text-[10px] tracking-[0.22em] uppercase">
                Scoring
              </span>
              {[
                { on: false, label: "All six terms" },
                { on: true, label: "S_drift removed" },
              ].map((opt) => {
                const active = opt.on === ablated;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => state.setAblated(opt.on)}
                    aria-pressed={active}
                    className="pb-0.5 font-mono text-[11px] tracking-[0.22em] uppercase transition-colors"
                    style={{
                      color: active ? "var(--accent)" : "var(--ink-faint)",
                      borderBottom: `1px solid ${active ? "var(--accent)" : "transparent"}`,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <Body>
              The operational reference system substitutes slick geometry as a
              proxy for transport. The paper this work builds on did the AIS
              cross-check by hand, per case, and named reverse-trajectory
              simulation as future work. Conditioning the gate and the score on a
              physical backward-drift field is the difference — so the honest way
              to present it is to remove the term and publish what happens,
              including the cases where nothing happens.
            </Body>

            {truth ? (
              <div className="mt-8">
                <Ledger
                  head={["The authored source", "Value"]}
                  align={["left", "right"]}
                  rows={[
                    [
                      "Identity",
                      <span className="num text-[14px]">{truth.label}</span>,
                    ],
                    [
                      "Kind",
                      <span className="text-dim text-[13.5px]">
                        {KIND_LABEL[truth.kind]}
                      </span>,
                    ],
                    [
                      "Rank, six terms",
                      <span
                        className="num text-[15px]"
                        style={{
                          color: truth.rank === 1 ? "var(--accent)" : "var(--ink)",
                        }}
                      >
                        #{truth.rank}
                      </span>,
                    ],
                    [
                      "Rank, without S_drift",
                      <span
                        className="num text-[15px]"
                        style={{
                          color:
                            truth.rankWithoutDrift !== truth.rank
                              ? "var(--accent)"
                              : "var(--ink)",
                        }}
                      >
                        #{truth.rankWithoutDrift}
                      </span>,
                    ],
                    [
                      "Score change",
                      <span className="num text-[15px]">
                        {signed(truth.totalWithoutDrift - truth.total)}
                      </span>,
                    ],
                    [
                      "Separability margin",
                      <span className="num text-[15px]">
                        {margin === null ? "n/a" : margin.toFixed(3)}
                      </span>,
                    ],
                  ]}
                />
                <Body size="small" className="mt-4">
                  {truth.rankWithoutDrift === truth.rank
                    ? "The rank holds on this case without the drift term. Other terms carried it, and that is reported rather than quietly dropped — a term that only ever helps is a term nobody tested."
                    : `Without the drift term the authored source falls ${
                        truth.rankWithoutDrift - truth.rank
                      } place${truth.rankWithoutDrift - truth.rank === 1 ? "" : "s"}. That movement is the contribution this project claims, on this case.`}
                </Body>
              </div>
            ) : (
              <Body className="mt-8">
                This scene has no authored source. Nobody released anything, so
                there is no rank to compare and the ablation has nothing to move.
                That is the point of running it.
              </Body>
            )}
          </Measure>
          <Margin>
            <WeightsNote />
            <div className="mt-6">
              <Note label="Weights version">
                <span className="num text-ink">{WEIGHTS_VERSION}</span>
              </Note>
            </div>
            <div className="mt-6">
              <Note label="No accuracy figure">
                Three published cases cannot support one. Per-case outcomes and
                the separability margin are what get reported.
              </Note>
            </div>
          </Margin>
        </Spread>
      </Page>

      {/* The list */}
      <Page>
        <SectionMark
          index={2}
          kicker={`${suspects.length} candidates`}
          title="Everything that survived the gate"
        />

        <Spread className="pb-14">
          <Gutter />
          <Measure className="lg:col-span-2 lg:col-start-2">
            <Ledger
              head={["", "Candidate", "Kind", "Score", "Without S_drift", ""]}
              align={["right", "left", "left", "right", "right", "left"]}
              rows={suspects.map((s) => [
                <span className="num text-accent text-[13px]">
                  {String(ablated ? s.rankWithoutDrift : s.rank).padStart(2, "0")}
                </span>,
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className="text-left"
                >
                  <span
                    className="num text-[14px] transition-colors"
                    style={{
                      color:
                        s.id === selected?.id ? "var(--accent)" : "var(--ink)",
                    }}
                  >
                    {s.label}
                  </span>
                  <span className="text-dim block text-[12.5px] leading-snug">
                    {s.detail}
                  </span>
                </button>,
                <span className="text-dim text-[12.5px]">
                  {KIND_LABEL[s.kind]}
                </span>,
                <span className="num text-[15px]">{s.total.toFixed(3)}</span>,
                <span className="num text-dim text-[13px]">
                  {s.totalWithoutDrift.toFixed(3)}
                </span>,
                s.isTruth ? <Tag>authored</Tag> : null,
              ])}
            />
            <Body size="small" className="mt-4">
              Choose any row to read its evidence below. Unlit contacts and fixed
              infrastructure are in the same list, on the same scale, because a
              ranking that shows only vessels has assumed the answer.
            </Body>
          </Measure>
        </Spread>
      </Page>

      {/* The sheet */}
      {selected && (
        <Page>
          <SectionMark index={3} kicker="Evidence" title="The case, and the case against" />
          <Spread className="pb-16">
            <Gutter />
            <Measure>
              <EvidenceSheet suspect={selected} />
            </Measure>
            <Margin>
              <AblationNote suspect={selected} />
              <div className="mt-6">
                <Note label="Read the geometry">
                  Each term carries the geometry that produced it. Drift
                  agreement is the track integrated through the origin field at
                  matching times; proximity is measured from the slick head, not
                  its centroid.
                </Note>
              </div>
            </Margin>
          </Spread>
        </Page>
      )}

      {/* The terms */}
      <Page>
        <SectionMark index={4} kicker="Method" title="The six terms" />

        <Spread className="pb-20">
          <Gutter />
          <Measure>
            <Body size="large">
              Five of these come from an operationally validated reference
              system. One is{" "}
              <Figure value="ours" />, and it is the one the section above takes
              away.
            </Body>
            <div className="mt-8 flex flex-col">
              {TERM_ORDER.map((k) => (
                <div
                  key={k}
                  className="border-t py-6"
                  style={{ borderColor: "var(--line)" }}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <Head level={3}>{TERM_LABEL[k]}</Head>
                    <div className="flex items-center gap-4">
                      <Tag
                        tone={
                          TERM_ORIGIN[k] === "This project" ? "accent" : "dim"
                        }
                      >
                        {TERM_ORIGIN[k]}
                      </Tag>
                      <span className="num text-ink text-[15px]">
                        ×{WEIGHTS[k].toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <Body size="small" className="mt-2.5">
                    {TERM_NOTE[k]}
                  </Body>
                </div>
              ))}
            </div>
          </Measure>
          <Margin>
            <Note label="Proximity decay">
              exp(−d/{PROXIMITY_LAMBDA_KM.toFixed(1)} km), taken from the
              reference implementation rather than chosen here.
            </Note>
          </Margin>
        </Spread>
      </Page>
    </div>
  );
}
