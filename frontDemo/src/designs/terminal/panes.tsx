/**
 * The three live panes: 01 DETECT, 02 DRIFT, 03 TRAFFIC.
 *
 * "Live" means their contents are a function of `state.hour`. Scrub the
 * timeline and these three change; the analytical panes in `reports.tsx` do
 * not, because a score computed from the whole record does not have an hour.
 * That split is why the console has six numbered panes rather than one long
 * page: the operator needs to know which readouts move with the clock.
 *
 * Every pane is a single scrolling column of rows at one type size. There is no
 * hierarchy of headings here beyond the block rule, and that is deliberate --
 * on a workstation the frame is the heading, and a pane that introduces itself
 * three times has spent a third of its rows on furniture.
 */

import { useMemo, type ReactNode } from "react";
import { SarTile, boundsFor } from "../../components/SarTile";
import { ageStatement, formatHour, stamp } from "../../lib/format";
import { CONTACT_RADIUS_KM, PHASE_LABEL, type Moment } from "../../lib/playback";
import type { DriftVariant } from "../../sim/scoring";
import type { Run } from "../../sim/types";
import {
  Alarm,
  Block,
  Btn,
  Field,
  Flag,
  Meter,
  Note,
  Pane,
  Row,
  SCROLL,
  Table,
} from "./components";
import {
  ConvergencePlot,
  FieldScope,
  SpreadPlot,
  WidthProfile,
  WindGatePlot,
} from "./instruments";

/** The scrolling body every pane shares. */
export function PaneBody({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto px-3 py-3" style={SCROLL}>
      {children}
    </div>
  );
}

const REGION: Record<string, string> = {
  "gulf-of-mexico": "gulf of mexico",
  "indian-waters": "indian waters",
};

/* ================================================================== *
 * 01 DETECT
 * ================================================================== */

const TILE_W = 560;
const TILE_H = 340;

