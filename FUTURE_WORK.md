# FUTURE WORK

Ordered by what unblocks what. Open problems are in `ISSUES.md`; finished work
is in `PREVIOUS_WORK.md`.

Two jobs are marked **[4060 Ti]** — they need training and cannot run on the
session machine. See `CLAUDE.md` §1.

---

## 0. Start here — where the 2026-09-22 session stopped

Read `CLAUDE.md` first, then this section, then §1. **Delete this section when
its contents are done** — do not append a second one, or this file becomes the
`HANDOFF.md` that was just removed.

### The situation

Three days to a **local** demo. The frontend must be top-tier; the backend can
stay file-driven. After the demo, the public site goes to Cloudflare (§4). The
user is Haziq; commit as them via the `commitskill` skill and **never add AI
attribution** — this is an academic/competition submission and authorship
matters.

### What the 2026-09-22 session did

| Commit | What |
|---|---|
| `6ef8039` | Committed the training machine's uncommitted work — 238 files |
| `7d41224` | Merged `origin/main`; the real frontend is now local |
| `da1320f` | Tracked the weights manifest |
| `49d03d0` | 11 handoff docs (311 KB) → 6 living docs |
| `1496436` | Frontend README; recorded the maplibre advisory |
| `781c815` | **Fixed the drift ensemble time anchor** — see `ISSUES.md` X9 |
| `16d4d8d` | Continuous playhead for the particle cloud; restored the release layer |

Baseline is **465 passed, 9 skipped**. `run.bat` is the backend menu;
`npm run dev --prefix frontDemo` serves the UI on port 5180.

### What is in flight, and exactly how far

**The animation is half-fixed and NOT verified.** The root cause was found and
addressed; the renderer is untouched.

Found: `Timeline.tsx:249` only ever emitted whole hours, for a good reason —
changing `hour` rebuilds every AIS track, both origin contours and the release
extent. `ParticleOverlay` is the single consumer that interpolates, so feeding
it integers pinned its blend factor at zero and turned a drift animation into a
slideshow advancing once per simulated hour.

Done: `lib/playhead.ts` publishes the fractional hour outside React; the canvas
subscribes and repaints from its own rAF loop. `tsc -b` is clean and the
production build passes.

**Not done, and the next thing to do:**

1. **Verify it actually moves.** Sampling the overlay canvas mid-playback was
   inconclusive — the hindcast haze draws at alpha 0.16 and only about 25
   pixels registered under the sampling stride. Use a finer stride over the
   alpha channel, or temporarily raise the alpha, or count non-zero pixels
   rather than hashing a sparse sample. **Do not claim this works until you
   have seen the cloud move between whole hours.**
2. **Then improve the renderer** in `frontDemo/src/map/ParticleOverlay.ts`: a
   pre-rendered soft radial sprite drawn with `drawImage` instead of
   `ctx.fillRect`; Catmull-Rom across four frames instead of the linear lerp in
   `sample()`; a fading trail buffer instead of `clearRect` every frame;
   per-particle phase and size jitter. Keep the existing weighting logic —
   release bright, hindcast a faint haze before the pass, full weight after.
   That reasoning is sound and hard-won.

### The thing the user noticed, and it is correct

> "animation from t negative x to t0 are just t0 but scaled down"

Exactly right, and worth understanding before touching anything.
`frontDemo/src/lib/reconstruction.ts` takes the **T0 particle cloud** and
applies a uniform scale about a moving centre for every negative hour — see its
`project()` helper. The per-scene constants (`offsetKm`, `start`, `pulse`,
`peak`) are hand-tuned by eye. **Nothing before the pass is physics.**

Do not try to improve that function. Delete it, and feed the map real backward
frames from the OpenDrift ensemble (§1.3). `frontDemo/scripts/check-reconstruction.ts`
must then be rewritten to validate the exported artifacts instead.

### Proven feasible on this machine — do not re-derive

- **The real drift chain runs on CPU in 89 seconds.** 10 members x 200
  particles, 72 h backward, seeded from a real detection centroid. It produces
  a `(433, 2000)` history, a `(433, 42, 51)` origin field, contours and an age
  estimate. OpenDrift 1.14.11, netCDF4, xarray and copernicusmarine are all
  installed and import cleanly.
- `eval/final/scenes/*.geojson` hold **three real full-scene detections**
  (86 / 240 / 40 polygons, EPSG:4326) and are map-ready today. Largest-polygon
  centroids: `-89.686, 29.609`; `-89.011, 28.954`; `-89.667, 29.614`.
- With constant forcing the age estimate correctly returns `monotonic` /
  `indeterminate` — there is no convergence minimum without spatially varying
  flow. That is right behaviour rather than a bug, but it makes for a weak
  demo. Real forcing is what gives the hindcast structure.

### Blocked on the user

