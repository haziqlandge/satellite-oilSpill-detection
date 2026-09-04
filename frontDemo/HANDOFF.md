# frontDemo — recombination handoff

**Last updated:** 2026-09-01
**Scope:** `frontDemo/` only. The backend/ML track has its own `../HANDOFF.md`
and is unaffected by anything here.

Read this, then [`README.md`](README.md) (architecture and the traps), then
`src/console/NOTES.md`.

---

## 0. The forward-figures pass (latest)

Everything below §0 describes the recombination that produced the two surfaces.
This section is what changed after it.

**A next session should start at [`ISSUES.md`](ISSUES.md)**, which carries the
whole of this pass in compressed form plus what is left to do, what was verified
and what was deliberately decided. This section is the detail behind it.

### What changed

| Area | Change |
|---|---|
| **Direction** | Every drawn figure on both surfaces now runs forward from the satellite pass. See *Which way the figures run* in the README, which names what this costs |
| **Figure 2A** | Forward stack, framed without the suspect track, with a `StackReadout` column carrying each hour's 90% area. The hatch moved from T0 to the horizon: at the pass the 50% region sits under the slick outline, which is already hatched |
| **Figure 2B** | Was the convergence basin; now the forward spread of the 90% region, at 620px to match 2A. The age interval left this figure with it and is stated as a value in the map's readout |
| **Maps** | `MapCanvas` takes `direction`. Under `"forward"` neither the hindcast haze nor the release accumulation is handed to the overlay at all |
| **Colour** | `lib/palette.tsx` is a session-only overlay of CSS tokens and `MapPaint`, driven by `components/PalettePanel` — a floating window on the home page, a dock panel in the console. Export writes every field with its default, its current value and the file and key that owns it |
| **Dock** | Drag the grip past ~62% of its minimum and the rail shuts to a 10px `EdgeHandle`. Click it to reopen at the stored width, or drag inward to reopen at the width you drag to |
| **Console** | The page scrolls. The workstation is a `h-[100dvh]` wrapper, and `PanelDeck` below it renders any panel in one comfortable column with a sticky tab bar. The narrow tab strip is gone — the reader replaces it at every size |
| **Reader scale** | The reader renders the identical panes at `zoom: 1.32` inside a 52rem measure (`[data-panel-reader] [data-pane-host]` in `index.css`). Two earlier attempts were wrong and both are worth not repeating: a fixed-height host that scrolled internally, which is just the dock again; and dock-width columns, which used the page but kept every compact decision and read as a second dashboard. `zoom` is what keeps a figure and the label under it in the proportion they were drawn at |
| **Console type** | The panel family had a panel title at 10.5px and a paragraph at 10.5px — the top and bottom of the hierarchy set identically. Five roles, one setting each, tabulated in the docblock of `console/components.tsx`. The rule: uppercase and tracked means a label, sentence case and untracked means prose |
| **Colour panel** | Per-field revert (a drawn reload glyph beside the attribute) as well as revert-all, both the same control. Every field carries a plain-language sentence naming what it changes on screen — "the shade of the ocean", "the path of whichever vessel is selected" — because a token name means nothing from outside the code |
| **Timeline** | `eventSpan` is `[0, forwardHours]`. Marks come from `checkpointsFor`, shared with the home page's transport. The trace under the ruler is the 90% region's area, because `growthCurve` is entirely pre-pass and drew nothing on the new scale |

### Two things that were measured, not guessed

**`MapCanvas`'s live re-paint was applying about half the theme.** Its `repaint`
array covered the contours and the tracks and silently omitted `slick-fill`,
`slick-line`, `slick-axis`, `release-*`, `targets`, `markers` and
`raster-brightness-min` — so the slick mask and the basemap floor were painted
once at construction and never again. This did not matter while paint was a
frozen literal and mattered immediately once a panel could change it. Verified
by setting the slick to magenta and watching the mask change on the console map.

**A forward stack does not fit a landscape plate.** The forecast ribbon runs
tens of kilometres downwind and stays a few hundred metres across, so a
fit-to-contain is limited by height and uses almost none of the width. Figure 2A
biases the geography left and gives the recovered third to a readout column;
that column carries the same areas figure 2B charts, so the two figures share
their numbers rather than asserting the same thing twice.

### Verified in the browser

