# frontDemo — open issues for the next session

**Written:** 2026-09-03, at the end of the forward-figures / colour-panel /
panel-reader pass. Read [`HANDOFF.md`](HANDOFF.md) §0 first for what changed and
why; this file is only what is *left*.

`npx tsc --noEmit` is clean and `npm run build` succeeds as of writing. Nothing
here is blocking.

---

## 1. Context, compressed

Everything below came out of one session of changes to `frontDemo/`, driven by a
plan at `~/.claude/plans/frontdemo-signal-main-page-linear-leaf.md`. The work,
in one line each:

- **Every drawn figure now runs forward from the satellite pass.** Home figures
  2A and 2B, all four console drift/evidence instruments, the console timeline,
  and all four maps' particle clouds. The backward origin field is still
  computed and still what the AIS gate is conditioned on — it is simply no
  longer *drawn*. `README.md` §*Which way the figures run* is the reference.
- **A runtime colour panel** (`lib/palette.tsx` + `components/PalettePanel.tsx`),
  session-only, on both surfaces: a floating window on the home page, a dock
  panel in the console. Per-field revert, revert-all, and a JSON export naming
  every field's source location.
- **The dock drags shut** past ~62% of its minimum, leaving a 10px edge handle
  that reopens on click or on a drag-to-width.
- **The console page scrolls**, with a *panel reader* below the workstation: the
  same panes, one at a time, rendered at `zoom: 1.32` in a ~1100px measure with
  a sticky tab bar. It replaces the old narrow-viewport tab strip at every size.
- **Three drawings on the home page**: a tanker that sails the left gutter on a
  gentle serpentine paying out its wake, a leaking tanker in the drift margin,
  and a processing chain in the method margin built from
  `PLAN/ARCHITECTURE.md`'s data-flow table.
- **A console type scale**, five roles with one setting each, tabulated in the
  docblock of `console/components.tsx`.

Three constraints the person directing this work set, which the next session
should keep:

1. **Ask before assuming.** Surface every ambiguous decision as a question with
   its consequence spelled out, rather than picking a sensible default.
2. **"It works" is not finished.** Typography, spacing and visual balance are
   part of correctness. A visual that restates what the adjacent text already
   says is the wrong *concept*, not a drawing that needs redoing more prettily.
3. **No invented data.** Anything a figure states comes from `content.ts`,
   `PLAN/*.md` or the simulation. This bit twice.

---

## 2. Deviations from the plan

Both are deliberate and neither is a defect. Recorded so nobody re-derives them.

| Plan said | What was done | Why |
|---|---|---|
| Lift `renderPanel` to a module-level `PanelBody` component | Left it a closure inside `ConsoleShell`, passed as a `render` prop to `DockRail`, `FloatWindow` and `PanelDeck` | The point of the lift was reuse, and a prop already gives that from four hosts. Lifting means threading a dozen values (`run`, `hour`, `moment`, `toggles`, `entries`, `state`, …) through a props object for no behavioural gain. **Worth doing if a fifth host appears** |
| Do not change `Pane` / `PaneBody` | `PaneBody` gained a `data-pane-body` attribute | Attribute only, no behaviour change. It is the handle the reader's scoped CSS uses to switch off the internal scroll, which is what lets one component serve both layouts instead of being forked |

---

## 3. Verified, so nobody re-tests it

Measured in the browser this session, several against the numbers `HANDOFF.md`
§9.1 records:

- Slick recolour repaints the console map live (this is what the `MapCanvas`
  repaint-gap fix buys); per-field revert restores one field and leaves the
  others; revert-all clears everything.
- Float window after the `FloatShell` refactor: drag 120 × 60 → **120 × 60**,
  resize +140 × +140 → **+140 × +140**, `Escape` re-docks. Pixel-accurate.
- Dock: drag past minimum shuts it; click reopens at 214; drag-to-330 reopens at
  330. Close all nine panels, reopen one → **430px**, `--panel-scale: 1`.
- Panels menu opens full width, outside the header subtree, with the new panel.
- Timeline `min=0 max=48`, marks T0/+12/+24/+36/+48, ruler every 6 h, **no
  negative hour anywhere**.
- Console at 375 × 812: no horizontal overflow, no rails, reader is the only
  pane reader.
- Home colour panel opens from the masthead swatch as a `z-50` floating window.
- Home page: no error boundary, four plates render, no horizontal overflow.

---

## 4. Not verified — do these first

1. **`prefers-reduced-motion` on both surfaces.** Never exercised. Four things
   now depend on it: `ShipTrail` (should moor the ship at the start and draw no
   wake), `StageChain`, every plate, and `revealOnScroll`. This was already
   listed as unverified in `HANDOFF.md` §9.3 and more now hangs off it.
