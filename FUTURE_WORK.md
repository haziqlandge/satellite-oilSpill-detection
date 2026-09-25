# FUTURE WORK

Ordered by what unblocks what. Open problems are in `ISSUES.md`; finished work
is in `PREVIOUS_WORK.md`.

Items marked **[4060 Ti]** needed training; the work now lives on that machine
(`CLAUDE.md` §1).

---

## 0. Start here (written 2026-09-25, end of the 4060 Ti sessions; the work returns to the session machine)

Read `CLAUDE.md` first, then this section. **Replace this section when its
contents are done** — do not append a second one.

### The situation

A **local** demo plus a public live site
(`satellite-oil-spill-detection.vercel.app`, built by Vercel from `main`).
The user is Haziq. Commit as them via `commitskill` and **never add AI
attribution**; commit only when the user asks. The user verifies in the browser
pane and wants the same from you: reload (and confirm it), view at about
**z9**, screenshot.

**Everything below was done on the RTX 4060 Ti machine and is uncommitted.**
It reaches the session machine as a zip. Unzip it at the repository root
(`HANDOFF_README.txt` inside says how), then run
`.venv/Scripts/python.exe -m scripts.repath_artifacts --check`. The session
machine keeps all data inside the repository: **point at its own in-repo
datasets**, not the `E:`/junction paths some docs mention (`CLAUDE.md` §2).
**No remaining plan item needs the GPU.** Only a retrain would, for example on
two-class labels if B1 is ever done.

### Progress (counted 2026-09-25)

**All 27 items are done, or done up to a step only the user can take.**

- §1: 6/6. §3: 6/6.
- §2: 6/6. §2.6's verified delete list is `eval/cleanup/delete_list.json`
  (9 archives, 91 GB on the 4060 Ti); deleting is the user's step.
- §4: 3/3.
  - §4.2: Vercel serves the static build; the real runs and ONNX are now
    committable (`.gitignore`), and a git-only `npm ci && npm run build` was
    verified. It completes on the user's next push.
  - §4.3: `VITE_API_BASE` + `API_CORS_ORIGINS` let a hosted pipeline plug in
    unchanged.
- §5: 6/6.
  - 03 and 06: done earlier.
  - 07: all 8 acceptance lines evidenced (reads ≤ 298 ms after warm-up;
    52,122 AIS points play at ~70 fps).
  - 08: `eval/RESULTS.md` + `eval/COMPARISON.md`, with the not-met lines
    reported.
  - 09: the network-off run and Supabase seeding were superseded by user
    decisions (always online; no Supabase), recorded in
    `PLAN/CONSTRAINTS.md` C12.
  - 10: the region registry, two new zones (Ennore, Paradip) and the INCOIS
    cross-check.

Several acceptance lines are **measured and not met**, and stay reported:

- mAP .36 against .90;
- Case 3's ablation (Q7);
- Case 2's source 0.13 km outside the contour;
- degenerate ages (F5);
- the Ennore reach about 3.4 times too long (X17).

### What this last session added (all 2026-09-25)

- **Currents.** `backend/ingest/metocean/cmems.py`. The toolbox logs in
  through the `CDSE_*` pair (Marine password now equals CDSE). The three real
  runs are regenerated on ERA5 + CMEMS. **X9** (per-member wind timing) and
  **F20** are closed.
- **Map.** A few large wind/current arrows, each a cell's mean
  (`sim/flow.ts`, `backend/drift/flow.py` → `scene.json` `flow`). A stack of
  flow cards at top right (SIM-tagged only). "Sourced from …" or SIM tags in
  the panels. The refusal banner is gone from the map (pane 04 keeps it).
  Panel prose clamps to 2–3 lines. Real runs with no AIS draw display-only
  SIM traffic.
- **MapLibre 6.11.2** (critical XSS fixed). Import it from
  `frontDemo/src/map/maplibre.ts` only (worker URL).
- **Tooling.**
  - `scripts/verify_offline.py`, `export_snapshot.py`, `archive_cleanup.py`,
    `ennore_crosscheck.py`;
  - `npm run export:evaluation`;
  - `demo/WALKTHROUGH.md`;
  - offline land (`map/offlineLand.ts`).
