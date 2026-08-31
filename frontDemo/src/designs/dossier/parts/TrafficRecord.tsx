/**
 * IV -- TRAFFIC RECORD.
 *
 * The register of who was in the water, hour by hour, from the first parcel of
 * the discharge to the satellite pass.
 *
 * This part exists to keep the gate auditable. Part V hands the reader a short
 * list of scored candidates, and a short list produced by a filter is only
 * trustworthy if the thing it was filtered out of is also on the record. So the
 * register is printed in full: every hour of the event, how much oil was in the
 * water at that hour, how big it was, and which tracks were within twelve
 * kilometres of it.
 *
 * The distinction the copy on this sheet works hardest to hold is that presence
 * is not a ranking and not an allegation. Seventy-odd vessels pass within twelve
 * kilometres of a slick in a busy approach every hour; that is what a shipping
 * lane is. Being in the register is a far weaker claim than being a candidate,
 * and the two must never be allowed to blur into each other.
 *
 * One working exhibit is permitted in this file and it is here. It is framed as
 * one: a plate the reader operates is no longer the plate a finding was written
 * against, and the caption says so.
 */

import { useMemo, useState } from "react";

import { useDesign } from "../../../DesignContext";
import { MapCanvas } from "../../../map/MapCanvas";
import { DEFAULT_TOGGLES, type LayerToggles } from "../../../map/basemap";
import { clock, formatHour } from "../../../lib/format";
import {
  CONTACT_RADIUS_KM,
  PHASE_LABEL,
  eventSpan,
  momentAt,
  type Contact,
} from "../../../lib/playback";
import type { ShellProps } from "../../registry";

import {
  Exhibit,
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
  Stamp,
  TickBox,
} from "../components";
import { EventStrip } from "../plates";

/**
 * How many tracks each hour of the register prints before it summarises.
 *
 * A busy approach puts dozens of vessels inside the radius every hour. Printing
 * all of them would bury the register; printing some of them and stopping
 * silently would misrepresent it. So it prints the nearest few and states the
 * remainder as a count, which is what a register does with a long entry.
 */
const ROWS_PER_HOUR = 4;

