# SlickTrace — one product, two surfaces

A demonstration interface over the SAR + AIS oil-spill attribution system.
**Design work feeding PHASE-07, not PHASE-07 itself.**

> **Ownership:** this folder is worked on from the dev laptop. `backend/` and
> `ml/` are worked on from the training machine. Keeping the two apart is what
> stops the frontend and the pipeline colliding in the same tree.

## Run

```bash
npm install --prefix frontDemo
```

```bash
npm run dev --prefix frontDemo
```

Opens on port 5180. `.claude/launch.json` defines this as a preview target named
`frontDemo`.

```bash
npm run build --prefix frontDemo
```

---

## What this is now

It was **four independent design studies** — Signal, Terminal, Orbit, Dossier —
switchable from a rail on the right edge. That study is finished, and the
directions have been recombined into one product with two surfaces:

| Surface | Route | What it is |
|---|---|---|
| **Home** | `#/` | A scroll page that tells a visitor what is happening in the ocean: detection, drift and its forcing, forecast, root cause, suspects, method |
| **Console** | `#/console` | An operations workstation -- a map, dockable panels, an operational timeline -- and, below it, the same panels at a width you can read them at |

The harvest, in one line each:

- **Signal** gave the home page its composition, typography and masthead.
- **Dossier** gave it the **graphs** — the chart frame, the origin-field and
  convergence plates, the SAR plate, the width profile, the wind gate, the event
  strip, the flag sparkline. Its *paper vocabulary* (stamps, redaction,
  footnotes, Roman numerals) was deliberately left behind.
- **Orbit** gave it the **live readouts** — gauges, segment bars, traces, rockers.
- **Terminal** became the console whole, then grew a window manager.

Both plate and instrument files were already **100% token-driven** — no
hardcoded colours anywhere — which is what made this a recombination rather than
a rewrite. The one real adaptation was value, not hue: Dossier's plates were
composed for ink on paper and had to be re-weighted for a near-black ground
(see *Two things that were measured, not guessed* below).

---

## Architecture

```
src/
  sim/            the simulation. Untouched by the recombination
  map/            MapCanvas, layer definitions, particle overlay
  lib/
    format.ts     vocabulary: term labels, timestamps, ageStatement()
    playback.ts   the event, hour by hour: phase, extent, contacts, checkpoints
    project.ts    SVG projection arithmetic for figures
    motion.ts     anime.js scope + scroll reveal
    palette.tsx   the runtime colour overlay, both surfaces
    hash.ts       hash routing
    spill.ts      per-block scenario state
  components/     shared by both surfaces
    FloatShell      a draggable, resizable window with no opinions
    PalettePanel    the RGB / token / basemap controls
    SarTile
  content.ts      the project's FACTS. Not its copy
  theme.ts        the two surfaces: map paint, fonts, accents
  site/           the home page
    SiteShell  Nav  SpillSelect  Loading  ShipTrail
    components.tsx                (from Signal)
    scenery.tsx                   the tanker and the stage chain
    plates.tsx                    (from Dossier)
    instruments.tsx               (from Orbit)
    env.tsx                       wind / current / growth charts
    sections/  Ocean  Drift  Damage  Cause  Method
  console/        the operations console
    ConsoleShell  Workspace  Timeline  LogStream  panes  reports
    (ConsoleShell also owns PanelDeck, the readable section below the fold)
    SpillKey  PanelsMenu  Popover
    dock/  useDock  DockRail  FloatWindow
```

### Every figure owns its own spill

The rule the home page is built around: **each data block carries its own spill
control, and changing one must not change any other.** `useSpill` in
`lib/spill.ts` is one instance per block, with its own run, its own clock and
its own selection.

Two things make that affordable: `buildRun` is memoised per `scenario:variant`,
so the second block to ask for a case pays nothing; and a block does not build
its run until it nears the viewport, so four half-second builds are never paid
at once on load.

Drift and its environment subsection share one control on purpose. Those charts
*are* the forcing that drift ran through, and letting them disagree would be a
lie about which ocean moved which oil.

### The console is a window manager

`console/dock/` is hand-rolled, about 600 lines. Panels dock left or right, tear
off into floating windows on a double-click, close to a menu and come back from
it. Dock widths drive `--panel-scale`, so widening a dock genuinely enlarges its
type rather than giving small type more room.

The state is one flat record of panel → placement, not the nested split-tree a
dock library keeps: there are two fixed docks and no arbitrary splitting, and a
tree would cost an order of magnitude more code for a rearrangement nobody asked
for. Layout persists under `slicktrace:dock`, and **there is always a reset**.

---

## Scientific integrity

These are correctness requirements from `PLAN/CONSTRAINTS.md`, not disclaimer
text, and they survived the recombination:

- **Age is never a bare scalar.** `ageStatement()` in `lib/format.ts` handles the
  case the old UI got wrong: for an ongoing discharge the interval collapses to
  `0–0 h`, and printing that as a measurement is false precision. It states
  "ongoing" instead, with the method beside it.
- **Damping is a relative dB index, never a thickness.** There is no field for
  microns or for spilled volume anywhere in the interface.
- **`insufficient_evidence` is prominent, never an empty list.** The
  `mumbai-null` scenario triggers it.
- **Every score decomposes** into six named terms with weights and the geometry
  that produced them. No bare totals.
- **Drift is an ensemble** producing credible regions, in either direction.
  Nothing implies it recovers a precise point. Note that the *figures* now run
  forward -- see "Which way the figures run" below -- while the attribution
  underneath them is still conditioned on the backward field.
- **Wind gate is a continuous multiplier**, surfaced, never a silent filter.
- **Dark vessels are ranked but never named.** All identities are masked
  (`MMSI 636•••••4`).
- **Simulated data stays visibly simulated** — a source note on the home page, a
  `SIM` flag in the console.
- Language is **candidate, suspected, score** — never responsible or confirmed.

---

## Stack

- **Vite + React 19 + TypeScript**, `strict`, `noUnusedLocals`
- **Tailwind v4** via `@tailwindcss/vite`. Tokens are CSS custom properties in
  `src/index.css`, re-pointed under `[data-surface="..."]`
- **anime.js v4.5** — named exports (`animate`, `createTimeline`, `stagger`,
  `svg.createDrawable`, `text.split`, `onScroll`, `createScope`, `utils`,
  `steps`). Any v3 snippet found online will not work here, and neither will
  every v4 one: **easing functions are imports now, not strings**. `ease:
  "steps(2)"` was removed from the core and a rejected easing does not throw —
  it falls back to the default, which is a fade. `Caret` was doing exactly that,
  blinking-as-fading, with only a console warning to say so. It is `ease:
  steps(2)` with `steps` imported
- **MapLibre GL JS**, no API key. Esri basemaps, no token
- Fonts self-hosted through `@fontsource`, never a `<link>` to Google Fonts

---

## Which way the figures run

Every drawn figure on both surfaces runs **forward from the satellite pass**.
Figures 2A and 2B on the home page, the console's `FieldScope`,
`ConvergencePlot`, `SpreadPlot` and `TrackScope`, the console timeline, and both
maps' particle clouds all start at T0 and end at the forecast horizon.

This was a deliberate change of subject and it costs something worth naming. The
backward origin field is what the AIS gate is conditioned on -- it is the
project's actual contribution -- and it is no longer *drawn* anywhere. The
system still computes it, `run.drift` still carries it, the score decomposition
still rests on it, and the panes still state the age interval as a value. What
has gone is the picture of it.

Two consequences to know before editing:

- `run.drift.convergence` is pre-filtered to backward hours in `sim/drift.ts`
  and has no forward analogue. Anything forward reads
  `run.drift.frames.filter(f => f.hour >= 0)`, whose frames already carry
  `area90Km2` and `spreadKm`
- `fieldHours()` and `forecastHours()` in `lib/project.ts` are mirrors of each
  other. `fieldProjection` takes `{ includeTrack }` because a forward plate
  framed on a vessel's track is mostly empty plate

## Traps worth not re-entering

**`body { overflow-x: hidden }`.** CSS will not give you `overflow-x: hidden`
with `overflow-y: visible` — the used value of the other axis becomes `auto`,
which makes the body the scroll container. The viewport then never scrolls, so
`window` scroll events never fire, so anime's `onScroll()` observer never
triggers, so every element primed to `opacity: 0` stays there and the page below
the fold renders as a black rectangle with nothing in the console. Use
`overflow-x: clip`.

**`overflow-x: auto` on a bar that carries a menu.** The console header had it so
its content could scroll on a narrow viewport, and it silently clipped both
dropdowns hung off it: they opened, set their state correctly, and rendered as a
few-pixel sliver. Raising `z-index` fixes nothing — no z-index escapes an
overflow clip, and a `z-50` inside a header is only `z-50` *within the header*.
Both menus now render into `document.body` through a portal (`console/Popover`).

**...and a portal escapes the surface root along with the clip.** The half of
that trap nobody saw for two sessions. `#root` lives inside `<body>`, so a panel
portalled to `document.body` is a *sibling* of the surface root, not a
descendant — and the token ladder is re-pointed under `[data-surface]` on that
root. Both console menus therefore read the `:root` fallback, where `--accent`
is the **home page's orange**, and where `--warn`, `--alarm`, `--group` and
`--group-ink` are not declared at all, so `background: var(--group)` was invalid
at computed-value time and resolved to nothing. They also could not see the
colour panel's overrides, which are inline custom properties on that same root:
moving `--accent` recoloured the whole console *except* its two menus. And they
inherited Tailwind preflight's system sans while every character around them was
IBM Plex Mono. `Popover` now restates `data-surface`, spreads `tokenStyle()` and
sets `fontFamily` — it is a second surface root, deliberately, and it has to be
kept in step with `App.tsx`'s.