2. **`filter: grayscale(1)`** on both surfaces. Same §9.3 entry, still open.
3. **The colour export actually downloading.** `downloadPalette` builds a Blob
   and clicks a synthetic anchor; the JSON's *content* is verified by reading
   `exportPalette`, but the download itself has never been triggered in a
   browser. Click **export colours** and confirm a `slicktrace-palette.json`
   lands with sensible `source` strings.
4. **`mumbai-null` on the home page.** The insufficient-evidence branch in
   `sections/Cause.tsx` has still never been triggered in a browser — and
   `Cause.tsx` changed this session (it gained `direction="forward"`). It must be
   the loudest thing in that block and must print `Candidates named: none`.
5. **Console timeline transport.** Play, the three speeds, and the new `<<` /
   `t0` / `>>` checkpoint steppers were rewritten and only read, never clicked.
6. **Evidence pane's `goto t0`.** Rewritten from `goto window`; not clicked.
7. **Token recolour end-to-end.** Changing `--accent` *should* recolour page,
   figures and console chrome together — this is structurally certain (the
   inline custom property is set on the surface root) but was only verified for
   the map's `slick`, not for a token.

---

## 5. Known limitations, with the reasoning

**Land and sea cannot be coloured separately.** Asked for, and not possible with
this basemap. `buildStyle` stacks a flat `water` background, a single **raster**
tile layer from Esri, and an optional tint over it; the raster carries coastline
and open sea in the same pixels, and a raster layer can only be filtered as a
whole. Two routes were checked and rejected: `raster-color` (a luminance→colour
ramp that would have worked) is a Mapbox GL JS v3 property and is **not in
MapLibre 5.24** — confirmed by grepping the shipped bundles; vector tiles with
land and water as separate features need an account key, and this map is
deliberately keyless. The panel now explains this under *Why land and sea move
together*, along with what does partially separate them. **If a keyed vector
basemap ever becomes acceptable, this turns into two real fields and that note
comes out.**

**The panel reader uses CSS `zoom`.** Two consequences: anything measuring
geometry *inside* the reader gets zoomed pixels back from
`getBoundingClientRect`; and on an engine without `zoom` support the reader
renders at normal size, which is a graceful degradation rather than a break. The
alternative was a sweeping px-to-em refactor across a dozen console files — see
the comment block in `index.css`, which also records the two layouts that were
tried and rejected before this one.

**The Browser pane reports `document.visibilityState: "hidden"`**, which
throttles `requestAnimationFrame` to about 1 Hz and clamps timers. Every
animation takes tens of seconds to settle under automation, and `useSpill` needs
~10 s to build a run. Budget for it; do not conclude something is broken.

---

## 6. Improvements worth making

Ordered by value.

1. **Console chrome is outside the type scale.** `components.tsx` now documents
   five roles with one setting each, and the panes follow it. The chrome does
   not: `ConsoleShell`'s header, `SpillKey`, `PanelsMenu` and `Timeline` still
   use ad-hoc 8 / 8.5 / 10 / 10.5px. They are self-consistent, so this is tidying
   rather than a defect — but it is the obvious next step and the scale is
   written down now. The two panel-level exceptions that *were* defects — a
   22px age readout and a 15px candidate name — are gone.
2. ~~**Instrument SVG text is a separate, undocumented scale.**~~ **Done**, in
   the panel-reader pass. The rule is in `console/instruments.tsx`'s docblock:
   *a label anchored to a position stays in the SVG, a summary readout moves out
   to HTML through `FigLine`*. Every summary readout has moved, and each
   instrument now states the width it renders at its composed scale (`figW`),
   which the reader caps it to. What is left inside a viewBox is an axis end, a
   scale bar's length and the `DOWNSTREAM` arrow -- all pinned to geometry, all
   measured rendering between 9 and 12px.
3. **`site/figures.tsx` is 800 lines of dead code.** Nothing imports it; the
   live figures are `plates.tsx` and `env.tsx`. It still contains the *old
   backward* `WideningFigure`, which is now actively misleading to anyone
   grepping for how a figure is drawn. Delete it, or move it to `.backup/`.
4. **`Workspace.tsx:397` has a `useAnimeScope` with no backstop.** Every plate
   got one this session; the console map's furniture did not. Same failure mode:
   primed to invisible, revealed by a timeline a hidden tab can stall.
5. **`growthCurve` is nearly orphaned.** `lib/playback.ts` still exports it, and
   after the timeline rewrite its only live caller is `site/env.tsx`'s growth
   chart (plus dead `figures.tsx`). Fine to keep — just know it is no longer the
   shared thing its position in `lib/` implies.
