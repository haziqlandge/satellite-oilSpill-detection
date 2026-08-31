/**
 * ORBIT -- what is actually mounted in the racks.
 *
 * One module per key in `modes.ts`. They are real components rather than render
 * functions in a table, which is not a style preference: modes mount and unmount
 * different subsets of this file, and a plain function called from the rail's
 * render would move every hook inside it into the rail's own hook order. Change
 * mode, change the subset, and React sees a different sequence of hooks in the
 * same component. Components have their own identity and their own hook order,
 * so switching mode is a mount, which is what it should have been anyway.
 *
 * Every module in here obeys the same four rules, and they are correctness
 * rules rather than house style:
 *
 *  - no bare age (C1). `ageStatement` decides how to say it, including the case
 *    where the discharge had not stopped and an interval would be false
 *    precision in the other direction
 *  - no bare total (C4). A score is never shown without its six terms, their
 *    weights and the sentence that produced each one
 *  - the damping index is a relative dB contrast and is labelled as one (C2).
 *    There is no micron and no volume anywhere in this file
 *  - the wind gate is a continuous multiplier, on screen, with the band drawn on
 *    the gauge (C9). Nothing disappears quietly
 */

import { useMemo, type ComponentType } from "react";
import { SarTile, boundsFor } from "../../components/SarTile";
import { useDesign } from "../../DesignContext";
import {
  KIND_SHORT,
  TERM_LABEL,
  TERM_ORDER,
  ageStatement,
  formatHour,
  relHour,
  signed,
  stamp,
} from "../../lib/format";
import { CONTACT_RADIUS_KM, PHASE_LABEL, growthCurve, type Moment } from "../../lib/playback";
import { fieldHours, fieldProjection, ringPath } from "../../lib/project";
import { TERM_NOTE, TERM_ORIGIN } from "../../content";
import { WEIGHTS_VERSION } from "../../sim/scoring";
import { orderedSuspects, type RunState } from "../../useRun";
import type { LayerToggles } from "../../map/basemap";
import type { Run, ScoreTermKey, Suspect } from "../../sim/types";
import {
  Gauge,
  Instrument,
  Lamp,
  Note,
  Readout,
  Rocker,
  Row,
  Segments,
  Selector,
  Tag,
  Trace,
  alpha,
  useTone,
} from "./instruments";

/** Everything a module is allowed to read, assembled once per frame by the shell. */
export interface Deck {
  run: Run;
  state: RunState;
  moment: Moment;
  /** Change mission mode. Relation footers are live links, not captions. */
  go: (mode: string) => void;
  toggles: LayerToggles;
  setToggles: (t: LayerToggles) => void;
}

type Module = ComponentType<{ deck: Deck }>;

/* ------------------------------------------------------------------ *
 * M1  OBSERVE
 * ------------------------------------------------------------------ */

const Acquisition: Module = ({ deck: { run, go } }) => (
  <Instrument
    code="INS-01"
    title="Acquisition"
    source="PUB"
    status="nominal"
    relation={{ label: "constrains → age interval", mode: "reconstruct", onGo: go }}
  >
    <Readout value={stamp(run.meta.acquiredAt).slice(11)} unit="UTC" size={26} />
    <div className="mt-2">
      <Row label="Scene" value={run.detection.sceneId} />
      <Row label="Sensor" value="S1 IW · VV" title="Sentinel-1 interferometric wide swath, VV polarisation" />
      <Row label="Date" value={stamp(run.meta.acquiredAt).slice(0, 10)} />
      <Row
        label="Basin"
        value={run.meta.region === "gulf-of-mexico" ? "GULF OF MEXICO" : "INDIAN WATERS"}
      />
    </div>
    <Note className="mt-2">
      One pass. Sentinel-1 revisits every six to twelve days, so this slick is
      observed once and never tracked across scenes.
    </Note>
  </Instrument>
);

const Geometry: Module = ({ deck: { run, go } }) => {
  const c = run.characterisation;
  const profile = c.widthMProfile;

  return (
    <Instrument
      code="INS-02"
      title="Slick geometry"
      source="SIM"
      relation={{ label: "seeds → backward ensemble", mode: "reconstruct", onGo: go }}
    >
      <div className="flex items-end gap-3">
        <Readout value={c.areaKm2.toFixed(2)} unit="km²" size={26} />
        <div className="flex-1">
          <Row label="Length" value={`${c.lengthKm.toFixed(1)} km`} />
          <Row label="Width" value={`${Math.round(c.widthMMean)} m`} />
        </div>
      </div>

      <div className="mt-2.5">
        <p
          className="num mb-1 text-[8.5px] tracking-[0.16em]"
          style={{ color: "var(--ink-faint)" }}
        >
          WIDTH PROFILE · HEAD → TAIL
        </p>
        <Trace values={profile} height={30} tone="var(--accent)" />
      </div>

      <div className="mt-1.5">
        <Row label="Bearing" value={`${Math.round(c.orientationDeg)}°`} />
        <Row label="Elongation" value={c.elongation.toFixed(1)} />
        <Row label="Fragments" value={run.detection.parts.length} />
        <Row
          label="Head"
          value={c.headTailResolvedBy === "drift_field" ? "BY FIELD" : "AMBIGUOUS"}
          tone={c.headTailResolvedBy === "drift_field" ? "var(--ink)" : "var(--ink-dim)"}
        />
      </div>

      <Note className="mt-2">
        Geometry alone cannot say which end of a ribbon is the head. Where the
        two ends were emitted, the drift field is what resolves it.
      </Note>
    </Instrument>
  );
};

