/**
 * I -- INCIDENT.
 *
 * The opening statement of the file: what was detected, where, when, and what
 * the system believes happened before the satellite arrived.
 *
 * The part is deliberately narrative before it is numeric. A case file does not
 * open with a metrics grid; it opens with an account of the incident, and the
 * register underneath it is what the account is checkable against. The two
 * exhibits are a locality chart and the chronology, which are the two questions
 * a reader has before any of the analysis means anything: where is this, and
 * what order did it happen in.
 */

import { useMemo } from "react";

import { useDesign } from "../../../DesignContext";
import { MapCanvas } from "../../../map/MapCanvas";
import { DEFAULT_TOGGLES } from "../../../map/basemap";
import { ageStatement, clock, dateline, formatHour, stamp } from "../../../lib/format";
import { PHASE_LABEL, momentAt, phaseAt } from "../../../lib/playback";
import { scenarioListing } from "../../../sim/scenarios";
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
  Rule,
  Stamp,
} from "../components";
import { EventStrip } from "../plates";

/** A locality chart shows where, not what. The result layers stay off. */
const LOCALITY_TOGGLES = {
  ...DEFAULT_TOGGLES,
  contours: false,
  particles: false,
  traffic: false,
  candidates: false,
  forecast: false,
  release: false,
};

