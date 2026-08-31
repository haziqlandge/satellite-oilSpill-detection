# frontDemo — redesign handoff

**Last updated:** 2026-08-31 (second pass; see section 4b)
**Scope of this document:** `frontDemo/` only. The backend/ML track has its own
`../HANDOFF.md` and is unaffected by anything here.

Read this, then [`README.md`](README.md) (architecture and the two bug traps),
then the `NOTES.md` inside whichever `src/designs/<name>/` you are working in.

---

## 1. What this was

The brief was `REDESIGN FRONTDEMO AS 4 GENUINELY DISTINCT WEBSITE EXPERIENCES`.
The old `frontDemo` was **one website with five themes**: a `ThemeUI` object
carried panel type, density, console arrangement and button shape, and every
component branched on it, so five directions shared one `Panel`, one
`PageHeader`, one `Stat`, one `TopNav` and one twelve-column page.

It is now **four independent products over one simulation engine**. Five
directions became four; Deepwater was removed as instructed.

---

## 2. Status: complete

All four directions are built, typecheck clean, and build clean.

```bash
npx tsc -b --force        # 0 errors
npm run build             # succeeds; four shells code-split into own chunks
```

| # | Direction | Sections | Lines | State |
|---|---|---|---|---|
| 01 | **Signal** — investigative publication | `/` `picture` `water` `candidates` `cases` `method` | ~4.5k | Done |
| 02 | **Terminal** — operations workstation | `detect` `drift` `traffic` `attribute` `evidence` `method` | ~4.5k | Done |
| 03 | **Orbit** — mission control | `observe` `reconstruct` `traffic` `attribute` `brief` | ~4.1k | Done |
| 04 | **Dossier** — evidence archive | `""` `satellite` `drift` `record` `candidates` `finding` `limitations` | ~5.4k | Done |

Each has its own navigation model, its own page composition, its own component
family, its own typography, its own animation language, and its own interactive
console. **Zero cross-design imports** — verified by grep. There is no
`designs/shared/`, deliberately.

The shared foundation -- `sim/`, `map/`, `lib/`, `useRun` and `content.ts` --
was built first, and each direction was then built against it independently.
That order is what made zero cross-design imports achievable rather than
aspirational.

---

## 3. What was actually verified

Verified in the browser, not just typechecked:

- All four render and switch cleanly; the scenario, hour and selection survive a
  design switch (they live in `useRun` at `App` level, above the shells).
- Signal's three-column editorial spread, bled SAR strip with annotation plates
  and leader lines, and the release small-multiples sequence.
- Terminal's boot transcript printing real run numbers, command rail, dense
  analysis pane, operational timeline and event log. Map container measured at
  824×734 after the zero-height fix.
- Orbit's floating instrument rails over a full-bleed bathymetric chart, the
  node-based temporal strip and the mode bank.
- Dossier's paper ground, Roman-numeral index, exhibit plates, and — the
  strongest single screen in the redesign — **Part VI FINDING** rendering
  `INSUFFICIENT EVIDENCE` with a stamped `NO ATTRIBUTION ISSUED`, the tightest
  90% region, candidates considered/admitted/scored, and `Candidates named:
  None`.
- The brief's grayscale test: with `filter: grayscale(1)` forced on `html`, the
  four remain obviously different products.
- The five scenarios: the authored source ranks #1 in all five; `mumbai-null`
  correctly triggers `insufficientEvidence` (90% contour ≈ 130 km²).

---

## 4. Bugs found and fixed along the way

These were pre-existing or introduced during the work; all are fixed. They are
listed because two of them are the kind that come back.