export default function TrafficRecord({ state }: ShellProps) {
  const { run } = state;
  const design = useDesign();
  const [toggles, setToggles] = useState<LayerToggles>({
    ...DEFAULT_TOGGLES,
    forecast: false,
  });

  const now = useMemo(
    () => (run ? momentAt(run, state.hour) : null),
    [run, state.hour],
  );

  /**
   * The register itself.
   *
   * Built once per case. Each row costs a pass over every vessel in the
   * scenario -- there are around 250 -- so this is memoised on the run and
   * never recomputed while the reader scrubs.
   */
  const register = useMemo(() => {
    if (!run) return [];
    const first = Math.round(run.releaseStartHour);
    const rows: {
      hour: number;
      at: number;
      released: number;
      areaKm2: number;
      contacts: Contact[];
      inContact: number;
    }[] = [];
    for (let h = first; h <= 0; h++) {
      const m = momentAt(run, h);
      rows.push({
        hour: h,
        at: m.at,
        released: m.releasedFraction,
        areaKm2: m.areaKm2,
        contacts: m.contacts,
        inContact: m.inContact,
      });
    }
    return rows;
  }, [run]);

  /** Distinct tracks that appear anywhere in the register, for the gate note. */
  const seen = useMemo(() => {
    const ids = new Set<string>();
    for (const row of register) for (const c of row.contacts) ids.add(c.mmsi);
    return ids.size;
  }, [register]);

  if (!run) return null;

  const [spanLo, spanHi] = eventSpan(run);
  const candidateCount = run.suspects.length;

  return (
    <>
      <PartTitle
        numeral="IV"
        title="Traffic record"
        standfirst={`Every hour from the first parcel in the water to the satellite pass, with the tracks that were within ${CONTACT_RADIUS_KM} km of the oil at that hour. This is a record of presence. It is not a ranking, and appearing in it is not an allegation.`}
      />

      <Leaf
        margin={
          <MarginNote label="Standing of this record">
            A vessel is in this register because it passed close to oil that was
            on the surface at the time. That is a statement about geography. A
            candidate in Part V is a track the origin field reaches at a matching
            time, which is a statement about transport. The second is evidence;
            the first is context.
          </MarginNote>
        }
      >
        <Head level={3}>Why the record is filed in full</Head>
        <Prose className="mt-4">
          The gate is the step that turns tens of thousands of historical AIS
          reports into a handful of candidates, and it is the only filter in this
          system with physics behind it. A filter that cannot be inspected is
          indistinguishable from a filter that was tuned until it produced the
          answer somebody wanted, so what it was applied to is filed here
          alongside what came out of it.<Ref n={1} />
        </Prose>
        <Prose className="mt-4">
          Across the {register.length} hours of the event, {seen} distinct tracks
          came within {CONTACT_RADIUS_KM} km of oil on the surface.{" "}
          {candidateCount} of them, together with the unlit contacts and the fixed
          installations in the area of interest, are scored in Part V. The
          difference between those two numbers is the gate, and it is the whole
          contribution this project claims.
        </Prose>

        <div className="mt-6 grid max-w-[46rem] grid-cols-1 gap-x-12 sm:grid-cols-2">
          <div>
            <FieldRow label="Hours of record" value={String(register.length)} />
            <FieldRow label="AIS reports in case" value={run.aisPointCount.toLocaleString()} />
            <FieldRow label="Tracks in scenario" value={String(run.vessels.length)} />
          </div>
          <div>
            <FieldRow label={`Within ${CONTACT_RADIUS_KM} km`} value={String(seen)} />
            <FieldRow label="Scored in Part V" value={String(candidateCount)} tone="accent" />
            <FieldRow label="Named anywhere" value="None" />
          </div>
        </div>
      </Leaf>

      {/* ---------------------------------------------------------------- *
          The working exhibit
       * ---------------------------------------------------------------- */}
      <Leaf
        margin={
          <div>
            <MarginNote label="Working exhibit">
              The only plate in this file the reader operates. Scrubbing changes
              what it shows, so it is not a reproduction and cannot be cited as
              one.
            </MarginNote>
            <div className="mt-4">
              <Stamp tone="ink" size="small" angle={2.4}>
                Reader-operated
              </Stamp>
            </div>
          </div>
        }
      >
        <Exhibit
          n={8}
          working
          title="The event, played"
          source="model"
          sourceNote="Reader-operated · framing not fixed"
          caption={
            <>
              The oil as it entered the water and drifted, with the traffic drawn
              to the same instant. Before the pass the only thing on the surface
              is the oil released so far; the detector's mask does not exist yet,
              because the satellite has not been over. At{" "}
              {formatHour(state.hour)} the surface extent is{" "}
              {now ? now.areaKm2.toFixed(2) : "—"} km² and{" "}
              {now ? now.contacts.length : 0} tracks are within{" "}
              {CONTACT_RADIUS_KM} km.
            </>
          }
        >
          <div className="h-[420px] w-full sm:h-[520px]">
            <MapCanvas
              run={run}
              paint={design.map}
              hour={state.hour}
              toggles={toggles}
              selected={
                run.suspects.find((s) => s.id === state.selectedId) ?? null
              }
              onSelect={state.setSelectedId}
              interactive
              controls="scale"
              className="h-full w-full"
            />
          </div>
        </Exhibit>

        <div className="mt-6">
          <EventStrip run={run} hour={state.hour} onScrub={state.setHour} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div>
            <Micro tone="ink">Clock</Micro>
            <input
              type="range"
              className="scrub mt-2"
              min={spanLo}
              max={spanHi}
              step={1}
              value={state.hour}
              onChange={(e) => state.setHour(Number(e.target.value))}
              aria-label="Hours from acquisition"
            />
            <div className="text-faint flex items-baseline justify-between font-mono text-[9.5px] tracking-[0.18em] uppercase">
              <span>{formatHour(spanLo)}</span>
              <span style={{ color: "var(--ink)" }}>
                {formatHour(state.hour)} ·{" "}
                {now ? clock(now.at) : "--:--"}Z ·{" "}
                {now ? PHASE_LABEL[now.phase] : ""}
              </span>
              <span>{formatHour(spanHi)}</span>
            </div>

            <div className="mt-5 grid max-w-[40rem] grid-cols-1 gap-x-10 sm:grid-cols-2">
              <div>
                <FieldRow
                  label="Released"
                  value={`${((now?.releasedFraction ?? 0) * 100).toFixed(0)}%`}
                />
                <FieldRow label="Surface extent" value={`${(now?.areaKm2 ?? 0).toFixed(2)} km²`} />
              </div>
              <div>
                <FieldRow
                  label={`Within ${CONTACT_RADIUS_KM} km`}
                  value={String(now?.contacts.length ?? 0)}
                />
                <FieldRow
                  label="Touching the oil"
                  value={String(now?.inContact ?? 0)}
                  tone={now && now.inContact > 0 ? "accent" : "ink"}
                />
              </div>
            </div>
          </div>

          <div>
            <Micro tone="ink">Plate composition</Micro>
            <div className="mt-2 border-t" style={{ borderColor: "var(--line)" }}>
              {(
                [
                  ["release", "Oil on the surface"],
                  ["slick", "Detector mask"],
                  ["contours", "Credible regions"],
                  ["particles", "Ensemble particles"],
                  ["traffic", "All traffic"],
                  ["candidates", "Candidate tracks"],
                  ["targets", "Radar targets"],
                  ["forecast", "Impact forecast"],
                  ["labels", "Place names"],
                ] as [keyof LayerToggles, string][]
              ).map(([key, label]) => (
                <TickBox
                  key={key}
                  on={toggles[key]}
                  label={label}
                  onChange={(v) => setToggles((t) => ({ ...t, [key]: v }))}
                />
              ))}
            </div>
          </div>
        </div>
      </Leaf>

      {/* ---------------------------------------------------------------- *
          The register
       * ---------------------------------------------------------------- */}
      <Leaf
        margin={
          <MarginNote label="Exhibit 09">
            Identities are masked throughout. An unlit contact is never resolved
            to a name anywhere in this system, and neither is a transmitting one.
          </MarginNote>
        }
      >
        <Rule weight="firm" className="mb-6" />
        <Head level={3}>Register of presence</Head>
        <Prose className="mt-3" size="small">
          One row per hour, first parcel to satellite pass. The rightmost column
          lists the nearest {ROWS_PER_HOUR} tracks at that hour with their
          distance to the oil and their reported speed; where more were inside
          the radius the remainder is stated rather than dropped. A track marked
          in oxide was inside the oil's outline at that hour rather than near
          it.<Ref n={2} />
        </Prose>

        <div className="mt-5">
          <Register
            caption={`Hours ${formatHour(register[0]?.hour ?? 0)} to ${formatHour(0)}`}
            head={[
              "Hour",
              "UTC",
              "Released",
              "Extent",
              `≤${CONTACT_RADIUS_KM} km`,
              "In oil",
              "Nearest tracks",
            ]}
            align={["left", "left", "right", "right", "right", "right", "left"]}
            width={["4.5rem", "5rem", "5rem", "5.5rem", "4.5rem", "4rem", undefined]}
            dense
            rows={register.map((r) => {
              const shown = r.contacts.slice(0, ROWS_PER_HOUR);
              const rest = r.contacts.length - shown.length;
              return {
                key: String(r.hour),
                mark: r.hour === Math.round(state.hour),
                cells: [
                  <span className="num">{formatHour(r.hour)}</span>,
                  <span className="num text-[11px]">{clock(r.at)}</span>,
                  <span className="num">{(r.released * 100).toFixed(0)}%</span>,
                  <span className="num">{r.areaKm2.toFixed(2)}</span>,
                  <span className="num">{r.contacts.length}</span>,
                  <span
                    className="num"
                    style={{ color: r.inContact > 0 ? "var(--accent)" : undefined }}
                  >
                    {r.inContact}
                  </span>,
                  <div className="min-w-[18rem]">
                    {shown.length === 0 ? (
                      <span className="text-faint font-mono text-[10.5px]">
                        — no track within {CONTACT_RADIUS_KM} km —
                      </span>
                    ) : (
                      shown.map((c) => (
                        <div
                          key={c.mmsi}
                          className="num flex flex-wrap items-baseline gap-x-3 text-[10.5px] leading-[1.6]"
                          style={{
                            color:
                              c.distanceKm <= 0.001
                                ? "var(--accent)"
                                : "var(--ink-dim)",
                          }}
                        >
                          <span style={{ minWidth: "9.5rem" }}>
                            {c.candidate ? "▸ " : "  "}
                            {c.label}
                          </span>
                          <span>{c.distanceKm.toFixed(1)} km</span>
                          <span>{c.sog.toFixed(1)} kn</span>
                          <span className="text-faint">{c.cog.toFixed(0)}°</span>
                        </div>
                      ))
                    )}
                    {rest > 0 && (
                      <div className="text-faint mt-0.5 font-mono text-[10px] tracking-[0.12em] uppercase">
                        and {rest} more within {CONTACT_RADIUS_KM} km, not listed
                      </div>
                    )}
                  </div>,
                ],
              };
            })}
          />
        </div>

        <Prose className="mt-6" size="small">
          A caret marks a track that is also scored in Part V. Most rows here
          carry none: the register is mostly the ordinary traffic of a working
          approach, which is exactly why a list of everyone who was nearby is not
          an accusation of anything.
        </Prose>
      </Leaf>

      <Leaf pad="tight" margin={<Micro>Notes</Micro>}>
        <Footnotes
          items={[
            <>
              Every track in this register is simulated. Real AIS is commercially
              sensitive and state-restricted and is not redistributed here; the
              Indian-waters cases are authored because free real AIS covers
              United States waters only.
            </>,
            <>
              A distance of zero means the reported position fell inside the
              outline of the oil on the surface. It is normally zero for every
              track in a row, and that is the correct result rather than a
              failure: a slick is a thin ribbon, being inside its outline at a
              reported position is rare, and the scoring in Part V does not
              depend on it ever happening.
            </>,
          ]}
        />
      </Leaf>
    </>
  );
}
