# FUTURE WORK

Ordered by what unblocks what. Open problems are in `ISSUES.md`; finished work
is in `PREVIOUS_WORK.md`.

Two jobs are marked **[4060 Ti]** — they need training and cannot run on the
session machine. See `CLAUDE.md` §1.

---

## 0. Start here — where the 2026-09-22 session stopped

Read `CLAUDE.md` first, then this section. **Delete this section when its
contents are done** — do not append a second one.

### The situation

A **local** demo. The frontend must be top-tier; the backend can stay
file-driven. The user is Haziq; commit as them via `commitskill` and **never add
AI attribution** — authorship matters for this submission.

### What landed on 2026-09-22

ERA5 unblocked (licence accepted, verified with a real fetch). Repo-relative
paths. The faked hindcast deleted and replaced by the ensemble's own backward
leg. A land mask. Two scenes displaced to open water. Real discharge profiles. A
real renderer. A real upload path. GeoTIFF reading. And the first real OpenDrift
runs this project has produced — three scenes, ERA5-forced, exported to
`frontDemo/public/runs/*/drift.json`, validated by `npm run check:realdrift`.

Of those three, the December scene reports **`convergence_minimum`** and returns
an actual age triple. That is the first age this system has produced that is a
number rather than a refusal, and it took genuine time-varying wind.

### THE NEXT JOB, and it is one job: replace the land mask with a real one

This is the top priority and the user has now raised it three times. Everything
else is downstream of it.

**The failure.** Uploads drift and draw AIS over land — seen on Bali and Java,
where every shipping lane crosses the island. The cause is not a bug in the
mask; it is that the mask barely exists. `frontDemo/src/sim/landmask.generated.ts`
covers **three hand-drawn boxes** (Gulf of Mexico, Kutch, Mumbai) and `isLand`
answers **water** everywhere else. The corpus is global — DATA.md §2.1 records
scenes in the Gulf of Guinea, the Red Sea, the Mediterranean and off Borneo — so
almost every upload lands outside every box.

**What is already built toward this.** `ensureLandmask(centre, radiusKm)` in
`frontDemo/src/sim/landmask.ts` fetches basemap tiles for an arbitrary region,
classifies them and registers a runtime box. Verified working: 42 tiles,
119,316 cells, 26.7% land, 1.95 s for the Persian Gulf, correctly separating the
Saudi coast from open water. The upload path calls it before drifting.

**Why that is still not enough.** It is on-demand, so the first run in a new
region waits ~2 s for tiles; it depends on a third-party raster service at
runtime; it classifies a *picture* of a coastline rather than a coastline; and
**nothing else uses it** — the corridor generator in `sim/ais.ts` and
`buildTraffic` consult no mask at all, which is why lanes cross Bali.

Do it properly:

1. **Ship real coastline geometry.** Natural Earth 10m `land` plus
   `minor_islands` is public domain, about 10 MB as a shapefile, and a few
   hundred kB as simplified TopoJSON. Add a script beside
   `scripts/build_landmask.py` that fetches it, clips to the regions in use and
   emits it. Keep the raster mask as the fast lookup but **rasterise the
   polygons into it** instead of sampling a basemap picture, so the classifier
   is geometry rather than pixel colour.
2. **Make land a constraint on AIS, not only on drift.** `buildTraffic` should
   reject a corridor whose centreline or lateral scatter crosses land and
   resample it. `landFraction` already exists and `npm run check:corridors`
   already tests the authored lanes; uploads generate corridors at runtime and
   are tested by nothing.
3. **Keep one source of truth.** The backend uses OpenDrift's GSHHS landmask and
   the frontend uses its own. They disagree at the shore, which is why
   `overlayFrames` has to nudge parcels to water and report the count. If the
   frontend moves to Natural Earth, write down which one is authoritative.

### Then: the three UI defects the user named

- **Framing.** Previews were letterboxed in white; fixed. The raster is still
  decimated to 1024 for screening, which is deliberate — speckle averaging, and
  it is the cheap first pass PHASE-03 describes — but running locally there is
  no reason not to raise `SCREEN_MAX` in `sim/ingest.ts` and show the full
  raster.
- **Position by map pin.** Done — `console/PositionPicker.tsx` replaces the
  latitude and longitude boxes with a map, a draggable marker and a footprint
  box, with the numeric fields kept behind a disclosure. **Not yet reviewed by
  the user; confirm it before building on it.**
- **Wire the real runs into the console.** The artifacts and the loader
  (`sim/realDrift.ts`) exist; nothing selects them yet. That is the remaining
  half of §1.3.

