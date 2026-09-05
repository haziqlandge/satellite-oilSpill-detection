# NEXT SESSION — read this first, it is the whole brief

Written at the end of the **seventh** pass. **This file supersedes every other
markdown file in the repository as the to-do list**, including
`NEXT-SESSION-session5.md` and `ISSUES.md` (both history). Where they disagree,
this wins.

`npx tsc --noEmit` is clean. `npm run build` is clean and now emits **no chunk
size warning**. **Everything is still uncommitted**, and now spans six sessions.

---

# PART 0 — STATE OF THE TREE

Files carried in from sessions 1–6, untouched this session:

```
 M .gitignore                          coordinator: frontDemo/.backup/ excluded
 M src/components/FloatShell.tsx       agent B: B2 drag reporting, B3 deletion
 M src/components/PalettePanel.tsx     agent C: basemapTint inert-state note
 M src/console/ConsoleShell.tsx        agent B: owns the drag controller
 M src/console/dock/DockRail.tsx       agent B: data-dock-strip, tear-off, B3
 M src/console/dock/FloatWindow.tsx    agent B: B2
 M src/console/dock/useDock.ts         agent B: useDockDrag (+662 lines), B3
 M src/index.css                       agent C (comments only) + coordinator
 M src/map/MapCanvas.tsx               session 6: infrastructure selection
 M src/map/basemap.ts                  session 6: infrastructure selection
```

Changed **this** session:

```
 M src/sim/scoring.ts       area90Km2 halt figure; scoreDark sweep + prior
 M src/sim/ais.ts           speed_drop 0.72 -> 0.85; unknownClassPrior added
 M src/sim/scenarios.ts     expectation tripwire; kutch-dark notes rewritten
 M src/sim/types.ts         expectedTop1 documented
 M src/console/reports.tsx  C3 option 3: `goto T0` on its own row
 M vite.config.ts           maplibre split out; chunk warning limit
```

**No scenario data changed this session.** `git diff -U0 src/sim/scenarios.ts |
grep '{ from:'` returns exactly one line, and it is session 6's gom-platform
lane. Every corridor is byte-identical to `HEAD`. That is worth knowing because
a corridor change *was* built and shipped mid-session and then reverted — see
PART 2.

**The largest risk in this repo is still that none of this is committed.** Six
sessions. Decide it first.

---

# PART 1 — WHAT CLOSED, AND HOW IT WAS PROVED

## 1.1 `insufficientEvidence.area90Km2` reported the wrong frame — **FIXED**

Carried unfixed for three sessions with an exact fix already written down.

`drift.convergence` is sorted ascending by hour and the backward hours are
negative, so index 0 is the **most-backward, widest** frame. Two of the three
halt branches in `scoring.ts` read `[0]`; the third already took the minimum,
as do `deriveAge`, `panes.tsx` and `reports.tsx`. All three now read one hoisted
`tightestArea90Km2`.

**Proved twice.** Headless, `mumbai-null` went 129.60 → 15.25 km², and the
`[0]` column of the probe reproduces 129.60 exactly, so the before-value is a
measurement rather than a recollection. Then in the running console: pane 04's
halt notice now prints `90% origin contour 15 km²`, and the paragraph beside it
already said "closes to 15 km² against a 300 km² limit". **The two numbers on
the same page used to disagree with each other**; they now agree. `kutch-dark`
under `max` prints 7.09 via the separability branch, unchanged.

## 1.2 `speed_drop` was dead code across the entire fixture set — **FIXED**

Not in the previous brief in this form. The brief said `behaviour` was 0 on
`gom-moving`; the truth is worse and was found by censusing every vessel.

**Across 1096 vessels in all five scenarios, two behaviour flags fired in the
whole app**, both on `gom-berthed`'s truth. `speed_drop` fired on nothing —
including `gom-moving`, where `movingDischarge` plants a 1.6 kn reduction on an
8.0 kn transit *specifically* so this flag has something to find. It reached
ratio 0.7912 against a 0.72 threshold and missed.

Threshold moved to 0.85, chosen against the noise rather than against the
fixture: AIS speed noise is 0.16 kn per report and `minRun` averages eight, so
the sampling sigma of the tested quantity is 0.057 kn — 0.7% of an 8 kn transit.
15% is ~21 sigma clear of that and under the 20% the generator plants.