- Slick recolour repaints the console map live. **The `--accent` half of this
  line was an overclaim and is corrected here:** what was checked that session
  was the map's `slick`, which is `MapPaint` through `setPaintProperty` — the
  *other* mechanism, not a token. `ISSUES.md` §4.7 recorded it as unverified,
  and when it was finally driven end to end (2026-09-05) it turned out to be
  **false in two places**: both console header menus, being portalled outside
  the surface root, could not be recoloured at all and were rendering in the
  site's orange; and both `SarTile` canvases baked the accent into pixels and
  never re-baked. Both are fixed. Measured after: 148 of 148 `--accent`
  consumers on the console follow an override with none stuck, and the tiles go
  1036 magenta / 0 green under an override to 0 / 1091 on revert-all
- Left dock: drag past minimum shuts it; click reopens at 214; drag-to-330
  reopens at 330 with `--panel-scale` 1.244
- Close all nine panels, reopen one → 430px, `--panel-scale: 1` (the old bug)
- Panels menu still opens full width outside the header subtree, with the new
  panel in it
- Timeline: `min=0 max=48`, marks at T0/+12/+24/+36/+48, ruler every 6h, no
  negative hour anywhere
- Console at 375×812: no horizontal overflow, no rails, deck is the only reader
- Home: no error boundary, four plates render, no horizontal overflow

### Land and sea cannot be coloured separately

Asked for, and not possible with this basemap. `buildStyle` stacks a flat
`water` background, one **raster** tile layer from Esri, and an optional tint
background over it. The raster is a single photograph carrying the coastline and
the open sea in the same pixels; a raster layer can be filtered as a whole
(opacity, saturation, contrast, brightness floor and ceiling) or washed from
above, and nothing can repaint half of it, because the style has no idea which
pixels are land.

Two routes were checked and rejected:

- **`raster-color`**, which maps raster luminance onto a colour ramp and would
  have separated a dark sea from lighter land, is a Mapbox GL JS v3 property.
  It is **not in MapLibre 5.24** — confirmed by grep over the shipped bundles.
- **Vector tiles** with land and water as distinct features would do it
  properly, and every no-cost provider of them wants an account key. The map is
  deliberately keyless (`README`, *Stack*).

What is genuinely available is now said in the panel itself, under *Why land and
sea move together*: on the dark basemap the open sea is the darkest thing in the
picture and the land the lightest, so `basemapBrightnessMin` acts mostly on the
sea and `basemapBrightnessMax` mostly on the land; and taking `basemapOpacity`
to zero removes the photograph, at which point the `water` colour **is** the sea
and the graticule carries the geography. If a keyed vector basemap is ever
acceptable, this becomes two real fields and that note comes out.

### Still open

- **The Browser pane reports `document.visibilityState: "hidden"`**, which
  throttles `requestAnimationFrame` to about 1 Hz and clamps timers. Every
  animation therefore takes tens of seconds to settle under automation. This is
  what `useAnimeScopeInView`'s `backstop` exists for; the plates' own
  `useAnimeScope` timelines have **no** such backstop and are the remaining
  place where a stalled timeline leaves a figure blank
- `frontDemo/vite.config.ts` now reads `process.env.PORT`, and
  `.claude/launch.json` sets `autoPort`, so a second dev server can run beside
  a first
- The tanker and the stage chain are in `site/scenery.tsx`; the gutter ship is
  `site/ShipTrail.tsx` and moors to `[data-ship-start]` / `[data-ship-end]`

---

## 1. What this was, and what happened

The previous state was **four independent design studies** over one simulation
engine — Signal, Terminal, Orbit, Dossier — switchable from a rail on the right
edge, with zero cross-design imports and deliberately no `designs/shared/`.

That study did its job, and the decision was taken to **recombine rather than
overhaul**: Terminal becomes the console, Signal supplies the home page's
structure and masthead, Dossier supplies its graphs, Orbit supplies its live
readouts. The product is **SlickTrace**, with two surfaces.

The old constraint — no shared presentation layer — was the right rule for a
comparison study and is deliberately retired now that there is one product.
`site/` and `console/` do share `sim/`, `map/`, `lib/`, `content.ts` and
`theme.ts`, and share nothing else with each other.

---

## 2. Status: complete

```bash
npx tsc --noEmit          # 0 errors
npm run build             # succeeds; both shells code-split into own chunks
```

| Surface | Route | State |
|---|---|---|
| **Home** | `#/` | Opening, Detection, Drift + Environment, Forecast, Attribution, Method |
| **Console** | `#/console` | Map, two docks, floating windows, timeline, event log |

Deleted after harvesting: `src/designs/` entirely, `designs/registry.ts`,
`components/DesignSwitcher.tsx`, `DesignContext.tsx`, `design.ts`, `useRun.ts`.

---

## 3. What was verified in the browser

Not just typechecked:

- All home sections render; no element stranded at `opacity: 0`.
- **Per-figure spill isolation** — changing the drift block's case changes its
  map, playback and all three environment charts, and leaves the detection,
  forecast and attribution blocks untouched.
