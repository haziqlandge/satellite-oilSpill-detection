/**
 * Why spills happen, and who was there.
 *
 * The prose in this block is general -- it is about the two ways oil ends up in
 * the water, not about any one case -- and it stays put when the reader changes
 * the spill. What changes is the overlay and the list under it.
 *
 * The overlay is interactive but has no playback, on purpose. This is the one
 * figure on the page asking a spatial question rather than a temporal one --
 * whose track passes through the origin window -- and a transport control would
 * invite the reader to answer it by scrubbing rather than by looking. The layer
 * buttons are the controls here instead, and they are drawn as switches so it
 * is obvious there is something to press.
 */

import { useState } from "react";
import { CAUSES } from "../../content";
import { KIND_LABEL, TERM_LABEL, TERM_ORDER } from "../../lib/format";
import { orderedSuspects, type SpillState } from "../../lib/spill";
import { MapCanvas } from "../../map/MapCanvas";
import { DEFAULT_TOGGLES, type LayerToggles } from "../../map/basemap";
import { usePaint } from "../../lib/palette";
import {
  Body,
  Head,
  Margin,
  Measure,
  Note,
  Page,
  SectionMark,
  Spread,
  Tag,
  ValueRule,
  Wide,
} from "../components";
import { Rocker } from "../instruments";
import { FlagSeries } from "../plates";
import { SpillSelect } from "../SpillSelect";
import { Loading } from "../Loading";

/** What the overlay can draw. Ordered as they stack on the map. */
const LAYERS: { key: keyof LayerToggles; label: string; hint: string }[] = [
  { key: "slick", label: "Detection mask", hint: "The instance contour" },
  { key: "contours", label: "Origin field", hint: "Where the oil started, 50% and 90%" },
  { key: "particles", label: "Particles", hint: "The ensemble members themselves" },
  { key: "traffic", label: "All AIS traffic", hint: "Every track in the window" },
  { key: "candidates", label: "Gated candidates", hint: "Tracks that survived the filter" },
  { key: "targets", label: "Radar targets", hint: "Bright contacts, matched or dark" },
];

