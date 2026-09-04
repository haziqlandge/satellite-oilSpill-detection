# frontDemo — open issues for the next session

**Written:** 2026-09-03, at the end of the forward-figures / colour-panel /
panel-reader pass. Read [`HANDOFF.md`](HANDOFF.md) §0 first for what changed and
why; this file is only what is *left*.

`npx tsc --noEmit` is clean and `npm run build` succeeds as of writing. Nothing
here is blocking.

> **Read §9 first — it is the current state.** A third pass on 2026-09-05 closed
> §4.5 (the play-at-horizon defect), §4.6 (`goto t0`) and §4.7 (token recolour),
> which is all three of the items §8.3 lists as "what is actually left", plus the
> four never-seen type sizes in §8.2. Those entries are left standing as the
> record of what was believed at the time; where §9 disagrees with them, §9 wins.
> What is still open is §9.4.

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

1. ~~**`prefers-reduced-motion` on both surfaces.**~~ **Exercised, and one real
   gap found.** Driven by stubbing `matchMedia` and then switching surface by
   hash — the shells are lazy and remount per surface, and a hash change does
   not reload, so the stub survives. Worth reusing; there is no other lever.

   Three of the four were already correct, because `useAnimeScope` and
   `useAnimeScopeInView` both return before their setup when the preference is
   set, and **every plate and `StageChain` prime their targets inside that
   setup** — so nothing is primed and nothing needs revealing. Measured on the
   home page: 22 plate elements and 22 scenery elements all visible, zero
   invisible text nodes anywhere on the page, body height unchanged at 10 813px.
   `ShipTrail` does its own check and does it properly: stroke-dashoffset 10 079
   against a path length of 10 079 (no wake at all) with the hull at y=173 of
   that 10 079 (moored at the start).

   **`revealOnScroll` was the gap.** It is a plain function with no check inside
   it, and `SiteShell.tsx:62` called it unguarded, so it primed its target to
   `opacity: 0` and slid it 26px regardless of the preference — the one motion
   on the page a reader asking for none still got. Now guarded at the call site.
   Blast radius was small (`[data-reveal]` is on exactly one figure, in
   `scenery.tsx`), which is presumably why it went unnoticed.

   Console side: sweep carrier transform `none`, bar resting at 702px of a 702px
   map — the sweep is not drawn, which is its documented resting state — caret
   solid at opacity 1, nothing invisible in any pane.
2. ~~**`filter: grayscale(1)`** on both surfaces.~~ **Checked analytically, and
   it passes.** Screenshots cannot verify this: a root `filter` is not applied by
   the capture compositor, the same way the grain layer breaks captures in
   `HANDOFF.md` §9.2. The rigorous form of the question is whether any state is
   carried by hue alone, and that is answerable from the tokens and a source
   audit.

   Relative luminance out of 255 — ink 221, **warn 193, ok 187**, dim 146, alarm
   128, faint 103. `ok` and `warn` are **5.7 apart**: the same grey, and close to
   how they read to a red-green deficiency. Everything else separates cleanly.

   Every conditional `tone={…}` on both surfaces was then audited. The four
   `ok`/`warn` pairs — the only collapsing combination — each carry the state
   independently: the class name changes (`oos` / `slick_unknown`), the number
   changes (`x1.00` / `x0.42`), the meter's bar is a different length, or the
   word is different (`drift field` / `ambiguous`). **No state on either surface
   is lost in grayscale.**

   The measurement and the rule it implies are now in `components.tsx`'s `Tone`
   docblock, because that is where someone reaches when they want to say "this
   one is a problem" — and an `ok`/`warn` pair cannot say it.