| Bug | Where | Why it mattered |
|---|---|---|
| `body { overflow-x: hidden }` made the **body** the scroll container | `index.css` | The viewport never scrolled, so `window` scroll events never fired, so anime's `onScroll()` never triggered, so every element primed to `opacity: 0` stayed invisible and the page below the fold was a black rectangle **with nothing in the console**. Now `overflow-x: clip`. |
| `onScroll({ enter: "bottom-=80 top" })` threshold was inverted | `lib/motion.ts` | That asks for the element *leaving* upward, not arriving. Now `"top bottom-=80"`, plus a new `revealFallback()` backstop so priming to invisible can never strand content. |
| `SOURCE.release` never added to the map | `map/MapCanvas.tsx` | `dataLayers` added two layers against a missing source; MapLibre rejected them and unwound the rest of the `load` handler, so the map came up entirely empty. |
| `ctx.strokeStyle = "var(--accent)"` silently ignored | `components/SarTile.tsx` | Canvas cannot resolve CSS variables, so the instance mask outline drew in the previous colour. Now resolved via `getComputedStyle`. |
| Map pane collapsed to `height: 0` | `designs/terminal/Workspace.tsx` | Map reported `loaded() === true` with 20 live layers and composited nothing. |
| `EvidenceCard.originWindow` treated as hours | `designs/terminal` | It is epoch **milliseconds**; the pane printed `T+1701691039000h`. |
| Age interval printed raw | everywhere | The sim returns `[0, 0, 0]` for ongoing discharges; printing that as an interval is false precision. New `ageStatement()` in `lib/format.ts` states "ongoing" instead, with the method beside it. |
| Gated-candidate tracks painted near-white | `design.ts` | 20+ candidates turned every map into spaghetti and buried the selected track. Dimmed across all four. |
| Graticule painted in the rejected-traffic ink | `design.ts` / `basemap.ts` | Terminal had `basemap: "none"` at the time, so the graticule was its **only** geography and it was one step off the ground. `MapPaint.graticule` is now its own token. (Terminal gained a basemap in the second pass; see §4b.) |
| Headline named the wrong sea | `designs/signal` | Copy derived the place from `region`, but Indian waters holds both Kutch and Mumbai High. `ScenarioMeta.place` added. |

---

## 4b. Second pass, 2026-08-31 — playback, map ground and controls

A review pass over the four directions. Everything here is fixed and verified in
the browser; `npx tsc --noEmit` is clean. **Rollback point for the map and
animation work: [`.backup/2026-08-31-animation/`](.backup/2026-08-31-animation/README.md).**

### The release read as smaller than the hindcast

The single loudest problem. At `T-28h` the map showed a wide bright cloud while
the readout beside it said `discharged 0% · surface 0.00 km2`, and at `T0` it
showed a tight slick — so the playback said the spill had been **larger before
it started** than at the moment it was photographed.

The cloud at `T-28h` was the hindcast ensemble, not oil, and it is at its widest
at the far end of the backward horizon precisely because reversal spreads. Both
clouds were being drawn at nearly the same weight, and a viewer has no way to
tell a hypothesis from a measurement when they are the same mark.

`ParticleOverlay` now distinguishes them:

| | Before the pass | After the pass |
|---|---|---|
| **Release cloud** — the oil | bright, and now held at its first frame before the release begins, so the playback opens on a single seed parcel at the source and accumulates until it fills the observed extent | not drawn; the map draws contours |
| **Origin field cloud** — the ensemble | faint haze at 1/7 the ink, behind the oil | full weight — forward, the ensemble *is* oil |

The haze returns to full weight whenever the release cloud is off, because then
it is the subject of the panel and there is nothing to confuse it with. That is
what Signal's *origin field* view and Dossier's ensemble plate want.

Nothing in the simulation changed. `runRelease` already emitted parcel by parcel
from the first hour of the discharge; the playback simply was not showing it.

### The other fixes

