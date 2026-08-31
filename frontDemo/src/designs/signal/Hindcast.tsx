/**
 * "The water" -- the working section of the publication.
 *
 * The investigation is a read. This is the same evidence with the controls left
 * on, so a reader who does not believe the piece can run the event themselves:
 * scrub from the first hour of the discharge to the forecast horizon, watch the
 * patch grow and drift, and watch the traffic move beside it.
 *
 * It is still set as a publication rather than as a dashboard. The map is one
 * wide plate with a caption, the transport is typographic, and the register of
 * who was in the water is a ruled table rather than a list of cards. Signal's
 * relationship with geography is "evidence exhibit" even when the exhibit is
 * live.
 */

import { useMemo, useState } from "react";
import { MapCanvas } from "../../map/MapCanvas";
import type { LayerToggles } from "../../map/basemap";
import { useDesign } from "../../DesignContext";
import { ageStatement, formatHour, stamp } from "../../lib/format";
import { momentAt } from "../../lib/playback";
import { orderedSuspects, type RunState } from "../../useRun";
import { EventTransport, MomentReadout } from "./Playback";
import { WideningFigure } from "./figures";
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
  SectionMark,
  Spread,
  Standfirst,
  Tag,
} from "./components";

/**
 * Layer sets, named the way an editor would ask for them rather than as a row
 * of checkboxes. Three views of the same instant, and nothing else -- a
 * publication does not hand the reader nine toggles and walk away.
 */
const VIEWS: {
  key: string;
  label: string;
  note: string;
  toggles: LayerToggles;
}[] = [
  {
    key: "event",
    label: "The event",
    note: "The oil as it entered the water and was carried, with the traffic that was there.",
    toggles: {
      release: true,
      slick: true,
      contours: false,
      particles: true,
      traffic: true,
      candidates: true,
      targets: false,
      forecast: false,
      labels: true,
    },
  },
  {
    key: "origin",
    label: "The origin field",
    note: "The credible regions the release could have come from, at this hour.",
    toggles: {
      release: false,
      slick: true,
      contours: true,
      particles: true,
      traffic: false,
      candidates: true,
      targets: false,
      forecast: false,
      labels: true,
    },
  },
  {
    key: "forecast",
    label: "Where it goes",
    note: "The 72 hour forward impact envelope from the same engine, run the other way.",
    toggles: {
      release: false,
      slick: true,
      contours: false,
      particles: true,
      traffic: false,
      candidates: false,
      targets: true,
      forecast: true,
      labels: true,
    },
  },
];

/** Rows of the proximity register printed before the tail is summarised. */
const REGISTER_ROWS = 12;