const Damping: Module = ({ deck: { run } }) => {
  const db = run.characterisation.dampingRatioDb;
  return (
    <Instrument code="INS-03" title="Damping index" source="SIM" status="caution">
      <div className="flex items-center gap-3">
        <Gauge
          value={db}
          min={-15}
          max={0}
          size={86}
          unit="dB"
          format={(v) => v.toFixed(1)}
          ticks={15}
        />
        <div className="min-w-0 flex-1">
          <Row label="Contrast" value={`${db.toFixed(1)} dB`} />
          <Row label="Confidence" value={run.characterisation.dampingConfidence.toUpperCase()} />
          <div className="mt-1 flex gap-1">
            <Tag>NO THICKNESS FIELD</Tag>
          </div>
        </div>
      </div>
      <Note className="mt-2">
        A relative backscatter contrast between the slick and the water around
        it. Converting it to microns, or to a spilled volume, would be inventing
        a number remote sensing cannot supply — so there is no field for either
        anywhere in this system.
      </Note>
    </Instrument>
  );
};

const Scene: Module = ({ deck: { run, toggles, setToggles } }) => {
  const W = 268;
  const H = 150;
  const bounds = useMemo(
    () => boundsFor(run.detection.parts, 0.34, W / H),
    [run.detection.parts],
  );

  return (
    <Instrument code="INS-04" title="Radar scene" source="SIM">
      <div
        className="overflow-hidden rounded-[6px]"
        style={{ border: `1px solid ${alpha("var(--line)", 100)}` }}
      >
        <SarTile
          parts={run.detection.parts}
          bounds={bounds}
          seed={run.detection.sceneId}
          dampingDb={run.characterisation.dampingRatioDb}
          windMs={run.characterisation.windSpeedMs}
          showMask={toggles.slick}
          maskColour="var(--accent)"
          width={W * 2}
          height={H * 2}
          className="block h-auto w-full"
        />
      </div>
      <div className="mt-1.5">
        <Rocker
          on={toggles.slick}
          onChange={(v) => setToggles({ ...toggles, slick: v })}
          label="Segmentation mask"
          hint="Also drives the detection layer on the chart"
        />
      </div>
      <Note className="mt-1.5">
        Synthesised from a speckle model — gamma-distributed, multiplicative,
        with the slick as a region of suppressed mean backscatter. Not an
        acquisition, and nothing on this page is.
      </Note>
    </Instrument>
  );
};

const Classification: Module = ({ deck: { run, go } }) => {
  const unknown = run.detection.className !== "oos";
  return (
    <Instrument
      code="INS-05"
      title="Classification"
      source="SIM"
      status={unknown ? "caution" : "nominal"}
      relation={{ label: "feeds → wind gate", mode: "observe", onGo: go }}
    >
      <Readout
        value={unknown ? "SLICK, UNKNOWN" : "OPERATIONAL DISCHARGE"}
        size={unknown ? 15 : 13}
      />
      <div className="mt-2">
        <p className="num mb-1 text-[8.5px] tracking-[0.16em]" style={{ color: "var(--ink-faint)" }}>
          {`DETECTOR CONFIDENCE ${(run.detection.confidence * 100).toFixed(0)}%`}
        </p>
        <Segments value={run.detection.confidence} />
      </div>
      <div className="mt-2">
        <Row label="Detection" value={run.detection.id} />
        <Row label="Classes" value="OOS · SLICK_UNKNOWN" />
      </div>
      <Note className="mt-2">
        Two foreground classes, instance masks rather than boxes: the ensemble is
        seeded inside the mask, and a bounding box would seed the sea around it.
      </Note>
    </Instrument>
  );
};

const Wind: Module = ({ deck: { run, go } }) => {
  const c = run.characterisation;
  const weak = c.windGateMultiplier < 0.62;
  return (
    <Instrument
      code="INS-06"
      title="Wind gate"
      source="PUB"
      status={weak ? "caution" : "nominal"}
      relation={{ label: "multiplies → every candidate score", mode: "attribute", onGo: go }}
    >
      <div className="flex items-center gap-3">
        <Gauge
          value={c.windSpeedMs}
          min={0}
          max={20}
          band={[3, 12]}
          size={86}
          unit="m/s"
          format={(v) => v.toFixed(1)}
          ticks={20}
          tone={weak ? "var(--ink-dim)" : "var(--accent)"}
        />
        <div className="min-w-0 flex-1">
          <p className="num mb-1 text-[8.5px] tracking-[0.16em]" style={{ color: "var(--ink-faint)" }}>
            {`MULTIPLIER ×${c.windGateMultiplier.toFixed(2)}`}
          </p>
          <Segments value={c.windGateMultiplier} tone={weak ? "var(--ink-dim)" : "var(--accent)"} />
          <div className="mt-1.5">
            <Row label="Band" value="3–12 m/s" title="Where oil is detectable in radar at all" />
          </div>
        </div>
      </div>
      <Note className="mt-2">
        Continuous, never a cut. Below three metres per second the sea is already
        flat and a biogenic film looks the same as oil; above twelve the slick is
        mixed down. A detection near either edge loses confidence visibly instead
        of quietly disappearing.
      </Note>
    </Instrument>
  );
};

