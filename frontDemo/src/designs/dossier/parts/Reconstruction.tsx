/**
 * III -- DRIFT RECONSTRUCTION.
 *
 * The part of the file that carries the one thing nothing in the reviewed
 * literature does: an ensemble stepped backward from the mask to a probability
 * field over space and time.
 *
 * Everything on this sheet is composed to stop a reader taking away a point.
 * The chart plate draws an outline per hour and no line anywhere joining them
 * (C5). The convergence plate shows the basin the age interval is measured
 * across, so the width of the interval is visible rather than asserted (C1).
 * And where the field is too diffuse to discriminate, the sheet says so here
 * as well as in Part VI, because a reader who stops after the reconstruction
 * must not leave with a tighter impression than the model supports (C3).
 */

import { ageStatement, formatHour } from "../../../lib/format";
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
import { ConvergencePlate, OriginFieldPlate } from "../plates";

export default function Reconstruction({ state }: ShellProps) {
  const { run } = state;
  if (!run) return null;

  const d = run.drift;
  const age = ageStatement(d);
  const tightest = d.convergence.reduce(
    (m, c) => Math.min(m, c.area90Km2),
    Infinity,
  );
  const widest = d.convergence.reduce((m, c) => Math.max(m, c.area90Km2), 0);
  const diffuse = d.insufficientEvidence;

  return (
    <>
      <PartTitle
        numeral="III"
        title="Drift reconstruction"
        standfirst="An ensemble of drift members was seeded inside the mask and stepped backward through currents and wind. What it produces is a probability field over space and time. It does not produce a position, and no figure in this part should be read as one."
      />

      <Leaf
        margin={
          <MarginNote label="Method">
            The same engine runs forward for the impact forecast. Running it in
            both directions off one set of physics is what makes the backward
            result checkable: a hindcast that cannot reproduce the observed
            slick when run forward is a hindcast with a bug in it.
          </MarginNote>
        }
      >
        <Head level={3}>What was run</Head>
        <Prose className="mt-4">
          {d.ensembleSize} members, {d.particleCount.toLocaleString()} particles,
          stepped {d.backwardHours} hours backward from the acquisition and{" "}
          {d.forwardHours} hours forward from it. Diffusion is the model's own
          mixing rather than a random walk added on top, because a hand-rolled
          walk accumulates particles in the wrong places and an accumulation is
          indistinguishable, at the end, from a confident origin.<Ref n={1} />
        </Prose>
        <Prose className="mt-4">
          At each hour the members are collapsed into credible regions. The 90%
          region is the area inside which the model puts nine parcels in ten; the
          50% region is the tighter core of it. Reversing a spreading process
          spreads it further, so those regions widen the further back the run
          goes — from {tightest.toFixed(0)} km² at the tightest to{" "}
          {widest.toFixed(0)} km² at the backward horizon.
        </Prose>

        <div className="mt-6 grid grid-cols-1 gap-x-12 md:grid-cols-2">
          <div>
            <Micro tone="ink" className="mb-2">
              Ensemble
            </Micro>
            <FieldRow label="Members" value={String(d.ensembleSize)} />
            <FieldRow label="Particles" value={d.particleCount.toLocaleString()} />
            <FieldRow label="Backward horizon" value={`${d.backwardHours} h`} />
            <FieldRow label="Forward horizon" value={`${d.forwardHours} h`} />
          </div>
          <div>
            <Micro tone="ink" className="mb-2">
              Field
            </Micro>
            <FieldRow label="Tightest 90% region" value={`${tightest.toFixed(0)} km²`} />
            <FieldRow label="Widest 90% region" value={`${widest.toFixed(0)} km²`} />
            <FieldRow label="Timesteps" value={String(d.frames.length)} />
            <FieldRow
              label="Discriminating"
              value={diffuse ? "No" : "Yes"}
              tone={diffuse ? "accent" : "ink"}
            />
          </div>
        </div>
      </Leaf>

      <Leaf
        margin={
          <MarginNote label="Exhibit 06">
            One outline per hour and nothing joining them. A single backward line
            would be the most persuasive figure this system could draw and the
            most dishonest, because it would state a precision the ensemble does
            not have.
          </MarginNote>
        }
      >
        <Exhibit
          n={6}
          title="Origin field"
          source="model"
          caption={
            <>
              Credible regions for the hours before the pass. Dashed outlines are
              the 90% region at each hour; the hatched region is the 50% core at
              the best-estimate release hour, {formatHour(-Math.round(d.ageHours[1]))}
              . The mask segmented at the pass is hatched in oxide, and the
              highest-scoring candidate's track is drawn as a fine dashed line so
              the reader can see whether the field arrives at it.
            </>
          }
        >
          <OriginFieldPlate run={run} />
        </Exhibit>
      </Leaf>

      <Leaf
        margin={
          <MarginNote label="Exhibit 07">
            The basin is shallow on purpose. If it were a spike, an age could be
            reported as a number, and the interval on this sheet would be
            narrower than the physics supports.
          </MarginNote>
        }
      >
        <Exhibit
          n={7}
          title="Convergence and the age interval"
          source="model"
          caption={
            <>
              Area of the 90% region at each hour before acquisition. The hatched
              band is the reported age interval and the solid rule inside it is
              the best estimate. The interval is the width of the basin, not a
              confidence dressing added to a point.
            </>
          }
        >
          <ConvergencePlate run={run} />
        </Exhibit>
      </Leaf>

      <Leaf
        margin={
          <div>
            <Micro>Age</Micro>
            <div className="mt-3">
              <Stamp tone={age.degenerate ? "accent" : "ink"} size="small" angle={-2.8}>
                {age.method}
              </Stamp>
            </div>
          </div>
        }
      >
        <Rule weight="firm" className="mb-6" />
        <Head level={3}>Statement of age</Head>
        <Prose className="mt-4" tone="ink" size="lede">
          The slick is {age.phrase}.
        </Prose>
        <Prose className="mt-4">
          {age.degenerate
            ? "The interval carries no usable width here, which is a statement about the release rather than a precise measurement of it. Printing a zero-width interval as though it were a determination of age would be false precision in the opposite direction, so the state is reported and the numbers are kept beside it."
            : "The interval and the method travel together everywhere in this file. There is no reading of this system in which an age appears as a single figure, because no reliable regressor from radar to age exists and inventing one in the interface would be inventing one in the science."}
          <Ref n={2} />
        </Prose>

        <div className="mt-6 max-w-[30rem]">
          <FieldRow label="Reported age" value={age.value} tone="accent" />
          <FieldRow label="Method" value={age.method} />
          <FieldRow label="Temporal state" value={age.state} />
          <FieldRow
            label="Interval bounds"
            value={`${d.ageHours[0]} / ${d.ageHours[1]} / ${d.ageHours[2]} h`}
            note="Low, best, high. Carried as a triple through every interface in the system."
          />
        </div>
      </Leaf>

      {diffuse && (
        <Leaf
          margin={
            <div className="mt-1">
              <Stamp tone="accent" angle={-4.2}>
                Too diffuse
              </Stamp>
            </div>
          }
        >
          <div
            className="border-y py-7"
            style={{ borderColor: "var(--accent)", borderWidth: "2px 0" }}
            role="status"
          >
            <Micro tone="accent">Consequence for this case</Micro>
            <Head level={2} className="mt-3" style={{ color: "var(--accent)" }}>
              The field does not separate the candidates.
            </Head>
            <Prose className="mt-4" tone="ink">
              {diffuse.reason}
            </Prose>
            <p className="num text-faint mt-3 text-[12px]">
              Tightest 90% origin region {diffuse.area90Km2.toFixed(0)} km²
            </p>
            <Prose className="mt-4" size="small">
              Part V still scores every candidate and prints the working, because
              the reasoning has to stay open to challenge. Part VI issues no
              attribution.
            </Prose>
          </div>
        </Leaf>
      )}

      <Leaf pad="tight" margin={<Micro>Notes</Micro>}>
        <Footnotes
          items={[
            <>
              The forcing fields on this sheet are smooth analytic substitutes for
              the ocean model the production pipeline reads. Real forcing grids
              are coarser than a slick is wide, and that uncertainty belongs in
              the reported interval rather than hidden inside a tighter-looking
              contour.
            </>,
            <>
              Age is carried as low, best and high with the method that produced
              it, in the data model and in every interface over it. Past roughly
              a day or two the regions widen until they cannot separate one
              candidate from another, and the honest output at that point is the
              finding in Part VI, not a narrower contour.
            </>,
          ]}
        />
      </Leaf>
    </>
  );
}