**Measured after:** fires on `gom-moving`'s truth and on nothing else; nearest
other vessel anywhere is 0.9539. `gom-moving` separability 0.1024 → 0.1162
(integral) and 0.0844 → 0.0982 (max). **The other four scenarios are byte-
identical.** Truth stays rank 1 everywhere.

## 1.3 `expectedTop1` had no consumer — **FIXED, with a negative control**

`checkExpectation` in `scenarios.ts`, dev builds only, runs per scenario **and
per variant**. It needs no new field: `truth === null` must coincide with a
refusal; otherwise exactly one candidate carries `isTruth`, ranks 1, and the run
does not refuse.

**The control is the point.** Shipped config: 0 warnings. Old `kutch-dark`
corridor restored: 2 warnings naming both symptoms. Restored again: 0. Then
verified in the real browser — clicking `s_drift → max` in pane 02 puts both
warnings in the console. The failure that sat invisible for two sessions with a
green build is now visible to anyone with devtools open.

## 1.4 `scoreDark` sampled one frame where `scoreInfrastructure` swept — FIXED, **changes nothing today**

`scoreInfrastructure` sweeps `-backwardHours..0` and takes the best hour.
`scoreDark` sampled hour 0 only. Two fixed-point candidates, two standards, and
the worse treatment went to the unlit contact — the entire subject of the
scenario it appears in. Sampling at hour zero also asks the wrong question: it
asks where the oil *is*, which is what `proximity` already answers.

**Stated plainly because it matters: this changes no number on the shipped
fixtures.** `dark-01`'s drift is 0.6948 before and after, because hour zero
already was its best hour — `informativeness` is `sqrt(AREA/area90)`, the field
is tightest at acquisition (7.09 km² against 102.76 at h−28), and the contact
sits near the release. It is a consistency fix and a guard for a future scenario
whose contact is not at the release. **It does not fix `kutch-dark` under
`max`.** See PART 2.

## 1.5 C3, the rank row — option 3 shipped

`goto T0` lifted out of the `flex-wrap` row onto its own row. **Verified in the
browser, not just in the diff**: the goto row is `mt-1 flex` with exactly 1
button, its previous sibling is the rank strip with 38, and it sits at the
block's left edge (x = 54.5) at every width instead of wherever the wrap left
it (38th / 26th / 10th / 33rd / 52nd control across the five fixtures).
Screenshot taken.

The two comments that the move made false were rewritten, not left: the one
arguing the shared-lit idiom "the rank buttons **beside it**", and the one
listing "pushed `goto T0` onto its own row" as a *cost* of a rejected experiment.

**Not done:** the keyboard question. `components.tsx:601` still renders
`<tr onClick>` with no `tabIndex`, no role, no key handler, and pane 05's rank
row is still the only keyboard route to selecting a candidate. The director
chose option 3 **only**, knowing this. It stays open.

## 1.6 The build chunk warning — closed, with a real benefit

`MapCanvas` was 1,199.39 kB because four modules import it statically, so Rollup
hoists it and maplibre rides along. Split: **1,055.26 kB maplibre + 138.93 kB of
this project's map code**, total slightly *down*. No warning.

The benefit is caching, not bytes. `MapCanvas.tsx` is one of the most-edited
files here; before the split, one line changed the hash on all 1,199 kB.

**Verified against the production build, not just the build log** — a dev server
does not use production chunking, so a green `npm run build` would not have
proved this. `npm run preview` on :5190, console loaded: `maplibre-gl-*.js`
(279 kB over the wire) and `MapCanvas-*.js` (49 kB) arrive as separate requests,
map style loaded, 23 layers, 36 candidates, **zero console errors**, and the dev
tripwire is correctly silent. A `frontDemo-preview` entry was added to
`.claude/launch.json` for this; it serves whatever `dist/` holds, so rebuild
before trusting it again.

---

# PART 2 — THE ONE THAT DID NOT GO AS PLANNED. READ THIS BEFORE TOUCHING `kutch-dark`.

The director chose **"move corridor 3 out"** to fix `kutch-dark` failing its own
`expectedTop1` under `max`. **That option does not exist.** It was built,
shipped, rejected on sight, and reverted, all within this session. The whole
sequence is recorded in the corridor's own comment in `scenarios.ts`; the short
version:

**A lane that fixes `max` exists.** `[69.38, 22.35] -> [69.62, 22.70]`,
widthKm 2.6: 0% land over 17,806 samples, `dark-01` first under **both**
variants in **all three** corridor slots, margins 0.287–0.351 against the 0.015
floor, 12–14 candidates admitted.