/* ------------------------------------------------------------------ *
 * M2  RECONSTRUCT
 * ------------------------------------------------------------------ */

const Age: Module = ({ deck: { run, go } }) => {
  const age = ageStatement(run.drift);
  const [lo, best, hi] = run.drift.ageHours;

  return (
    <Instrument
      code="INS-07"
      title="Age interval"
      source="SIM"
      status={age.degenerate ? "caution" : "nominal"}
      relation={{ label: "gates → AIS by time", mode: "traffic", onGo: go }}
    >
      <Readout value={age.value} unit="since release" size={age.value.length > 6 ? 20 : 30} />

      {/* The interval drawn, not printed. C1 forbids a scalar; a bar makes the
          width of the claim the first thing read rather than a footnote. */}
      <div className="mt-2.5">
        <div
          className="relative h-[26px] rounded-[4px]"
          style={{ border: `1px solid ${alpha("var(--line)", 100)}`, background: alpha("var(--base-3)", 70) }}
        >
          <span
            className="absolute inset-y-[3px] rounded-[2px]"
            style={{
              left: `${(lo / Math.max(hi, 1)) * 88 + 4}%`,
              width: `${Math.max(4, ((hi - lo) / Math.max(hi, 1)) * 88)}%`,
              background: alpha("var(--accent)", 22),
              border: `1px solid ${alpha("var(--accent)", 60)}`,
            }}
          />
          {!age.degenerate && (
            <span
              className="absolute inset-y-0 w-px"
              style={{ left: `${(best / Math.max(hi, 1)) * 88 + 4}%`, background: "var(--accent)" }}
            />
          )}
          <span
            className="num absolute top-1/2 left-2 -translate-y-1/2 text-[8.5px]"
            style={{ color: "var(--ink-faint)" }}
          >
            0h
          </span>
          <span
            className="num absolute top-1/2 right-2 -translate-y-1/2 text-[8.5px]"
            style={{ color: "var(--ink-faint)" }}
          >
            {`${Math.max(hi, 1)}h`}
          </span>
        </div>
      </div>

      <div className="mt-2">
        <Row label="Method" value={age.method.toUpperCase()} />
        <Row label="State" value={age.state.toUpperCase()} />
      </div>

      <Note className="mt-2">{sentenceCase(age.phrase)}.</Note>
    </Instrument>
  );
};

const Convergence: Module = ({ deck: { run, moment } }) => {
  const conv = run.drift.convergence;
  const areas = conv.map((c) => c.area90Km2);
  const minAt = areas.indexOf(Math.min(...areas));
  const mark = nearestIndex(conv.map((c) => c.hour), moment.hour);

  return (
    <Instrument code="INS-08" title="Drift convergence" source="SIM">
      <Trace values={areas} height={46} baseline={minAt} mark={mark} />
      <div className="mt-1 flex justify-between">
        <span className="num text-[8.5px]" style={{ color: "var(--ink-faint)" }}>
          {relHour(conv[0]?.hour ?? 0)}h
        </span>
        <span className="num text-[8.5px]" style={{ color: "var(--ink-faint)" }}>
          {relHour(conv[conv.length - 1]?.hour ?? 0)}h
        </span>
      </div>
      <div className="mt-1.5">
        <Row label="Minimum" value={`${areas[minAt]?.toFixed(0) ?? "—"} km²`} />
        <Row label="At" value={formatHour(conv[minAt]?.hour ?? 0)} />
        <Row label="Spread" value={`${conv[minAt]?.spreadKm.toFixed(1) ?? "—"} km`} />
      </div>
      <Note className="mt-2">
        Reversing a spreading process spreads it further. The tightest hour is
        where the ensemble agrees most, and how sharp that minimum is decides
        whether an age can be stated at all.
      </Note>
    </Instrument>
  );
};

const Ensemble: Module = ({ deck: { run, moment } }) => {
  const frame = frameAt(run, moment.hour);
  return (
    <Instrument code="INS-09" title="Ensemble" source="SIM">
      <div className="flex items-center gap-3">
        <Gauge
          value={frame?.spreadKm ?? 0}
          min={0}
          max={Math.max(12, Math.ceil((frame?.spreadKm ?? 0) * 1.4))}
          size={86}
          unit="km"
          format={(v) => v.toFixed(1)}
          ticks={10}
        />
        <div className="min-w-0 flex-1">
          <Row label="Members" value={run.drift.ensembleSize} />
          <Row label="Particles" value={run.drift.particleCount.toLocaleString("en")} />
          <Row label="Backward" value={`${run.drift.backwardHours} h`} />
          <Row label="Forward" value={`${run.drift.forwardHours} h`} />
        </div>
      </div>
      <Note className="mt-2">
        {`${run.drift.ensembleSize} members stepped through perturbed currents and wind. The field is their union; there is no single backward trajectory in this system, and the mean of an ensemble is not one.`}
      </Note>
    </Instrument>
  );
};