1. **ERA5 licence.** The CDS credentials authenticate — a 403 specifically on
   licences proves it. The account has simply not accepted the ERA5 licence:
   `https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels?tab=download#manage-licences`
   One click. Until then the only available forcing is constant. The probe
   script is in the session scratchpad as `cds_probe.py`.
2. **`PLAN/INDEX.md` lines 100-105** still say `frontDemo/` "is owned by a
   separate session. Do not edit it from the backend track." True when the
   trees were split, wrong now. It is protected canon — ask before changing it.
3. **CMEMS has no credentials at all** (`ISSUES.md` X2), so there are no real
   currents, only wind.

### Traps this session hit, so the next one does not

- **`.venv/pyvenv.cfg` pointed at the other machine's Python** and nothing ran.
  Fixed. The same stale prefix (the training machine's home directory) is in
  the annotation pack, `inventory.json`, every `final-v*` split list and
  `release.json` — see `DATA.md` §1. Nothing that reads those verbatim will run.
- **`npm install --prefix frontDemo` fails on npm 10+**; it resolves
  `package.json` from the working directory. Use `cd frontDemo && npm install`.
  `npm run --prefix` is unaffected.
- **Browser probes race the map's async `load`.** Querying the DOM at three
  seconds showed no overlay canvas and led to a wrong conclusion about
  StrictMode being at fault. It was not. Wait until `.maplibregl-map` has a
  bare `<canvas>` child before asserting anything about the overlay.
- **The drift engine requires naive UTC datetimes** and dies deep inside pandas
  on tz-aware ones (`ISSUES.md` X10). An ISO-8601 acquisition time parsed from
  GeoTIFF metadata is naturally tz-aware, so any real ingest path hits this.
- **`git add -A` used to sweep in 169 MB** of derived eval caches. Now
  gitignored, but check `git status` before staging.

### Order of work

§1.1 paths → §1.2 upload → §1.3 real artifacts → §1.4 animation → §2 labels.

The labelling route in §2 needs **no retraining**, which matters because this
machine cannot train anything. §2.5 is written for the 4060 Ti machine and
should be handed over as a unit.

---

## 1. Immediate — the local demo

### 1.1 Make the paths repo-relative

Blocks everything else in this section. Every absolute path in the annotation
pack, `inventory.json`, the eleven `final-v*` split lists and `release.json`
points at the training machine's home directory. The bytes are present and
hash-verified; only the prefix is wrong. Full list in `DATA.md` §1.

### 1.2 Real upload, real metadata

Replace the fingerprint gate in `frontDemo/src/console/SampleImagePanel.tsx`.

Accept a georeferenced sigma-0 dB GeoTIFF, a plain GeoTIFF, or a PNG/JPEG tile
— including the 4,464 real 2048² SAR PNGs already under
`data/processed/dataset/oos/images/`. Reject raw `.SAFE`: SNAP is an hour or
more of CPU and belongs offline.

Required from the user:

| Input | How |
|---|---|
| The raster | drag-drop |
| Acquisition time (UTC) | from GeoTIFF tags, else parsed from the Sentinel-1 filename, else asked for — without it there is no wind field, no AIS window and no honest time axis |
| Location | from CRS and geotransform; if absent, a map pin plus a scale, and the run is stamped *location asserted by user* |

Everything else is derived: wind and current, AIS, bright targets, geometry,
damping, wind gate, drift, origin field, age, candidates, scores, evidence.

**Never send the science raster.** Split it: the float32 sigma-0 dB raster stays
local (COG + DEFLATE, lossless, when it must move); the browser derives an 8-bit
display raster through the project's fixed `DB_WINDOW = (-35.0, 0.0)` and emits
WebP; metadata travels as a JSON sidecar. A 3.58 GB scene becomes roughly 200 KB
of WebP plus 2 KB of JSON, and nothing is lost because the metadata was never in
the pixels. Use the fixed window, not a per-image stretch — see
`PREVIOUS_WORK.md` §2.2.

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

### 1.4 Make the animation fluid

Causes are specific and all in `frontDemo/src/map/ParticleOverlay.ts`:

| Cause | Fix |
|---|---|
| square `fillRect` particles | pre-rendered soft radial sprite via `drawImage` |
| linear interpolation between whole-hour frames | Catmull-Rom across four frames, and export at OpenDrift's native 10-minute step |
| `clearRect` every frame | fading trail buffer so parcels leave streaklets |
| every particle moves identically | per-particle phase offset and size jitter |
| redraw only when `dirty` | continuous rAF driven by a time clock during playback |

Keep the existing weighting logic — release cloud bright, backward ensemble a
faint haze before the pass, full weight after. That reasoning is sound.

The particles are the real ensemble; interpolation between stored timesteps is
interpolation, and the UI should say so.

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