export function Cause({ spill }: { spill: SpillState }) {
  const { run, selectedId, setSelectedId } = spill;
  const paint = usePaint();

  const [toggles, setToggles] = useState<LayerToggles>({
    ...DEFAULT_TOGGLES,
    forecast: false,
    release: false,
  });

  const selected = run?.suspects.find((s) => s.id === selectedId) ?? null;
  const ranked = run ? orderedSuspects(run, false).slice(0, 5) : [];
  const halt = run?.drift.insufficientEvidence ?? null;

  return (
    <section id="cause" ref={spill.ref} className="scroll-mt-[70px] py-14">
      <Page>
        <SectionMark
          index={4}
          kicker="Attribution"
          title="How oil gets into the water"
        />

        {/* --- general: the two causes ------------------------------- */}
        <Spread className="mt-8">
          <Measure>
            <Body>
              Almost all of it comes from one of two situations, and they are
              worth separating because they leave completely different evidence
              behind.
            </Body>
          </Measure>
        </Spread>

        <Wide className="mt-8">
          <div className="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-2">
            {CAUSES.map((c) => (
              <article key={c.key}>
                <Tag tone="accent">{c.short}</Tag>
                <Head level={3} className="mt-2">
                  {c.title}
                </Head>
                <Body className="mt-3" size="small">
                  {c.body}
                </Body>
                <div
                  className="mt-4 border-l pl-3.5"
                  style={{ borderColor: "var(--accent)" }}
                >
                  <p className="text-faint font-mono text-[9.5px] tracking-[0.24em] uppercase">
                    What it leaves behind
                  </p>
                  <p className="text-dim mt-1.5 text-[13.5px] leading-[1.55]">
                    {c.signature}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </Wide>

        {/* --- the overlay ------------------------------------------- */}
        <div className="mt-14">
          <Spread>
            <Measure>
              <Head level={3}>Ship movement over the spill</Head>
              <Body className="mt-3">
                Every track that passed through the area during the window,
                drawn over the origin field the drift produced. The question the
                picture is asking is not who was nearest to the slick — it is
                whose track passed through the place the oil started, at the
                hour it started.
              </Body>
            </Measure>
            <Margin>
              <Note label="Draw what you want">
                Each switch is a layer. Turning the traffic on and the
                candidates off shows how much the physical gate actually threw
                away.
              </Note>
            </Margin>
          </Spread>

          {run ? (
            <Wide className="mt-7">
              <figure>
                <div className="mb-3 flex items-center">
                  <SpillSelect spill={spill} />
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_224px]">
                  <div
                    className="relative border"
                    style={{ borderColor: "var(--line)", height: 470 }}
                  >
                    <MapCanvas
                      run={run}
                      paint={paint}
                      hour={0}
                      /*
                        Held at the pass, and forward-only like every other map
                        on the page. The origin field this block's scoring is
                        built on is still drawn -- it is the 50% and 90% contour
                        layers, which are geometry rather than the particle
                        cloud -- but the pre-pass release accumulation and the
                        hindcast haze are not.
                      */
                      direction="forward"
                      toggles={toggles}
                      selected={selected}
                      onSelect={setSelectedId}
                      className="h-full w-full"
                      interactive
                      controls="scale"
                    />
                  </div>

                  {/* The controls, as switches rather than as text links. */}
                  <div
                    className="border p-3"
                    style={{
                      borderColor: "var(--line)",
                      background: "var(--base-2)",
                    }}
                  >
                    <p className="text-faint font-mono text-[9.5px] tracking-[0.24em] uppercase">
                      Layers
                    </p>
                    <div className="mt-3 space-y-2.5">
                      {LAYERS.map((l) => (
                        <Rocker
                          key={l.key}
                          on={toggles[l.key]}
                          label={l.label}
                          hint={l.hint}
                          onChange={(v) =>
                            setToggles((t) => ({ ...t, [l.key]: v }))
                          }
                        />
                      ))}
                    </div>
                    <p className="text-faint mt-4 text-[12px] leading-[1.5]">
                      Pan and zoom the chart. Click a track to select it. There
                      is no playback here — this is one instant, the satellite
                      pass.
                    </p>
                  </div>
                </div>

                <figcaption className="text-dim mt-3 text-[13px] leading-[1.5]">
                  <Tag tone="accent">Figure 4</Tag> Traffic over the origin
                  field at the moment of acquisition.{" "}
                  {run.gate.considered.toLocaleString()} tracks considered,{" "}
                  {run.gate.admitted} admitted by the gate.{" "}
                  {/* `gate.reason` is the rule itself, and it was carried on
                      every run and printed on neither surface. The two counts
                      without it say a filter ran; with it they say what the
                      filter was, which is the difference between a number and
                      an auditable one. */}
                  {run.gate.reason}
                </figcaption>
              </figure>
            </Wide>
          ) : (
            <div className="mt-7">
              <Loading label="Reconstructing traffic" height={470} />
            </div>
          )}
        </div>

        {/* --- the suspects ------------------------------------------ *
         *
         * The two text blocks stack in the left column and the ranking sits
         * beside them. They used to be a measure-and-margin pair with the list
         * full width underneath, which left the note stranded at the top of a
         * short column and put a five-row list next to nine hundred pixels of
         * score rail.
         * ---------------------------------------------------------- */}
        <Wide className="mt-14">
          <div className="grid grid-cols-1 gap-x-14 gap-y-9 lg:grid-cols-[minmax(0,44ch)_minmax(0,1fr)]">
            <div>
              <Head level={3}>Who was there</Head>
              <Body className="mt-3">
                What survives the gate, scored on six weighted terms and ranked.
                These are candidates. Not suspects in a legal sense, not
                findings, and never a determination — the language throughout is
                candidate, suspected and score.
              </Body>
              <div className="mt-8">
                <Note label="Unlit contacts stay unnamed">
                  A radar target with no transponder association is ranked like
                  anything else and is never given an identity. All identities
                  on this page are masked in any case.
                </Note>
              </div>
            </div>

            <div>
              {!run ? (
                <Loading label="Scoring candidates" height={260} />
              ) : halt ? (
                <div
                  className="border p-6"
                  style={{
                    borderColor: "var(--alarm)",
                    background:
                      "color-mix(in oklab, var(--alarm) 8%, transparent)",
                  }}
                >
                  <p
                    className="font-mono text-[11px] tracking-[0.28em] uppercase"
                    style={{ color: "var(--alarm)" }}
                  >
                    Insufficient evidence — attribution withheld
                  </p>
                  <p className="text-ink mt-3 text-[15px] leading-[1.6]">
                    The 90% origin contour covers{" "}
                    {halt.area90Km2.toFixed(0)} km². {halt.reason}
                  </p>
                  <p className="text-dim mt-3 text-[14px] leading-[1.6]">
                    No candidate is ranked from a field this diffuse. This is
                    the result, not an error and not an empty list — a pipeline
                    that always produces a suspect is not a pipeline anyone
                    should trust.
                  </p>
                  {/*
                    The outcome, in the refusal's own ink.

                    This line is what the block actually concludes -- the
                    pipeline reached the end and named nobody -- and it was set
                    in `--ink-faint`, the quietest token on the page, under two
                    paragraphs of brighter body text. A conclusion printed more
                    softly than its own explanation reads as a footnote to the
                    refusal rather than as the refusal's result.
                  */}
                  <p
                    className="mt-3 font-mono text-[10px] tracking-[0.2em] uppercase"
                    style={{ color: "var(--alarm)" }}
                  >
                    Candidates named: none
                  </p>
                </div>
              ) : (
                <ol className="space-y-px">
                  {ranked.map((s, i) => {
                    const on = s.id === selectedId;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(s.id)}
                          aria-current={on ? "true" : undefined}
                          className="w-full cursor-pointer border-b px-1 py-3 text-left transition-colors"
                          style={{
                            borderColor: "var(--line)",
                            background: on
                              ? "color-mix(in oklab, var(--accent) 7%, transparent)"
                              : "transparent",
                          }}
                        >
                          <div className="flex items-baseline gap-3">
                            <span
                              className="font-mono text-[13px]"
                              style={{
                                color:
                                  i === 0
                                    ? "var(--accent)"
                                    : "var(--ink-faint)",
                              }}
                            >
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="text-ink min-w-0 flex-1 truncate text-[15px]">
                              {s.label}
                            </span>
                            <span className="text-faint font-mono text-[10px] tracking-[0.16em] uppercase">
                              {KIND_LABEL[s.kind]}
                            </span>
                            <span
                              className="font-mono text-[14px]"
                              style={{
                                color:
                                  i === 0 ? "var(--accent)" : "var(--ink-dim)",
                              }}
                            >
                              {s.total.toFixed(3)}
                            </span>
                          </div>
                          <p className="text-dim mt-1 pl-[calc(13px+0.75rem)] text-[13px] leading-[1.5]">
                            {s.detail}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}

              {/*
                How far clear the top candidate actually is.

                Both scores are printed above, so the margin is *derivable* by
                subtraction -- but the threshold is not, and the threshold is
                the part that matters: below 0.015 `scoring.ts` stops
                distinguishing the top two at all. A ranked list that never says
                how close the race was invites the reader to treat first place
                as a finding, which is the one reading this whole section is
                written to prevent.

                `run.separability` is read here rather than recomputed. The
                console derives its own because it has to answer for the ablated
                ranking as well; this page has no ablation toggle, so the value
                the scorer produced is the value to print.
              */}
              {run && !halt && ranked.length > 0 && (
                <p className="text-faint mt-5 font-mono text-[11px] leading-[1.6]">
                  {run.separability === null ? (
                    <>
                      Only one candidate survived the gate, so there is no
                      margin to report. That is a result, not a gap.
                    </>
                  ) : (
                    <>
                      Separability {run.separability.toFixed(3)} — the margin
                      between the first and second candidate.{" "}
                      {run.separability < 0.015
                        ? "That is inside the noise of the weighting, so neither is distinguished from the other."
                        : "Reported per case, never targeted."}
                    </>
                  )}
                </p>
              )}
            </div>
          </div>

          {/*
            The decomposition, full width in three columns.

            It was a 420px rail beside the list, which ran to nine hundred
            pixels tall while the list it sat next to ended at three hundred --
            so the block carried a hole the height of a screen. The content is
            unchanged: every term keeps its weight and its geometry (no bare
            totals), every flag keeps the series that raised it (C7), and the
            caveats stay.
          */}
          {run && !halt && selected && (
            <div
              className="mt-12 border-t pt-8"
              style={{ borderColor: "var(--line)" }}
            >
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="text-faint font-mono text-[9.5px] tracking-[0.24em] uppercase">
                  Score decomposition
                </p>
                <p className="text-ink text-[16px]">{selected.label}</p>
                <p className="text-faint ml-auto font-mono text-[10px] tracking-[0.16em] uppercase">
                  {KIND_LABEL[selected.kind]} · total{" "}
                  {selected.total.toFixed(3)}
                </p>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                  <p className="text-faint font-mono text-[9.5px] tracking-[0.24em] uppercase">
                    Terms
                  </p>
                  <div className="mt-3 space-y-1">
                    {TERM_ORDER.map((k) => (
                      <ValueRule
                        key={k}
                        label={TERM_LABEL[k]}
                        value={selected.terms[k]}
                        weight={selected.weights[k]}
                        detail={
                          selected.evidence.terms.find((t) => t.key === k)
                            ?.detail
                        }
                        emphasis={k === "drift"}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-faint font-mono text-[9.5px] tracking-[0.24em] uppercase">
                    Behavioural flags
                  </p>
                  {selected.evidence.anomalies.length ? (
                    selected.evidence.anomalies.map((a) => (
                      <div key={a.code} className="mt-3">
                        <p className="text-ink text-[13.5px]">{a.label}</p>
                        <p className="text-dim mt-0.5 text-[12.5px] leading-[1.5]">
                          {a.detail}
                        </p>
                        <div className="mt-1.5">
                          <FlagSeries series={a.series} label={a.seriesLabel} />
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-faint mt-3 text-[12.5px] leading-[1.5]">
                      None raised for this candidate.
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-faint font-mono text-[9.5px] tracking-[0.24em] uppercase">
                    Caveats
                  </p>
                  <ul className="mt-3 space-y-2">
                    {selected.evidence.caveats.map((c, i) => (
                      <li
                        key={i}
                        className="text-dim text-[12.5px] leading-[1.5]"
                      >
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </Wide>
      </Page>
    </section>
  );
}