- **Regions.** `frontDemo/src/sim/regions.json` (read by `sim/regions.ts` and
  `backend/regions.py`) drives:
  - the API's region label;
  - the AIS footprint;
  - the bundled landmask;
  - the evidence-card zone caveats.

  Scenarios `ennore-anchored` and `paradip-spm` rank their truth first and
  are in the Python parity fixtures.

### Verification state at hand-off

- **Last full run** (before the Phase 10 and panel-clamp changes): pytest
  **667 passed, 8 skipped**, ruff and mypy clean (144 files), all 14
  `npm run check` scripts passed, and the build succeeded.
- **After those changes, run individually and all passing:**
  - the attribution / verdict / geometry / landmask / API / AIS-clip tests
    (114);
  - `test_attribution` on 7 scenarios (26);
  - CORS (2);
  - `tsc -b`;
  - `check:scenarios`, `check:corridors`, `check:realruns`;
  - the `vite preview` production build.
- **First job on the session machine: run the full verification** (below),
  and fix whatever it turns up before anything else.

### NEXT, in order

1. **Verify** (below). Expected about 670 passed; update the baseline in
   `CLAUDE.md` §7.
2. **The user commits and pushes**, then checks the Vercel site's Real views
   and flow arrows.
3. **X16**, then ranking a real field. Port the console's `densityGrid` into
   `backend/attribute/field.py` with parity fixtures. Nothing real is
   rankable today.
4. **X17:** try hourly or tidal currents for the Ennore cross-check before
   trusting forecast reach.
5. **X14:** move the AIS export into `backend/ingest/ais/`.
6. **Waiting on a person:**
   - B1 labels;
   - the Q6 QGIS measurement;
   - X7 (the Case 3 acquisition);
   - the §2.6 deletions;
   - F17;
   - the `PositionPicker` review;
   - paid AIS outside US waters.

### Verification

```bash
.venv/Scripts/python.exe -m pytest
```

Then ruff and `mypy ml backend scripts`, both clean. Then the frontend:

```bash
cd frontDemo && npx tsc -b && npm run check && npm run build
```

### Traps already paid for

- **Vercel ships only what git carries.** Keep `frontDemo/public/runs/` and
  `*.onnx` committed.
- **MapLibre 6 needs its worker handed over:** import it from
  `map/maplibre.ts`.
- **A real scene's `detection.parts` is the whole 250 km scene.** Use
  `spillParts` for anything about the spill.
- **The Marine toolbox prompts on stdin without credentials**, and reports a
  refused login with an empty message (`PREVIOUS_WORK.md` §2.24).
- **`realRun.ts` does not hot-swap:** reload and confirm it.
- **The console's boot screen hides the map under load.** Wait for
  `__map.loaded()`.
- **Heredocs break on quotes and backslashes.** Write scripts with the Write
  tool.
- **`times` descends on a backward run.**
- **`json.dumps` writes a bare `NaN`.**
- **npm 10+ ignores `--prefix` for install.**

---

## 1. Immediate — the local demo

### 1.1 Make the paths repo-relative — DONE 2026-09-22

`scripts/repath_artifacts.py` rewrote every reference (commit `467c456`);
`python -m scripts.repath_artifacts --check` reported on 2026-09-23 that every
artifact resolves from the repository. Re-run it after copying anything new from
the training machine, which will embed that machine's paths again.

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

### 1.3 Replace simulated data with real artifacts — DONE 2026-09-23

Done as `sim/realRun.ts` (§0); `lib/reconstruction.ts` is deleted. The real
runs now also carry a 72 h forward forecast and start from the slick's own
shape (§0, "this session"). The original brief follows.

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

### 1.5 A skip button, always visible — DONE 2026-09-23

"Use precomputed result" on every path, including the live one. Instant, and
labelled as precomputed.