3. ~~**The colour export actually downloading.**~~ **Triggered and verified end
   to end.** Instrumented `URL.createObjectURL`, `URL.revokeObjectURL` and
   `HTMLAnchorElement.prototype.click` without blocking any of them, then
   clicked **export colours** in the reader's colour panel.

   One Blob, `application/json`, 14 083 bytes. The anchor is clicked while in
   the DOM, with `download="slicktrace-palette.json"` and a live `blob:` href,
   and the object URL is revoked once — the one-second timer that exists because
   Firefox races a synchronous revoke. The Blob parses, and carries
   `generatedBy` / `generatedAt` / `editedSurface` / `note` / `site` / `console`.

   The `source` strings were then checked properly rather than eyeballed. All
   **74** fields carry one, none has a malformed shape, every token source reads
   exactly `src/index.css → [data-surface="<surface>"] <token>` and every map
   source `src/theme.ts → SURFACES.<surface>.map.<field>` — and all 26 tokens and
   24 map fields were confirmed to *resolve* against the real files. The values
   are live too: the export carries this session's palette work (console and site
   water `#1a2e21`, tint `#083b73`, site opacity `0.92`), and `changed` is empty
   throughout, correctly, because nothing was overridden in the panel.

   What is *not* verified, because nothing in this environment can observe it:
   whether the browser then wrote the file to disk. Everything up to and
   including the click is confirmed.

   One honesty gap found while reading the output, not fixed: the export omits
   `basemap` (the `ocean | canvas | paper | none` enum) and `showLabels`, because
   `exportPalette`'s `paintKeys` is the panel's *editable* fields rather than all
   of `MapPaint`. Defensible — you cannot revert what you cannot set — but the
   `note` implies the file describes the map paint, and it describes 24 of 26.
4. ~~**`mumbai-null` on the home page.**~~ **Triggered and verified.** Selecting
   *Look-alike, no spill* (the scenario's display name — it does not say
   "mumbai" anywhere in the UI, which is why this was awkward to find) replaces
   the ranked list with the withheld-attribution box: `--alarm` border, an 8%
   alarm wash, 24px of padding, and `Candidates named: none`. It is the loudest
   thing in its block, and by replacement rather than by size — the list it
   stands in for is gone.

   One defect found and fixed while checking: `Candidates named: none` is the
   line that states the *outcome*, and it was set in `--ink-faint`, the quietest
   token on the page, beneath two paragraphs of brighter body text. A conclusion
   printed more softly than its own explanation reads as a footnote to the
   refusal instead of the result of it. It is now in `--alarm`, verified
   rendering `rgb(255, 77, 77)`.

   A note for whoever tests this next: the heading is CSS-uppercased, so a
   case-sensitive grep for "Insufficient evidence" against `innerText` returns
   nothing while the branch is rendering perfectly. That cost a few minutes
   here.
5. **Console timeline transport.** *Partly verified. One unresolved bug — do
   not close this.*

   **Working, clicked and measured:** `<<` / `t0` / `>>` step the 12-hour
   checkpoints exactly (T0 → +12 → +24 → +36, back to +24, `t0` home to T0). The
   three speed buttons each become the sole active one and the default is `4x`,
   matching `useState(4)`. Play flips the label to `|| hold` and advances —
   T+14h to T+48h in nine seconds at 12x, which is ~3.8 h/s and matches what the
   `dt` clamp predicts under this pane's ~1 Hz rAF throttling. It auto-stops on
   reaching T+48h, and pause holds the hour.

   **The bug: pressing play at the horizon is intermittent.** `toggle()` is
   meant to restart the event (`if (hourRef.current >= h1 - 0.01) setHour(h0)`).
   Sampled every 300 ms it did exactly that once — T+48h → T+3h → … → T+36h with
   the label flipping. On two other attempts, sampled every 400 ms for 2.4 s, the
   hour stayed at T+48h and the label stayed `play`: the toggle did nothing.

   **Not diagnosed.** The suspicion is a race between `setHour(h0)` called
   *inside* the `setPlaying` updater and the playback effect reading
   `hourRef.current`: if the ref still holds 48 when the effect runs, the first
   tick sees `acc >= h1` and immediately does `setHour(h1); setPlaying(false)`,
   which would look exactly like this. Calling a second setter from inside a
   state updater is also not something React guarantees — StrictMode
   double-invokes updaters in dev. Both are plausible; neither was confirmed.
   Next session: instrument `hourRef` and the effect's first tick, then decide
   whether the restart belongs outside the updater.
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