**It is unusable**, because it moves every AIS line off the oil. Nearest report
248 m → 863 m, nothing inside 500 m, no track crossing the slick. The director's
words on seeing it: *"you botched dark vessel now all lines are off the main
spill, the ship lines dont even intersect with the spill."* He is right, and
this is a standing constraint, not a one-off: he asked for the same thing
explicitly on `gom-platform` in session 6.

**The two requirements are mutually exclusive at the data level, and this was
measured, not argued.** Twelve geometries. Every lane whose vessels cross the T0
slick (13–28 crossing tracks) loses `dark-01` its first place under `max`. Every
lane that holds first place crosses nothing. The reason is in the **scorer**:
the slick sits inside the origin field, so crossing the slick means entering the
field peak; under `max` a vessel is scored by the densest cell its track ever
touches, while `dark-01` is one fixed point whose max and integral are equal
(0.6390 either way). **`max` structurally rewards carrying AIS.**

The shipped lane is the original: 2.27 km off the release, **27 of 36 admitted
tracks cross the T0 detection polygon**, nearest report 248 m.

## 2.1 The prior lever was pulled, and it is not enough

The director chose it. It is done, it was a real defect, and it does **not** fix
`max` — all three facts matter.

`scoreDark` scored `prior` as `min(0.8, lengthM / 260)`: pure size, on a
different scale from every vessel it is ranked against, where prior is 78% class
and 22% size. A 118 m contact got **0.4538, below an identified 118 m general
cargo at 0.4898.** The contact was marked down for the analyst's ignorance.

`unknownClassPrior` in `ais.ts` now applies the vessel formula with the class
term averaged over the classes the measured length admits. For 118 m that is
General cargo alone, so it lands on **exactly 0.4898** — the same prior the one
class it could be would get. That coincidence is a useful check on the method.

**Measured:** `dark-01` 0.6390 → 0.6419; `integral` margin 0.0968 → 0.0997. The
other four scenarios are byte-identical. **Under `max` it is still rank 3**, and
the arithmetic says why: the gap is 0.0153 on a term weighted 0.08, so the prior
would have to be **0.6811** to take first place. It was not pushed there. The
only argument that would justify 0.68 — that running dark is itself suspicious —
is already spent, explicitly and with its own caveat, in the `behaviour` term,
and spending it twice is double counting.

**One lever is left and nobody has chosen it:** `max` reduces a track by its
single densest cell and a point by its only cell. Changing that is a decision
about the scoring model and it re-scores all five scenarios.

---

# PART 3 — WHAT IS OPEN

## 3.1 Decisions the director has not taken

- **`kutch-dark` under `max`** — PART 2. Two levers spent (lane geometry, dark
  prior); only the `max` reduction rule is left, and it re-scores everything.
- **The rank row's keyboard access** — §1.5. Deliberately deferred.
- **`gom-berthed` / S_drift** — see 3.2, the framing has changed.
- **`sParity` reach window** — unchanged from the last brief, and there is now a
  positive reason to leave it: `gom-moving`'s `tests` string uses the behaviour
  as evidence that one term is not enough, which is what `S_drift` is for.
  Changing the term deletes the demonstration.

## 3.2 S_drift is not load-bearing **anywhere** — the previous brief understated this

The last brief said `gom-berthed` could no longer show `S_drift` is load-bearing.
Measured across all five scenarios and both variants: **`rankWithoutDrift` is 1
in every case.** Removing the reverse-trajectory term never changes who wins,
anywhere. Fixing one scenario would not fix the control.

But the ablation is **not** inert, and this is the more useful finding:

| scenario | margin with drift | without | runner-up changes? |
|---|---|---|---|
| gom-platform | 0.2052 | **0.0328** | yes, `352899153` → `489973815` |
| kutch-dark | 0.0968 | **0.0331** | yes, `633175011` → `414710635` |
| gom-berthed | 0.0686 | **0.0398** | yes |
| gom-moving | 0.1162 | **0.1050** | yes, `626889811` → `595572453` |

S_drift collapses the margin by up to **6.3×** and reshuffles the field beneath
rank 1. That is a defensible and arguably stronger claim than necessity — the
answer does not hang on one term — but it is **not** what the "without S_drift"
control currently implies, and no copy anywhere says it. Cheap, high-value work:
say this, in the interface, in the pane that offers the toggle.

## 3.3 Closed by measurement, do not re-investigate