const Origin: Module = ({ deck: { run, moment, go } }) => {
  const frame = frameAt(run, moment.hour);
  const insufficient = run.drift.insufficientEvidence;

  return (
    <Instrument
      code="INS-10"
      title="Origin probability"
      source="SIM"
      status={insufficient ? "hold" : "active"}
      relation={{ label: "conditions → AIS gate", mode: "traffic", onGo: go }}
    >
      <Readout
        value={frame ? frame.area90Km2.toFixed(0) : "—"}
        unit="km² @ 90%"
        tone={insufficient ? "var(--ink-dim)" : "var(--ink)"}
        size={28}
      />
      <div className="mt-2">
        <Row label="50% region" value={`${frame?.area50Km2.toFixed(0) ?? "—"} km²`} />
        <Row label="At" value={formatHour(moment.hour)} />
        <Row label="Spread" value={`${frame?.spreadKm.toFixed(1) ?? "—"} km`} />
      </div>
      <Note className="mt-2">
        A credible region over space and time, evaluated at the mission clock.
        Not a point, and never a bearing to one — the two rings are where the
        source is likely to have been, at the hour shown, at two confidence
        levels.
      </Note>
    </Instrument>
  );
};

/**
 * The origin field, contracting.
 *
 * A small independent plot rather than a crop of the chart, because the argument
 * needs several hours at once and the chart can only draw one. The stack runs
 * from the outer hour inward: each ring is the 90% credible region at that hour,
 * and the fact that they nest is the entire claim the hindcast makes.
 */