| Fix | Where | Why it mattered |
|---|---|---|
| `phaseAt()` had `discharging` and `adrift` inverted | `lib/playback.ts` | Both release hours are negative and `releaseStartHour <= releaseEndHour <= 0`, so the comparison was the wrong way round. The timeline read `ADRIFT, NO LONGER DISCHARGING` on the very hour the first parcel entered the water, and `OIL ENTERING THE WATER` for the hours after it had stopped |
| `particles` toggle controlled nothing | `map/MapCanvas.tsx` | It was `setVisible(toggles.particles \|\| toggles.release)`. ORed together, turning the ensemble off did nothing at all while the release was on. One toggle each now: `particles` is the ensemble, `release` is the oil |
| Particles composited additively on the paper ground | `map/MapCanvas.tsx`, `map/ParticleOverlay.ts` | `lighter` is what makes overlapping parcels read as density on a dark ground. On Dossier's paper it drove every pixel towards white and the cloud vanished into the sheet. Compositing is now derived from the luminance of `MapPaint.water` |
| Terminal had no world at all | `design.ts`, `map/basemap.ts` | `basemap: "none"` left the graticule carrying all the geography, and a degree grid cannot say where the coast is. It now draws the dark grey canvas, held right back and washed in its own green through a new `basemap-tint` background layer between the raster and the data. **The tint layer exists because `raster-saturation` cannot colour a source that is neutral grey — there is no chroma in it to rotate** |
| Orbit's candidate tracks were invisible against its own chart | `design.ts` | Orbit is the one direction whose ground is genuinely blue, and a grey-blue candidate sat *inside* the bathymetry. Now orange: separated from the sea by hue and from the cyan selection by weight. This is a deliberate, scoped exception to §6.2 below, which still holds for the other three |
| The demo switcher answered clicks meant for the page | `components/DesignSwitcher.tsx` | It woke on `pointerdown` anywhere in the document, so selecting a candidate, opening a case or scrubbing the timeline all popped out a control that is not part of any direction. It now wakes only from its own rail, and the wrapper is `pointer-events: none` so its tucked footprint stops swallowing presses |
| Dossier's case switcher looked inert | `designs/dossier/` | Clicking a case in *Other files in this series* did rebuild the run, but nothing the reader could see changed: no scroll to top, the running head far above the fold, and parts — Part VII worst — that are almost entirely case-independent prose. Now scrolls to top on scenario change, the running head is sticky, the case rows carry their own identity, and a page-turn marks the change |
| Orbit's withheld finding blocked the map | `designs/orbit/OrbitShell.tsx` | `ATTRIBUTION WITHHELD` was a centred panel over the full-bleed map with no dismiss control, in every mode. It is now a permanent annunciator band plus a dockable panel: dismissible with `Esc` or its close control, reopened from the header HOLD key, and re-announced per run. **The state cannot be dismissed into invisibility** — the band and the hold lamp stay |
| The evidence track plot read as contradicting the live map | `designs/terminal/instruments.tsx`, `reports.tsx` | `TrackScope` draws the **backward** origin field while the map at `T+8h` draws the **forward** forecast, so they point opposite ways by construction — and nothing on the plot said so. It now states the case, the direction and the hour span it covers, and takes `hour` so it marks the contour for the hour being scrubbed instead of looking static |

## 5. What is left

Nothing is blocking. In rough priority order:

### 5.1 Close the last documented workaround (small, worth doing)

`src/designs/terminal/Workspace.tsx` still picks the MapLibre instance up from
the `window.__map` **debug handle** to drive its crosshair, coordinate readouts
and its own zoom furniture. `MapCanvas` now has the proper interface —
`onMap?: (map: MapLibreMap | null) => void`, fired on `load` and again with
`null` before teardown — but Terminal has **not been switched over to it yet**.

Do this: replace the `window.__map` polling in `Workspace.tsx` with the `onMap`
prop, then delete the workaround note from `src/designs/terminal/NOTES.md`.
The global assumes exactly one map is mounted and has no teardown signal.

### 5.2 Use the data now carried on `Run`

Two fields were added to `Run` during integration and are only partly consumed:

- `run.gate` (`{considered, admitted, reason}`) — Dossier's **Part IV** still
  approximates the gate's numerator by counting proximity across the register.
  It should print `run.gate` directly. Part VI already does.
- `run.separability` — Parts V and VI recompute the margin locally. Note their
  local versions are **ablation-aware** and `run.separability` is not, so this
  is only worth changing if the ablation-off case is what is wanted.

### 5.3 Per-design notes not yet actioned

