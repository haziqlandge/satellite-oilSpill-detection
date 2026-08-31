/**
 * The investigation. Signal's landing page, and its only long piece.
 *
 * It is a vertical read, not a dashboard: headline, standfirst, a bled radar
 * strip, then five numbered sections that go in the order a reporter would tell
 * it -- what the picture showed, what happened in the hours before it, where
 * the water leads, who was there, and where the certainty runs out. Every
 * figure on the way is an annotated exhibit with a caption and a source line.
 *
 * The numbers are not written into the copy. They are read out of the same
 * simulation the other three directions run, so the prose and the evidence for
 * it cannot drift apart.
 */

import { useMemo } from "react";
import { createTimeline, stagger, text, utils } from "animejs";
import { MapCanvas } from "../../map/MapCanvas";
import { useDesign } from "../../DesignContext";
import {
  primeReveal,
  revealFallback,
  revealOnScroll,
  useAnimeScope,
} from "../../lib/motion";
import { LIMITS, PROVENANCE, PUBLISHED, SIMULATED } from "../../content";
import { hrefFor } from "../../lib/hash";
import {
  KIND_LABEL,
  ageStatement,
  dateline,
  formatHour,
  stamp,
} from "../../lib/format";
import { AblationNote, EvidenceSheet, WeightsNote } from "./EvidenceSheet";
import { momentAt } from "../../lib/playback";
import { orderedSuspects, type RunState } from "../../useRun";
import type { Suspect } from "../../sim/types";
import {
  BackwardPlate,
  GrowthFigure,
  MarginPlot,
  ReleaseSequence,
  SarStrip,
  WideningFigure,
  WindGateFigure,
} from "./figures";
import {
  Body,
  EditorsNote,
  Exhibit,
  Figure,
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

export default function Investigation({ state }: { state: RunState }) {
  const { run, loading } = state;

  const suspects = useMemo(
    () => (run ? orderedSuspects(run, false) : []),
    [run],
  );
  const lead = suspects[0] ?? null;

  const root = useAnimeScope(() => {
    const { words } = text.split(".sig-headline", { words: true, chars: false });
    utils.set(words, { opacity: 0 });

    createTimeline({ defaults: { ease: "out(3)" } })
      .add(words, {
        opacity: [0, 1],
        translateY: [46, 0],
        duration: 900,
        delay: stagger(55),
      })
      .add(
        ".sig-standfirst",
        { opacity: [0, 1], translateY: [18, 0], duration: 700 },
        "-=560",
      );

    primeReveal(".sig-reveal", 28);
    revealOnScroll(".sig-reveal", { delay: 70 });
    revealFallback(".sig-reveal");
  }, [run?.meta.id]);

  if (loading || !run) return <Composing />;

  const c = run.characterisation;
  const d = run.drift;
  const age = ageStatement(d);
  const start = momentAt(run, run.releaseStartHour + 1);
  const atPass = momentAt(run, 0);

  return (
    <div ref={root}>
      {/* ---------------------------------------------------------------- *
       * Opening
       * ---------------------------------------------------------------- */}
      <Page>
        <section className="pt-14 pb-10 lg:pt-24">
          <Kicker>Radar to responsibility · Case study</Kicker>
          {/* The headline names the water this case is actually in. A fixed
              headline reading "in the Gulf" was still on screen when the reader
              switched to a Mumbai scene, which is the kind of small dishonesty
              that costs a publication its credibility faster than a wrong
              number does. */}
          <Head level={1} className="sig-headline mt-6 max-w-[15ch]">
            {`A dark patch appeared off ${run.meta.place}. We traced the water backward.`}
          </Head>
        </section>
      </Page>

      <Page>
        <Spread className="pb-14">
          <Gutter>
            <p className="text-faint font-mono text-[10px] tracking-[0.2em] uppercase">
              {dateline(run.meta.acquiredAt)}
            </p>
          </Gutter>
          <Measure className="sig-standfirst">
            <Standfirst>
              {`Oil flattens the short waves that scatter radar back to a satellite, so a slick reads as a hole in the sea. Finding one is the easy half. The hard half is that the hole is not where the oil came from: by the time Sentinel-1 passed over ${run.meta.place}, the oil at the far end of it had been in the water for ${Math.abs(run.releaseStartHour)} hours, and so had the water.`}
            </Standfirst>
            <Body className="mt-6">
              This is what it looks like to run that water backward. Not one
              line on a map — an ensemble of {d.ensembleSize} drift members
              carrying{" "}
              {d.particleCount.toLocaleString()} particles through the currents
              and the wind, producing a probability field over space and time.
              What survives the field is a short list of things that were in the
              right water at the right hour. What follows is the reasoning, in
              full, including the parts that do not support a conclusion.
            </Body>
          </Measure>
          <Margin>
            <Note label="The case">
              {run.meta.summary}
            </Note>
            <div className="mt-6">
              <Note label="What it tests">{run.meta.tests}</Note>
            </div>
          </Margin>
        </Spread>
      </Page>

      {/* The picture, at full width. */}
      <Page>
        <Exhibit
          n={1}
          bleed
          className="sig-reveal"
          caption={
            <>
              The scene as the detector receives it. Synthesised radar, four
              looks, gamma speckle over a region of suppressed backscatter —
              a picture of the problem, not an acquisition. The outline is the
              instance mask; the annotations are measured from it.
            </>
          }
          source={`${run.detection.sceneId} · simulated`}
        >
          <SarStrip run={run} />
        </Exhibit>
      </Page>

      {/* ---------------------------------------------------------------- *
       * I. What the satellite saw
       * ---------------------------------------------------------------- */}
      <Page>
        <div className="pt-20">
          <SectionMark
            index={1}
            kicker="Detection and geometry"
            title="What the satellite saw"
          />
        </div>

        <Spread className="pb-16">
          <Gutter />
          <Measure>
            <Body size="large">
              The slick stretches <Figure value={c.lengthKm.toFixed(1)} unit="km" />{" "}
              from head to tail, with a mean width of{" "}
              <Figure value={c.widthMMean.toFixed(0)} unit="m" /> and an area of{" "}
              <Figure value={c.areaKm2.toFixed(2)} unit="km²" />. It arrives in{" "}
              <Figure value={String(c.fragmentation)} /> parts, elongated{" "}
              <Figure value={c.elongation.toFixed(1)} />{" "}
              times its width, lying along a bearing of{" "}
              <Figure value={c.orientationDeg.toFixed(0)} unit="°" />.
            </Body>
            <Body className="mt-6">
              The detector calls it{" "}
              <span className="text-accent">{run.detection.className}</span> at{" "}
              {run.detection.confidence.toFixed(2)} confidence. That is a class
              label, not a verdict: the two classes are operational discharge and
              slick of unknown origin, and the distinction is itself an
              attribution signal rather than a certainty about what is floating
              there.
            </Body>
            <Body className="mt-6">
              Width is narrow at the head and wider at the tail. Oil released
              earliest has been spreading longest, so along a linear discharge
              the width gradient is an age gradient laid out in space. It is why
              finding the head is worth the trouble — every proximity
              measurement downstream is taken from it.
            </Body>
          </Measure>
          <Margin>
            <Note label="Width along the axis">
              <MarginPlot
                values={c.widthMProfile}
                caption={`head → tail, max ${Math.max(...c.widthMProfile).toFixed(0)} m`}
              />
              Sampled perpendicular to the medial axis, head to tail.
            </Note>

            <div className="mt-8">
              <Note label={`Wind gate ${c.windGateMultiplier.toFixed(2)}`}>
                <WindGateFigure ms={c.windSpeedMs} value={c.windGateMultiplier} />
                Below about 3 m/s the sea is already flat and a dark patch means
                little; above about 12 m/s wind mixes oil down. Both edges are
                soft, so this is a multiplier on everything resting on this
                detection — never a filter that makes detections disappear.
              </Note>
            </div>

            <div className="mt-8">
              <Note label="Damping, not thickness">
                <span className="num text-ink text-[19px]">
                  {c.dampingRatioDb.toFixed(1)} dB
                </span>{" "}
                <Tag>confidence low</Tag>
                <br />
                Mean backscatter inside the mask against a surrounding annulus.
                A relative contrast index and nothing more. There is no field
                anywhere in this system for a thickness in microns or a spilled
                volume, because remote sensing cannot currently supply either.
              </Note>
            </div>
          </Margin>
        </Spread>

        <Spread className="pb-20">
          <Gutter />
          <Measure>
            <PullQuote attribution="Jafarzadeh et al., quoted in the corpus">
              A dark patch is not oil-specific. Low wind, biogenic film, sea ice
              and a ship's own wake all flatten the surface the same way.
            </PullQuote>
          </Measure>
          <Margin>
            <Note>
              The most dangerous look-alike is a wake, because attributing one
              accuses the vessel that made it. Look-alike false positives are
              counted and reported separately from mean average precision for
              exactly that reason.
            </Note>
          </Margin>
        </Spread>

        <Spread className="pb-16">
          <Gutter />
          <Measure>
            <Onward
              to="picture"
              label="Take the mask off the plate and read every measurement"
            />
          </Measure>
          <Margin />
        </Spread>
      </Page>

      {/* ---------------------------------------------------------------- *
       * II. The hours before the picture -- the release, played forward
       * ---------------------------------------------------------------- */}
      <Page>
        <SectionMark
          index={2}
          kicker="The event"
          title="The hours before the picture"
        />

        <Spread className="pb-10">
          <Gutter />
          <Measure>
            <Body size="large">
              A spill is not a shape. It is something that happened, over{" "}
              <Figure value={Math.abs(run.releaseStartHour).toFixed(0)} unit="hours" />,
              and the satellite photographed the last frame of it.
            </Body>
            <Body className="mt-6">
              Below is the same water at six moments, from the first parcel
              entering it to the instant of the pass. Oil arrives a little at a
              time and is carried while it arrives, so the finished slick is the
              accumulated history of a release rather than a thing that appeared.
              The dashed outline in every frame is where the slick ends up, so
              each panel can be read against the answer.
            </Body>
            <Body className="mt-6">
              The vessels are drawn at the position they actually reported at
              that hour. This is not a ranking and nothing here is a candidate
              yet — it is only who was in the water while the oil was going into
              it, which is a far weaker claim and a much better question.
            </Body>
          </Measure>
          <Margin>
            <Note label="Discharge">
              <GrowthFigure run={run} />
              Surface extent grows from{" "}
              <span className="num text-ink">
                {(run.release[0]?.areaKm2 ?? 0).toFixed(2)}
              </span>{" "}
              km² to{" "}
              <span className="num text-ink">{atPass.areaKm2.toFixed(2)}</span>{" "}
              km² by the pass.
            </Note>
          </Margin>
        </Spread>

        <div className="sig-reveal pb-6">
          <Exhibit
            n={2}
            caption={
              <>
                The release, played forward. Each panel is the modelled surface
                extent at that hour under the same forcing the hindcast runs
                backward through; the count underneath is vessels within 12 km.
              </>
            }
            source="Model output · simulated"
          >
            <ReleaseSequence run={run} />
          </Exhibit>
        </div>

        <Spread className="pb-20">
          <Gutter />
          <Measure>
            <Head level={3} className="mb-5">
              Who was in the water when it started
            </Head>
            <Ledger
              head={["Vessel", "Type", "Distance", "Speed"]}
              align={["left", "left", "right", "right"]}
              rows={
                start.contacts.length
                  ? start.contacts.slice(0, 6).map((ct) => [
                      <span className="num text-[13px]">{ct.label}</span>,
                      <span className="text-dim text-[13px]">{ct.kind}</span>,
                      <span className="num text-[13px]">
                        {ct.distanceKm < 0.05
                          ? "in the oil"
                          : `${ct.distanceKm.toFixed(1)} km`}
                      </span>,
                      <span className="num text-[13px]">
                        {ct.sog.toFixed(1)} kn
                      </span>,
                    ])
                  : [
                      [
                        <span className="text-dim text-[13px]">
                          No transponding vessel within 12 km at the first hour
                          of the release.
                        </span>,
                        "",
                        "",
                        "",
                      ],
                    ]
              }
            />
            <Body size="small" className="mt-4">
              The six nearest of {start.contacts.length} tracks reporting within
              12 kilometres, out of {run.vessels.length} in the scene. Identities
              are masked: the published cases name real ships, and a
              demonstration has no reason to print a real vessel's name beside
              the word polluter.
            </Body>
          </Measure>
          <Margin>
            <Note label={formatHour(start.hour)}>
              {stamp(start.at)} · {(start.releasedFraction * 100).toFixed(0)}% of
              the discharge in the water, covering {start.areaKm2.toFixed(2)}{" "}
              km².
            </Note>
            <div className="mt-6">
              <Note label="Run it yourself">
                The working section plays this event on a live map, hour by hour,
                with the register updating as vessels come and go.
              </Note>
            </div>
          </Margin>
        </Spread>

        <Spread className="pb-16">
          <Gutter />
          <Measure>
            <Onward
              to="water"
              label="Play the event on the map and scrub through it"
            />
          </Measure>
          <Margin />
        </Spread>
      </Page>

      {/* ---------------------------------------------------------------- *
       * III. Where the water leads us
       * ---------------------------------------------------------------- */}
      <Page>
        <SectionMark
          index={3}
          kicker="Hindcast"
          title="Where the water leads us"
        />

        <div className="sig-reveal pb-8">
          <Exhibit
            n={3}
            bleed
            caption={
              <>
                The 90% origin contour at seven hours before the pass, drawn as
                a stack. The rings contract toward the water the oil came from;
                the grey line is the track of the candidate that ends up ranked
                first. Nothing in this figure is a trajectory — every ring is a
                credible region.
              </>
            }
            source={`${d.ensembleSize} members · ${d.particleCount.toLocaleString()} particles · simulated`}
          >
            <div className="mx-auto max-w-[1560px] px-5 sm:px-8 lg:px-12">
              <BackwardPlate run={run} />
            </div>
          </Exhibit>
        </div>

        <Spread className="pb-16">
          <Gutter />
          <Measure>
            <Body size="large">
              Age is never a single number. On this scene the answer is{" "}
              <Figure value={age.value} />
              {age.degenerate ? "" : ", by " + age.method}.
            </Body>
            <Body className="mt-6">
              No reliable regressor from a radar image to a slick age exists, so
              a figure with a decimal point on it here would be a guess wearing
              one. What the model reports is {age.phrase}. The temporal state is{" "}
              <span className="text-accent">{d.temporalState}</span>, and the
              method is <span className="text-accent">{age.method}</span> — not
              when the particle cloud was tightest, but when the
              high-probability region first reached something that could have
              released this.
            </Body>
            <Body className="mt-6">
              And the field widens the further back it is run. That is not a
              defect waiting to be tuned out — reversing a diffusive process
              spreads it, because diffusion is irreversible. Past a point the
              region that could have held this oil covers enough water that
              nothing inside it is distinguished from anything else inside it.
            </Body>
          </Measure>
          <Margin>
            <Note label="At the pass">
              90% contour{" "}
              <span className="num text-ink">
                {d.frames.find((f) => f.hour === 0)?.area90Km2.toFixed(1) ?? "—"}
              </span>{" "}
              km², spreading to{" "}
              <span className="num text-ink">
                {d.frames[0]?.area90Km2.toFixed(0)}
              </span>{" "}
              km² at {formatHour(-d.backwardHours)}.
            </Note>
          </Margin>
        </Spread>

        <div className="sig-reveal pb-20">
          <Exhibit
            n={4}
            caption={
              <>
                Area of the 90% origin contour against hours before acquisition.
                The shaded span is the estimated release window. The curve is
                published rather than smoothed, because it is the measurement
                the insufficient-evidence rule is written against.
              </>
            }
            source="Model output · simulated"
          >
            <WideningFigure run={run} />
          </Exhibit>
        </div>
      </Page>

      {/* ---------------------------------------------------------------- *
       * IV. Who was there
       * ---------------------------------------------------------------- */}
      <Page>
        <SectionMark index={4} kicker="Attribution" title="Who was there" />

        {d.insufficientEvidence && (
          <Spread className="pb-12">
            <Gutter />
            <Measure>
              <EditorsNote
                reason={d.insufficientEvidence.reason}
                areaKm2={d.insufficientEvidence.area90Km2}
              />
            </Measure>
            <Margin />
          </Spread>
        )}

        <Spread className="pb-12">
          <Gutter />
          <Measure>
            <Body size="large">
              {run.aisPointCount.toLocaleString()} vessel reports were in this
              scene. {run.vessels.length} tracks.{" "}
              {suspects.filter((s) => s.kind === "ais_vessel").length} of them
              were inside the origin field at a matching backward hour, which is
              the only filter in this system with physics behind it.
            </Body>
            <Body className="mt-6">
              Everything that survived is listed below on one scale — vessels,
              unlit radar contacts and fixed infrastructure together. A ranking
              that shows only the top vessel has quietly decided the question it
              was asked.
            </Body>
          </Measure>
          <Margin>
            <Note label="The gate">
              A track survives only if it was inside the credible origin region
              at the hour that region describes. It removes the overwhelming
              majority of traffic in one step.
            </Note>
          </Margin>
        </Spread>

        <div className="sig-reveal pb-10">
          <Exhibit
            n={5}
            bleed
            caption={
              <>
                The scene at the moment of the pass: the detection, the credible
                origin region, the traffic that was in the water, and the track
                of the candidate ranked first picked out of it. A reproduction,
                not a viewer — the framing is the argument, so it does not pan.
              </>
            }
            source="Esri basemap · data simulated"
          >
            <TrafficExhibit state={state} />
          </Exhibit>
        </div>

        <Spread className="pb-16">
          <Gutter />
          <Measure className="lg:col-span-2 lg:col-start-2">
            <Ledger
              head={["", "Candidate", "Kind", "Score", "Without S_drift"]}
              align={["right", "left", "left", "right", "right"]}
              rows={suspects.map((s) => [
                <span className="num text-accent text-[13px]">
                  {String(s.rank).padStart(2, "0")}
                </span>,
                <span>
                  <span className="num text-[14px]">{s.label}</span>
                  <span className="text-dim block text-[12.5px] leading-snug">
                    {s.detail}
                  </span>
                </span>,
                <span className="text-dim text-[12.5px]">
                  {KIND_LABEL[s.kind]}
                </span>,
                <span className="num text-[15px]">{s.total.toFixed(3)}</span>,
                <span className="num text-dim text-[13px]">
                  {s.totalWithoutDrift.toFixed(3)}
                  {s.rankWithoutDrift !== s.rank && (
                    <span className="text-faint ml-2">
                      #{s.rankWithoutDrift}
                    </span>
                  )}
                </span>,
              ])}
            />
          </Measure>
        </Spread>

        {lead && <TheEvidence lead={lead} />}
      </Page>

      {/* ---------------------------------------------------------------- *
       * V. Limits
       * ---------------------------------------------------------------- */}
      <Page>
        <SectionMark
          index={5}
          kicker="Standards"
          title="Where it stops being certain"
        />

        <Spread className="pb-20">
          <Gutter />
          <Measure>
            <div className="flex flex-col">
              {LIMITS.map((l, i) => (
                <article
                  key={l.key}
                  className="sig-reveal border-t py-7"
                  style={{ borderColor: "var(--line)" }}
                >
                  <div className="flex gap-5">
                    <span className="num text-faint shrink-0 text-[13px]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <Head level={3}>{l.title}</Head>
                      <Body size="small" className="mt-2.5">
                        {l.body}
                      </Body>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </Measure>
          <Margin>
            <Note label="Editorial position">
              These are printed at the same weight as the claims. A system that
              names vessels as suspected polluters and does not publish where it
              stops being certain is not a usable system; it is a confident one.
            </Note>
          </Margin>
        </Spread>
      </Page>

      {/* ---------------------------------------------------------------- *
       * Colophon
       * ---------------------------------------------------------------- */}
      <footer
        className="border-t"
        style={{ borderColor: "var(--ink-faint)", background: "var(--base-2)" }}
      >
        <Page>
          <div className="grid grid-cols-1 gap-10 py-16 lg:grid-cols-3">
            <div>
              <Kicker tone="dim">Sources</Kicker>
              <p
                className="text-ink mt-4 text-[15px] leading-[1.6]"
                style={{ fontFamily: "var(--font-body)" }}
              >
                {PROVENANCE.full}
              </p>
            </div>
            <div>
              <Kicker tone="dim">Taken from published work</Kicker>
              <ul className="mt-4 space-y-2.5">
                {PUBLISHED.map((p) => (
                  <li
                    key={p}
                    className="text-dim border-l pl-3 text-[13.5px] leading-[1.5]"
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
            <div>
              <Kicker tone="dim">Simulated in this demonstration</Kicker>
              <ul className="mt-4 space-y-2.5">
                {SIMULATED.map((p) => (
                  <li
                    key={p}
                    className="text-dim border-l pl-3 text-[13.5px] leading-[1.5]"
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
        </Page>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The map, as a plate
 *
 * Signal's relationship with geography is the weakest of the four on purpose.
 * The map appears once, as a reproduction with a caption and corner labels,
 * fixed at the framing the piece was written around. It does not pan, it has no
 * zoom control and no layer switcher, because a reader who drags it away from
 * the composition has lost the picture the caption is describing and there is
 * nothing underneath worth finding.
 * ------------------------------------------------------------------ */

function TrafficExhibit({ state }: { state: RunState }) {
  const def = useDesign();
  const { run } = state;
  const suspects = useMemo(
    () => (run ? orderedSuspects(run, false) : []),
    [run],
  );
  if (!run) return null;

  return (
    <div
      className="relative h-[62vh] max-h-[680px] min-h-[380px] w-full"
      style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}
    >
      <MapCanvas
        run={run}
        paint={def.map}
        hour={0}
        toggles={{
          slick: true,
          contours: true,
          particles: false,
          traffic: true,
          candidates: true,
          targets: true,
          forecast: false,
          labels: true,
          release: false,
        }}
        selected={suspects[0] ?? null}
        interactive={false}
        controls="scale"
        className="h-full w-full"
      />

      {/* Corner marks, in the manner of a printed plate. */}
      <div className="pointer-events-none absolute inset-0 p-5">
        <div className="flex h-full flex-col justify-between">
          <div className="flex items-start justify-between">
            <p className="text-faint font-mono text-[10px] tracking-[0.22em] uppercase">
              {run.detection.sceneId}
            </p>
            <p className="text-accent font-mono text-[10px] tracking-[0.22em] uppercase">
              {stamp(run.meta.acquiredAt)}
            </p>
          </div>
          <p className="text-faint max-w-[34ch] font-mono text-[10px] leading-relaxed tracking-[0.14em] uppercase">
            Detection · 50 and 90% origin contours · gated traffic · lead
            candidate track
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The evidence, set as an editorial breakdown
 * ------------------------------------------------------------------ */

function TheEvidence({ lead }: { lead: Suspect }) {
  return (
    <Spread className="pb-20">
      <Gutter>
        <p className="text-faint font-mono text-[10px] tracking-[0.2em] uppercase">
          The evidence
        </p>
      </Gutter>

      <Measure>
        <EvidenceSheet suspect={lead} showWindow={false} />
        <Onward
          to="candidates"
          label="Read every candidate's evidence, and take the drift term away"
        />
      </Measure>

      <Margin>
        <WeightsNote />
        <div className="mt-6">
          <AblationNote suspect={lead} />
        </div>
      </Margin>
    </Spread>
  );
}

/**
 * The link at the foot of a section.
 *
 * A piece that ends without telling the reader where the working is has asked
 * them to take it on trust. Set as a rule and a line of mono, not a button.
 */
function Onward({ to, label }: { to: string; label: string }) {
  return (
    <a
      href={hrefFor(to)}
      className="text-accent mt-9 inline-flex items-baseline gap-3 border-t pt-4 font-mono text-[11px] tracking-[0.2em] uppercase transition-opacity hover:opacity-70"
      style={{ borderColor: "var(--accent)" }}
    >
      {label}
      <span aria-hidden>→</span>
    </a>
  );
}

function Composing() {
  return (
    <Page>
      <div className="flex min-h-[70vh] max-w-[46ch] flex-col justify-center">
        <Kicker>Running the ensemble</Kicker>
        <Head level={2} className="mt-4">
          Composing the investigation.
        </Head>
        <Body className="mt-5">
          Twelve drift members, thirty-eight hundred particles, a density grid
          and two credible-region contours for every hour of the horizon.
        </Body>
      </div>
    </Page>
  );
}