1. ~~**Console chrome is outside the type scale.**~~ **Fixed, and the scale
   itself was the bigger half of it.** The entry blamed the chrome for using
   "ad-hoc 8 / 8.5 / 10 / 10.5px", but 10 and 10.5 were never ad-hoc: they are
   `Row`'s label, every `Btn`, `Meter`'s label, `Toggle`, `Alarm`'s body and
   `Table`'s empty state. The documented table listed five roles and **omitted
   the two busiest rungs on the surface**, so the chrome could not have followed
   it. A scale nobody can follow is not a chrome problem.

   Both halves are done. The table in `console/components.tsx` now describes the
   seven rungs that actually exist — 9, 9.5, 10, 10.5, 11, 11.5, 13 — and says
   what stands on each. Eight off-ladder sizes were moved onto it: the 12px
   wordmark → 11.5 (the title rung), two 8.5px labels and two 8px disclosure
   glyphs → 9, the dock handle's 8.5px "hide" → 9, and the boot transcript's
   responsive bump to 12px → a flat 11px, which was the only type size on the
   surface that changed with the viewport.

   `DockRail` and `Workspace` were not in the entry's list and were carrying
   three of the eight. Verified by sweeping the rendered DOM rather than the
   source: every visible HTML text node now computes to one of the seven rungs.
   The two exceptions the sweep turns up are not text — `<script>`/`<style>`/
   `<title>` plus one `.sr-only` span at the browser default, and nineteen SVG
   `<text>` nodes at 8 *user units*, which are the instruments' own scale under
   §6.2's rule and not CSS pixels at all.
2. ~~**Instrument SVG text is a separate, undocumented scale.**~~ **Done**, in
   the panel-reader pass. The rule is in `console/instruments.tsx`'s docblock:
   *a label anchored to a position stays in the SVG, a summary readout moves out
   to HTML through `FigLine`*. Every summary readout has moved, and each
   instrument now states the width it renders at its composed scale (`figW`),
   which the reader caps it to. What is left inside a viewBox is an axis end, a
   scale bar's length and the `DOWNSTREAM` arrow -- all pinned to geometry, all
   measured rendering between 9 and 12px.
3. ~~**`site/figures.tsx` is 800 lines of dead code.**~~ **Deleted.** All seven
   exports had live counterparts first (`SarStrip`→`SarPlate`,
   `BackwardPlate`→`OriginFieldPlate`, `ReleaseSequence`→`EventStrip`,
   `WindGateFigure`→`WindGatePlate`, `WideningFigure`→`ForecastSpreadPlate`,
   `GrowthFigure`→`GrowthChart`), so nothing unique went with it. `.backup/` was
   rejected as the destination: it is not gitignored, so moving the file there
   would have kept all 800 lines in the repo and in every grep -- which is the
   entire harm the entry describes. `README.md`'s file tree was updated.
4. ~~**`Workspace.tsx:397` has a `useAnimeScope` with no backstop.**~~ **The
   premise was wrong, and a real defect was found underneath it.** A backstop
   exists to restore targets a setup primed to `opacity: 0` when the timeline
   never runs, and `settle()` only touches elements below 0.05 opacity. The scan
   sweep primes nothing -- measured at opacity 1 across eight samples -- and
   animates `translateY` only, so a stalled timeline leaves it visible and
   still. A backstop would have been a no-op advertising a hazard that is not
   there. Worth knowing before adding one anywhere: a careless wide selector
   *would* have forced the crosshair (`opacity-0`, driven by pointer events)
   permanently visible.

   What was actually broken: `translateY: ["-2%", "102%"]` resolves against the
   **transformed element's own box**, so the 64px bar travelled 66px and looped
   in the top tenth of a 669px map. The bar now rides a full-height carrier and
   the same percentages mean the map's height -- verified by driving both
   endpoints directly: bar top 0 at `-100%`, 669 at `0%`, a swept distance equal
   to the container. Resize-proof, no measurement, nothing to recompute. The
   sweep is absent under reduced motion by design; see the docblock.
5. ~~**`growthCurve` is nearly orphaned.**~~ **Closed, deliberately not moved.**
   With `figures.tsx` deleted it has exactly one live caller,
   `site/env.tsx`'s growth chart. Moving it there was considered and rejected
   twice over: `playback.ts` is the event's *time axis*, not a bag of shared
   helpers -- `momentAt`, `eventSpan` and `checkpointsFor` are all the same kind
   of projection of a run onto hours -- and `console/Timeline.tsx` names this
   function in the note explaining what its trace used to be, which would then
   be a console file pointing into a home-page component.

   What *was* wrong was the docstring: "for the designs that chart it", plural,
   left over from the four-design study. It now says who uses it and why it
   lives where it does. Checked while here: the `Timeline.tsx:86` mention is
   past tense and accurate, not a stale import.