### The question the user asked, answered

> "is the model not trained properly, it's clearly marking empty ocean as oil"

**The trained model is not running.** It has never run in the browser. What
marks the region is a dark-region Otsu screen in `sim/ingest.ts`, and the panel
says so in those words. The checkpoint exists at
`runs/final_l1_fp32_release/L1-ciou/weights/best.pt` (6.6 MB, one class), the
ONNX exporter exists at `ml/export/export.py` and has never been run, and
`backend/app/__init__.py` is 0 bytes — there is no API and no in-browser
inference.

The specific failure in that screenshot is a frame with **separation 0.04 and
damping −1.25 dB** — essentially no contrast anywhere — and the screen returned
25% of it. A threshold cannot do better on a frame with no contrast, and tuning
one is not the fix: `ISSUES.md` F11b records that contrast separation does
**not** cleanly divide the good cases from the bad.

**So do §4.1 and make it real:** export to fp16 ONNX (~6 MB at 2.9 M
parameters) and run it with `onnxruntime-web` on WebGPU, WASM as the fallback.
No backend, no server GPU, runs on the visitor's hardware — and it also answers
§4.2, since Cloudflare cannot host custom weights. Be honest about what it
buys: mAP50 is **.364** against a .90 target (Q1) and small-instance recall is
**.11** (Q4). A real detector, and not a good one.

### One correction to carry forward

The user is right that look-alike data exists, and the "no look-alike data"
framing that has been repeated is wrong.
`13761290/02_Test_images_and_ground_truth/Images/` ships **150 Lookalike and 150
No oil**, and they are already in the built corpus: **289 Lookalike and 271
No_oil tiles**, 560 negatives against 2,577 Oil (~18%). What `ISSUES.md`
actually says is narrower, and both parts remain true — **Part II's** additional
~42 GB was never downloaded (B3), and only **11 named look-alike tiles** exist
in the *test* split (Q2), which is a thin evaluation sample rather than absent
training data. Say it that way from now on.

### Traps already paid for

- **`times` descends on a backward run.** `times[0]` is the observation.
- **The drift engine needs naive UTC datetimes** (X10).
- **`json.dumps` writes a bare `NaN`** that `JSON.parse` refuses. The first
  drift export was unloadable and looked fine on disk. `check-real-drift.ts`
  parses every artifact for exactly this reason.
- **`coastline_action` was `none` for backward runs** while the docstring said
  `previous`, so parcels walked inland. Fixed; it was 11.8%, 21.2% and 33.3% of
  rendered parcels.
- **Otsu finds the sea, not the oil,** on a real scene that is ~90% water. Now
  re-applied inside the dark class and disclosed as "split Nx" in the panel.
- **Corpus GeoTIFFs sit outside `DB_WINDOW`** of −35..0 dB — measured −49.5 to
  −20.1 and −39.0 to −27.3 — so the fixed window clips them to black. The
  decoder falls back to the raster's own range and says so.
- **The band order is not consistent** (DATA.md D5): band 1 carries the wider
  spread in one scene, band 2 in another. Chosen by measurement, never
  hardcoded.
- **npm 10+ ignores `--prefix` for `install`.** Use `cd frontDemo`.
- **`git add -A` used to sweep in 169 MB.** Check `git status` first.

### Verification

```bash
.venv/Scripts/python.exe -m pytest
```

Baseline **474 passed, 9 skipped**. Then ruff, then the frontend:

```bash
cd frontDemo && npm run check && npm run build
```

`npm run check:ingest` needs fixtures first:
`.venv/Scripts/python.exe -m scripts.export_ingest_fixtures --out <dir>`, then
`TILE_DIR=<dir> npm run check:ingest`.

## 1. Immediate — the local demo

### 1.1 Make the paths repo-relative

Blocks everything else in this section. Every absolute path in the annotation
pack, `inventory.json`, the eleven `final-v*` split lists and `release.json`
points at the training machine's home directory. The bytes are present and
hash-verified; only the prefix is wrong. Full list in `DATA.md` §1.

### 1.2 Real upload, real metadata — DONE 2026-09-22

The fingerprint gate is gone. Any decodable raster is accepted, screened for
a dark region by `frontDemo/src/sim/ingest.ts`, and its outline, bearing,
length, widths and damping ratio are MEASURED off those pixels and become a
scene the whole console runs. Verified on the corpus itself: a real 2048²
tile screens in **66 ms** in the browser and ends with C3 correctly
withholding attribution, which was not scripted.

