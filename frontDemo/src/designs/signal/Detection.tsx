/**
 * "The picture" -- what the satellite recorded, examined properly.
 *
 * The investigation states the geometry in a sentence. This section takes the
 * same tile apart: the mask can be lifted off it, every measured quantity is
 * printed with the thing that produced it, and the two claims the project
 * refuses to make -- a thickness, and a single-number age -- are argued rather
 * than merely omitted.
 */

import { useMemo, useState } from "react";
import { LIMITS } from "../../content";
import { ageStatement } from "../../lib/format";
import { type RunState } from "../../useRun";
import { MarginPlot, SarStrip, WindGateFigure } from "./figures";
import {
  Body,
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

export default function Detection({ state }: { state: RunState }) {
  const { run, loading } = state;
  const [mask, setMask] = useState(true);
  const [annotate, setAnnotate] = useState(true);

  const lookalike = useMemo(
    () => LIMITS.find((l) => l.key === "lookalike")!,
    [],
  );
  const thickness = useMemo(
    () => LIMITS.find((l) => l.key === "thickness")!,
    [],
  );

  if (loading || !run) {
    return (
      <Page>
        <div className="flex min-h-[60vh] items-center">
          <Kicker>Building the scene</Kicker>
        </div>
      </Page>
    );
  }

  const c = run.characterisation;
  const age = ageStatement(run.drift);

  return (
    <div>
      <Page>
        <section className="pt-12 pb-8 lg:pt-16">
          <Kicker>Analysis · Detection and characterisation</Kicker>
          <Head level={1} className="mt-5 max-w-[15ch]">
            A dark patch, measured.
          </Head>
        </section>

        <Spread className="pb-10">
          <Gutter />
          <Measure>
            <Standfirst>
              Everything downstream depends on turning a region of low
              backscatter into numbers. The drift ensemble seeds inside the mask,
              so a bounding box would seed the sea around it; the scorer measures
              distance from the head, so the head has to be found rather than
              assumed.
            </Standfirst>
          </Measure>
          <Margin>
            <Note label="Class">
              <span className="text-accent num text-[17px]">
                {run.detection.className}
              </span>{" "}
              at {run.detection.confidence.toFixed(2)}. Two classes: operational
              discharge, and slick of unknown origin. The label is itself an
              attribution signal, not a certainty about what is floating there.
            </Note>
          </Margin>
        </Spread>

        {/* Controls, set as an editorial credit line rather than a toolbar. */}
        <div
          className="mb-5 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t pt-4"
          style={{ borderColor: "var(--ink-faint)" }}
        >
          <span className="text-faint font-mono text-[10px] tracking-[0.22em] uppercase">
            Plate controls
          </span>
          <button
            type="button"
            onClick={() => setMask(!mask)}
            className="pb-0.5 font-mono text-[11px] tracking-[0.22em] uppercase transition-colors"
            style={{
              color: mask ? "var(--accent)" : "var(--ink-faint)",
              borderBottom: `1px solid ${mask ? "var(--accent)" : "var(--line)"}`,
            }}
          >
            {mask ? "Mask on" : "Mask off"}
          </button>
          <button
            type="button"
            onClick={() => setAnnotate(!annotate)}
            className="pb-0.5 font-mono text-[11px] tracking-[0.22em] uppercase transition-colors"
            style={{
              color: annotate ? "var(--accent)" : "var(--ink-faint)",
              borderBottom: `1px solid ${annotate ? "var(--accent)" : "var(--line)"}`,
            }}
          >
            {annotate ? "Annotations on" : "Annotations off"}
          </button>
          <p
            className="text-dim max-w-[54ch] text-[13px] leading-[1.45]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            Lift the mask off and what is left is the problem the detector is
            actually given: a grainy field with a slightly darker region in it.
          </p>
        </div>
      </Page>

      <Page>
        <Exhibit
          n={1}
          bleed
          caption={
            <>
              Synthesised radar, four looks. Gamma-distributed speckle over a
              region of suppressed mean backscatter, modulated by wind streaks —
              which is what a look-alike is made of. Not an acquisition, and the
              caption will say so every time.
            </>
          }
          source={`${run.detection.sceneId} · simulated`}
        >
          <SarStrip run={run} showMask={mask} annotate={annotate} />
        </Exhibit>
      </Page>

      {/* Geometry */}
      <Page>
        <div className="pt-16">
          <SectionMark index={1} kicker="Geometry" title="What was measured" />
        </div>

        <Spread className="pb-14">
          <Gutter />
          <Measure>
            <Ledger
              head={["Quantity", "Value", "How it was obtained"]}
              align={["left", "right", "left"]}
              rows={[
                [
                  "Length",
                  <span className="num text-[15px]">
                    {c.lengthKm.toFixed(1)} km
                  </span>,
                  "Along the medial axis, head to tail",
                ],
                [
                  "Area",
                  <span className="num text-[15px]">
                    {c.areaKm2.toFixed(2)} km²
                  </span>,
                  "On an equal-area projection",
                ],
                [
                  "Mean width",
                  <span className="num text-[15px]">
                    {c.widthMMean.toFixed(0)} m
                  </span>,
                  "Sampled perpendicular to the axis",
                ],
                [
                  "Orientation",
                  <span className="num text-[15px]">
                    {c.orientationDeg.toFixed(0)}°
                  </span>,
                  "Principal axis of the mask",
                ],
                [
                  "Elongation",
                  <span className="num text-[15px]">
                    {c.elongation.toFixed(1)}
                  </span>,
                  "Length over mean width",
                ],
                [
                  "Compactness",
                  <span className="num text-[15px]">
                    {c.compactness.toFixed(3)}
                  </span>,
                  "1 for a circle; a ribbon tends to zero",
                ],
                [
                  "Parts",
                  <span className="num text-[15px]">{c.fragmentation}</span>,
                  "Connected components in the instance",
                ],
                [
                  "Head",
                  <span className="num text-[13px]">
                    {c.head[1].toFixed(3)}, {c.head[0].toFixed(3)}
                  </span>,
                  `Resolved by ${c.headTailResolvedBy.replace(/_/g, " ")}`,
                ],
                [
                  "Tail",
                  <span className="num text-[13px]">
                    {c.tail[1].toFixed(3)}, {c.tail[0].toFixed(3)}
                  </span>,
                  "Both ends are emitted; geometry alone cannot say which is which",
                ],
              ]}
            />
          </Measure>
          <Margin>
            <Note label="Width along the axis">
              <MarginPlot
                values={c.widthMProfile}
                caption={`head → tail · max ${Math.max(...c.widthMProfile).toFixed(0)} m`}
              />
              Narrow at the head, wider at the tail. Oil released earliest has
              been spreading longest, so along a linear discharge the width
              gradient is an age gradient laid out in space.
            </Note>
            <div className="mt-8">
              <Note label="Why the head matters">
                Proximity is measured from the head, not from the centroid.
                Where along a slick you look matters more than how you weight
                distance from it.
              </Note>
            </div>
          </Margin>
        </Spread>
      </Page>

      {/* Wind */}
      <Page>
        <SectionMark
          index={2}
          kicker="Confidence"
          title="Wind is a multiplier, not a filter"
        />

        <Spread className="pb-16">
          <Gutter />
          <Measure>
            <Body size="large">
              This scene was sampled at{" "}
              <Figure value={c.windSpeedMs.toFixed(1)} unit="m/s" />, which puts
              the gate at{" "}
              <Figure value={c.windGateMultiplier.toFixed(2)} />.
            </Body>
            <Body className="mt-6">
              Below roughly 3 m/s there is not enough surface roughness for oil
              to suppress: the sea is already dark and a dark patch means little.
              Above roughly 12 m/s wind mixes oil down into the water column and
              re-roughens the surface. Both edges are soft and both vary by
              region, which is precisely why this is a continuous multiplier
              carried onto every score resting on this detection rather than a
              cut that makes detections quietly disappear from the list.
            </Body>
            <Body className="mt-6">
              A detection at 1.9 m/s is still a detection. It is a detection with
              its confidence visibly reduced, and a reader can see which one it
              was.
            </Body>
          </Measure>
          <Margin>
            <Note label="The gate curve">
              <WindGateFigure ms={c.windSpeedMs} value={c.windGateMultiplier} />
              Sampled wind marked on the curve.
            </Note>
          </Margin>
        </Spread>

        <Spread className="pb-16">
          <Gutter />
          <Measure>
            <PullQuote attribution={lookalike.title}>
              {lookalike.short}.
            </PullQuote>
            <Body className="mt-6">{lookalike.body}</Body>
            <Body className="mt-6">
              The most dangerous of them is a vessel's own wake: linear, dark,
              and adjacent to a ship, so mistaking one for a discharge accuses
              the vessel that made it. Look-alike false positives are therefore
              counted and reported separately from mean average precision, never
              folded into a single headline accuracy number.
            </Body>
          </Measure>
          <Margin />
        </Spread>
      </Page>

      {/* Damping and age */}
      <Page>
        <SectionMark
          index={3}
          kicker="Refusals"
          title="Two numbers this system will not give you"
        />

        <Spread className="pb-20">
          <Gutter />
          <Measure>
            <Head level={3}>A thickness</Head>
            <Body size="small" className="mt-3">
              What is measured is a damping ratio:{" "}
              <span className="num text-ink">
                {c.dampingRatioDb.toFixed(1)} dB
              </span>{" "}
              <Tag>confidence low</Tag> — mean backscatter inside the mask
              against a surrounding annulus. {thickness.body}
            </Body>

            <Head level={3} className="mt-10">
              A single age
            </Head>
            <Body size="small" className="mt-3">
              The answer on this scene is{" "}
              <span className="text-accent num">{age.value}</span>, by{" "}
              {age.method}, in temporal state{" "}
              <span className="text-accent">{age.state}</span>. Stated in full:{" "}
              {age.phrase}. No reliable regressor from a radar image to a slick
              age exists, so a figure with a decimal point on it would be a guess
              wearing one — and the interval is not a hedge, it is the actual
              result the method produces.
            </Body>
          </Measure>
          <Margin>
            <Note label="Structural, not editorial">
              These are not omissions in the interface. The database schema has
              no column for an absolute thickness and cannot store an age as a
              bare scalar, so neither number can reach a screen even by accident.
            </Note>
          </Margin>
        </Spread>
      </Page>
    </div>
  );
}