6. ~~**`ScenarioMeta.id` is typed `string`**~~ **Fixed.** `ScenarioId` moved from
   `sim/scenarios.ts` down into `sim/types.ts` -- it could not go the other way,
   because `scenarios.ts` imports `types.ts` and reaching back up would have
   been a cycle. `scenarios.ts` re-exports the type, so all five existing
   `from "../sim/scenarios"` import sites are untouched. There were **two** casts
   to remove, not one: `LogStream.tsx` and a redundant one in
   `site/SpillSelect.tsx:143` on a value that was already `ScenarioId`.

   Verified load-bearing rather than assumed: with `id` typed `string` a
   misspelled scene id compiled and failed at runtime in `scenarioListing`.
   Injecting `"gom-berthd"` now gives
   `TS2820: Type '"gom-berthd"' is not assignable to type 'ScenarioId'. Did you
   mean '"gom-berthed"'?` (`console/NOTES.md` §1 can be closed with this.)
7. ~~**`run.gate` and `run.separability`** are carried on `Run` and surfaced
   nowhere on the home page.~~ **Fixed; the entry was half stale.** `run.gate`'s
   two counts were already in Figure 4's caption. What was surfaced on *neither*
   surface was `gate.reason` — the rule itself, "tracks retained where
   P(lat, lon, t) exceeded 0.06 of the field peak at the matching backward
   hour". The counts without it say a filter ran; with it they say what the
   filter was, which is the difference between a number and an auditable one.
   It now follows the counts in the caption.

   `separability` was genuinely used nowhere outside the console, and the
   console *derives its own* rather than reading the field — correctly, because
   it must also answer for the ablated ranking, which `run.separability` cannot
   express. The home page has no ablation toggle, so it reads the field. It sits
   under the ranked list, because both scores are printed there and the margin
   is therefore derivable by subtraction — but the **threshold** is not, and
   that is the part that matters: below 0.015 the scorer stops distinguishing
   the top two at all.

   Checked across three scenarios rather than one: berthed 0.057 (list shows
   0.629 and 0.573, so 0.056 at the list's 3dp — agrees), platform 0.117 with
   five candidates, and `mumbai-null`, where the line is correctly *absent*
   because attribution is withheld and there is no ranking to qualify. The
   `null` branch (fewer than two candidates) and the `< 0.015` branch are
   written and typed but unreached by the five fixtures; the copy for the latter
   mirrors `scoring.ts:335` word for word.

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

## 6c. The convergence note described the wrong curve — fixed

`panes.tsx` said *"the insufficient-evidence rule is written against this
curve"* beside a plot that has run forward since the forward-figures pass. The
rule in `sim/drift.ts:282` tests `best.area90Km2 > cfg.diffuseThresholdKm2`,
where `best` is the tightest point of the **backward** convergence. True when
the plot ran backward; false since.

Both halves of the suggested fix are done. `diffuseThresholdKm2` is now carried
on `DriftRun` — it was scenario config that never left the sim — so the pane
prints the test rather than asserting one exists: `origin min` (the backward
contour at its tightest), `refuse above` (this scenario's threshold, 420 km² for
four of the five and 300 for `mumbai-null`), and the test's own result. The note
now says plainly that the drawn curve is *not* what the rule is tested on.

**The interesting part, and a trap for anyone extending this.** The first
version printed a `verdict` row reading `run.drift.insufficientEvidence`, which
looked obviously right and was wrong on the very case it matters for.
`scenarios.ts:911` fills that field from the **scorer**, which withholds for any
of four reasons — a wind gate under 0.15, this diffuse test, no candidate
surviving the gate, or a top two closer than 0.015. On `mumbai-null` the cause
is a wind gate at 1.9 m/s while the origin contour closes to 15 km² against a
300 km² threshold: the field constrains perfectly well and the run is still
withheld. The row would have printed `15 · 300 · withheld` — a test contradicted
by its own verdict, which is exactly the defect this entry was raised about.

The row now reports the diffuse test alone, recomputed from the two numbers
beside it, and the note names the other three causes as things this curve cannot
see. Checked that `originMin` really is the rule's own quantity: `refineAge`
returns `Pick<DriftRun, "ageHours" | "ageMethod" | "temporalState">` and does not
touch `convergence`, so the series on the run is the series `deriveAge` tested.
The `too diffuse` branch is unreached by the five fixtures — none of their
minima approach their thresholds.

---

## 6d. Queued — asked for, not yet designed

**Floating windows should snap into a dock when dragged onto it.** Today a torn
-off panel is dragged around freely (`components/FloatShell.tsx`) and the only
way back is `Escape` or the panels menu; dropping one over a dock rail does
nothing. Wanted: dragging a float onto a panel/dock area docks it there.

Raised by the person directing this work with two conditions attached, and they
are the reason this is a queued entry rather than a change: **do not start it
until every other issue here is closed**, and **interview before implementing**
— surface the ambiguous decisions (which drop targets are live, whether the
rail shows a drop indicator, what happens to the panel already fronted there,
whether the drag is pointer-based or uses the existing dock state) as questions
with their consequences, rather than picking defaults.

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

---

## 8. Session handoff — 2026-09-04, second pass

`npx tsc --noEmit` is clean and `npm run build` succeeds. Session 1's work
(panel reader, `Split`, map palette) is in `HEAD`; everything below is
**uncommitted in the working tree**.

### 8.1 What this session closed, and how well

| Item | State | Strength of the check |
|---|---|---|
| Masthead crowding (asked for directly) | Fixed | Measured at 1512 / 1280 / 1024 + screenshots |
| §6.1 console type scale | Fixed | Source sweep **and** rendered-DOM sweep |
| §6.3 dead `figures.tsx` | Deleted | Grep for importers, every export mapped to a live counterpart |
| §6.4 sweep backstop | Premise disproved; real bug fixed | Geometric proof by driving both transform endpoints |
| §6.5 `growthCurve` | Closed, docstring only | Reasoned; no behaviour change |
| §6.6 `ScenarioMeta.id` | Fixed | Proved load-bearing by injecting a typo → `TS2820` |
| §6.7 `gate` / `separability` | Fixed | Value cross-checked against the list on 3 of 5 scenarios |
| §6c convergence note | Fixed | Caught my own first attempt printing a contradictory verdict |
| §4.1 reduced motion | Fixed + verified | **JS paths only — see 8.2** |
| §4.2 grayscale | Passed | **Analytical only — see 8.2** |
| §4.3 colour export | Verified | Blob, anchor, revoke, all 74 `source` strings resolved |
| §4.4 `mumbai-null` | Verified + one fix | Rendered, and the outcome line re-inked |

### 8.2 Where the checks are weaker than they look

Read this before trusting any row above.

- **§4.1 reduced motion was driven by stubbing `matchMedia`, not by the real
  preference.** That exercises every JavaScript path — `useReducedMotion`,
  `useAnimeScope`, `useAnimeScopeInView`, `ShipTrail`, the guard added to
  `revealOnScroll` — and exercises **none of the CSS**. The
  `@media (prefers-reduced-motion: reduce)` block in `index.css` was inert
  throughout, because a stub cannot make a media query match. If the real
  preference is ever available, re-run it; what is unverified is the CSS clamp,
  not the JS.
- **§4.2 grayscale was never actually looked at.** A root `filter` is not
  applied by this pane's capture compositor — the same class of problem as the
  grain layer in `HANDOFF.md` §9.2 — so every screenshot came back in colour.
  The conclusion (no state is carried by hue alone) rests on token luminances
  plus an audit of every conditional `tone={…}` in the source. That is a decent
  argument and it is *not* the same as having seen the surface in grey.
- **§4.3 cannot confirm a file reached disk.** Everything up to and including
  the anchor click is confirmed; the browser's own save step is unobservable
  here.
- **Eight type sizes were changed in §6.1 and four of them were never seen
  rendered.** The rendered-DOM sweep proves every visible text node computes to
  a rung, which is the property that matters — but these four were not looked
  at individually and one of them is only reachable in a transient state:
  - the **boot transcript** (12px → flat 11px, `Workspace.tsx`) only renders
    before a run finishes building, and it was never caught on screen;
  - the **dock edge-handle "hide"** label (8.5 → 9px) needs a dock collapsed to
    appear, which was never done;
  - the **panels-menu dock/float buttons** (8.5 → 9px) — the menu was opened but
    those buttons were not inspected;
  - the **spill key's "spill" prefix and its ▼** (8.5 and 8 → 9px) appear in
    screenshots but were not scrutinised.
- **§6.7 was checked on three of five scenarios** (berthed, platform,
  `mumbai-null`). `gom-moving` and `kutch-dark` were not. `gate.reason` was read
  on berthed only.
- **Three branches are written and typed but unreachable from the fixtures**, so
  none of them has ever executed: separability's `null` branch (needs a single
  candidate), separability's `< 0.015` branch, and the convergence block's
  `too diffuse` branch (no scenario's origin minimum approaches its threshold).
- **The masthead was not checked below 1024px.** The section nav is hidden
  there, so the bar becomes wordmark + actions; that arrangement was never
  viewed after the change.
- **The panel reader was not re-checked after this session's edits** to
  `panes.tsx` and `components.tsx`. The build passes and the Convergence block
  was seen rendering correctly, but the full reader was not swept again the way
  it was in session 1.
- **The Attribute pane (04) was never opened**, in either session. It carries a
  `data-fields` grid added in session 1.

### 8.3 What is actually left

1. **§4.5 — the play-at-horizon bug.** Diagnosed only as far as two competing
   hypotheses; see the entry. This is the one open *defect*, as opposed to an
   unverified item.
2. **§4.6 — the evidence pane's `goto t0`.** Not started. Never clicked.
3. **§4.7 — token recolour end to end.** Not started. The claim to test is that
   changing `--accent` in the colour panel recolours page, figures and console
   chrome together; session 1 verified this for the map's `slick` only, which is
   the *other* mechanism (map paint, not tokens).
4. **§6d — the floating-window snap-to-dock feature**, queued at the end of this
   pass. It was asked for with two conditions: do not begin until everything
   above is closed, and interview before implementing rather than picking
   defaults.

### 8.4 Two things worth stealing from this pass

- **To force reduced motion:** stub `window.matchMedia` for the
  `prefers-reduced-motion` query, then change surface by hash. The shells are
  lazy and remount per surface and a hash change does not reload, so the stub
  survives and the newly mounted shell reads it. There is no other lever here.
- **A case-sensitive grep against `innerText` will lie to you.** Several
  headings are uppercased in CSS, so `/Insufficient evidence/` finds nothing
  while the block renders perfectly. That cost real time under §4.4.

---

## 9. Session handoff — 2026-09-05, third pass

Run as three agents in parallel, each taking one task at a time and reporting
back before being released to the next; the coordinator did every browser check
rather than accepting an agent's own account of its work. `npx tsc --noEmit` is
clean. Everything below is **uncommitted in the working tree**, on top of the
session-2 work that was already uncommitted.

The three agents were stopped part-way through their last tasks, by request.
None had reached a report and **none had written to disk** — verified:
`index.css`, `lib/motion.ts`, `lib/palette.tsx`, `components/PalettePanel.tsx`
and `theme.ts` are all byte-identical to `HEAD`. There is no half-applied change
to unpick. §9.4 is what they were doing.

### 9.1 Closed this session, and how well

| Item | State | Strength of the check |
|---|---|---|
| Masthead: wordmark hard left, de-crowded (asked for directly) | Fixed | Measured at 1024 / 1279 / 1280 / 1512 / 375 |
| §8.2 masthead below 1024 | Documented; two false comments corrected | Arithmetic, plus browser at 320 / 280 / 768 |
| **§4.5 play-at-horizon** | **Fixed** — was the one open *defect* | 10/10 on the exact failing shape |
| §4.6 evidence pane `goto t0` | Fixed; a real falsehood found under it | Title read back; lit state read from the inline style |
| **§4.7 token recolour end to end** | **Fixed** — two real defects, neither previously known | 148/148 consumers follow; tiles 1036 magenta ↔ 1091 green |
| §8.2 four never-seen type sizes | All four now seen | 9 / 9 / 9 / 11px; full ladder sweep re-run |
| anime `ease: "steps(2)"` (new) | Fixed | Zero new warnings after reload |
| Popover font (new) | Fixed | Renders mono; 0 truncated rows |

The ladder sweep is worth recording: after every edit above, exactly **one**
visible HTML text node on the console computes off the seven rungs, and it is
the `.sr-only` span at the browser default that §6.1 already documents as the
exception. The scale still holds.

### 9.2 The two defects worth naming

**§4.5 was a React updater-site problem, not a race.** The restart lived inside
the `setPlaying` updater — `if (hourRef.current >= h1 - 0.01) setHour(h0)` — and
React has *two* sites at which it may invoke a functional updater. With the
fiber's lanes clean it runs eagerly, inside the click, and the nested `setHour`
batches normally and the restart works. With a lane pending, the eager path is
skipped and the updater runs during the render phase instead, where `setHour`
belongs to an ancestor that has already rendered — so React cannot fold it into
that pass, warns, and defers the hour to a second render. The commit in between
carries `playing: true` with the hour still at the horizon; React flushes passive
effects synchronously at the end of a sync-lane commit, so the playback effect
armed with `acc = 48` and stopped on its own first frame. Hour and label flicker
out and back inside a frame or two, which is why sampling every 300 ms read it as
"the toggle did nothing". The auto-stop dispatches `setPlaying(false)` on this
fiber, which is exactly why it failed worst immediately after one.

`toggle` is now `p => !p`, pure, and the restart decision moved into the playback
effect, which already had to read the hour. The question "are we at the end?" and
the answer "then begin at h0" are now one read of one value in one effect body,
so they cannot land in different commits.

The confirming evidence is a console error the old build emitted and the new one
does not: `Cannot update a component (ConsoleShell) while rendering a different
component (Timeline)`. It is deduped by component name, so it prints **once per
session** — presumably why two prior passes over this never saw it.

**§4.7 could never have passed as written.** `console/Popover.tsx` portals to
`document.body`, making the panel a *sibling* of `#root` rather than a descendant
of `<div data-surface="console">`. It therefore read the `:root` fallback ladder,
where `--accent` is the **home page's orange** — so both console header menus drew
orange borders and orange checkmarks against a phosphor-green console — and where
`--warn`, `--alarm`, `--group` and `--group-ink` are not declared at all, so
`background: var(--group)` on the panels menu's group band was invalid at
computed-value time and resolved to nothing. Being outside the surface root, it
also could not see the colour panel's inline overrides at all: moving `--accent`
recoloured the whole console *except* its two menus. The portal now restates
`data-surface` and spreads `tokenStyle()` — it is a second surface root,
deliberately, and has to stay in step with `App.tsx`'s.

Separately, `SarTile` resolved `var(--accent)` into `ctx.strokeStyle` inside an
effect whose dependencies could not change on a token override (`maskColour` is
the literal string `"var(--accent)"`, which never changes when the token behind
it does), so both SAR tiles kept the outgoing accent indefinitely while every SVG
figure beside them had already changed. Fixed by depending on the override's
*value*, with the generated acquisition cached in a ref so a per-drag redraw does
not re-run a 27–56 ms speckle loop on every slider step.

### 9.3 New findings, not previously recorded

- **`ease: "steps(2)"` was silently doing nothing.** anime removed the string
  form from the core in v4 and a rejected easing does not fail — it falls back to
  the default, which is a fade. So `Caret` had been *fading* while its own
  docblock says a fade reads as a notification and only a hard on/off reads as a
  terminal. Now the imported `steps` function; the runtime warning is gone.
- **The popovers rendered in system sans** inside a wholly monospace console —
  `-apple-system` across all 39 text nodes of the panels menu — because the
  portal inherits from `<html>`, not the surface root. Same root cause as §4.7's
  other half. `fontFamily: fonts.body` added, mirroring `App.tsx:109`. It is
  `fonts.body` and not `fonts.mono` so the line stays a copy of `SurfaceRoot`'s:
  they coincide on the console and must not on the site.
- **The rank-button row is unbounded** — one `Btn` per suspect, so 37 / 25 / 9 /
  32 / 51 buttons across the five fixtures. `goto T0` is therefore the 52nd
  control in that wrap row on `mumbai-null`, which materially affects whether an
  operator ever finds it. Not changed: it is a design decision, and truncating
  the row hides evidence. See §9.4.2.
- **Panes 04 and 05 disagree about ranks under halt.** On `mumbai-null` pane 04
  deliberately prints `—` and heads the block "Hypotheses considered", while
  pane 05's card says `unranked` and then prints rank buttons `01`…`51`
  underneath it. Pane 05 is displaying an ordering pane 04 explicitly withholds —
  the C3 language rule cut both ways in one console. Not fixed. Same class as the
  falsehood §4.6 turned up.

### 9.4 Still open — the three stopped tasks, plus what was already queued

1. **§4.1's CSS half.** §8.2 retracts half of §4.1: the `matchMedia` stub
   exercised every JS path and **none** of the CSS, because a stub cannot make a
   media query match. The `@media (prefers-reduced-motion: reduce)` block in
   `index.css` has still never run. What was wanted: read the block, confirm
   every selector in it still matches something (`site/figures.tsx` was deleted
   and the masthead has been rebuilt twice since it was written), enumerate every
   CSS transition / keyframe / `scroll-behavior` on both surfaces against it, and
   judge what should *not* be clamped — a 150ms `transition-colors` is fine to
   keep, `ConsoleKey`'s `hover:scale-[1.02]` is arguable.
   **One concrete gap already identified and not closed:** `Nav.tsx` calls
   `window.scrollTo({ behavior: "smooth" })` in **JS**, in two places. A CSS
   media query cannot reach that, and nothing guards it.
   **How to exercise it without the real preference:** extract the rules from the
   media block and re-apply them unconditionally through an injected stylesheet.
   That runs the CSS even though nothing available here can make the query match.
2. **The rank row (§9.3).** Wanted as a decision brief rather than a change, with
   three costed options — a top-N that always includes the current selection
   (what happens when the operator wants #37?), a scrollable fixed-height row
   (what does that cost on a surface whose dock already scrolls?), or moving
   `goto` out of the wrap row so its position is stable regardless of count — and
   the measured wrap arithmetic at the dock's real widths (214 default, 430
   reopened, per §3).
3. **Panes 04/05 under halt (§9.3).** Straightforward fix, with one trap: the
   rank buttons are also the only way to select a candidate, so their labels
   cannot simply be blanked, and if every button would render identical text that
   is a usability problem to solve rather than ship. Check what else selects a
   candidate before touching them.
4. **§4.3's honesty gap.** `exportPalette`'s `paintKeys` is the panel's
   *editable* fields, so the export carries 24 of `MapPaint`'s 26 — `basemap`
   (an enum) and `showLabels` (a boolean) are omitted while the `note` implies
   the file describes the map paint. Two defensible fixes: include them, or
   narrow the `note`. Note that `ExportField` is shaped for a hex string, so
   forcing a boolean into it may be a *new* dishonesty replacing the old one.
   **The higher-value half was not reached:** §4.3 checked that every exported
   field resolves to a real source and never checked the converse — that every
   real field is exported. Diff the token ladder in `palette.tsx` against what
   `index.css` actually declares under `[data-surface]`.
5. **§8.2's remaining gaps.** The Attribute pane (04) has still never been opened
   in any session. The panel reader has not been re-swept since session 2's edits
   to `panes.tsx` and `components.tsx` — nor since this session's, which touched
   `components.tsx`, `Popover.tsx` and `reports.tsx`.
6. **§6d — floating-window snap-to-dock.** Unchanged: do not begin until
   everything above is closed, and interview before implementing.

### 9.5 Two corrections to how this gets checked

Both are about the instruments rather than the code, and both cost real time.

- **A `scrollWidth` probe cannot see horizontal clipping on this page.** `body`
  is `overflow-x: clip`, so `document.scrollWidth` goes on reporting the viewport
  width while content is lost off the side. An earlier check of "no overflow at
  375" was measuring nothing. Compare an element's right edge against
  `clientWidth` instead.
  Related, and the reason a number in an earlier draft of §9 was wrong:
  **padding is not a floor.** The masthead overflows its own `pr-6` before it
  overflows the viewport, so "stops fitting" (284.3px) and "loses ink off the
  screen" (260.3px) are two different widths. At a 280px viewport the bar is over
  its padding by four pixels and has lost nothing — measured, actions cluster
  ending at x=260.3 with 19.7px to spare.
- **`getComputedStyle` is not reliable here for reading a React-driven state
  change.** Checking `goto T0`'s lit state it returned byte-identical accent
  colours at T0 and T+24, while `aria-pressed` correctly read `true` then
  `false`. The raw `style` attribute was authoritative and showed the real
  `var(--accent)` → `var(--line)` swap. Read the attribute, not the computed
  value, when the question is what React wrote.