Measured over 24 real labelled train tiles, stratified across all three
source corpora (`scripts/export_ingest_fixtures.py`, then
`npm run check:ingest`): **21 of 24 overlap a labelled slick**, 2 are
refused as uniformly dark, 1 misses. Recall of the labelled region is
typically 0.75–1.0 while IoU is often low — the screen finds the oil and
over-covers, which is what a threshold does. The panel reports coverage so
that is visible rather than hidden.

**It is a threshold screen and the UI says so in those words.** It is not
the trained segmenter, so an uploaded region is classed `slick_unknown`,
never `oos`, and the `conf` readout carries the screen's contrast separation
rather than an invented model score. The dB damping figure is real, derived
through the corpus window, and the provenance states the window was assumed
— which matters for Refined SOS tiles (DATA.md D6).

Three things are asserted by the operator and stamped on the run: position,
ground scale and acquisition time. The corpus tiles carry no georeferencing
and no time in their names, so they cannot be derived; the time IS parsed
when the file is named like a Sentinel-1 product.

**Still open, and deliberately not claimed:**

- **GeoTIFF is not decoded.** The panel says so and asks for a PNG. Wiring
  `geotiff.js` would give a real geotransform and CRS, which is the only
  route to a position that is measured rather than asserted.
- **The float32 sigma-0 path is not built.** `DB_WINDOW` is recorded in
  `ingest.ts` as the constant that path would apply; PNG and JPEG input has
  already been through it.
- **Nothing is uploaded anywhere.** The raster never leaves the browser,
  which is the right default and also why the WebP-sidecar split in the
  original plan is not needed yet. It becomes necessary when §3's API exists.

### 1.3 Replace simulated data with real artifacts

`eval/final/scenes/*.geojson` already holds three real full-scene detection
outputs (86, 240 and 40 polygons, EPSG:4326) and is map-ready today.

Run the real OpenDrift ensemble offline, once per scene, and export particles,
50%/90% contours per timestep, the convergence series and the age triple to
`frontDemo/public/runs/<scene>/`. Static files — which is also exactly what a
static host wants later.

Then **delete `frontDemo/src/lib/reconstruction.ts`.** Once real backward frames
exist, a hand-tuned cosmetic transform presented as a hindcast is not redundant,
it is a false claim. `frontDemo/scripts/check-reconstruction.ts` needs rewriting
to validate the exported artifacts instead.

Watch the sign convention: `times` **descends** on a backward run.

### 1.4 Make the animation fluid — DONE 2026-09-22

All of it, in `frontDemo/src/map/ParticleOverlay.ts`: pre-rendered radial
stamp via `drawImage`, Catmull-Rom across four frames, a fading trail buffer
instead of `clearRect`, per-parcel size and brightness, and a continuous rAF
already driven by the fractional playhead. The existing weighting logic is
kept — release bright, backward ensemble a faint haze before the pass, full
weight after — with the forecast thinned further, because the 50/90 contours
are drawn over it and are what it is read from.

Two things deliberately NOT done, and why:

- **Position is never jittered.** Size and brightness vary per parcel; where
  a parcel *is* does not. The whole claim of this view is that these are the
  ensemble's own positions.
- **The 10-minute native step belongs to §1.3**, not here. Interpolating
  between stored timesteps is interpolation whatever the step, and the
  interface says so; exporting finer frames is a change to what is stored.

**If you change the weights, measure the saturated fraction.** Additive
blending clips, and a clipped cloud looks confident while carrying no
density information: the first draft of the stamp held full opacity to 45%
of its radius and put **51.4%** of lit pixels at full white. Fading from the
centre took it to **0%**. Count pixels with alpha >= 250 on the overlay
canvas; judging this by eye is how it got shipped wrong the first time.

### 1.5 A skip button, always visible

"Use precomputed result" on every path, including the live one. Instant, and
labelled as precomputed.

---

## 2. The labelling blocker

### 2.1 Run CFAR, then rebuild the review pack

The proposer currently **cannot** propose `oos` — `bright_target_distance_px`
is `-1.0` for all 355 instances, so the `is_linear AND vessel_adjacent` branch
is unreachable (`ISSUES.md` B2). Run `backend/detect/cfar/detector.py` over the
24 pilot tiles first, then regenerate. Note
`scripts/prepare_annotation_review.py` raises `FileExistsError` if `--out`
already exists, so write to a new directory.

This is what makes a non-specialist review defensible: confirming or rejecting
real `oos` proposals backed by vessel evidence, rather than guessing from shape.

### 2.2 A review pack that can actually be used

