/**
 * What the spill is going to reach.
 *
 * The same engine that runs backward to find the source runs forward to say
 * where the oil goes next, and this is that. It is deliberately the shortest
 * data block on the page, because it is also the one where it would be easiest
 * to overclaim: an impact forecast invites a number for how much oil, and this
 * system has no honest way to produce one.
 *
 * So the block states an envelope and an exposure, and then states plainly what
 * it cannot say. The limits are set in the same weight of type as the forecast,
 * not in a footnote.
 */

import { LIMITS } from "../../content";
import type { SpillState } from "../../lib/spill";
import { MapCanvas } from "../../map/MapCanvas";
import { DEFAULT_TOGGLES } from "../../map/basemap";
import { usePaint } from "../../lib/palette";
import {
  Body,
  Margin,
  Measure,
  Note,
  Page,
  SectionMark,
  Spread,
  Tag,
} from "../components";
import { Row, Segments } from "../instruments";
import { SpillSelect } from "../SpillSelect";
import { Loading } from "../Loading";

/** The limits that bear directly on an impact claim. */
const RELEVANT = ["thickness", "forcing", "diffusion"];

export function Damage({ spill }: { spill: SpillState }) {
  const { run } = spill;
  const paint = usePaint();

  // The forecast envelope, at the forward horizon. Area is the union the
  // contours enclose rather than a sum over frames, which would double-count
  // every hour the oil sat still.
  const horizon = run?.drift.forwardHours ?? 0;
  const lastForward = run?.drift.frames
    .filter((f) => f.hour > 0)
    .reduce<null | { hour: number; area90Km2: number }>(
      (m, f) => (m && m.hour > f.hour ? m : f),
      null,
    );

  return (
    <section id="damage" ref={spill.ref} className="scroll-mt-[70px] py-14">
      <Page>
        <SectionMark
          index={3}
          kicker="Forecast"
          title="What it reaches next"
        />

        <Spread className="mt-8">
          <Measure>
            <Body>
              Run the same ensemble forward instead of backward and it becomes
              an impact forecast: not a line showing where the slick will be,
              but an envelope containing most of where it could be, widening
              with every hour it is projected.
            </Body>
            <Body className="mt-4">
              This is the output that matters operationally — it is what decides
              where a response vessel goes and which stretch of coast gets
              warned. It is also the output most easily overstated, so the
              envelope is drawn at its honest width rather than at the width
              that would look decisive.
            </Body>
          </Measure>
          <Margin>
            {run && lastForward && (
              <div className="space-y-2">
                <Row label="Horizon" value={`${horizon} h`} />
                <Row
                  label="90% envelope"
                  value={`${lastForward.area90Km2.toFixed(0)} km²`}
                />
                <Row
                  label="At the pass"
                  value={`${run.characterisation.areaKm2.toFixed(2)} km²`}
                />
                <div className="mt-3">
                  <p className="text-faint font-mono text-[9.5px] tracking-[0.24em] uppercase">
                    Spread over the forecast
                  </p>
                  <div className="mt-1.5">
                    <Segments
                      value={Math.min(
                        1,
                        run.characterisation.areaKm2 /
                          Math.max(1, lastForward.area90Km2),
                      )}
                    />
                  </div>
                  <p className="text-faint mt-1.5 text-[12px] leading-[1.5]">
                    The observed slick against the area it could occupy in{" "}
                    {horizon} hours.
                  </p>
                </div>
              </div>
            )}
          </Margin>
        </Spread>

        <div className="mt-10">
          {run ? (
            <figure>
              <div
                className="border"
                style={{ borderColor: "var(--line)", height: 420 }}
              >
                <MapCanvas
                  run={run}
                  paint={paint}
                  hour={horizon}
                  /* This block is the forecast outright, so there is nothing
                     from before the pass that belongs on it. */
                  direction="forward"
                  toggles={{
                    ...DEFAULT_TOGGLES,
                    forecast: true,
                    particles: false,
                    traffic: false,
                    candidates: false,
                    targets: false,
                  }}
                  selected={null}
                  className="h-full w-full"
                  interactive
                  controls="scale"
                />
              </div>
              <figcaption className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <Tag tone="accent">Figure 3</Tag>
                <span className="text-dim max-w-[74ch] text-[13.5px] leading-[1.5]">
                  The {horizon} hour impact envelope, drawn at 12 hour steps.
                  Each ring is the 90% credible region for that hour; the
                  outermost is the furthest the oil could plausibly have reached
                  by the horizon.
                </span>
              </figcaption>
              <SpillSelect spill={spill} label="Forecast" />
            </figure>
          ) : (
            <Loading label="Projecting forward" height={420} />
          )}
        </div>

        {/* The limits, in the same weight as the claim above them. */}
        <Spread className="mt-12">
          <Measure>
            <div className="space-y-6">
              {LIMITS.filter((l) => RELEVANT.includes(l.key)).map((l) => (
                <div key={l.key}>
                  <h3
                    className="text-ink text-[17px] leading-[1.3]"
                    style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
                  >
                    {l.title}
                  </h3>
                  <Body className="mt-2" size="small">
                    {l.body}
                  </Body>
                </div>
              ))}
            </div>
          </Measure>
          <Margin>
            <Note label="Why no volume">
              Every interface that reports a spill wants to say how many tonnes.
              Backscatter contrast cannot supply it, and converting a relative
              damping index into a thickness would be inventing the number
              rather than measuring it. There is no field for it anywhere in the
              system, which is a structural refusal rather than a missing
              feature.
            </Note>
          </Margin>
        </Spread>
      </Page>
    </section>
  );
}