**Drawing the oil and the hindcast at the same weight.** They are the same kind
of mark and they mean opposite things. The backward ensemble is at its widest at
the far end of the backward horizon — reversal spreads, it does not focus —
which is exactly the hour when least oil is in the water. Painted at equal
weight, the playback claims the spill was larger before it began than at the
moment it was photographed.

**An animation that primes its targets to `opacity: 0`.** A hidden tab throttles
`requestAnimationFrame` to roughly one frame a second, so a one-second reveal
takes most of a minute and anything reading the page meanwhile -- a screenshot,
a scrape, a reader coming back to the tab -- finds blank space. `revealOnScroll`
has carried a timed backstop for this since it was written;
`useAnimeScopeInView` takes a `backstop` selector for the same reason. If a
setup hides something, arrange for it to come back even when the timeline does
not run. Prime with `opacity` as well as any transform, so the rescue has one
uniform signal to look for.

**A CSS custom property set from an effect, consumed by the same element.**
`DockRail` set `--dock-w` in a `useEffect` keyed on `[size, side]`. Close every
panel in a dock and the rail unmounts; reopen one and it mounts a fresh element
whose deps have not changed, so the effect never re-runs, `width: var(--dock-w)`
resolves to `auto`, and the panel takes the whole viewport. The resting width is
rendered now; only the drag writes to the DOM.

**Calling a setter from inside a `useState` updater.** It looks like a way to
read fresh state and act on it in one go, and it works often enough to pass a
casual test. React has *two* sites at which it may invoke a functional updater:
eagerly, inside the event handler, when the fiber has no pending lanes — and
during the **render phase** when it does. On the eager path a nested setter is
an ordinary batched update and everything is fine. On the render-phase path a
setter belonging to an *ancestor* cannot join that pass, so React defers it to a
second render and warns. The timeline's play-at-horizon restart lived in such an
updater and failed roughly two times in three, worst immediately after the
playback loop's own auto-stop — because that auto-stop is what leaves a lane on
the fiber. Keep updaters pure (`p => !p`) and put the decision where the value
is actually consumed. The tell is `Cannot update a component (X) while rendering
a different component (Y)`, which is **deduped by component name and printed
once per session** — easy to scroll past.

**A `<canvas>` cannot read a token, so it bakes one.** `ctx.strokeStyle` takes a
resolved colour string and silently ignores `var()`, so `SarTile` resolves
`var(--accent)` through `getComputedStyle` inside its draw effect. That makes
the drawing only as current as the last time the effect ran — and none of its
dependencies changes when a token moves, because the `maskColour` prop is the
*literal string* `"var(--accent)"`. Both SAR tiles kept the outgoing accent
indefinitely while every SVG figure beside them had already changed. Depend on
the override's **value**, not on the prop that names it. Note the second half:
redrawing on every token change means redrawing on every step of a slider drag,
and the speckle loop is 27–56 ms, so the generated acquisition is cached in a
ref and only the outline is redrawn.

---

## Two things that were measured, not guessed

**The console map was not lighter until `brightness-min` moved.** Lowering
`raster-brightness-max` pushes a basemap back but never makes it greyer — Esri's
dark canvas over open ocean has almost no bright pixels for a ceiling to act on.
`raster-brightness-min` is the control that lifts the floor. And the lift was
invisible until the scanline overlay came down from `opacity: 0.22` with a
radial vignette to a flat `0.1`: the paint properties read back exactly as set
while a full-viewport wash put the grey straight back to near-black.

**The wind chart is about direction because the speed is constant.**
`makeForcing` holds wind *speed* fixed per scenario and veers only direction, so
a speed time series is a dead-flat line and an area fill under it implies an
accumulation that is not happening. The chart makes the veer the subject, draws
the speed as the single value it is against the detectability band, and says in
its caption that the constancy is a property of the simulation rather than a
calm.

---

## Known issues

| Issue | Detail |
|---|---|
| Age interval is degenerate for ongoing releases | The simulation returns `[0, 0, 0]` for four of the five scenarios. `ageStatement()` presents this honestly, but the underlying `source_coincidence` estimator is worth revisiting in PHASE-04 |
| Requires network for the basemap | Everything else is generated locally; the map reports a tile failure in the corner and the graticule, scene, slick, origin field and traffic all still draw (C12) |
| Not wired to the API | All content comes from `src/sim/`. PHASE-07 is where that becomes a transport change — the shapes already mirror `PLAN/INTERFACES.md` §2 |
| No automated tests | There is no test harness in `frontDemo/` |