The current `index.html` is static and script-free and expects 24 JSON files to
be hand-edited in a text editor. Replace it with one self-contained page showing
per tile: image and mask overlay, the shape statistics already computed
(elongation, compactness, solidity, area), CFAR vessel distance, ERA5 wind at
acquisition, and the rubric — capturing decisions and downloading the JSONs.

### 2.3 The rubric

- **Wind gate first.** Below ~3 m/s there is no Bragg roughness for oil to
  suppress, so the sea is already dark and contrast is meaningless. Above
  ~10–12 m/s wind mixes oil down and re-roughens the surface. Outside the band,
  **defer**. (Espedal 1999.)
- **Linear, trailing a vessel, not widening** → `oos` candidate.
- **Linear, diverging in a V from a bright target** → ship wake. Reject. This is
  the most dangerous confusion: a wake is linear, dark, adjacent to a vessel,
  and would be attributed to the ship that made it.
- **Irregular or compact, no vessel** → `slick_unknown`.
- **Sharp boundary and strong contrast** → oil-like. Weak contrast argues
  biogenic film → defer.
- **Never** promote a `Lookalike` or `No oil` tile. Those 249 tiles have
  genuinely empty masks and are the only look-alike evaluation stratum that
  exists.
- Record `confirmed_by: "<name> (non-specialist, rubric-assisted)"` plus a
  confidence field.

Background: Brekke & Solberg 2005, *Remote Sensing of Environment* 95(1):1–13;
Topouzelis 2013 for the concrete feature families; EMSA CleanSeaNet operational
guidance for how analysts weigh them.

### 2.4 Move the verdict downstream

The detector keeps **one honest class**, `slick`. `oos` versus `slick_unknown`
becomes an evidence-backed verdict computed *after* detection from the wind gate
multiplier, CFAR vessel adjacency, V-divergence, backward-drift plausibility and
shape statistics — rendered with its terms, the way suspect scores already are.

Zero new annotation, zero retraining. It is also what the project's own research
already concluded: `RESEARCH/topics/lookalike-discrimination.md` states that
distinguishing oil from natural films using SAR imagery alone is unreliable, and
lists the four evidence layers that can do it. `weights/L1-ciou-research.json`
already declares one class and says never to relabel predictions as `oos`; this
makes the rest of the system agree with the weights.

### 2.5 [4060 Ti] Zenodo Part II and the look-alike false-alarm rate

**Context for whoever picks this up on the training machine.** Part II's
*images* were never downloaded — only the two mask archives are on disk
(426 KB + 417 KB), and there is no extracted directory. Extracting what is
present yields nothing trainable. The two image archives are about 21 GB each,
42.77 GB total; this machine had 225 GB free at last check.

Skipping Part II was a deliberate 2026-08-31 decision, because Part III already
brought the negative pool to 10.2% / 11.7% / 11.8% per split against a ~10%
target. **But that decision carried an explicit trigger — fetch it if the
baseline over-triggers on look-alikes — and the trigger has fired:** 8 of 11
named look-alike test tiles raise an alarm.

The job:

1. Check whether Part II was ever incorporated on that machine. If it was, say
   so and stop; this item is stale.
2. If not: `scripts/download_zenodo.py --records negatives`, then
   `scripts/extract_zenodo.py`, then verify counts and hashes.
3. Rebuild the dataset with the enlarged negative pool, preserving overlap
   quarantine.
4. Retrain and report the **look-alike false-positive count separately from
   mAP** (constraint C8), against the current 8/11 baseline.

Negative curation is, per the project's own research, the single
highest-leverage intervention available — it is what cut the anchor paper's
false positives from 14 to 5. It costs data, not architecture.

**Do not evaluate on the held-out test split.** It is consumed. A new
generalisation claim needs a freshly frozen, independently labelled holdout.

### 2.6 Archive cleanup — verify before deleting

`data/` is 158 GB. Nothing gets deleted before its extraction is verified:

1. Inventory every archive under `data/raw/**` and `data/interim/**`.
2. Confirm the extracted tree exists with the expected file count; spot-check
   SHA-256 against the manifests.
3. Print the delete list with per-item and total reclaimed space.
4. Delete only after the user confirms that list. Archives whose extraction
   cannot be verified stay.

Part II's two mask archives are excluded until §2.5 completes.

---

## 3. The live local pipeline

`backend/app/__init__.py` is 0 bytes — there is no API. `PLAN/INTERFACES.md` §3
specifies it completely, so this is implementation, not design.

1. `backend/app/main.py` plus routers for scenes, detections, drift, suspects,
   vessels and health.
