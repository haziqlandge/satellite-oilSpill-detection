/**
 * Where it came from, and where it is going.
 *
 * Two movements. The first is the forecast, played forward from the satellite
 * pass. The second is the record behind it -- four figures on one grid: the
 * forecast ensemble as a stack of credible regions, how far that stack has
 * spread by each hour, and the water and the growth that moved it.
 *
 * Both movements run forward only. They used to face backward, and the plates
 * argued about where the oil came from rather than about where it goes; the
 * hindcast is still what the attribution rests on and the console still draws
 * it, but this section is now one direction throughout rather than two mixed
 * together under one heading.
 *
 * The second movement shares the first's spill control on purpose. These charts
 * *are* the forcing this drift ran through; letting the map show one case while
 * the graphs under it showed another would not be flexibility, it would be a lie
 * about which ocean moved which oil.
 *
 * Everything after the playback sits on one width. It used to mix two: the
 * headings were set on the text measure while the figures were set on the wide
 * figure grid, so the prose started two hundred pixels to the right of the
 * charts it introduced and the block read as two pages shuffled together.
 */

import { useMemo } from "react";
import { ageStatement, formatHour } from "../../lib/format";
import { PHASE_LABEL, momentAt } from "../../lib/playback";
import type { SpillState } from "../../lib/spill";
import { MapCanvas } from "../../map/MapCanvas";
import { DEFAULT_TOGGLES } from "../../map/basemap";
import { usePaint } from "../../lib/palette";
import {
  Body,
  Head,
  Kicker,
  Margin,
  Measure,
  Page,
  SectionMark,
  Spread,
  Tag,
  Wide,
} from "../components";
import { ForecastSpreadPlate, OriginFieldPlate } from "../plates";
import { TankerProfile } from "../scenery";
import { CurrentChart, GrowthChart } from "../env";
import { EventTransport } from "../Playback";
import { SpillSelect } from "../SpillSelect";
import { Loading } from "../Loading";

