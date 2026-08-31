/**
 * Method and standards.
 *
 * A publication's note on how the work was done and what it will not claim.
 * Set as a piece rather than as a spec sheet: the pipeline runs as a numbered
 * editorial sequence, the comparison against the prior art is a ruled table,
 * and the six scoring terms are annotated with where each one came from.
 */

import {
  revealOnScroll,
  useAnimeScope,
} from "../../lib/motion";
import {
  COMPARISON,
  PROVENANCE,
  PUBLISHED,
  SIMULATED,
  STAGES,
  TERM_NOTE,
  TERM_ORIGIN,
} from "../../content";
import { TERM_LABEL, TERM_ORDER } from "../../lib/format";
import { PROXIMITY_LAMBDA_KM, WEIGHTS, WEIGHTS_VERSION } from "../../sim/scoring";
import {
  Body,
  Gutter,
  Head,
  Kicker,
  Ledger,
  Margin,
  Measure,
  Note,
  Page,
  PullQuote,
  SectionMark,
  Spread,
  Standfirst,
  Tag,
} from "./components";

export default function Standards() {
  const root = useAnimeScope(() => {
    return revealOnScroll(".std-reveal", { y: 24, delay: 70 });
  }, []);

  return (
    <div ref={root}>
      <Page>
        <section className="pt-14 pb-10 lg:pt-20">
          <Kicker>Method</Kicker>
          <Head level={1} className="mt-5 max-w-[16ch]">
            How it was done, and what it refuses to say.
          </Head>
        </section>

        <Spread className="pb-16">
          <Gutter />
          <Measure>
            <Standfirst>
              Anything can claim to find polluters. What separates a usable
              system from a confident one is a written account of where it stops
              being certain, and this note carries that account in the same
              weight of type as the claims.
            </Standfirst>
          </Measure>
          <Margin>
            <Note label="Position">
              The output of this system is an accusation of an environmental
              crime. Opacity is not an acceptable artefact.
            </Note>
          </Margin>
        </Spread>
      </Page>

      {/* Pipeline */}
      <Page>
        <SectionMark index={1} kicker="Pipeline" title="Six stages, each of which writes down what it produced" />

        <Spread className="pb-20">
          <Gutter />
          <Measure>
            <ol className="flex flex-col">
              {STAGES.map((s, i) => (
                <li
                  key={s.key}
                  className="std-reveal grid grid-cols-[3rem_minmax(0,1fr)] gap-x-6 border-t py-7"
                  style={{ borderColor: "var(--line)" }}
                >
                  <span className="num text-accent text-[13px]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <Head level={3}>{s.name}</Head>
                    <Body size="small" className="mt-2.5">
                      {s.body}
                    </Body>
                  </div>
                </li>
              ))}
            </ol>
          </Measure>
          <Margin>
            <Note label="Read the order">
              Nothing expensive runs while anyone is watching. The pipeline is
              batch; the interface reads results that already exist.
            </Note>
          </Margin>
        </Spread>
      </Page>

      {/* The six terms */}
      <Page>
        <SectionMark
          index={2}
          kicker="Scoring"
          title="Six terms, and where each of them came from"
        />

        <Spread className="pb-16">
          <Gutter />
          <Measure>
            <div className="flex flex-col">
              {TERM_ORDER.map((k) => (
                <div
                  key={k}
                  className="std-reveal border-t py-6"
                  style={{ borderColor: "var(--line)" }}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <Head level={3}>{TERM_LABEL[k]}</Head>
                    <div className="flex items-center gap-4">
                      <Tag tone={TERM_ORIGIN[k] === "This project" ? "accent" : "dim"}>
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
            <Note label="Weights">
              <span className="num text-ink">{WEIGHTS_VERSION}</span>. Hand-set
              and version stamped, never fitted. Three published cases cannot
              support fitting six weights, so sensitivity is reported instead of
              an accuracy figure.
            </Note>
            <div className="mt-6">
              <Note label="Proximity decay">
                exp(−d/{PROXIMITY_LAMBDA_KM.toFixed(1)} km), taken from the
                operational reference implementation rather than chosen here.
              </Note>
            </div>
          </Margin>
        </Spread>

        <Spread className="pb-20">
          <Gutter />
          <Measure>
            <PullQuote attribution="The gap this project closes">
              No system in the reviewed literature conditions vessel attribution
              on a physical backward-drift field.
            </PullQuote>
            <Body className="mt-6">
              The operational reference system substitutes slick geometry as a
              proxy for transport. The paper this builds on did the AIS
              cross-check by hand, per case, and named reverse-trajectory
              simulation as future work. Conditioning the gate on the drift field
              is the difference, which is why the interface lets you take the
              term away and watch the ranking move rather than asserting that it
              matters.
            </Body>
          </Measure>
          <Margin />
        </Spread>
      </Page>

      {/* Prior art */}
      <Page>
        <SectionMark index={3} kicker="Prior art" title="Against what already exists" />

        <Spread className="pb-20">
          <Gutter />
          <Measure className="lg:col-span-2 lg:col-start-2">
            <Ledger
              head={["System", "Detection", "Backward drift", "AIS attribution", "Explainable"]}
              rows={COMPARISON.map((c) => [
                <span
                  className="text-[14px]"
                  style={{ color: c.ours ? "var(--accent)" : "var(--ink)" }}
                >
                  {c.system}
                </span>,
                <span className="text-dim text-[13px]">{c.detect}</span>,
                <span className="text-dim text-[13px]">{c.drift}</span>,
                <span className="text-dim text-[13px]">{c.ais}</span>,
                <span className="text-dim text-[13px]">{c.explain}</span>,
              ])}
            />
          </Measure>
        </Spread>
      </Page>

      {/* Provenance */}
      <Page>
        <SectionMark
          index={4}
          kicker="Provenance"
          title="What is real here, and what is not"
        />

        <Spread className="pb-24">
          <Gutter />
          <Measure>
            <Body size="large">{PROVENANCE.full}</Body>

            <div className="mt-10 grid grid-cols-1 gap-10 sm:grid-cols-2">
              <div>
                <Kicker>Taken from published work</Kicker>
                <ul className="mt-4 space-y-3">
                  {PUBLISHED.map((p) => (
                    <li
                      key={p}
                      className="text-dim border-l pl-3 text-[13.5px] leading-[1.55]"
                      style={{
                        borderColor: "var(--accent)",
                        fontFamily: "var(--font-body)",
                      }}
                    >
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <Kicker tone="dim">Simulated</Kicker>
                <ul className="mt-4 space-y-3">
                  {SIMULATED.map((p) => (
                    <li
                      key={p}
                      className="text-dim border-l pl-3 text-[13.5px] leading-[1.55]"
                      style={{
                        borderColor: "var(--line)",
                        fontFamily: "var(--font-body)",
                      }}
                    >
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Measure>
          <Margin>
            <Note label="Identities">
              Masked throughout. The published cases name real ships; a
              demonstration has no reason to print a real vessel's name beside
              the word polluter. Unlit contacts are ranked and never named at
              all.
            </Note>
          </Margin>
        </Spread>
      </Page>
    </div>
  );
}