6. **`ScenarioMeta.id` is typed `string`** so anything holding a run and wanting
   its listing has to cast. One cast in `LogStream.tsx`. Pre-existing; the fix
   belongs in `sim/types.ts`. (`console/NOTES.md` §1.)
7. **`run.gate` and `run.separability`** are carried on `Run` and surfaced
   nowhere on the home page. Pre-existing, `HANDOFF.md` §7.

---

## 6b. The panel-reader pass, and what it settled

Added after §6 was written; the items above it that this touched are marked.

**The map palette is now one palette.** `theme.ts` carries the seven basemap
fields from a `slicktrace-palette.json` export on *both* surfaces — the ground
at `#1a2e21`, a `#083b73` wash at 0.18 over it, and the raster at saturation
−0.49 / contrast 0.67 / brightness 0.26–0.68, with the home page lifted from a
0.44 basemap to the console's 0.92. Only the data inks still differ, which is
the point: orange oil and phosphor over the same sea. Two comments in `theme.ts`
that the new numbers falsified were rewritten rather than left standing — in
particular *"adding contrast crushes it to solid black"*, which was true at a
zero floor and is not true at 0.26.

One consequence worth knowing: the home page had no `basemap-tint` layer before,
and `buildStyle` only creates one when a tint is present at construction. The
colour panel's tint slider was therefore a silent no-op on the home page. It
works now.

**The reader is a third layout, not a tuned version of the second.** The `zoom`
approach shipped in §1 was wrong in a way that is invisible from the markup:
`zoom` scales type but not a `w-full` SVG with a fixed viewBox, so figures ran
at 1.5–2.2× the scale their tick sizes were chosen against and their captions
came out larger than the pane title. A margin-column layout was then built and
thrown away — it measured correctly and read wrongly, because a ruled full-width
label is what makes one of these a console pane rather than a document. What
shipped keeps the labels where they were and spends the width *inside* the body,
through `Split`: a figure beside the rows and the note that explain it, used
only where there is genuinely both. `index.css` records all three attempts.

The measured effect, at a 52rem reader: the track scope 778 → 370px tall, the
radar tile 630 → 327 (it is a `<canvas>` and the old `svg` cap missed it
entirely), the field scope 634 → 460, convergence 265 → 226.

**The console header sheds two controls below `useNarrow`'s breakpoint.** The
panels menu moves panels between docks that a narrow viewport does not render,
so it had nothing to act on; the `sim` badge beside it was competing for a
header that has to wrap at that width. Both are `{!narrow && ...}` rather than
CSS-hidden, so the menu's portal does not mount either. The `sim` disclosure is
still on the `case` group in the control-attributes panel, in the detect pane's
provenance note, and on the map's own status strip, which is untouched.

**Dead space was filled rather than designed around.** Each split left a void
beside a tall figure, and each is now carrying something the pane did not state
anywhere: the 90/50 area ratio and the lobe count beside the field scope, the
tile's ground extent beside the radar chip, the track and matched-segment
lengths and a key to the seven mark types beside the track scope. The age block
lost two duplicated rows and gained its method as a second boxed readout.

---

## 6c. Found while working, not fixed

**The convergence note describes the wrong curve.** `panes.tsx` says *"the
insufficient-evidence rule is written against this curve"* beside a plot that
has run forward since the forward-figures pass. The rule in `sim/drift.ts:282`
tests `best.area90Km2 > cfg.diffuseThresholdKm2`, where `best` is the tightest
point of the **backward** convergence — a different curve, in the direction the
display no longer draws. The sentence was true when the plot ran backward.

Not fixed here because the honest replacement is a decision, not an edit: either
the note stops claiming the plot evidences the refusal, or the threshold is
carried on `DriftRun` (it is currently scenario config, 420 km² for four of the
five and 300 for the fifth, and never leaves the sim) so the pane can state the
rule against the curve it is actually tested on. The second is better and is a
`sim/types.ts` change, which is out of this pass's scope.

---

## 7. Explicitly out of scope

Do not "fix" these; they were decided.

- **Scenario order is unchanged.** Making `mumbai-null` first was asked for and
  then withdrawn.
- **Figures 2C and 2D keep their heights.** Confirmed as fine at 190px.
- **The hindcast is not drawn anywhere.** This was chosen with the cost stated:
  the origin field is the project's actual contribution and it is now evidenced
  by the score decomposition rather than by a picture. Do not quietly add it
  back to a figure.
- **The colour overlay does not persist.** Session-only on purpose — a palette
  that survived a reload would become the product's real palette without anyone
  editing the source it is meant to be tried against. The export is the way out.
