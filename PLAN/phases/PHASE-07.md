# PHASE-07 — API and visual interface

## Objective
Serve the pipeline's results over a read-only REST API and build the React + MapLibre +
deck.gl interface that tells the whole story — detection, characterisation, backward drift,
forward forecast, ranked suspects, evidence — without a terminal.

## Why it exists
The problem statement requires "a suitable visual interface". It is also the only artefact
most evaluators will actually interact with, and the place where the interpretability
commitment (C4) is either honoured or quietly dropped.

## Dependencies
PHASE-06 (results to display). Can be scaffolded against fixtures earlier.

## Files to create
```
backend/app/main.py, deps.py
backend/app/routers/{scenes,detections,drift,suspects,vessels,health}.py
backend/app/schemas/*.py                pydantic v2 response models

frontend/src/App.tsx
frontend/src/map/{MapView,SarBasemap,SlickLayer,AisLayer,ParticleLayer,ForecastLayer}.tsx
frontend/src/panels/{SceneList,DetectionPanel,SuspectPanel,EvidenceCard}.tsx
frontend/src/time/TimeSlider.tsx
frontend/src/api/client.ts
```

## Implementation details

### API
Endpoints and payload shapes are fixed in `INTERFACES.md` §3. Two rules:

- **Read-only.** The API never triggers the pipeline (`ARCHITECTURE.md`). Nothing expensive
  runs while a judge is watching.
- **Contours, not grids.** The origin field is a large NetCDF; the API serves its 50% and
  90% contours as time-indexed GeoJSON.

Errors use RFC 7807. Note that `insufficient_evidence` returns **HTTP 200** — it is a
result, not a failure (C3).

### Frontend

**Why deck.gl over Leaflet:** we must render tens of thousands of AIS points plus an
animated particle cloud. Leaflet needs clustering to survive that; deck.gl is
GPU-accelerated (`ARCHITECTURE.md`).

Layers, bottom to top:
1. **SAR basemap** — the σ0 dB scene as tiles/COG
2. **Slick polygons** — coloured by class (`oos` vs `slick_unknown`), opacity by confidence
3. **Origin field contours** — 50% / 90%, driven by the time slider
4. **AIS tracks** — background traffic dimmed, candidates highlighted, top suspect emphasised
5. **Forward forecast** — impact polygons over the next 72 h
6. **CFAR bright targets** — ships and platforms; dark vessels marked distinctly

**The time slider is the centrepiece.** One control drives the backward particle cloud and
the AIS track playback **together**. That synchronised playback is the visual argument for
the entire thesis: the audience watches the origin field contract backward in time until it
lands on a vessel that was there.

Panels:
- **Scene list** → detections
- **Detection panel** — geometry, area, length, damping (flagged low-confidence),
  **age as an interval with its method**, wind speed and gate multiplier
- **Suspect panel** — ranked candidates with a per-term bar breakdown, not just a total
- **Evidence card** — expands a suspect: all six terms with weights, the geometry behind
  each, the matched track segment, anomaly flags with raw series, caveats, thumbnail

### Interpretability requirements in the UI (C4, ethics constraints)
These are acceptance-gated, not stylistic:
- Never render a total score without its term breakdown available in one click
- Always show alternative hypotheses — infrastructure and dark vessels — not only the top vessel
- `insufficient_evidence` renders **prominently**, not as an empty list
- Copy uses "candidate", "suspected", "score" — **never** "guilty", "responsible", "confirmed"
- Dark vessels are ranked but never named
- Caveats (low wind, sparse infrastructure coverage, diffuse origin field) are visible on
  the card, not hidden behind a tooltip

## Inputs / outputs
- In: PostGIS results, NetCDF contours, SAR tiles
- Out: a browsable web application

## Relevant interfaces
`INTERFACES.md` §3 (full endpoint list and the time-indexed FeatureCollection shape).

## Relevant research
`RESEARCH/papers/P002.md` (challenge #3 — the reason the evidence card exists);
`RESEARCH/papers/P001.md` (its Results section is a reasonable minimum UI feature list:
map, vessel positions, anomaly filtering, historical incidents, location search, basemap
switching);
`RESEARCH/topics/ais-attribution-and-scoring.md` (what belongs on the card).

## Tests
- API contract tests against the pydantic schemas for every endpoint.
- GeoJSON validity for all spatial responses.
- `/health` reports DB, weights and forcing-cache status.
- Frontend: component tests for the evidence card; a smoke E2E (Playwright) loading a seeded
  scene and opening a suspect.
- Performance: 50k AIS points render without stutter.

## Acceptance criteria
- [ ] Every `INTERFACES.md` §3 endpoint implemented and contract-tested
- [ ] API responses < 500 ms
- [ ] Cold-load a stored scene and drive the full story from the UI alone — detection →
      characterisation → backward drift → suspects → evidence — with no terminal
- [ ] Time slider animates the origin field and AIS tracks **in sync**
- [ ] Evidence card shows all six terms, their weights, and the geometry behind each
- [ ] `insufficient_evidence` renders prominently
- [ ] No UI copy asserts guilt
- [ ] 50k AIS points render smoothly

## Known failure conditions
- Origin-field contours per timestep are large → simplify geometries server-side; consider
  vector tiles if payloads get heavy.
- SAR basemap tiling: raw σ0 GeoTIFFs are not web-ready → generate COGs or pre-rendered tiles.
- Time-slider desync between drift timesteps (model cadence) and AIS timestamps (1-minute) →
  define a single canonical timeline in the API response and have the client interpolate.
- Colour choices implying certainty (red = guilty) → keep the palette neutral; encode
  *rank*, not verdict.