Each direction left a `NOTES.md`. Resolved items are marked; the open ones are:

- **Terminal** — `toggles.labels` controls nothing under `basemap: "none"`;
  `ScenarioMeta.id` is typed `string` rather than `ScenarioId`, forcing one cast
  in `LogStream.tsx`.
- **Dossier** — `momentAt` is O(vessels × extent vertices) per call. Fine at the
  current register scale (20–35 calls, memoised), but a batched
  `momentsOver(run, hours)` would be the place to optimise if the register ever
  covers the full forecast horizon.
- **Orbit** — items 1 and 2 are now marked RESOLVED (the camera API landed and
  `controls="scale"` already did what was wanted). Its `<style>`-element
  workaround for pseudo-element rules remains, scoped with an `orbit-` prefix.

### 5.4 Known issues, unfixed by choice

- **The age interval is degenerate.** The simulation returns `[0, 0, 0]` for
  four of five scenarios because `source_coincidence` puts the freshest oil at
  hour zero for an ongoing discharge. `ageStatement()` presents this honestly,
  but **the estimator itself is worth revisiting in PHASE-04**. This is a
  science-layer question and was deliberately not "fixed" from the frontend.
- **Basemap needs network — now on all four.** Terminal used to draw no world at
  all, so it was the one direction that did not care. It does now. Everything
  else is still generated locally and the map reports a tile failure in the
  corner while still drawing the graticule, scene, slick, origin field and
  traffic (C12).
- **The seed parcel before the release is one dot.** `runRelease` emits its
  first parcel at `floor(startHour)`, so holding that frame gives the playback
  exactly one marker to open on. `ParticleOverlay.releaseSize()` grows the
  marker as the cloud thins so it is findable. If the release rate is ever
  raised, that size ladder is the thing to re-check.
- **Not wired to the API.** All content comes from `src/sim/`. PHASE-07 makes
  that a transport change, not a rewrite — the shapes already mirror
  `PLAN/INTERFACES.md` §2.
- `frontDemo/.tmp/` holds one-off debug scripts and `frontDemo.zip` is a stale
  archive. Both are gitignored and untouched; delete if unwanted.

### 5.5 Not attempted

- Mobile was built per direction but only **Terminal's** mobile console mode was
  verified in the browser (375×812). Signal, Orbit and Dossier have responsive
  strategies written but not visually checked.
- No automated tests. There is no test harness in `frontDemo/`.

---

## 6. Things not to undo

1. **Do not add a `designs/shared/`.** The four converge on it immediately, and
   that is exactly the failure the redesign existed to fix.
2. **Do not re-brighten `MapPaint.candidate` on Signal, Terminal or Dossier.**
   The separation that matters is candidate versus *selected*, not candidate
   versus traffic, and twenty-odd bright tracks bury the one track the reader is
   being asked to look at. **Orbit is a deliberate exception** (see §4b): it is
   the only direction whose ground is genuinely blue, its candidates were
   invisible *inside* the bathymetry rather than merely quiet, and they are now
   orange. Hue carries the separation from the sea; weight still carries the
   separation from the selection.
3. **Do not make `body` `overflow-x: hidden` again.** See §4.
4. **Do not print `run.drift.ageHours` directly.** Use `ageStatement()`.
5. **Dossier is light on purpose.** Its whole vocabulary is ink on paper.
6. The scientific-integrity constraints in `PLAN/CONSTRAINTS.md` are correctness
   requirements. `insufficient_evidence` must stay the loudest thing on screen
   when set; scores must stay decomposed; dark vessels must stay unnamed.

---

## 7. Running it

```bash
npm install --prefix frontDemo
```

```bash
npm run dev --prefix frontDemo
```

Port 5180. `.claude/launch.json` defines it as a preview target named
`frontDemo`. Switch directions from the neutral control on the right edge; the
choice persists in `localStorage` under `slickline:design`.

To reach the insufficient-evidence state, pick the **Look-alike, no spill**
scenario (`mumbai-null`) — then Dossier Part VI, or Terminal's `attribute` pane.