export default function Incident({ state }: ShellProps) {
  const { run } = state;
  const design = useDesign();

  // The event as it stood at the pass. Read at hour zero rather than at the
  // reader's current hour: Part I is the statement of the incident, and a
  // statement that changed as the reader scrubbed a control in Part IV would
  // not be a statement.
  const atPass = useMemo(() => (run ? momentAt(run, 0) : null), [run]);

  // Four sampled instants for the strip's footer. `momentAt` walks every vessel
  // in the scenario -- 250-odd of them -- so the samples are memoised rather
  // than recomputed inside the JSX, where they would re-run on every render of
  // a part that re-renders whenever the reader touches anything.
  const marks = useMemo(() => {
    if (!run) return [];
    const hours = [
      run.releaseStartHour,
      Math.round(run.releaseStartHour / 2),
      run.releaseEndHour,
      0,
    ];
    return hours.map((h) => ({ hour: h, moment: momentAt(run, h) }));
  }, [run]);

  if (!run) return null;

  const age = ageStatement(run.drift);
  const listing = scenarioListing(state.scenario);
  const ongoing = run.releaseEndHour > -0.5;
  const dischargeHours = Math.abs(run.releaseEndHour - run.releaseStartHour);

  return (
    <>
      <PartTitle
        numeral="I"
        title="Incident"
        standfirst={`A slick was recorded in synthetic-aperture radar over the ${
          run.meta.region === "gulf-of-mexico" ? "Gulf of Mexico" : "Indian coastal waters"
        } at ${stamp(run.meta.acquiredAt)}. This part states what was detected and, from the reconstruction filed in Part III, what the system believes preceded it.`}
      />

      <Leaf
        margin={
          <MarginNote label="Classification">
            The detector emits two foreground classes. An operational discharge
            is a slick with the geometry of something laid down by a moving or
            berthed source; a slick of unknown origin is everything else it is
            confident is oil. Neither class is an attribution.
          </MarginNote>
        }
      >
        <Head level={3}>Account of the incident</Head>

        <Prose className="mt-4">
          Oil began entering the water at about {formatHour(run.releaseStartHour)}
          , {Math.abs(run.releaseStartHour)} hours before the acquisition
          {ongoing
            ? ", and was still entering it when the satellite passed over"
            : `, and stopped at about ${formatHour(run.releaseEndHour)}`}
          . Over the {dischargeHours.toFixed(0)} hours of the discharge the
          surface extent grew from nothing to{" "}
          {atPass ? atPass.areaKm2.toFixed(1) : "—"} km², drifting under the same
          currents and wind the reconstruction in Part III later steps
          backward.<Ref n={1} />
        </Prose>

        <Prose className="mt-4">
          At the pass the detector segmented{" "}
          {run.detection.parts.length === 1
            ? "a single connected mask"
            : `${run.detection.parts.length} connected masks`}{" "}
          covering {run.characterisation.areaKm2.toFixed(1)} km², elongated
          {" "}{run.characterisation.elongation.toFixed(0)}:1 along a bearing of{" "}
          {((run.characterisation.orientationDeg + 360) % 360).toFixed(0)}°. Its
          age is stated as {age.value} by {age.method}, and the reason it is
          stated as an interval rather than a number is set out in Part
          III.<Ref n={2} />
        </Prose>

        <Prose className="mt-4">
          This case is filed to test one thing: {listing.tests.toLowerCase()}
        </Prose>
      </Leaf>

      <Leaf
        margin={
          <div>
            <Micro>Register</Micro>
            <div className="mt-3">
              <Stamp tone="faint" size="small" angle={-2.4}>
                Simulated
              </Stamp>
            </div>
          </div>
        }
      >
        <Rule weight="firm" className="mb-5" />
        <div className="grid grid-cols-1 gap-x-12 md:grid-cols-2">
          <div>
            <Micro tone="ink" className="mb-2">
              Detection
            </Micro>
            <FieldRow label="Region" value={run.meta.region === "gulf-of-mexico" ? "Gulf of Mexico" : "Indian waters"} />
            <FieldRow label="Scene" value={run.detection.sceneId} />
            <FieldRow label="Acquired" value={`${dateline(run.meta.acquiredAt)} ${clock(run.meta.acquiredAt)}Z`} />
            <FieldRow
              label="Class"
              value={run.detection.className === "oos" ? "Operational discharge" : "Origin unknown"}
            />
            <FieldRow label="Confidence" value={run.detection.confidence.toFixed(2)} />
            <FieldRow label="Parts" value={String(run.detection.parts.length)} />
          </div>
          <div>
            <Micro tone="ink" className="mb-2">
              Event
            </Micro>
            <FieldRow label="Discharge began" value={formatHour(run.releaseStartHour)} />
            <FieldRow
              label="Discharge ended"
              value={ongoing ? "Still running at the pass" : formatHour(run.releaseEndHour)}
            />
            <FieldRow label="Extent at pass" value={`${run.characterisation.areaKm2.toFixed(1)} km²`} />
            <FieldRow label="Length" value={`${run.characterisation.lengthKm.toFixed(1)} km`} />
            <FieldRow
              label="Age"
              value={age.value}
              tone="accent"
              note={`Stated by ${age.method}. ${age.degenerate ? "The interval carries no usable width, so the state leads instead of the numbers." : "Never reported as a single figure."}`}
            />
            <FieldRow label="Temporal state" value={age.state} />
          </div>
        </div>
      </Leaf>

      <Leaf
        margin={
          <MarginNote label="Exhibit 01">
            A locality chart, not a working map. The framing is fixed because a
            reproduction filed in a case has one framing, and the result layers
            are off: this sheet answers where, and nothing else.
          </MarginNote>
        }
      >
        <Exhibit
          n={1}
          title="Locality"
          source="model"
          sourceNote="Basemap Esri · geometry model output"
          caption={
            <>
              The detected slick in its setting, at the moment of the pass. Fixed
              scale and framing; the credible regions, the traffic and the
              candidate tracks are filed separately in Parts III to V.
            </>
          }
        >
          <div className="h-[380px] w-full sm:h-[460px]">
            <MapCanvas
              run={run}
              paint={design.map}
              hour={0}
              toggles={LOCALITY_TOGGLES}
              selected={null}
              interactive={false}
              controls="scale"
              className="h-full w-full"
            />
          </div>
        </Exhibit>
      </Leaf>

      <Leaf
        margin={
          <MarginNote label="Exhibit 02">
            The chronology is filed here so the register in Part IV can be read
            against it. Every hour listed there is a point on this strip.
          </MarginNote>
        }
      >
        <Exhibit
          n={2}
          title="Chronology of the event"
          source="model"
          caption={
            <>
              Released fraction and surface extent from the first parcel in the
              water to the end of the forecast. The event is a quantity entering
              the sea over hours, not a shape that appeared: at{" "}
              {formatHour(run.releaseStartHour)} there is almost nothing on the
              surface, and the mask the detector segmented is the state at{" "}
              {formatHour(0)}.
            </>
          }
        >
          <EventStrip run={run} hour={0} />
        </Exhibit>

        <div className="mt-6 grid grid-cols-2 gap-x-8 sm:grid-cols-4">
          {marks.map(({ hour: h, moment: m }, i) => (
            <div
              key={`${h}-${i}`}
              className="border-t py-3"
              style={{ borderColor: "var(--line)" }}
            >
              <Micro tone={h === 0 ? "accent" : "faint"}>{formatHour(h)}</Micro>
              <p
                className="mt-1.5 text-[11px] leading-[1.4]"
                style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}
              >
                {PHASE_LABEL[phaseAt(run, h)]}
              </p>
              <p className="num mt-1.5 text-[12px]" style={{ color: "var(--ink)" }}>
                {(m.releasedFraction * 100).toFixed(0)}% · {m.areaKm2.toFixed(1)} km²
              </p>
            </div>
          ))}
        </div>
      </Leaf>

      <Leaf pad="tight" margin={<Micro>Notes</Micro>}>
        <Footnotes
          items={[
            <>
              The release, the currents and the wind on this sheet are generated
              by the simulation running in this page. {run.meta.provenance}
            </>,
            <>
              An age is never printed here as a single number. The interval and
              the method that produced it travel together, and where the
              discharge had not stopped at the pass the state is reported instead
              of a width that would be false precision in the other direction.
            </>,
          ]}
        />
      </Leaf>
    </>
  );
}