export function Detect({ run }: { run: Run }) {
  const d = run.detection;
  const c = run.characterisation;
  const bounds = useMemo(
    () => boundsFor(d.parts, 0.36, TILE_W / TILE_H),
    [d.parts],
  );

  const unknown = d.className === "slick_unknown";

  return (
    <Pane
      index="01"
      title="Detect"
      right={
        <Flag tone={unknown ? "warn" : "ok"}>
          {unknown ? "unknown origin" : "oos"}
        </Flag>
      }
    >
      <PaneBody>
        <Block label="Scene">
          <Row label="scene" value={d.sceneId} />
          <Row label="acq" value={stamp(d.acquiredAt)} />
          <Row label="sensor" value="sentinel-1 iw · vv · 10 m" />
          <Row label="region" value={REGION[run.meta.region] ?? run.meta.region} />
          <Row
            label="centre"
            value={`${run.meta.centre[1].toFixed(3)} ${run.meta.centre[0].toFixed(3)}`}
          />
          <Note label="provenance" tone="warn">
            {run.meta.provenance}
          </Note>
        </Block>

        <Block label="Classify" right={`${d.parts.length} part`}>
          <Row label="class" value={d.className} tone={unknown ? "warn" : "ok"} />
          <Meter
            label="conf"
            value={d.confidence}
            display={d.confidence.toFixed(2)}
            tone={d.confidence > 0.7 ? "ok" : "warn"}
          />
          <Note>
            Two foreground classes, not one: an operational discharge and a slick
            whose origin is unknown. The second is the class a look-alike lands
            in, and keeping it separate is what stops a biogenic film being
            counted as a spill further down the pipeline.
          </Note>
        </Block>

        <Block label="Geometry">
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="area" value={c.areaKm2.toFixed(2)} unit="km2" />
            <Field label="length" value={c.lengthKm.toFixed(1)} unit="km" />
            <Field label="width mean" value={c.widthMMean.toFixed(0)} unit="m" />
            <Field label="orientation" value={`${c.orientationDeg.toFixed(0)}°`} />
          </div>
          <div className="mt-2">
            <Row label="elongation" value={c.elongation.toFixed(1)} />
            <Row label="compactness" value={c.compactness.toFixed(2)} />
            <Row label="fragmentation" value={c.fragmentation.toFixed(2)} />
            <Row
              label="head/tail"
              value={c.headTailResolvedBy.replace(/_/g, " ")}
              tone={c.headTailResolvedBy === "ambiguous" ? "warn" : "ok"}
            />
          </div>
          {c.headTailResolvedBy === "ambiguous" && (
            <Note tone="warn" label="ambiguous">
              Geometry alone cannot say which end of a ribbon is the fresh one.
              Where the drift field does not resolve it, both ends are carried
              forward and proximity is computed against each.
            </Note>
          )}
        </Block>

        <Block label="Width profile" right="head → tail">
          <WidthProfile values={c.widthMProfile} />
        </Block>

        <Block label="Damping">
          <Row label="ratio" value={`${c.dampingRatioDb.toFixed(1)} dB`} />
          <Row label="confidence" value={c.dampingConfidence} tone="warn" />
          <Note tone="warn" label="not a thickness">
            A relative backscatter contrast index between the slick and the water
            around it. There is no field in this system for microns and none for
            volume, because converting a contrast ratio into either would be
            inventing a number remote sensing cannot currently supply.
          </Note>
        </Block>

        <Block label="Wind gate" right={`x${c.windGateMultiplier.toFixed(2)}`}>
          <WindGatePlot ms={c.windSpeedMs} value={c.windGateMultiplier} />
          <Row label="wind" value={`${c.windSpeedMs.toFixed(1)} m/s`} />
          <Row
            label="multiplier"
            value={`x${c.windGateMultiplier.toFixed(2)}`}
            tone={c.windGateMultiplier < 0.5 ? "warn" : "ok"}
          />
          <Note tone={c.windGateMultiplier < 0.5 ? "warn" : "faint"} label="continuous">
            The gate is a confidence multiplier applied to every score that rests
            on this detection, never a filter that removes it. Both band edges
            are ramps: below about 2 m/s the sea is flat whether or not there is
            oil on it, above about 13 m/s the oil is mixed down. A detection
            inside the ramp is kept, shown, and scaled.
          </Note>
        </Block>

        <Block label="Radar tile" right="synthesised">
          <div className="border" style={{ borderColor: "var(--line)" }}>
            <SarTile
              parts={d.parts}
              bounds={bounds}
              seed={`${run.meta.id}-terminal`}
              dampingDb={c.dampingRatioDb}
              windMs={c.windSpeedMs}
              showMask
              maskColour="var(--accent)"
              width={TILE_W}
              height={TILE_H}
              className="block w-full"
            />
          </div>
          <Note label="generated, not acquired">
            Gamma speckle at four looks over a wind-modulated mean, damped inside
            the mask by the ratio above. It is a picture of what the detector is
            asked to work on, not an acquisition, and nothing on this display is
            a photograph of the sea.
          </Note>
        </Block>
      </PaneBody>
    </Pane>
  );
}

/* ================================================================== *
 * 02 DRIFT
 * ================================================================== */