**Built as:** the one live path today is an upload's segmenter run, so the
button lives in the add-image panel and the Model Timing panel, always shown
while an upload is on screen. A precomputed result can only exist for a known
input, so results are keyed by the **SHA-256 of the file's bytes** (a renamed
copy still finds it) and stamped with the **model's SHA-256** (a retrained
release never sees a previous model's answer). They are made offline by the
browser's own `segment` on onnxruntime WASM (`npm run precompute:uploads --
<repo-relative files>`; default: every window in `data/processed/sar/windows/`)
into `frontDemo/public/precomputed/`, tracked, 4-31 KB each (RLE masks).
Only the segmentation is swapped; decode, trace, despeckle, coastline and drift
still run on the file in hand. The button is disabled with the reason when no
entry exists, cuts in during model load or between tiles when pressed (the
live run is aborted via `SegmentOptions.signal`), and the inference row,
the panel and the run's provenance all say PRECOMPUTED and when it was made.
`check:precomputed` recomputes every entry whose source is on disk and demands
the identical mask. Measured in the browser: a live WebGPU run on a canvas
decode and the stored WASM entry agree on **all 4,194,304 pixels** of a
2048² tile, scores to four decimals.

**For §3:** the live pipeline (`POST /runs`) must honour the same contract —
the precomputed answer for this exact input and model, and a label. **After
retraining (job 1/2), re-run `npm run precompute:uploads`**: every entry names
the old model, the browser refuses it, and the check fails until it is redone.

### 1.6 Real AIS on the map — DONE 2026-09-23

> "would like to see actual ais ship data overlay and not random fake ships
> with straight lines because that never happens in real life"

Decided with the user: the published vessels' real tracks are the Gulf scenes'
ground truth, and scenes with no real AIS get realistic simulated voyages,
labelled SIM.

**The three Gulf scenes run on real marinecadastre AIS.**
`scripts/export_ais_traffic.py` parses the national days once into
`data/interim/ais/*.npz` (Gulf AOI, ~15 min first run, 8 s after), cuts each
scene's box and window, cleans with `clean_records`, simplifies with
synchronised-distance Douglas-Peucker (every instant within 100 m — a path-only
simplifier would drop a stop on a straight line), records reception gaps
(>15 min) as explicit `breaks`, withholds identities (sequential ids keeping
only the MID; no MMSI or name reaches the file), and flags the published
vessel. 316 / 232 / 315 vessels, 1.2 MB, in `frontDemo/public/ais/`.
`sim/realAis.ts` loads them (`useSpill` awaits it; `buildRun` refuses a real
scene without it), resamples each continuous segment onto a global 5-minute grid
so `behaviour()`'s cadence logic holds, and never fills a gap. The map breaks
tracks at gaps instead of bridging them, and a vessel's position dot is drawn
only when it reported near the playhead.

**Measured, no weights touched:** every truth still ranks first — Case 2 (the
real tanker) 0.757, margin 0.396; Case 3 (the real supply vessel) 0.744, margin
0.186; Case 1 (the platform) 0.679, margin 0.232. Case 2's margin is partly by
construction: the slick is laid along the named vessel's real track, as the
publication describes. What is genuinely tested is that no other real vessel —
232 of them — outscores it. `check:realais` asserts each named vessel's AIS
reaches its published point (0.065 km at the pass; 0.046 km at the berth).

**Everywhere else, voyages instead of rulers.** `voyage()` in `sim/ais.ts`:
each vessel takes its own smoothed route through 2-4 waypoints, arrives from and
leaves toward its own point beyond the lane (lanes funnel, then fan out), speed
wanders, fishing boats trawl a ground at 2.5-4 kn, and tankers, bulkers, tugs
and supply boats sometimes stop — at the approach end of the voyage. The first
version stopped them mid-lane, which put a simulated tug holding station inside
kutch-dark's origin field and it outranked the dark contact; ships wait at
anchorages, not mid-transit, and moving stops there restored the ranking
(margin 0.0579). That is recorded so it is not mistaken for tuning after the
fact. The scripted truth tracks for the samples also bend now, except while
discharging, when they hold course as the real Case 2 tanker did.

**What the user saw and questioned.** The Case 2 truth draws a rectangle. It is
the tanker's real AIS: out of the Mississippi, a box south of the delta at 8 kn,
south along the slick to the tip at the pass, then a second box. Tankers box
offshore waiting for orders — and clean tanks while they do. The Evidence pane
now says "recorded AIS track" for every real vessel so a viewer is not left to
assume the generator drew it.

**Still open.** Uploads and the Indian-waters scenes remain simulated; there is
no free AIS for them on this machine. A real-AIS feed for uploads would need a
provider (Spire, MarineTraffic, Global Fishing Watch) and an account. The real
OpenDrift runs (§0, "wire the real runs") would pair naturally with this real
traffic — same three days — once they are wired into the console.

## 2. The labelling blocker

### 2.1 Run CFAR, then rebuild the review pack — DONE 2026-09-23 (§0, late evening)

The proposer currently **cannot** propose `oos` — `bright_target_distance_px`
is `-1.0` for all 355 instances, so the `is_linear AND vessel_adjacent` branch
is unreachable (`ISSUES.md` B2). Run `backend/detect/cfar/detector.py` over the
24 pilot tiles first, then regenerate. Note
`scripts/prepare_annotation_review.py` raises `FileExistsError` if `--out`
already exists, so write to a new directory.

This is what makes a non-specialist review defensible: confirming or rejecting
real `oos` proposals backed by vessel evidence, rather than guessing from shape.

### 2.2 A review pack that can actually be used — DONE 2026-09-23 (§0)

The current `index.html` is static and script-free and expects 24 JSON files to
be hand-edited in a text editor. Replace it with one self-contained page showing
per tile: image and mask overlay, the shape statistics already computed
(elongation, compactness, solidity, area), CFAR vessel distance, ERA5 wind at
acquisition, and the rubric — capturing decisions and downloading the JSONs.

### 2.3 The rubric — DONE 2026-09-23 (in the review page)

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

### 2.4 Move the verdict downstream — DONE 2026-09-23 in the console; the backend twin landed with phase 03

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

### 2.5 [4060 Ti] Zenodo Part II and the look-alike false-alarm rate — DONE 2026-09-25 (retrained, reported, promoted: `eval/part2/REPORT.md`)

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

## 3. The live local pipeline — 6 of 6 DONE (2026-09-24; §3.5's attribution half 2026-09-25)

Status: 1 DONE (file-backed, X1), 2 DONE (amendment in `PLAN/CONSTRAINTS.md`),
3 DONE (measured, `eval/two-pass/two_pass.json`), 4 DONE (plus the covering
cache lookup), 5 DONE (the chain runs the AIS gate, scores and evidence through
`backend/attribute`; on every real field it refuses to rank and reports only the
gate's count, because the field is wind-only, X2), 6 DONE (console streams the
stages). Findings: `PREVIOUS_WORK.md` §2.20 and §2.23. The original brief follows.

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

### 4.1 Detection on the visitor's GPU — DONE 2026-09-23

Built as described below, with two differences: the export is **fp32** (the
release manifest says `half: false`, and WASM is fp32-native), 12.9 MB; and the
upload panel now runs it in place of the Otsu screen. See §0.

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
| 03 — characterisation and wind gate | **DONE 2026-09-23/24** (`backend/characterize/`, §0). Acceptance: P004 lengths and source-tip ends met on the authored slicks, the wind gate suppresses mumbai-null (0) and scales the real May seed (0.33), C1/C2 structural; the QGIS hand-check on three slicks is open (ISSUES Q6) |
| 06 — attribution engine | **DONE 2026-09-25** (`backend/attribute/`, the console's scorer, matched to it on fixtures). S_drift = `integral`, decided by kutch-dark (`max` ranks its dark contact 4th); Case 3 is identical under both. Without the field, Case 1 and kutch-dark lose their truth; Case 3 does not, so its ablation line is **not met** (ISSUES Q7, `eval/attribution/REPORT.md`). Real runs refuse (wind-only, X2) |
| 07 — API and visual interface | **DONE 2026-09-25**: all 8 acceptance lines evidenced (§0) |
| 08 — evaluation and validation | **DONE 2026-09-25**: `eval/RESULTS.md`, `eval/COMPARISON.md`; not-met lines reported |
| 09 — demo packaging | **DONE 2026-09-25** (network-off and Supabase lines superseded by user decisions, `PLAN/CONSTRAINTS.md` C12) |
| 10 — Indian zones (the plan's PHASE-10) | **DONE 2026-09-25**: region registry, Ennore + Paradip scenarios, zone caveats, INCOIS Ennore cross-check (X17) |

Do not tune weights to force a fixture to pass. If `S_drift` cannot carry
Case 3, revisit the formulation and say so.