const Field: Module = ({ deck: { run, moment } }) => {
  const W = 268;
  const H = 168;
  const hours = useMemo(() => fieldHours(run, 7), [run]);
  const proj = useMemo(() => fieldProjection(run, W, H, hours), [run, hours]);
  const def = useDesign();
  const current = Math.round(moment.hour);

  return (
    <Instrument code="INS-11" title="Field scope" source="SIM">
      <div
        className="overflow-hidden rounded-[6px]"
        style={{
          border: `1px solid ${alpha("var(--line)", 100)}`,
          background: alpha("var(--base)", 60),
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden>
          {hours.map((h, i) => {
            const f = run.drift.frames.find((x) => x.hour === h);
            if (!f) return null;
            const near = h === current;
            const t = i / Math.max(1, hours.length - 1);
            return (
              <g key={h}>
                {f.contour90.map((ring, j) => (
                  <path
                    key={j}
                    d={ringPath(ring, proj)}
                    fill={near ? alpha(def.map.contour50, 12) : "none"}
                    stroke={near ? def.map.contour50 : alpha(def.map.contour90, 30 + t * 55)}
                    strokeWidth={near ? 1.6 : 1}
                    strokeDasharray={near ? undefined : "3 2"}
                  />
                ))}
              </g>
            );
          })}
          {run.detection.parts.map((ring, i) => (
            <path
              key={`d${i}`}
              d={ringPath(ring, proj)}
              fill={alpha(def.map.slick, 40)}
              stroke={def.map.slick}
              strokeWidth="1.2"
            />
          ))}
        </svg>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Tag>{`${hours.length} HOURS STACKED`}</Tag>
        <Tag tone={def.map.slick}>DETECTION</Tag>
        <Tag tone={def.map.contour50}>{formatHour(current)}</Tag>
      </div>
      <Note className="mt-1.5">
        Ninety per cent credible regions from the outer hour inward. They nest
        because the ensemble agrees more the closer it gets to the release; where
        they stop nesting is where attribution stops.
      </Note>
    </Instrument>
  );
};

const Horizon: Module = ({ deck: { run, state } }) => (
  <Instrument code="INS-12" title="Hindcast horizon" source="SIM">
    <Row label="Backward" value={`${run.drift.backwardHours} h`} />
    <Row label="Forward" value={`${run.drift.forwardHours} h`} />
    <Row label="Temporal" value={run.drift.temporalState.toUpperCase()} />
    <Row label="Weights" value={WEIGHTS_VERSION} />

    <div className="mt-2.5">
      <p className="num mb-1 text-[8.5px] tracking-[0.16em]" style={{ color: "var(--ink-faint)" }}>
        S_DRIFT FORMULATION
      </p>
      <Selector
        ariaLabel="Drift term formulation"
        value={state.variant}
        onChange={state.setVariant}
        options={[
          { value: "integral" as const, label: "Integral", title: "Integrate the track through the field; favours a lingering vessel" },
          { value: "max" as const, label: "Max", title: "Take the single best point of the track through the field" },
        ]}
      />
    </div>
    <Note className="mt-2">
      An open question from the synthesis, left open here: the integral should
      favour a vessel that lingered inside the field, which is the berthed case.
      Changing it rebuilds the run and rescores every candidate.
    </Note>
  </Instrument>
);

/* ------------------------------------------------------------------ *
 * M3  TRAFFIC
 * ------------------------------------------------------------------ */

const Playback: Module = ({ deck: { run, moment, go } }) => {
  const tone = useTone();
  const status =
    moment.phase === "discharging" ? "active" : moment.phase === "pre" ? "nominal" : "nominal";

  return (
    <Instrument
      code="INS-13"
      title="Event playback"
      source="SIM"
      status={status}
      relation={{ label: "drives → every instrument on this panel", mode: "traffic", onGo: go }}
    >
      <div className="flex items-center gap-3">
        <Gauge
          value={moment.releasedFraction}
          size={86}
          unit="released"
          format={(v) => `${(v * 100).toFixed(0)}%`}
          ticks={10}
        />
        <div className="min-w-0 flex-1">
          <Lamp status={status} label={moment.phase.toUpperCase()} />
          <div className="mt-1">
            <Row label="Since start" value={`${moment.sinceStart.toFixed(1)} h`} />
            <Row label="Clock" value={formatHour(moment.hour)} />
            <Row label="Discharge" value={`${Math.round(run.releaseEndHour - run.releaseStartHour)} h`} />
          </div>
        </div>
      </div>
      <p
        className="mt-2 text-[11px] leading-[1.45]"
        style={{ fontFamily: "var(--font-body)", color: tone.nominal }}
      >
        {PHASE_LABEL[moment.phase]}. The oil did not appear as a finished shape —
        it entered the water a parcel at a time, grew, and was carried. Run the
        transport below to watch it.
      </p>
    </Instrument>
  );
};

const Growth: Module = ({ deck: { run, moment } }) => {
  const curve = useMemo(() => growthCurve(run), [run]);
  const mark = nearestIndex(curve.map((c) => c.hour), moment.hour);

  return (
    <Instrument code="INS-14" title="Surface extent" source="SIM">
      <Readout value={moment.areaKm2.toFixed(2)} unit="km² on the surface" size={26} />
      <div className="mt-2">
        <p className="num mb-1 text-[8.5px] tracking-[0.16em]" style={{ color: "var(--ink-faint)" }}>
          EXTENT · WHOLE EVENT
        </p>
        <Trace values={curve.map((c) => c.areaKm2)} height={38} mark={mark} />
      </div>
      <div className="mt-2">
        <p className="num mb-1 text-[8.5px] tracking-[0.16em]" style={{ color: "var(--ink-faint)" }}>
          {`RELEASED FRACTION ${(moment.releasedFraction * 100).toFixed(0)}%`}
        </p>
        <Segments value={moment.releasedFraction} />
      </div>
      <Note className="mt-2">
        Extent is surface area, and surface area is not volume. Oil spreads,
        thins and weathers, so a bigger patch at hour twelve is not more oil than
        the same patch at hour two.
      </Note>
    </Instrument>
  );
};

const Gate: Module = ({ deck: { run, go } }) => (
  <Instrument
    code="INS-15"
    title="AIS gate"
    source="SIM"
    relation={{ label: "produces → candidate set", mode: "attribute", onGo: go }}
  >
    <div className="flex items-baseline gap-3">
      <Readout value={run.aisPointCount.toLocaleString("en")} unit="reports" size={22} />
    </div>
    <div className="mt-2">
      <Row label="Tracks" value={run.vessels.length} />
      <Row label="Gated" value={run.suspects.length} tone="var(--accent)" />
      <Row label="Radar targets" value={run.cfarTargets.length} />
      <Row label="Fixed assets" value={run.infrastructure.length} />
    </div>
    <Note className="mt-2">
      Historic traffic filtered against the origin field at matching times. This
      is the step that turns tens of thousands of reports into a handful of
      candidates, and it is the only filter in the system with physics behind it.
    </Note>
  </Instrument>
);

/**
 * Who was in the water.
 *
 * Explicitly not a ranking, and the module says so in the type it is set in as
 * well as in words: no rank column, no score, no accent on the rows. Presence
 * near oil is a far weaker claim than a scored candidate, and this is the one
 * place in the product where the two could be confused.
 *
 * The live figure is the nearest approach rather than the count inside the
 * extent. A vessel is only inside the polygon in the hour or two around the
 * release -- the oil leaves wherever it came from almost immediately -- so an
 * "in contact" readout would sit at zero all evening and say nothing. Nearest
 * approach moves continuously and is the number that carries the information.
 */
const Contacts: Module = ({ deck: { moment, state, go } }) => {
  const def = useDesign();
  const SHOWN = 6;
  const rows = moment.contacts.slice(0, SHOWN);
  const rest = moment.contacts.length - rows.length;
  const nearest = moment.contacts[0];

  return (
    <Instrument
      code="INS-16"
      title={`Contacts ≤ ${CONTACT_RADIUS_KM} km`}
      source="SIM"
      status={moment.contacts.length ? "active" : "nominal"}
      relation={{ label: "not a ranking → see attribution", mode: "attribute", onGo: go }}
    >
      <div className="flex items-end gap-3">
        <Readout
          value={nearest ? nearest.distanceKm.toFixed(2) : "—"}
          unit="km nearest"
          size={26}
        />
        <div className="flex-1">
          <Row label="Within" value={moment.contacts.length} />
          <Row
            label="In the oil"
            value={moment.inContact}
            tone={moment.inContact ? "var(--accent)" : "var(--ink-dim)"}
            title="Tracks whose position falls inside the surface extent at this hour"
          />
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-[3px]">
        {rows.map((c) => (
          <button
            key={c.mmsi}
            type="button"
            onClick={() => c.candidate && state.setSelectedId(c.mmsi)}
            disabled={!c.candidate}
            className="flex items-center gap-2 rounded-[4px] px-1.5 py-1 text-left transition-colors"
            style={{
              border: `1px solid ${alpha("var(--line)", c.candidate ? 100 : 55)}`,
              background:
                c.mmsi === state.selectedId ? alpha("var(--accent)", 10) : "transparent",
              cursor: c.candidate ? "pointer" : "default",
            }}
            title={c.candidate ? "A scored candidate — open its evidence" : "Present, not scored"}
          >
            <span
              aria-hidden
              className="shrink-0 rounded-[1px]"
              style={{
                width: 3,
                height: 16,
                background: c.candidate ? def.map.candidate : alpha(def.map.traffic, 100),
              }}
            />
            <span className="num min-w-0 flex-1 truncate text-[10px]" style={{ color: "var(--ink)" }}>
              {c.label}
            </span>
            <span className="num shrink-0 text-[9.5px]" style={{ color: "var(--ink-dim)" }}>
              {`${c.distanceKm.toFixed(2)}km`}
            </span>
            <span className="num shrink-0 text-[9px]" style={{ color: "var(--ink-faint)" }}>
              {`${c.sog.toFixed(1)}kn ${Math.round(c.cog)}°`}
            </span>
          </button>
        ))}
        {rest > 0 && (
          <p className="num px-1.5 pt-0.5 text-[9px]" style={{ color: "var(--ink-faint)" }}>
            {`+ ${rest} MORE WITHIN ${CONTACT_RADIUS_KM} KM, NEAREST FIRST`}
          </p>
        )}
        {!moment.contacts.length && (
          <p className="num px-1.5 py-2 text-[9.5px]" style={{ color: "var(--ink-faint)" }}>
            NO TRACK WITHIN RANGE AT THIS HOUR
          </p>
        )}
      </div>

      <Note className="mt-2">
        Presence, not a ranking. Being in the water beside oil is a much weaker
        claim than being a scored candidate, and most of these will be neither.
      </Note>
    </Instrument>
  );
};

const Forecast: Module = ({ deck: { run, toggles, setToggles } }) => (
  <Instrument code="INS-17" title={`${run.drift.forwardHours}h forecast`} source="SIM">
    <Readout value={`+${run.drift.forwardHours}`} unit="hours ahead" size={26} />
    <div className="mt-2">
      <Row label="Impact rings" value={run.forwardImpact.length} />
      <Row label="Engine" value="SAME ENSEMBLE" />
    </div>
    <div className="mt-1.5">
      <Rocker
        on={toggles.forecast}
        onChange={(v) => setToggles({ ...toggles, forecast: v })}
        label="Forecast envelope"
      />
    </div>
    <Note className="mt-1.5">
      The same drift engine, run forward instead of backward. The hindcast and
      the forecast are one model looking in two directions, which is why the
      forward envelope is a useful check on the backward field.
    </Note>
  </Instrument>
);

/* ------------------------------------------------------------------ *
 * M4  ATTRIBUTE
 * ------------------------------------------------------------------ */

const Attribution: Module = ({ deck: { run, state } }) => {
  const def = useDesign();
  const rows = orderedSuspects(run, state.ablated);
  const insufficient = run.drift.insufficientEvidence;

  if (insufficient) {
    return (
      <Instrument code="INS-18" title="Attribution" source="SIM" status="hold">
        <Lamp status="hold" label="WITHHELD" />
        <Note className="mt-2" tone="var(--ink)">
          The origin field is too diffuse to separate one candidate from another.
          No ranking is issued. That is the finding, not a missing result.
        </Note>
      </Instrument>
    );
  }

  return (
    <Instrument code="INS-18" title="Attribution" source="SIM" status="active">
      <div className="flex flex-col gap-1">
        {rows.map((s, i) => {
          const total = state.ablated ? s.totalWithoutDrift : s.total;
          const selected = s.id === state.selectedId;
          const moved = s.rank - s.rankWithoutDrift;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => state.setSelectedId(s.id)}
              className="rounded-[5px] px-1.5 py-1.5 text-left transition-colors"
              style={{
                border: `1px solid ${selected ? alpha("var(--accent)", 60) : alpha("var(--line)", 100)}`,
                background: selected ? alpha("var(--accent)", 9) : "transparent",
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="num shrink-0 text-[11px]"
                  style={{ color: i === 0 ? "var(--accent)" : "var(--ink-faint)" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: "var(--ink)", fontFamily: "var(--font-body)", fontWeight: 600 }}>
                  {s.label}
                </span>
                <Tag tone={s.kind === "dark_vessel" ? def.map.dark : undefined}>
                  {KIND_SHORT[s.kind]}
                </Tag>
                <span className="num shrink-0 text-[11px]" style={{ color: "var(--ink)" }}>
                  {total.toFixed(3)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="flex-1">
                  <Segments value={total} count={16} height={5} tone={i === 0 ? "var(--accent)" : "var(--ink-dim)"} />
                </span>
                {state.ablated && moved !== 0 && (
                  <span className="num shrink-0 text-[9px]" style={{ color: def.map.infrastructure }}>
                    {`${moved > 0 ? "▲" : "▼"}${Math.abs(moved)} WITHOUT S_DRIFT`}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <Note className="mt-2">
        Candidates, ranked by a score. Not a determination and not an
        identification: unlit contacts are ranked and never named, and the
        alternatives stay on screen beside the leader.
      </Note>
    </Instrument>
  );
};

const Ablation: Module = ({ deck: { run, state } }) => {
  const def = useDesign();
  const moved = run.suspects.filter((s) => s.rank !== s.rankWithoutDrift).length;

  return (
    <Instrument
      code="INS-19"
      title="S_drift ablation"
      source="SIM"
      status={state.ablated ? "caution" : "nominal"}
    >
      <Rocker
        on={state.ablated}
        onChange={state.setAblated}
        label="Remove the drift term"
        hint="Rescore and re-rank with S_drift excluded"
      />
      <div className="mt-2">
        <Row label="Ranks moved" value={moved} tone={moved ? def.map.infrastructure : undefined} />
        <Row label="Weights" value={WEIGHTS_VERSION} />
        <Row label="Terms" value={TERM_ORDER.length} />
      </div>
      <Note className="mt-2">
        The one term nothing in the reviewed literature computes. Take it out and
        the ranking is what the reference implementation would have produced;
        what moves is exactly the contribution of the backward field.
      </Note>
    </Instrument>
  );
};

const Evidence: Module = ({ deck: { run, state } }) => {
  const def = useDesign();
  const selected: Suspect | null =
    run.suspects.find((s) => s.id === state.selectedId) ?? run.suspects[0] ?? null;

  if (!selected) {
    return (
      <Instrument code="INS-20" title="Evidence card" source="SIM" status="hold">
        <Note>No candidate is being scored in this scenario.</Note>
      </Instrument>
    );
  }

  const total = state.ablated ? selected.totalWithoutDrift : selected.total;
  const terms = TERM_ORDER.map((k) => selected.evidence.terms.find((t) => t.key === k)).filter(
    (t): t is NonNullable<typeof t> => !!t,
  );
  const [wLo, wHi] = selected.evidence.originWindow;

  return (
    <Instrument code="INS-20" title="Evidence card" source="SIM" status="active">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-tight" style={{ fontFamily: "var(--font-body)", fontWeight: 700, color: "var(--ink)" }}>
            {selected.label}
          </p>
          <p className="mt-0.5 text-[10.5px] leading-snug" style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}>
            {selected.detail}
          </p>
        </div>
        <div className="text-right">
          <span className="num block text-[19px] leading-none" style={{ color: "var(--accent)" }}>
            {total.toFixed(3)}
          </span>
          <span className="num text-[8.5px]" style={{ color: "var(--ink-faint)" }}>
            {state.ablated ? "NO S_DRIFT" : "WEIGHTED SUM"}
          </span>
        </div>
      </div>

      {/* Six terms. Never a bare total: value, weight, contribution and the
          sentence that produced it, per term (C4). */}
      <div className="mt-2.5 flex flex-col gap-1.5">
        {terms.map((t) => {
          const muted = state.ablated && t.key === "drift";
          return (
            <div
              key={t.key}
              className="rounded-[5px] px-1.5 py-1.5"
              style={{
                border: `1px solid ${alpha("var(--line)", 100)}`,
                opacity: muted ? 0.4 : 1,
              }}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className="shrink-0 text-[9.5px] tracking-[0.14em] uppercase"
                  style={{ fontFamily: "var(--font-display)", fontWeight: 600, color: "var(--ink)" }}
                >
                  {TERM_LABEL[t.key]}
                </span>
                <span className="num shrink-0 text-[8.5px]" style={{ color: "var(--ink-faint)" }}>
                  {`w ${t.weight.toFixed(2)}`}
                </span>
                <span aria-hidden className="min-w-2 flex-1 translate-y-[-3px]" style={{ borderBottom: `1px dotted ${alpha("var(--line)", 90)}` }} />
                <span className="num shrink-0 text-[10.5px]" style={{ color: "var(--ink)" }}>
                  {t.value.toFixed(3)}
                </span>
                <span className="num shrink-0 text-[8.5px]" style={{ color: "var(--accent)" }}>
                  {signed(t.value * t.weight)}
                </span>
              </div>
              <div className="mt-1">
                <Segments value={t.value} count={14} height={4} tone={termTone(t.key, def.accent)} />
              </div>
              <p className="mt-1 text-[10px] leading-[1.42]" style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}>
                {t.detail}
              </p>
              <p className="num mt-0.5 text-[8.5px]" style={{ color: "var(--ink-faint)" }}>
                {`${TERM_ORIGIN[t.key].toUpperCase()} · ${TERM_NOTE[t.key].split(".")[0]}.`}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-2">
        <Row label="Origin window" value={`${formatHour(wLo)} → ${formatHour(wHi)}`} />
        <Row label="Matched leg" value={selected.evidence.matchedSegment ? "ON CHART" : "NONE"} />
      </div>

      {selected.evidence.anomalies.length > 0 && (
        <div className="mt-2.5">
          <p className="num mb-1 text-[8.5px] tracking-[0.16em]" style={{ color: "var(--ink-faint)" }}>
            BEHAVIOURAL FLAGS
          </p>
          <div className="flex flex-col gap-1.5">
            {selected.evidence.anomalies.map((a) => (
              <div key={a.code} className="rounded-[5px] px-1.5 py-1.5" style={{ border: `1px solid ${alpha(def.map.infrastructure, 30)}` }}>
                <div className="flex items-baseline gap-2">
                  <span className="num shrink-0 text-[9px]" style={{ color: def.map.infrastructure }}>
                    {a.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[10.5px]" style={{ fontFamily: "var(--font-body)", fontWeight: 600, color: "var(--ink)" }}>
                    {a.label}
                  </span>
                  {a.expected !== undefined && (
                    <span className="num shrink-0 text-[8.5px]" style={{ color: "var(--ink-faint)" }}>
                      {`EXPECTED ${a.expected.toFixed(2)}`}
                    </span>
                  )}
                </div>
                {/* C7: a flag always travels with the series that raised it. */}
                <div className="mt-1">
                  <Trace
                    values={a.series.map((p) => p.v)}
                    height={26}
                    tone={def.map.infrastructure}
                    fill={false}
                  />
                  <p className="num mt-0.5 text-[8px]" style={{ color: "var(--ink-faint)" }}>
                    {a.seriesLabel.toUpperCase()}
                  </p>
                </div>
                <p className="mt-1 text-[10px] leading-[1.4]" style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}>
                  {a.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {selected.evidence.caveats.length > 0 && (
        <div className="mt-2.5">
          <p className="num mb-1 text-[8.5px] tracking-[0.16em]" style={{ color: "var(--ink-faint)" }}>
            CAVEATS
          </p>
          <ul className="flex flex-col gap-1">
            {selected.evidence.caveats.map((c) => (
              <li key={c} className="flex gap-1.5 text-[10px] leading-[1.42]" style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}>
                <span aria-hidden style={{ color: def.map.infrastructure }}>
                  ▪
                </span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Instrument>
  );
};

/* ------------------------------------------------------------------ *
 * Always mounted
 * ------------------------------------------------------------------ */

/** Layer channels. Every mode presets these; this is where they are overridden. */
const Channels: Module = ({ deck: { toggles, setToggles } }) => {
  const set = (k: keyof LayerToggles) => (v: boolean) => setToggles({ ...toggles, [k]: v });
  return (
    <Instrument code="INS-00" title="Chart channels">
      <div className="grid grid-cols-2 gap-x-3">
        <Rocker on={toggles.slick} onChange={set("slick")} label="Detection" />
        <Rocker on={toggles.contours} onChange={set("contours")} label="Origin field" />
        <Rocker on={toggles.particles} onChange={set("particles")} label="Particles" />
        <Rocker on={toggles.release} onChange={set("release")} label="Release" />
        <Rocker on={toggles.traffic} onChange={set("traffic")} label="Traffic" />
        <Rocker on={toggles.candidates} onChange={set("candidates")} label="Candidates" />
        <Rocker on={toggles.targets} onChange={set("targets")} label="Radar targets" />
        <Rocker on={toggles.forecast} onChange={set("forecast")} label="Forecast" />
      </div>
      <Note className="mt-1.5">
        Each mission mode presets these. Changing one here overrides the preset
        until the mode changes again.
      </Note>
    </Instrument>
  );
};

export const INSTRUMENTS: Record<string, Module> = {
  acquisition: Acquisition,
  geometry: Geometry,
  damping: Damping,
  scene: Scene,
  classification: Classification,
  wind: Wind,
  age: Age,
  convergence: Convergence,
  ensemble: Ensemble,
  origin: Origin,
  field: Field,
  horizon: Horizon,
  playback: Playback,
  growth: Growth,
  gate: Gate,
  contacts: Contacts,
  forecast: Forecast,
  attribution: Attribution,
  ablation: Ablation,
  evidence: Evidence,
  channels: Channels,
};

/* ------------------------------------------------------------------ *
 * Small shared arithmetic
 * ------------------------------------------------------------------ */

function frameAt(run: Run, hour: number) {
  const r = Math.round(hour);
  return run.drift.frames.find((f) => f.hour === r) ?? null;
}

function nearestIndex(hours: number[], hour: number): number {
  let best = 0;
  for (let i = 1; i < hours.length; i++) {
    if (Math.abs(hours[i] - hour) < Math.abs(hours[best] - hour)) best = i;
  }
  return best;
}

/** The two terms this project contributes are drawn in the accent; the four it
    inherits from the reference implementation are not. */
function termTone(key: ScoreTermKey, accent: string): string {
  return TERM_ORIGIN[key] === "This project" ? accent : "var(--ink-dim)";
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