- **The rapid-basemap-swap "tiles unreachable" false positive does not exist.**
  MapLibre suppresses abort errors on both paths — `raster_tile_source.ts:113`
  (`if (!isAbortError(err))`) and `:209` (`if (tile.aborted)` swallows). Seven
  swaps at 120 ms produced 0 errors and no notice. **No `/abort/i` exclusion is
  needed.** Caveat: the swap ran against warm tile caches, so the source
  reading is what makes this solid, not the empirical run alone.
- **The gom-platform lane is still 0% land** at pixel resolution — re-checked at
  32,882 samples, worst blue−red +32. Session 6's claim survives a stricter test.

## 3.4 Still open, still unverified

- **A real weakness the control above exposed:** `MapCanvas.tsx:263` classifies
  by `message.includes("tile")`, and the message embeds the tile **URL**. A
  probe raster at `http://127.0.0.1:1/tiles/...` raised "Basemap tiles
  unreachable" purely because its path contained "tiles". Blast radius today is
  small (the only raster sources are `basemap` and `labels`), but a `labels`
  failure reports as a basemap failure. **Exact fix:** switch on
  `e.sourceId ∈ WORLD_SOURCE_IDS` (already exported from `basemap.ts:135`)
  instead of substring-matching. Not done.
- **`mumbai-null` still auto-selects a ship on a refusing run.** `lib/spill.ts`
  (not `sim/spill.ts` — the brief had the path wrong) sets
  `selectedId = built.suspects[0]?.id` unconditionally. **Not addressed this
  session at all.**
- **StrictMode's double-invocation path.** No warning was seen across this
  session's clicking, but it was **not** specifically exercised. Unchanged.
- Three `provenance` strings rest on Zhao et al. 2025 and cannot be checked.

---

# PART 4 — METHODS AND TRAPS

## 4.1 A coarse land grid will lie to you, and it nearly did

Two lane candidates measured **0% land on a ~900-sample envelope grid and
0.08–0.09% at 150 m spacing**. The coarse grid had stepped over a single ~400 m
islet at `[69.404, 22.528]` — and it sat at **1.3–1.6 sigma**, in the busy part
of the lane, not out in a tail that could be waved off. **Sample a lane envelope
at or below the z=10 tile pixel size (~150 m here).** Session 6's 909-sample
check over a 48 km lane had ~1 km spacing; it happened to be right (re-verified,
§3.3) but the method was not safe.

## 4.2 Build the mask once, then search

Per-sample `fetch` + `getImageData` makes each lane cost seconds. Reading 12
tiles once into a 451×271 `Int8Array` at 0.002° made lane evaluation free and
turned "guess a lane, check it" into a scan of ~10,000 candidates. Calibration
reproduced the recorded values exactly months on: open sea +51, release +36,
Jamnagar −20, Rajkot −23, threshold +12.

## 4.3 Corridor order is a real variable — and it caught a false positive

`buildTraffic` assigns vessels `corridors[i % n]` off one shared RNG stream, so
moving a lane re-rolls every vessel. A candidate at 3.64 km **passed in slot 2
and failed in slots 0 and 1**. It would have shipped as a coincidence. Run all
insertion positions, every time.

## 4.4 Prove the instrument before trusting a null result

My first basemap-error probe reported 0 errors. That was almost a finding. The
control — a raster source at an unroutable host — produced 26 errors and raised
the notice, proving the listener was live; only then was the 0 worth anything.
An earlier control using a bad ArcGIS *path* produced nothing (the service
returns 200 with a JSON body) and would have "confirmed" the wrong conclusion.

## 4.5 Two numbers on one page disagreeing is the cheapest bug detector here

The `area90Km2` bug was visible for three sessions as pane 04 printing
`130 km²` in the halt notice directly above a paragraph saying `15 km²`. Nobody
read them together. Worth a sweep for other such pairs.

---

# PART 5 — FIRST FIVE MINUTES

1. `cd frontDemo && npx tsc --noEmit` → clean. `npm run build` → clean, **no
   chunk warning**, `maplibre-gl` its own chunk, CSS 146.99 kB, two
   `prefers-reduced-motion` blocks, zero `motion-safe` rules.
2. **Decide whether to commit.** Sixteen files, six sessions.
3. **`kutch-dark` under `max`** (PART 2) — only the `max` reduction rule is
   left. Everything cheaper has been tried and measured.
4. Cheapest real work needing no decision: the `sourceId` fix in §3.4, and
   saying §3.2's ablation finding in the interface.