2. **One write endpoint**, `POST /api/v1/runs`, returning a job id with SSE
   progress. All GETs stay read-only. This is a deliberate amendment to the
   recorded rule that the API never triggers the pipeline — record it in
   `PLAN/CONSTRAINTS.md` as a dated deviation with its reasoning, the way the
   SNAP and sigma-0 decisions were recorded.
3. **Two-pass detection.** You cannot know which parts of a scene hold oil until
   something looks, but you do not need full-resolution inference to look: a
   decimated-overview dark-region screen, then full-res SAHI only on candidate
   windows. That turns an 864-tile sweep into a handful.
4. **Write the ERA5 fetcher.** `backend/ingest/metocean/cache.py` is a complete
   caching layer whose `fetcher` callable has no implementation anywhere.
   `CDSAPI_KEY` is set; CMEMS credentials are not.
5. Wire detect → wind gate → drift ensemble → origin field → convergence → AIS
   gate → scores → evidence.
6. Stream each stage as it completes, replacing the four hardcoded 5-second
   timers with progress that is real.

**No GPU is needed for the physics.** Only detection is GPU-hungry; the drift,
origin-field, convergence and scoring chain is NumPy on CPU and already written.

---

## 4. Deployment

### 4.1 Detection on the visitor's GPU

Export the release checkpoint to ONNX with the existing `ml/export/export.py`
and run it through `onnxruntime-web` on the WebGPU backend. The model is about
2.9 M parameters, so fp16 ONNX is roughly 6 MB — servable as an ordinary static
asset. Detection then runs on the visitor's hardware: no server GPU, no egress,
no per-inference cost.

Gate the UI on `navigator.gpu`. **Word it carefully:** WebGPU is a capability,
not a permission — there is no "Allow GPU?" dialog like camera or microphone.
The panel must tell the visitor what to *do* (update the browser, enable the
flag, switch browsers), not ask them to grant something they cannot. Fall back
to `onnxruntime-web` on WASM with SIMD and threads — tens of seconds rather than
under one, but it completes.

### 4.2 Static hosting

The frontend is a static Vite build and the run artifacts from §1.3 are static
files, so a static host plus object storage covers the public site with no
database in the request path.

Two findings to design around:

- **Cloudflare has no GPU available for a custom model.** Containers are
  CPU-only (max 4 vCPU / 12 GiB / 20 GB disk) and Workers AI runs a fixed
  catalogue — custom weights cannot be uploaded. Hence §4.1.
- **D1 is SQLite; there is no PostGIS.** The current design leans on it hard:
  `LINESTRING M` geometry with epoch seconds in the M ordinate, GiST indexes,
  and the spatiotemporal gate as a single PostGIS operation. Migrating means a
  bbox prefilter in SQL plus the exact gate in Shapely. That is the one genuine
  migration cost and should be costed deliberately. The cheap alternative is to
  keep Supabase for AIS and PostGIS only, and put the heavy imagery on object
  storage — which is where the egress problem actually lives.

Relevant limits, from the current documentation: static hosting allows 20,000
files at 25 MiB each on the free plan; R2 charges **no egress on any storage
class**, with 10 GB-month plus 1 M class-A and 10 M class-B operations free;
Workers cap request bodies at 100 MB on free and pro, so large uploads must go
to object storage directly rather than through a worker; Worker CPU is 30 s by
default on paid, raisable to 5 minutes.

Sequence it: static site and artifacts first (near-free, and it solves public
access on its own), object storage when real imagery goes up, and a server-side
API only if live inference online is actually wanted.

### 4.3 An external GPU host, later

If server-side inference is ever needed, put it behind the same
`POST /runs` plus SSE contract as §3 so the frontend does not change when it is
wired up.

---

## 5. Remaining phases

| Phase | State |
|---|---|
| 03 — characterisation and wind gate | Not started. Named as the next implementation milestone by the independent audit |
| 06 — attribution engine | Not started. Includes the open `S_drift` question: max over track points, or integral of the track through the field? The integral should favour a vessel that lingered, and therefore the Case 3 fixture. Implement both and let the fixture decide |
| 07 — API and visual interface | Partly covered by §3 and §1 |
| 08 — evaluation and validation | Blocked on a fresh holdout |
| 09 — demo packaging | Includes the C12 offline snapshot, which must be tested with the network actually off, not mocked |
| 10 — documentation and handover | — |

Do not tune weights to force a fixture to pass. If `S_drift` cannot carry
Case 3, revisit the formulation and say so.