- Drift playback runs; the transport scrubs.
- Attribution overlay toggles switch layers; the block has no playback control.
- Suspect list renders five candidates with masked identities and decomposed
  scores.
- **Console docking**: collapse and expand a rail; drag to resize (measured
  214 → 383 px, `--panel-scale` 1.35, font 21.6 px, persisted); double-click a
  tab to float; drag a window (pixel-accurate against the drag delta); resize;
  double-click its title bar to dock it back.
- **Close every panel, reopen one** → it comes back at its proper 430 px, not
  full-viewport. (This was a real bug; see §5.)
- Both header menus open and are fully visible.
- Console map is visibly grey, and both credible-region contours still read.
- Mobile 375 × 812: home is a single column with no horizontal overflow and the
  console falls back to its tab strip.
- Console messages clean on both surfaces on a fresh tab.

---

## 4. Two findings worth keeping

**The lighter console map needed `raster-brightness-min`, not `max`.** Lowering
`max` pushes a basemap back without ever making it greyer, because Esri's dark
canvas over open ocean has almost no bright pixels for a ceiling to act on. And
the lift stayed invisible until the scanline overlay came down: the map's paint
properties read back exactly as set while a full-viewport wash at `opacity:
0.22` plus a radial vignette put the grey straight back to near-black. Texture
over a surface has to be cheap enough to be free; that one was charging.

**The wind chart is about direction because the speed is constant.**
`makeForcing` holds wind speed fixed per scenario and veers only the direction.
Plotting speed as a time series draws a flat line under an area fill that implies
an accumulation which is not happening. The chart makes the veer the subject and
says in its caption that the constancy is a property of the simulation rather
than a calm — this is the kind of thing that has to be stated, not smoothed.

---

## 5. Bugs found and fixed during the recombination

| Bug | Where | Why it mattered |
|---|---|---|
| `overflow-x: auto` on the console header clipped both dropdowns | `ConsoleShell` | Spill key and panels menu both opened, set state correctly, and rendered as a few-pixel sliver. No z-index escapes an overflow clip, and `z-50` inside a header is only `z-50` within it. Both menus now render into `document.body` through a portal |
| Reopening a panel after closing all took the whole viewport | `dock/DockRail` | `--dock-w` was set by an effect keyed on `[size, side]`. Closing every panel unmounts the rail; reopening mounts a fresh element whose deps have not changed, so the effect never re-runs and `width: var(--dock-w)` resolves to `auto`. The resting width is rendered now |
| The panels menu was unusable once panels were closed | `PanelsMenu` | It was a bordered text button the same weight as everything else, with cramped rows. Now a filled green key matching the spill key, with a row-wide toggle, multi-select that never dismisses the menu, and open-all / reset |
| `window.__map` debug global drove the console's furniture | `console/Workspace` | It assumed exactly one map was mounted and had no teardown signal — survivable with a single fixed map, and not once a panel can be torn off into a window that mounts its own. Switched to `MapCanvas`'s `onMap` prop |
| Dossier's SAR plate was a lit white slab on the dark ground | `components/SarTile` | The display stretch was composed for paper. `SarTile` gained a `gain` prop — a display choice, not a change to the data, so the damping contrast the figure is about is untouched |
| Navbar CTA clipped off a 375 px viewport | `site/Nav` | The redundant Home link (the wordmark already goes home) is dropped below `sm`, and the CTA shortens to "Console" |
| Orbit's instruments reached into map paint for a caution ink | `site/instruments` | `--warn` and `--alarm` existed only under Terminal. Both surfaces define them now, so the instruments no longer depend on the map at all |

---

## 6. Things not to undo

1. **Do not make `body` `overflow-x: hidden` again**, and do not put
   `overflow-x: auto` on a bar that carries a dropdown. Both are in the README.
2. **Do not print `run.drift.ageHours` directly.** Use `ageStatement()`.
3. **Keep the release cloud bright and the hindcast a faint haze** while both are
   on screen, or the playback claims the spill was larger before it began.
4. **Candidate tracks stay dim** relative to the selected track.
5. **Every figure keeps its own spill control**, and changing one must not change
   another. The one deliberate exception is the environment subsection, which
   follows the drift block because those charts are that drift's forcing.
6. **The dock layout must always be recoverable** — the panels menu is the only
   route back from a closed panel, and reset must stay reachable.
7. The scientific-integrity constraints in `PLAN/CONSTRAINTS.md` are correctness
   requirements. `insufficient_evidence` must stay the loudest thing on screen
   when set; scores must stay decomposed; dark vessels must stay unnamed.

---

## 7. What is left

