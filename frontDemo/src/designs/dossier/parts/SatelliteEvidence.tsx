/**
 * II -- SATELLITE EVIDENCE.
 *
 * The acquisition itself and what was measured off it.
 *
 * Two constraints shape this sheet more than any aesthetic decision. C2: the
 * damping ratio is a relative backscatter contrast in dB and there is no field
 * anywhere in this system for a thickness or a volume, so the register prints
 * the index, prints its confidence as low, and prints the reason no micron
 * figure follows it. C9: the wind gate is a continuous multiplier, so it is
 * drawn as a curve with this detection's sample marked on it rather than
 * asserted as a number -- the reader can see there is no step in it.
 *
 * The radar plate is portrait and mounted with crop marks, because it is a
 * print of one frame out of a 250 km swath and saying so is more honest than
 * letting the frame stand in for the scene.
 */

import { boundsFor } from "../../../components/SarTile";
import { stamp } from "../../../lib/format";
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
import { SarPlate, WidthProfilePlate, WindGatePlate } from "../plates";

export default function SatelliteEvidence({ state }: ShellProps) {
  const { run } = state;
  if (!run) return null;

  const c = run.characterisation;
  const gateWeak = c.windGateMultiplier < 0.75;
  const bounds = boundsFor(run.detection.parts, 0.34, 0.74);
  const swathKm = ((bounds[2] - bounds[0]) * 111 * Math.cos((bounds[1] * Math.PI) / 180)).toFixed(0);

  return (
    <>
      <PartTitle
        numeral="II"
        title="Satellite evidence"
        standfirst="The acquisition, the mask segmented from it, and every quantity measured off that mask. Nothing on this sheet is an inference about a source; it is the description of an object on the sea surface."
      />

      <Leaf
        margin={
          <MarginNote label="Exhibit 03">
            The imagery is generated from a speckle model, not photographed and
            not an acquisition. It is a picture of what the detector is asked to
            work on, and it is classified as simulated for that reason.
          </MarginNote>
        }
      >
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <div>
            <Exhibit
              n={3}
              title="Radar frame"
              source="simulated"
              sourceNote="Synthesised · not an acquisition"
              caption={
                <>
                  Approximately {swathKm} km across. Gamma-distributed speckle
                  over a wind-modulated sea, with the mask outline overlaid. Oil
                  damps the short capillary waves that produce the return, so the
                  slick is a region of lower mean backscatter rather than a dark
                  object placed on the water.
                </>
              }
            >
              <SarPlate run={run} height={720} />
            </Exhibit>
            <div className="mt-4">
              <Stamp tone="ink" angle={-3.4} size="small">
                Simulated imagery
              </Stamp>
            </div>
          </div>

          <div>
            <Head level={3}>Characterisation</Head>
            <Prose className="mt-3" size="small">
              Measured on the mask, in the geometry the detector emitted. Where
              along a slick a measurement is taken matters more than how the
              distance from it is weighted, which is why the head, the tail and
              the medial axis are all first-class outputs rather than derived at
              scoring time.
            </Prose>

            <div className="mt-5">
              <Micro tone="ink" className="mb-2">
                Geometry
              </Micro>
              <FieldRow label="Area" value={`${c.areaKm2.toFixed(2)} km²`} />
              <FieldRow label="Length" value={`${c.lengthKm.toFixed(2)} km`} />
              <FieldRow label="Mean width" value={`${c.widthMMean.toFixed(0)} m`} />
              <FieldRow label="Orientation" value={`${((c.orientationDeg + 360) % 360).toFixed(1)}°`} />
              <FieldRow label="Elongation" value={c.elongation.toFixed(1)} />
              <FieldRow label="Compactness" value={c.compactness.toFixed(3)} />
              <FieldRow label="Fragmentation" value={c.fragmentation.toFixed(3)} />
              <FieldRow
                label="Head / tail"
                value={c.headTailResolvedBy === "drift_field" ? "Drift field" : "Ambiguous"}
                note={
                  c.headTailResolvedBy === "drift_field"
                    ? "Geometry alone cannot say which end is which. Both ends are emitted and the drift field resolved them."
                    : "Geometry could not separate the ends. Proximity was computed against both and the better reported, which is a weaker measurement and is scored as one."
                }
              />
            </div>

            <div className="mt-6">
              <Micro tone="ink" className="mb-2">
                Surface contrast
              </Micro>
              <FieldRow
                label="Damping ratio"
                value={`${c.dampingRatioDb.toFixed(1)} dB`}
                tone="accent"
                note="A relative contrast index between the slick and the water around it. It is not a thickness. No volume follows from it, and there is no field for either anywhere in this system."
              />
              <FieldRow label="Damping confidence" value={c.dampingConfidence} />
            </div>
          </div>
        </div>
      </Leaf>

      <Leaf
        margin={
          <MarginNote label="Exhibit 04">
            Width sampled perpendicular to the medial axis and mirrored about it,
            so the plate shows the plan form rather than a line chart of it.
          </MarginNote>
        }
      >
        <Exhibit
          n={4}
          title="Plan-form width profile"
          source="model"
          caption={
            <>
              The taper is the argument. Oil is widest where it entered the water
              and narrowest where it has been spreading longest, and that
              asymmetry is what lets the head be told from the tail when the
              drift field is not decisive.<Ref n={1} />
            </>
          }
        >
          <WidthProfilePlate run={run} />
        </Exhibit>
      </Leaf>

      <Leaf
        margin={
          <MarginNote label="Exhibit 05">
            The gate is a multiplier on the whole detection, applied to every
            candidate score in Part V. It is never a filter, and a detection
            never silently disappears because of it.
          </MarginNote>
        }
      >
        <Rule weight="firm" className="mb-6" />
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <Exhibit
            n={5}
            title="Wind gate"
            source="published"
            sourceNote="Band from published instrument limits"
            caption={
              <>
                The multiplier against wind speed, with this detection's sample
                marked.
              </>
            }
          >
            <WindGatePlate ms={c.windSpeedMs} value={c.windGateMultiplier} />
          </Exhibit>

          <div>
            <Head level={3}>Why the gate is a curve</Head>
            <Prose className="mt-3">
              Oil is only detectable in radar over a band of wind speeds. Below
              roughly 3 m/s the sea is already flat and a look-alike is
              indistinguishable from a discharge; above roughly 10 to 12 m/s the
              slick is broken up and the contrast is gone. Both edges are soft
              and vary by region, so a hard cut at either would silently discard
              detections that are merely less certain.
            </Prose>
            <Prose className="mt-4">
              This detection sampled {c.windSpeedMs.toFixed(1)} m/s at the
              centroid, giving a multiplier of{" "}
              {c.windGateMultiplier.toFixed(2)}.{" "}
              {gateWeak
                ? "That is low enough to be carried as a caveat on every candidate in Part V, and if it falls far enough the file issues no attribution at all."
                : "Every score in Part V is multiplied by it, and it is printed on each evidence card."}
            </Prose>

            <div className="mt-5 max-w-[26rem]">
              <FieldRow label="Wind at centroid" value={`${c.windSpeedMs.toFixed(1)} m/s`} />
              <FieldRow
                label="Gate multiplier"
                value={`×${c.windGateMultiplier.toFixed(2)}`}
                tone={gateWeak ? "accent" : "ink"}
              />
              <FieldRow label="Applied to" value="Every candidate score" />
            </div>
          </div>
        </div>
      </Leaf>

      <Leaf pad="tight" margin={<Micro>Notes</Micro>}>
        <Footnotes
          items={[
            <>
              Both ends of the slick are emitted by the characteriser because
              geometry alone cannot determine which is the head. This case
              resolved them by {c.headTailResolvedBy.replace(/_/g, " ")}.
            </>,
            <>
              Frame acquired {stamp(run.meta.acquiredAt)}, scene{" "}
              {run.detection.sceneId}. Sentinel-1 interferometric wide swath, VV
              polarisation, 10 m ground sample. Instrument parameters are
              published; the pixels on this sheet are not.
            </>,
          ]}
        />
      </Leaf>
    </>
  );
}