export function Drift({
  run,
  hour,
  variant,
  setVariant,
}: {
  run: Run;
  hour: number;
  variant: DriftVariant;
  setVariant: (v: DriftVariant) => void;
}) {
  const d = run.drift;
  const age = ageStatement(d);
  const rounded = Math.round(hour);
  const frame = d.frames.find((f) => f.hour === rounded) ?? null;

  return (
    <Pane
      index="02"
      title="Drift"
      right={
        <Flag tone={d.insufficientEvidence ? "alarm" : "ok"}>
          {d.insufficientEvidence ? "diffuse" : "converged"}
        </Flag>
      }
    >
      <PaneBody>
        {d.insufficientEvidence && (
          <div className="mb-3">
            <Alarm code="E-C3" title="field too diffuse to discriminate" compact>
              <p>
                90% contour {d.insufficientEvidence.area90Km2.toFixed(0)} km².{" "}
                {d.insufficientEvidence.reason}
              </p>
            </Alarm>
          </div>
        )}

        <Block label="Ensemble">
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="members" value={d.ensembleSize} />
            <Field label="particles" value={d.particleCount.toLocaleString()} />
            <Field label="backward" value={`${d.backwardHours} h`} />
            <Field label="forward" value={`${d.forwardHours} h`} />
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span
              className="text-[10px] tracking-[0.14em] uppercase"
              style={{ color: "var(--ink-faint)" }}
            >
              s_drift
            </span>
            <Btn onClick={() => setVariant("integral")} active={variant === "integral"}>
              integral
            </Btn>
            <Btn onClick={() => setVariant("max")} active={variant === "max"}>
              max
            </Btn>
          </div>
          <Note label="ensemble, not a trajectory">
            Twelve members stepped backward through perturbed forcing produce a
            probability field over space and time. There is no single reverse
            track anywhere in this system, and the display never draws one: what
            contracts toward the release is a stack of credible regions, and its
            width is the answer, not an error bar on a better answer.
          </Note>
        </Block>

        <Block label={`Field at ${formatHour(rounded)}`} right={frame ? `${frame.spreadKm.toFixed(1)} km spread` : "--"}>
          <FieldScope run={run} hour={hour} />
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <Field label="50%" value={frame ? frame.area50Km2.toFixed(1) : "--"} unit="km2" />
            <Field label="90%" value={frame ? frame.area90Km2.toFixed(1) : "--"} unit="km2" />
            <Field label="spread" value={frame ? frame.spreadKm.toFixed(1) : "--"} unit="km" />
          </div>
        </Block>

        <Block label="Convergence" right="area90 vs hour">
          <ConvergencePlot run={run} />
          <SpreadPlot run={run} hour={hour} />
          <Note>
            Published as the model emits it. The insufficient-evidence rule is
            written against this curve, so smoothing it to look like a cleaner
            basin would be hiding the measurement the refusal depends on.
          </Note>
        </Block>

        <Block label="Age" right={age.method}>
          <div
            className="border px-3 py-2"
            style={{ borderColor: "var(--accent)", background: "var(--base)" }}
          >
            <p className="text-[9px] tracking-[0.22em] uppercase" style={{ color: "var(--ink-faint)" }}>
              estimated age
            </p>
            <p className="num mt-1 text-[22px] leading-none" style={{ color: "var(--accent)" }}>
              {age.value}
            </p>
          </div>
          <div className="mt-2">
            <Row label="method" value={age.method} />
            <Row label="state" value={age.state} tone={age.degenerate ? "warn" : "ink"} />
            <Row label="interval" value={`${d.ageHours[0]}–${d.ageHours[2]} h`} tone="dim" />
          </div>
          <Note tone={age.degenerate ? "warn" : "faint"} label="how to read it">
            {age.phrase}. There is no reliable regressor from a radar image to an
            age, so this is never reported as a single number: what the system
            determined is a window, and the window is what every temporal term
            downstream is scored against.
          </Note>
        </Block>
      </PaneBody>
    </Pane>
  );
}

/* ================================================================== *
 * 03 TRAFFIC
 * ================================================================== */

/**
 * How many contacts the table prints.
 *
 * A busy scene puts seventy-odd tracks inside the twelve kilometre radius at
 * once. Printing all of them turns a readout into a scroll, and the tail of a
 * distance-sorted list is the least informative part of it -- so the table is
 * capped and the remainder is stated as a count rather than silently dropped.
 */
const CONTACT_CAP = 14;