Nothing is blocking.

- **`run.gate` and `run.separability`** are carried on `Run` and only partly
  consumed. The attribution block prints `run.gate` directly; nothing recomputes
  separability locally any more, but neither is surfaced on the home page.
- **Mobile was verified for the console and the home page**, at 375 × 812 only.
- **No automated tests.** There is no harness in `frontDemo/`.
- **Not wired to the API.** All content comes from `src/sim/`; PHASE-07 makes
  that a transport change, not a rewrite.
- `frontDemo/.tmp/` holds one-off debug scripts and `frontDemo.zip` /
  `frontDemoworking.zip` are stale archives. All gitignored; delete if unwanted.

---

## 8. Running it

```bash
npm run dev --prefix frontDemo
```

Port 5180. To reach the insufficient-evidence state, pick **Look-alike, no
spill** (`mumbai-null`) on the attribution block, or from the console's spill
key.

---

## 9. Next session: start here

The recombination is complete and both surfaces work. What follows is the list of
things that are **done but not visually verified**, in the order they are most
likely to bite.

### 9.1 Measure these before changing anything

Run the dev server and confirm the baseline still holds, because several of these
were bugs once and the fixes are the kind that regress quietly:

| Check | Expected | How it was measured |
|---|---|---|
| Per-figure isolation | Changing the drift picker moves **only** drift + its environment charts | Read the environment caption's `scene sat at X m/s` before and after: `7.2` (platform) → `5.1` (berthed), with the other three picker labels unchanged |
| Dock resize + type scale | 214 → 383 px gives `--panel-scale: 1.35`, computed `font-size: 21.6px`, persisted to `slicktrace:dock` | Drag the left grip, then read `getComputedStyle(host)` |
| Close all panels, reopen one | Comes back at **430 px**, not full viewport | Toggle every row in the panels menu off, then one on, and measure the rail's `getBoundingClientRect().width` |
| Header menus | Both open **fully visible**, not as a sliver | They render into `document.body`; confirm `[role=dialog]` exists outside the header subtree |
| Console map | Visibly grey, both credible contours still readable | `raster-brightness-min` is the control; `max` alone does nothing here |

### 9.2 A verification trap that cost real time here

**The Browser pane throttles a hidden page.** When `document.hidden` is true,
`setTimeout` is clamped to ~1 s, and `useSpill` builds its run behind a 16 ms
timer. A block therefore sits on its `Loading` placeholder for many seconds and
looks broken when it is merely throttled. Symptoms: `role=status` elements that
never clear, `document.body.scrollHeight` growing slowly, a scroll-walk loop
timing out at 45 s.

Check `document.visibilityState` before concluding anything is wrong, and give
each block several seconds rather than a few hundred milliseconds.

**Screenshots also lie intermittently on the home page.** The `mix-blend-soft-light`
grain layer breaks the capture compositor: the page renders correctly in the
browser while the screenshot comes back black, or with the sticky header drawn at
the bottom of the frame. The DOM is the source of truth. Hide
`[aria-hidden].fixed.inset-0` before capturing if a screenshot is needed.

### 9.3 Not yet verified — do these first

1. **The Dossier plate density pass is only half done.** `SarPlate` was fixed —
   it was a lit white slab on the dark ground and now takes `gain={205}`, a
   display stretch that leaves the damping contrast untouched. The others were
   **not** individually checked against the near-black ground:
   `OriginFieldPlate`, `ConvergencePlate`, `WidthProfilePlate`, `EventStrip`,
   `FlagSeries`. All were composed for ink on paper. Look specifically at hatch
   density, neat-line weight and the registration crosses.
2. **`mumbai-null` on the home page.** The insufficient-evidence branch in
   `sections/Cause.tsx` was read but never triggered in the browser. It must be
   the loudest thing in that block and must print `Candidates named: none`.
3. **Console interactions not exercised:** the float window's resize corner,
   `Escape` to dock a focused window, and the timeline's play/pause and speed
   buttons.
4. **`prefers-reduced-motion` and `filter: grayscale(1)`** on both surfaces.
5. **Performance on the home page.** Three MapLibre contexts plus four run builds.
   The viewport gate spreads the cost, but it has not been profiled on a slow
   machine.

### 9.4 Smaller things left

- `run.gate` is printed on the attribution block; `run.separability` is carried on
  `Run` and surfaced nowhere on the home page.
- `ScenarioMeta.id` is typed `string`, forcing one cast in `LogStream.tsx`. The
  fix belongs in `sim/types.ts`.
- The `MapCanvas` chunk is 1.18 MB (MapLibre). Pre-existing, not introduced here.
- No automated tests, and no harness to put them in.
