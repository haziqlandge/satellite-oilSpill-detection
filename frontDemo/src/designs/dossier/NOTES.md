# Dossier — requests against shared files

Nothing in this list is blocking. Each is a place where Dossier worked around a
shared module rather than changing it.

## 1. `ScoringResult.gate` and `ScoringResult.separability` never reach `Run` — RESOLVED

`sim/scoring.ts` computes both:

- `gate: { considered, admitted, reason }` — how many candidates the
  spatiotemporal gate considered and how many it admitted, with the reason
- `separability` — the margin between the top candidate and the next

`sim/scenarios.ts` drops both when it assembles the `Run`; only
`insufficientEvidence` is carried through onto `drift`.

Both are exactly the kind of thing a case file needs to print, and the comment
on the field itself says "filtering is a deliverable". Part IV re-derives an
approximation of the gate's numerator by counting distinct tracks that came
within 12 km across the register, which is a different and weaker statement than
what the gate actually considered. Part V and Part VI recompute the margin from
the top two totals, which is correct but duplicates arithmetic that already ran.

**Resolved.** `Run` now carries `gate` and `separability`, populated in
`sim/scenarios.ts` from the values the scorer already returned. Part IV should
stop approximating the gate's numerator from proximity and print `run.gate`
directly; Parts V and VI can read `run.separability` instead of recomputing the
margin. Filtering is a deliverable, so the count of what was thrown away belongs
on the run.

## 2. `momentAt` cost at register scale

`lib/playback.ts` `momentAt` is O(vessels x extent vertices) per call. Part IV
builds a register of one row per hour of the event, which is 20–35 calls over
~250 vessels, memoised on the run. It is fine at this scale and no change is
needed, but if the register ever grows to the full forecast horizon a batched
`momentsOver(run, hours)` that rasterises the extent once per hour would be the
place to put the optimisation.