export function Traffic({
  run,
  moment,
  hour,
  selectedId,
  setSelectedId,
}: {
  run: Run;
  moment: Moment | null;
  hour: number;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}) {
  const contacts = moment?.contacts ?? [];
  const shown = contacts.slice(0, CONTACT_CAP);
  const rest = contacts.length - shown.length;
  const gated = run.suspects.filter((s) => s.kind === "ais_vessel").length;

  return (
    <Pane
      index="03"
      title="Traffic"
      right={<Flag tone={contacts.length ? "ok" : "dim"}>{contacts.length} near</Flag>}
    >
      <PaneBody>
        <Block label="AIS" right={`${CONTACT_RADIUS_KM} km radius`}>
          <div className="grid grid-cols-3 gap-1.5">
            <Field label="reports" value={run.aisPointCount.toLocaleString()} />
            <Field label="tracks" value={run.vessels.length} />
            <Field label="gated" value={gated} tone="ok" />
          </div>
          <Note>
            The gate is the only filter in this system with physics behind it: a
            track survives it only if it was inside the credible origin region at
            the hour that region describes. It is what turns tens of thousands of
            reports into a handful of candidates.
          </Note>
        </Block>

        <Block
          label={`Proximity at ${formatHour(hour)}`}
          right={`${contacts.length} within ${CONTACT_RADIUS_KM} km`}
        >
          <Table
            head={["km", "contact", "kn", "deg", ""]}
            align={["right", "left", "right", "right", "left"]}
            keys={shown.map((c) => c.mmsi)}
            activeKey={selectedId}
            // Only a scored candidate can be selected. Clicking a track that was
            // merely nearby must not put it in the evidence pane, because the
            // evidence pane is where the system makes its case and this table is
            // explicitly not part of it.
            onSelect={(id) => {
              if (run.suspects.some((s) => s.id === id)) setSelectedId(id);
            }}
            empty={
              moment && moment.phase === "pre"
                ? "no oil in the water at this hour"
                : "no track within the radius at this hour"
            }
            rows={shown.map((c) => [
              <span style={{ color: c.distanceKm <= 0.001 ? "var(--warn)" : "var(--ink)" }}>
                {c.distanceKm <= 0.001 ? "0.0" : c.distanceKm.toFixed(1)}
              </span>,
              <span style={{ color: c.candidate ? "var(--accent)" : "var(--ink-dim)" }}>
                {c.label}
              </span>,
              c.sog.toFixed(1),
              String(Math.round(c.cog)).padStart(3, "0"),
              <span className="flex gap-1">
                {c.distanceKm <= 0.001 && <Flag tone="warn">in oil</Flag>}
                {c.candidate && <Flag tone="ok">cand</Flag>}
              </span>,
            ])}
          />
          {rest > 0 && (
            <p className="mt-1.5 text-[10px]" style={{ color: "var(--ink-faint)" }}>
              + {rest} further track{rest > 1 ? "s" : ""} inside the radius, not printed. Sorted by
              distance; the tail is the least informative part of the list.
            </p>
          )}
          <Note tone="warn" label="proximity is not a ranking">
            This is who was in the water near the oil at this hour, nothing more.
            Being present is a far weaker claim than being a candidate: a vessel
            in this table has not been scored, gated against the origin field, or
            checked for parity with the slick. The candidates are in pane 04, and
            a track can sit at the top of this list and never appear there.
          </Note>
        </Block>

        <Block label="Event state" right={moment ? PHASE_LABEL[moment.phase].toLowerCase() : "--"}>
          {moment && (
            <>
              <Meter
                label="release"
                value={moment.releasedFraction}
                display={`${(moment.releasedFraction * 100).toFixed(0)}%`}
              />
              <Row label="surface" value={moment.areaKm2.toFixed(2)} unit="km2" />
              <Row
                label="since start"
                value={moment.sinceStart >= 0 ? `${moment.sinceStart.toFixed(0)} h` : "not yet"}
              />
              <Row
                label="inside extent"
                value={moment.inContact}
                tone={moment.inContact ? "warn" : "dim"}
              />
            </>
          )}
          <Note label="playback">
            PLAY on the timeline runs the event forward from the first hour of the
            discharge. The oil starts as a few hundred metres of surface and grows;
            the traffic is mapped from that first hour, not from the satellite pass.
            A count of zero inside the extent is the ordinary case and not a
            failure — a vessel that discharged and kept steaming is several
            kilometres clear of its own slick within the hour.
          </Note>
        </Block>
      </PaneBody>
    </Pane>
  );
}