export function Drift({ spill }: { spill: SpillState }) {
  const { run, hour, setHour } = spill;
  const paint = usePaint();

  const moment = useMemo(
    () => (run ? momentAt(run, Math.round(hour)) : null),
    [run, hour],
  );
  const age = run ? ageStatement(run.drift) : null;

  return (
    <section id="drift" ref={spill.ref} className="scroll-mt-[70px] py-14">
      <Page>
        <SectionMark
          index={2}
          kicker="Hindcast and forecast"
          title="Where it came from, and where it goes"
        />

        <Spread className="mt-8">
          <Measure>
            <Body>
              A slick photographed at one instant is the end of one process and
              the start of another. Finding the source means running the ocean
              backwards; saying what happens next means running it forwards from
              the same frame. The system does both, and the attribution rests on
              the backward half.
            </Body>
            <Body className="mt-4">
              Neither direction produces a line. The output is a probability
              field over space and time: an ensemble of members, each stepped
              through slightly different forcing, and the region that contains
              most of them. The figures here are the forward half — where the
              oil goes after the pass, and how much the ensemble has spread by
              the time it gets there.
            </Body>
          </Measure>
          <Margin>
            <p
              className="border-l pl-4 text-[13.5px] leading-[1.55]"
              style={{ borderColor: "var(--accent)", color: "var(--ink-dim)" }}
            >
              <span className="text-accent mr-2 font-mono text-[9.5px] tracking-[0.2em] uppercase">
                Figure 2
              </span>
              The forecast, played forward from the satellite pass. Nothing from
              before the pass is drawn: the map opens on the mask the segmenter
              returned and carries the ensemble outward from there.
            </p>
            <TankerProfile />
          </Margin>
        </Spread>

        {/* --- the playback ------------------------------------------- */}
        <Wide className="mt-10">
          {run ? (
            <figure>
              <div className="mb-3 flex items-center">
                <SpillSelect spill={spill} />
              </div>

              <div
                className="relative border"
                style={{ borderColor: "var(--line)", height: 520 }}
              >
                <MapCanvas
                  run={run}
                  paint={paint}
                  hour={hour}
                  /*
                    Forward only. The hindcast haze used to sit behind the oil
                    here even at T0, which put two clouds meaning opposite
                    things on one map and asked the caption to keep them apart.
                    This figure is about where the oil goes.
                  */
                  direction="forward"
                  /*
                    No traffic and no candidate tracks on this map. This figure
                    is about where the oil goes; twenty-odd AIS lines crossing
                    it answer a different question and were the loudest marks on
                    screen. The attribution block draws them, where they mean
                    something.
                  */
                  toggles={{
                    ...DEFAULT_TOGGLES,
                    forecast: true,
                    traffic: false,
                    candidates: false,
                    targets: false,
                  }}
                  selected={null}
                  className="h-full w-full"
                  interactive
                  controls="scale"
                />

                {moment && (
                  <div
                    className="pointer-events-none absolute top-0 left-0 flex flex-wrap items-center gap-x-4 gap-y-1 border-r border-b px-3 py-2"
                    style={{
                      borderColor: "var(--line)",
                      background:
                        "color-mix(in oklab, var(--base) 78%, transparent)",
                    }}
                  >
                    <span className="text-accent font-mono text-[13px]">
                      {formatHour(hour)}
                    </span>
                    <span className="text-dim font-mono text-[10px] tracking-[0.18em] uppercase">
                      {PHASE_LABEL[moment.phase]}
                    </span>
                    <span className="text-faint font-mono text-[10px]">
                      discharged {(moment.releasedFraction * 100).toFixed(0)}%
                    </span>
                    <span className="text-faint font-mono text-[10px]">
                      surface {moment.areaKm2.toFixed(2)} km²
                    </span>
                  </div>
                )}

                {/*
                  The run's own figures, overlaid top right. They used to sit in
                  the margin beside the prose, where they read as page
                  furniture. They describe the ensemble the map is drawing, so
                  they belong on it.
                */}
                {age && (
                  <div
                    className="pointer-events-none absolute top-0 right-0 border-b border-l px-3 py-2"
                    style={{
                      borderColor: "var(--line)",
                      background:
                        "color-mix(in oklab, var(--base) 78%, transparent)",
                    }}
                  >
                    <dl className="space-y-0.5">
                      <Fig k="Ensemble" v={`${run.drift.ensembleSize} members`} />
                      <Fig
                        k="Particles"
                        v={run.drift.particleCount.toLocaleString()}
                      />
                      <Fig k="Forecast" v={`${run.drift.forwardHours} h`} />
                      <Fig k="Age" v={age.value} />
                    </dl>
                    <p className="text-faint mt-1.5 text-[9.5px] tracking-[0.1em]">
                      {age.method}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-5">
                <EventTransport run={run} hour={hour} onChange={setHour} />
              </div>
            </figure>
          ) : (
            <Loading label="Running the ensemble" height={520} />
          )}
        </Wide>

        {/* --- the evidence behind the forecast ----------------------- */}
        <Evidence spill={spill} />
      </Page>
    </section>
  );
}

/** One overlaid run figure: label left, value right, on a tabular column. */
function Fig({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <dt className="text-faint font-mono text-[9px] tracking-[0.2em] uppercase">
        {k}
      </dt>
      <dd className="num text-ink ml-auto text-[11px]">{v}</dd>
    </div>
  );
}

/**
 * The records the forecast rests on.
 *
 * Its own titled movement, so there is a visible seam between the thing that
 * moves and the things that measure it. Four figures on one grid, each with its
 * number and its caption *above* the plot rather than below: a reader meeting a
 * chart wants to know what it is before they read it, and captions underneath
 * put every explanation one figure out of step with its subject.
 *
 * The caption block is given a floor height so the four plots sit on two clean
 * baselines regardless of how long the individual captions run.
 *
 * Keeps `id="environment"`: the masthead links to it.
 */
function Evidence({ spill }: { spill: SpillState }) {
  const { run } = spill;

  return (
    <div
      id="environment"
      className="mt-16 scroll-mt-[70px] border-t pt-10"
      style={{ borderColor: "var(--line)" }}
    >
      <Wide>
        {/* The heading sits on the same width as the figures it introduces. */}
        <div className="max-w-[62ch]">
          <Kicker>The record behind it</Kicker>
          <Head level={3} className="mt-3">
            What the forecast is built on
          </Head>
          <Body className="mt-3">
            The drift above is not a guess about the water. It is the
            consequence of the mask the detector returned, and of a specific
            current and a specific rate of spreading. These four are those
            records, sampled at the middle of the slick across the same hours
            the playback covers — so the case shown here always follows the
            control above, because a different case would be a different ocean.
          </Body>
        </div>

        {run ? (
          <div className="mt-9 grid grid-cols-1 gap-x-10 gap-y-11 xl:grid-cols-2">
            <Plate
              n="2A"
              caption="The forecast ensemble as a stack of credible regions, widening away from the pass. No trajectory is drawn — a single line would claim a precision the ensemble does not have."
              framed
            >
              <OriginFieldPlate run={run} />
            </Plate>

            <Plate
              n="2B"
              caption="How wide the 90% region is at each hour after the pass. It only grows: the ocean disperses oil, so the further out the forecast reaches the less the region rules out."
              framed
            >
              <ForecastSpreadPlate run={run} />
            </Plate>

            <Plate
              n="2C"
              caption="Surface current speed, with the semidiurnal tide broken out on its own scale — it is a component of the current, not a second quantity. The oscillation riding on the mean flow is what makes a backward trajectory wander rather than run straight."
            >
              <CurrentChart env={run.environment} />
            </Plate>

            <Plate
              n="2D"
              caption="How much oil had entered the water, against how far it had spread. The two diverge — a discharge can be finished while the slick is still growing — and that gap is the reason the age estimate is an interval."
            >
              <GrowthChart run={run} />
            </Plate>
          </div>
        ) : (
          <div className="mt-9">
            <Loading label="Sampling the record" height={240} />
          </div>
        )}
      </Wide>
    </div>
  );
}

/**
 * A numbered figure with its caption above it.
 *
 * `framed` is for the two map plates, which are drawn on their own ground and
 * need an edge; the two charts draw their own neat line and would read as
 * boxed twice.
 */
function Plate({
  n,
  caption,
  framed = false,
  children,
}: {
  n: string;
  caption: string;
  framed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <figure className="flex flex-col">
      <figcaption
        className="min-h-[5.5rem] border-b pb-3"
        style={{ borderColor: "var(--line)" }}
      >
        <div className="flex items-baseline gap-3">
          <Tag tone="accent">Figure {n}</Tag>
          <span
            className="h-px min-w-4 flex-1"
            style={{ background: "var(--line)" }}
            aria-hidden
          />
        </div>
        <p className="text-dim mt-2 text-[13px] leading-[1.5]">{caption}</p>
      </figcaption>

      <div
        className={`mt-4 ${framed ? "border" : ""}`}
        style={
          framed
            ? { borderColor: "var(--line)", background: "var(--base-2)" }
            : undefined
        }
      >
        {children}
      </div>
    </figure>
  );
}