export default function Hindcast({ state }: { state: RunState }) {
  const def = useDesign();
  const { run, loading, hour, setHour } = state;
  const [view, setView] = useState(VIEWS[0].key);

  const suspects = useMemo(
    () => (run ? orderedSuspects(run, state.ablated) : []),
    [run, state.ablated],
  );

  if (loading || !run) {
    return (
      <Page>
        <div className="flex min-h-[60vh] items-center">
          <Kicker>Running the ensemble</Kicker>
        </div>
      </Page>
    );
  }

  const d = run.drift;
  const age = ageStatement(d);
  const active = VIEWS.find((v) => v.key === view) ?? VIEWS[0];
  const moment = momentAt(run, hour);
  const frame =
    d.frames.find((f) => f.hour === Math.round(hour)) ?? d.frames[0];

  return (
    <div>
      <Page>
        <section className="pt-12 pb-8 lg:pt-16">
          <Kicker>Working section · Hindcast</Kicker>
          <Head level={1} className="mt-5 max-w-[16ch]">
            Run the water yourself.
          </Head>
        </section>

        <Spread className="pb-10">
          <Gutter />
          <Measure>
            <Standfirst>
              Everything below is computed on this page from the same simulation
              the rest of the issue quotes. Drag the rule and the ocean moves:
              the oil grows out of nothing, the traffic that was reporting moves
              with it, and the credible origin region contracts or widens hour by
              hour.
            </Standfirst>
          </Measure>
          <Margin>
            <Note label="Why it is here">
              A piece that shows a result and not the working is asking to be
              believed. This section is the working.
            </Note>
          </Margin>
        </Spread>

        {/* View selector, set as a masthead of exhibits rather than tabs. */}
        <div
          className="mb-6 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t pt-4"
          style={{ borderColor: "var(--ink-faint)" }}
        >
          {VIEWS.map((v) => {
            const on = v.key === view;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                aria-current={on ? "true" : undefined}
                className="pb-0.5 font-mono text-[11px] tracking-[0.22em] uppercase transition-colors"
                style={{
                  color: on ? "var(--accent)" : "var(--ink-faint)",
                  borderBottom: `1px solid ${on ? "var(--accent)" : "transparent"}`,
                }}
              >
                {v.label}
              </button>
            );
          })}
          <p
            className="text-dim ml-auto max-w-[52ch] text-[13px] leading-[1.45]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            {active.note}
          </p>
        </div>
      </Page>

      <Page>
        <Exhibit
          n={1}
          bleed
          caption={
            <>
              {active.note} Hour {formatHour(hour)}, {stamp(moment.at)}. Every
              layer is generated by the simulation on this page; the world
              underneath is a basemap raster and carries no data.
            </>
          }
          source="Model output · simulated"
        >
          <div
            className="h-[64vh] max-h-[720px] min-h-[380px] w-full"
            style={{
              borderTop: "1px solid var(--line)",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <MapCanvas
              run={run}
              paint={def.map}
              hour={hour}
              toggles={active.toggles}
              selected={suspects.find((s) => s.id === state.selectedId) ?? null}
              onSelect={(id) => id && state.setSelectedId(id)}
              controls="scale"
              className="h-full w-full"
            />
          </div>
        </Exhibit>
      </Page>

      <Page>
        <div className="py-12">
          <EventTransport run={run} hour={hour} onChange={setHour} />
        </div>

        <div className="border-t pt-10 pb-14" style={{ borderColor: "var(--line)" }}>
          <MomentReadout run={run} hour={hour} />
        </div>
      </Page>

      {/* Who was in the water, live. */}
      <Page>
        <SectionMark
          index={1}
          kicker="The register"
          title="Who was in the water at this hour"
        />

        <Spread className="pb-16">
          <Gutter />
          <Measure className="lg:col-span-2 lg:col-start-2">
            <Ledger
              head={["Vessel", "Type", "Distance to the oil", "Speed", "Course", ""]}
              align={["left", "left", "right", "right", "right", "left"]}
              rows={
                moment.contacts.length
                  ? // Capped. A working port puts seventy-odd transponding
                    // vessels inside twelve kilometres, and a table that long
                    // stops being a register and becomes a wall. The count of
                    // what is not shown is stated under it rather than dropped.
                    moment.contacts.slice(0, REGISTER_ROWS).map((ct) => [
                      <span className="num text-[13.5px]">{ct.label}</span>,
                      <span className="text-dim text-[13px]">{ct.kind}</span>,
                      <span
                        className="num text-[13.5px]"
                        style={{
                          color:
                            ct.distanceKm < 0.05 ? "var(--accent)" : "var(--ink)",
                        }}
                      >
                        {ct.distanceKm < 0.05
                          ? "in the oil"
                          : `${ct.distanceKm.toFixed(1)} km`}
                      </span>,
                      <span className="num text-[13px]">{ct.sog.toFixed(1)} kn</span>,
                      <span className="num text-dim text-[13px]">
                        {ct.cog.toFixed(0)}°
                      </span>,
                      ct.candidate ? <Tag tone="accent">scored</Tag> : null,
                    ])
                  : [
                      [
                        <span
                          className="text-dim text-[13.5px]"
                          style={{ fontFamily: "var(--font-body)" }}
                        >
                          {moment.phase === "pre"
                            ? "The release has not started. There is no oil to be near."
                            : "No transponding vessel within 12 kilometres at this hour."}
                        </span>,
                        "",
                        "",
                        "",
                        "",
                        "",
                      ],
                    ]
              }
            />
            {moment.contacts.length > REGISTER_ROWS && (
              <p className="text-faint mt-3 font-mono text-[10.5px] tracking-[0.16em] uppercase">
                {moment.contacts.length - REGISTER_ROWS} further tracks within 12
                km, not listed
              </p>
            )}
          </Measure>
        </Spread>

        <Spread className="pb-16">
          <Gutter />
          <Measure>
            <Body>
              Being in this table is not an allegation and not a ranking. It is
              proximity, which is the weakest possible relationship to a spill:
              a vessel can be a kilometre from oil it did not release, and the
              vessel that did release it can be forty kilometres away by the time
              the satellite passes. The register exists so the step that produced
              the candidate list stays auditable, not so the reader can pick a
              suspect out of it.
            </Body>
          </Measure>
          <Margin>
            <Note label="Marked “scored”">
              Only tracks that were inside the credible origin region at a
              matching backward hour survive the gate and get a score. Everything
              else in this table was simply nearby.
            </Note>
          </Margin>
        </Spread>
      </Page>

      {/* The field at this hour. */}
      <Page>
        <SectionMark
          index={2}
          kicker="The field"
          title="What the ensemble says at this hour"
        />

        <Spread className="pb-12">
          <Gutter />
          <Measure>
            <Body size="large">
              At {formatHour(hour)} the 50% credible region covers{" "}
              <Figure value={frame.area50Km2.toFixed(1)} unit="km²" /> and the
              90% region covers{" "}
              <Figure value={frame.area90Km2.toFixed(1)} unit="km²" />, with the
              particle cloud spread{" "}
              <Figure value={frame.spreadKm.toFixed(1)} unit="km" /> about its
              centroid.
            </Body>
            <Body className="mt-6">
              The ensemble is {d.ensembleSize} members carrying{" "}
              {d.particleCount.toLocaleString()} particles, differing in wind
              drift factor, horizontal diffusivity and wind phase — because the
              published sensitivity work found that wind phase is where the
              spread actually comes from. One trajectory would be a prediction. A
              spread of them is an assessment.
            </Body>
            <Body className="mt-6">
              Age on this scene is{" "}
              <span className="text-accent">{age.value}</span>: {age.phrase}.
            </Body>
          </Measure>
          <Margin>
            <Note label="Reported, not tuned">
              The 90% region grows the further back the model is run. Reversing a
              diffusive process spreads it. If that growth ever swallows the
              distinction between candidates, the correct output is that the
              evidence is insufficient — not the best-scoring vessel that happens
              to be inside it.
            </Note>
          </Margin>
        </Spread>

        <div className="pb-20">
          <Exhibit
            n={2}
            caption={
              <>
                Area of the 90% origin contour against hours before acquisition,
                with the estimated release window shaded and the reader's current
                hour marked. Published rather than smoothed.
              </>
            }
            source="Model output · simulated"
          >
            <WideningFigure run={run} />
          </Exhibit>
        </div>
      </Page>
    </div>
  );
}
