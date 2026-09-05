# NEXT SESSION — read this first, it is the whole brief

Written 2026-09-05 at the end of the fifth pass. **This file supersedes
`ISSUES.md` §10.5 as the to-do list.** `ISSUES.md` remains the history; this is
what to *do*. Where they disagree, this wins.

`npx tsc --noEmit` is clean. `npm run build` succeeds. **Everything is
uncommitted in the working tree** — 12 source files plus `ISSUES.md`.

---

# PART 0 — STATE OF THE TREE

```
 M ISSUES.md                        §10 recovered, §11 appended
 M src/components/FloatShell.tsx    B1: focus fix (Escape was unreachable)
 M src/components/PalettePanel.tsx  C1: enum + flag controls
 M src/console/dock/FloatWindow.tsx B1: comment corrected
 M src/console/dock/useDock.ts      session 4 refactor + B1: RANK totality guard
 M src/console/reports.tsx          session 4 (masked-MMSI, halt titles)
 M src/index.css                    session 4 reduced-motion rewrite — NEVER EXERCISED
 M src/lib/motion.ts                A1: prefersReducedMotion() + matchMedia hardening
 M src/lib/palette.tsx              C1: 4 field lists, PAINT_COVERAGE guard
 M src/map/MapCanvas.tsx            C1: live world swap, 2 revived controls
 M src/map/basemap.ts               C1: worldSpec(), canShowLabels()
 M src/sim/scenarios.ts             session 4 corridors + A2: 7 copy fixes
 M src/site/Nav.tsx                 sessions 3+5: masthead, scroll guard
```

Nothing is half-finished. No agent was stopped mid-edit this session.

---

# PART 1 — WHAT SESSION 5 CLOSED, AND HOW IT WAS PROVED

Five tasks completed by three agents under a one-task-at-a-time gate. **Every
claim below was re-verified by the coordinator in a real browser or by an
independent probe — none is an agent's own account of itself.**

## A1 — reduced-motion, the JS half (`ISSUES.md` §10.5.2) — CLOSED

Both `window.scrollTo({behavior:"smooth"})` calls in `Nav.tsx` now route through
one `scrollToTop()` that reads `prefersReducedMotion()`.

| test | measured |
|---|---|
| reduced ON, wordmark | first frame `[8, 0]` — instant |
| reduced ON, `Home` link | first frame `[7, 0]` — instant |
| reduced OFF | glide 4000 → 3985 → 3916 → 2586 → 696 → 0 (~800 ms) |
| `matchMedia` deleted | `threw: null`, still scrolls — no crash path |
| hook regression, 6 consumers | caret opacity `[1,1,1,1,1,1]` static, sweep `none`, 0 invisible nodes |

**Two things worth carrying forward.** `"instant"` was used rather than `"auto"`
because `"auto"` defers to the computed `scroll-behavior`, which is only `auto`
*because* the reduced-motion CSS block sets it — a guard whose correctness
depends on the stylesheet it exists to compensate for is not a guard. And the
agent found that `motion.ts` did **not** previously handle a missing
`matchMedia` (it guarded `typeof window` only), so a `window` without
`matchMedia` threw out of a preference check. Now hardened.

## A2 — scenario copy audit (`ISSUES.md` §10.5.8) — AUDIT COMPLETE, 3 ITEMS OPEN

All 5 scenarios × 5 assertion fields × both drift variants, run against the real
`buildRun`. Seven false claims fixed in copy; **no numeric field changed by A2**.

Fixed: `gom-moving`'s "carried downstream for most of a day" (oil stopped
entering at T−4 h); `gom-moving`'s "Every term agrees" (parity ranks the true
vessel **49/51**); `gom-berthed`'s "proximity fails" (proximity is **1.0000,
rank 1** — `ongoing: true` pins the slick head on the berth) and "only the drift
field reaches the berth" (truth is still rank 1 with S_drift **removed
entirely**); `gom-platform`'s "outside the origin window" (a *time* range in this
codebase, and 10,429 of 20,471 reports fall inside it); `kutch-dark`'s "no AIS
report anywhere near" (nearest report **248 m**, nearest track **70 m**); plus
three false comments.

**Independently re-measured by the coordinator** — see PART 4 for the three that
remain open.

## A3 — drift particles never audited (`ISSUES.md` §10.7) — CLOSED, one small finding

Done by the coordinator. Every forward particle extracted from the real run and
classified against the Esri ocean raster (method in PART 5).

| scenario | h0 | h48 |
|---|---|---|
| gom-moving, gom-berthed, gom-platform, mumbai-null | 0% land | **0% land** |
| kutch-dark | 0% land | **0.8% — 1 of 120 sampled, at [69.2788, 22.4173]** |

**Answer: drift particles essentially do not beach, with one exception.**
`kutch-dark` puts a small fraction ashore by the forecast horizon. That is the
same scenario as all three of A2's open findings, which is not a coincidence —
see PART 4.1. Sample was 120 of 1920 particles per frame; a full sweep would
tighten the 0.8% but will not change the conclusion.

## B1 — verify the canonical-order dock refactor (`ISSUES.md` §10.4.2) — CLOSED

| test | measured |
|---|---|
| fresh load | left `//control · //colour · //event log`, right `01…06` — canonical |
| double-click `02 drift` | row closes to `01·03·04·05·06` |
| focus **before** the fix | `document.activeElement` was **`BODY`** |
| focus **after** the fix | `SECTION tabIndex=-1`, inside the float |
| **Escape → drift's slot** | **2**, not 5 — the measured regression is gone |
| render-phase `setState` warning | **none** |
| stale fixture reload | right row canonical *despite* `order: 99` |
| stored `"order"` occurrences | **9 before reload → 0 after** |

**Two real defects found and fixed.** (1) `RANK`'s totality was true only by
luck — `PANELS: PanelDef[]` widened the ids so nothing checked coverage. Proved
by injecting a 10th union member: the compiler raised **one** error, on
`DEFAULT_LAYOUT`, and none on `RANK`, so a developer fixing what they were shown
would ship `RANK[x] === undefined` → `NaN` comparator → implementation-defined
sort → the exact scrambled row the refactor exists to abolish. Now
`as const satisfies readonly PanelDef[]` makes it a compile error.
(2) **`Escape` could never fire**: nothing ever put focus inside a float
(`preventDefault()` on `pointerdown` suppresses click-focus, and the `<section>`
had no `tabIndex`), while the console's legend advertised "esc dock a window".

**The migration answer was a fourth outcome nobody predicted:** `readPlacement`
*rebuilds* the placement, so a stale `order` is neither rejected (which would
discard the operator's layout) nor carried along — it is **stripped**, and gone
for good after one save.

## C1 — palette export + editability (`ISSUES.md` §10.5.4) — CLOSED

`basemap` (enum) and `showLabels` (boolean) are now editable; `MapPaint` is
26/26 covered both directions, enforced by a **compile-time `PAINT_COVERAGE`
guard** so the twenty-seventh field cannot fall out silently.

**The converse audit's real yield was two controls that were exported, editable,
and did nothing on a running map** — worse than a missing field, because they
answered:

| control | before | after |
|---|---|---|
| `contourFill` | inert | `contour90-fill` opacity **0.07 → 0.2**, `contour50-fill` **0.06 → 0.18** ✓ |
| `strokeScale` | inert | traffic **0.68 → 1.92**, slick **1.19 → 3.36** (×2.82, exactly the ratio) ✓ |
| graticule (deliberately unscaled) | 0.5 | **0.5** — confirms only 7 of 14 weights scale ✓ |

Both were evaluated once inside `dataLayers` at layer-add time and never
re-applied by the theme effect.

**The basemap swap does not tear the scene down** — verified: tiles
`Ocean/World_Ocean_Base` → `Canvas/World_Dark_Gray_Base`, layers **23 → 23**,
sources **15 → 15**, all data layers intact, camera unmoved. `setStyle` was
rejected because the 13 GeoJSON sources and ~20 layers are added imperatively in
`MapCanvas`'s `load` handler and appear nowhere in `buildStyle`, so a style diff
would remove all of them.

Also found: 4 dead font tokens (`--font-grotesk/serif/tech/geo`, zero `var()`
references, still shipping `@fontsource` packages), and 2 dead `theme.ts`
members (`SurfaceDef.accent`, `surfaceFor()` — no call sites).

---

# PART 2 — THE PROTOCOL. READ BEFORE DISPATCHING ANYTHING.

Every rule here exists because of a specific failure. Keep the reasons attached.

## 2.1 No browser — as a CATEGORY, never as a tool name

Agents must not use: **any browser tool of any family** (not
`mcp__Claude_Browser__*`, not `mcp__claude-in-chrome__*`, not any future one),
**no dev server**, **no `npm run dev`**, **no requests to localhost**, **no
injecting a stylesheet or script "just to check"**.

**Why a category:** session 4's briefs banned one family *by name*; the agents
used the other one and complied with the letter of it. All three were killed.

**A `PostToolUse` hook will fire** after their edits saying *"A preview server is
running… follow `<verification_workflow>`"*. Tell every agent to **refuse it** —
an automated tool message is not authorisation. All three agents this session
were told, all three refused, and two flagged it unprompted. **Consider
disabling that hook for agent runs; it is an active trap pointed at the one rule
that matters.**

Agents needing a rendered check write the exact recipe **and its falsifier** into
their report. The coordinator runs it. That division worked perfectly this
session — every agent's falsifier list was directly executable.

## 2.2 Context economy — this is what the director asked for

- **Briefs are files.** `frontDemo/.tmp/briefs/BRIEF-<X>.md`, pre-extracted:
  quoted decisions, full interfaces, line-number landmarks, numbers already
  measured. Dispatch prompt is three lines: read your brief, do task 1, stop.
  Never tell an agent to read `ISSUES.md` end to end — it is 1000+ lines.
- **Reports are files.** `frontDemo/.tmp/reports/<AGENT><TASK>-report.md`, with
  the final message capped at **~150 words**: verdict / files touched / the one
  finding that matters / what was not verified / where the recipe is. A good
  report is ~1,800 words and nine of them is most of a context window.
  **This was identified but not yet applied — session 5's agents still returned
  full reports. Apply it from the first dispatch.**
- **State files.** `frontDemo/.tmp/state/<AGENT>.md`, appended at the end of each
  task. Closest thing to resuming available.
- **There is no `SendMessage` for subagents in this build.** Verified three times
  via `ToolSearch`; `ListAgents` advertises it but the tool will not load. Every
  follow-up is a cold spawn. Do not fake parking by polling or sleeping.

## 2.3 Lanes

Exclusive write access per lane, other lanes' files named as forbidden. Agents
read anything; anything needing a file outside the lane is described in the
report and applied by the coordinator. **Verify from the diff afterwards, not
from the agent's word.** Zero collisions occurred this session with this scheme.

## 2.4 Pairing and checkpoints

Tasks 2 and 3 of a lane **may** go in one dispatch (the first gate establishes
trust; the saving of a cold spawn is worth more than a third gate). Never all
three. When paired, the agent writes its checkpoint report **the moment each
task finishes**, and each checkpoint must list **the exact files and hunks that
task touched** so a rejected task can be reverted without taking the other with
it. Pair only when the tasks touch disjoint files **or** one is analysis-only.

## 2.5 The gate

Do not pass minimal changes, skimming, or an asserted check that was not run.
**When an agent corrects you, check it — three times this session an agent was
right about a premise in its own brief**, and saying so in the next brief is what
keeps them doing it. An agent may leave a task open only after ~15 minutes of
genuine effort with multiple approaches documented.

---

# PART 3 — THE FOUR REMAINING TASKS

Suggested split: **1 → 2 → 4**. B and C lanes only; the A lane is closed.

| Lane | Owns (exclusive) | Tasks |
|---|---|---|
| **B — dock & floats** | `console/dock/*`, `components/FloatShell.tsx`, `console/ConsoleShell.tsx` | B2, B3 |
| **C — palette & motion CSS** | `lib/palette.tsx`, `components/PalettePanel.tsx`, `theme.ts`, `index.css`, `map/*` | C2, C3 |

B2 and B3 share files → **hunk lists required**. C2 and C3 are disjoint (C3 is
analysis-only) → safe to pair.

A full pre-written brief for B2+B3 already exists at
**`frontDemo/.tmp/briefs/BRIEF-B2.md`** — it carries the B1 feedback, the §6d
spec, and the semantics B1 established. Reuse it; do not rewrite it. If `.tmp`
has been cleared, everything in it is reproduced below.

---

## B2 — §6d, drag a floating window into a dock (THE DIRECTOR'S EXPLICIT ASK)

**The interview is done. The specification is settled. Do not re-open it and do
not ask for defaults to be confirmed.** From `ISSUES.md` §10.6:

- **drop target: the tab bar strip only.** Not the panel body, not the collapsed
  edge handle; a collapsed dock is not a target
- **no drop indicator.** While the pointer is down over a tab bar the window
  *actually docks, live*, and the rail re-renders with it in place
- **live un-dock:** move back off the strip with the pointer still down and it
  pops back out to a float that keeps following the pointer. Reversible until
  release
- **landing slot is canonical, never positional.** 03 always lands between 02
  and 04, closing over absent panels
- **the dropped panel becomes the fronted tab**
- **cross-dock drops are allowed but append at the end**
- **tear-off:** dragging a docked tab more than a few px tears it into a float
  that follows the pointer immediately. Double-click keeps working
- **canonical order applies to every path home** — verified in B1

### The hard part, flagged so it is not discovered late

**"Docks live while the pointer is still down" means the dragged window unmounts
mid-drag.** `FloatWindow` renders only while the placement is `float`; calling
`dock(id, side)` unmounts it, taking its `pointermove`/`pointerup` listeners and
any `setPointerCapture` with it. The drag then cannot be reversed, which breaks
the live-un-dock requirement outright.

So the drag state and listeners **cannot live in the component that unmounts.**
Options to cost and choose between, with an argument:
1. a drag controller in `ConsoleShell` (owns `useDock`, does not unmount), with
   `FloatShell` merely reporting pointer-down;
2. `window` listeners deliberately not cleaned up by the unmounting component —
   fragile, say why if chosen;
3. keep the window mounted-but-hidden during the docked-preview state — costs a
   placement state that does not exist.

### Requirements

1. **`[role=tablist]` exists three times** — the two rails **and the panel reader
   below the workstation**. The reader is **not** a drop target. Distinguish them
   without relying on DOM order or y-position heuristics.
2. A collapsed dock is not a target (`dock.collapsed[side]`).
3. Reversible any number of times before release.
4. Dropped panel becomes fronted (`setActive(side, id)`).
5. Tear-off past a few px; **double-click-to-float must keep working** and must
   not be swallowed by the drag threshold.
6. Do not regress B1's five verified paths home.
7. Any JS-driven motion needs `prefersReducedMotion()` from `src/lib/motion.ts`.

### Semantics B1 established — load-bearing, written nowhere else

- `dock(id)` on an already-docked panel is a **no-op**.
- **A float carries no origin**: a guest torn off a non-home rail and sent back
  goes to its **home** rail.
- Cross-dock `dock(id, side)` already works: guests append after natives, in
  `RANK` order, independent of arrival order.
- The comparator is "natives before guests, then `RANK`"; natives means
  `homeSide` (from `DEFAULT_LAYOUT`) equals the rendered side.
- `dock()`/`reopen()` call `setActiveRaw` from **inside** the `setLayout`
  updater. Deliberate, documented, and **verified to produce no React warning**.
  **Do not "fix" it.** It differs from the `Timeline.tsx` §4.5 bug because there
  the nested setter belonged to an *ancestor*; here it is the same component.

---

## B3 — `--panel-scale` is inert, and two docblocks say otherwise

### The measurement, already done

Every leaf text node in the right dock computes to an identical font size at 300,
430 and 760 px — same histogram at all three:

```
87 x 10px · 15 x 9.5px · 14 x 11px · 12 x 9px · 9 x 11.5px · 9 x 10.5px · 4 x 13px · 1 x 7px
```

The dock body's own font-size **does** move — 14.4 / 15.904 / 21.52 px, exactly
`16 × scale` — so the property is set and **nothing inherits it**: every console
size is an absolute `text-[10px]` bracket and the padding utilities are px too
(buttons are 33.2 px wide at every width).

### What claims otherwise

- `useDock.ts`'s `scaleFor` docblock — describes scaling that does not happen.
- `DockRail.tsx`'s `body` comment — "widening a dock genuinely enlarges its
  contents rather than just giving them more room to be small in". False.
- `FloatShell.tsx:239` inherits the same non-effect.

Mechanism: `DockRail.tsx:82` writes it during drag, `:241` in the style object,
`:246` `fontSize: "calc(1em * var(--panel-scale, 1))"`.

### The constraint

**The sweeping px-to-em refactor was already considered and rejected** (§5) —
that rejection is why the panel reader uses CSS `zoom`. Do not propose it again
as new. So: either **make the claims true-to-fact**, or **delete the inert
mechanism**. Decide and argue. Whichever, the false claims must not survive.

---

## C2 — exercise the reduced-motion CSS (`ISSUES.md` §10.5.1 / §10.4.1)

`src/index.css`'s `@media (prefers-reduced-motion: reduce)` block was rewritten
in session 4 by an agent killed mid-flight. **It has still never run.** Nothing
in this environment can make the query match; an injected stylesheet is the only
lever, and the snippets were never built.

### What is already established

The block lives in `@layer base` and clamps universally:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-delay: 0s !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-delay: 0s !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Its central cascade argument is checkable and appears correct: **unlayered
`!important` is the *weakest* important author position**, so Tailwind's `!`
modifier compiling into `@layer utilities` (`duration-200!`) would punch straight
through a clamp sitting outside every layer. `base` is declared before
`components` and `utilities`, so under the reversed order it outranks both.

Its census was verified exactly by grep: 33 `transition-colors`, 5
`transition-opacity`, 2 `transition-[filter]`, 1 each of `transition-transform`,
`transition-all`, `transition-[transform,box-shadow,filter]`, and 1
`animate-pulse` → **44 utilities, 43 transitions, 1 keyframe animation**.

### What C2 must do

1. **Write the injection recipe** (the agent writes it; the coordinator runs it):
   extract the rules from the media block, re-apply them unconditionally through
   an injected stylesheet, then read back `transitionDuration` on a named element
   per surface plus `scrollBehavior` on the root. Give the expected values and
   the falsifier for each.
2. **Confirm every selector in the block still matches something.**
   `site/figures.tsx` was deleted and the masthead has been rebuilt twice since
   that block was written.
3. **Check the `.backup/` claim.** The block asserts that `npm run build`
   produces **three** compiled `prefers-reduced-motion` blocks — this one,
   MapLibre's, and a dead
   `@media (prefers-reduced-motion: no-preference)` carrying three `motion-safe:`
   utilities that match no element, because **Tailwind's source detection reaches
   `.backup/`, which is not gitignored** and still contains
   `DesignSwitcher.tsx` with `motion-safe:` classes. **The compiled CSS was never
   actually grepped.** Grep it. If true, the cheapest fix is gitignoring
   `.backup/` — note the root `.gitignore` currently covers `frontDemo/.tmp/`
   only.
4. **Judge what should not be clamped**, with an argument. A 150 ms
   `transition-colors` is generally fine to keep; `ConsoleKey`'s
   `hover:scale-[1.02]` is arguable. The block already argues for a blunt clamp —
   check whether that argument holds.

**The JS half is already done** (A1) — `Nav.tsx`'s two `scrollTo` calls are
guarded. Do not redo it. The block's own note saying nothing guards them is now
**stale and should be corrected** to point at `scrollToTop()`.

---

## C3 — the rank-row decision brief (ANALYSIS ONLY, NO CODE)

`reports.tsx` renders one `Btn` per suspect, not a top-N: **37 / 25 / 9 / 32 /
51** buttons across the five fixtures, so `goto T0` is the 52nd control in that
wrap row on `mumbai-null`.

### Already measured — do not re-derive

- The evidence pane lives in the **right** dock, envelope **300 / 430 / 760**.
  (§9.4.2 says "214 default, 430 reopened" — **214 is the *left* dock** and is
  wrong for this pane.)
- Two-digit rank button: **33.2 px**. `goto T0`: **71.2 px**.
- 7 per row on 8 rows at 300; 10 per row on 6 rows at 430; 19 per row on 3 rows
  at 760. `goto T0` shares the last rank row at every width.
- The pane body is `overflow-y-auto`, so a tall block scrolls rather than clips.
- Identity labels were tried and **rejected by the director** (66–84 px each →
  3 per row on 17 rows, 455 px tall, pushing `goto T0` off the last row).

### Deliverable

Three costed options, each with its consequence — not a recommendation dressed as
options. Worth costing: a top-N that always includes the current selection (what
happens when the operator wants #37?); a scrollable fixed-height row (what does
that cost on a surface whose dock already scrolls?); moving `goto` out of the
wrap row so its position is stable (cheapest, does not address the row).
Then state which you would take, as your view rather than as the answer.

**Note the standing objection:** the row *is* the candidate list, and truncating
it hides evidence — on this project that is a real cost, cf. §7's note that the
hindcast was removed with its cost stated.

---

# PART 4 — DECISIONS ONLY THE DIRECTOR CAN MAKE

These four are blocked on a judgement, not on effort. **Put them as questions
with consequences; do not pick a default.**

## 4.1 `kutch-dark` is structurally broken and the three symptoms share one cause

Session 4's corridor rework moved corridor 3 to a lane that clears land but
passes **2.27 km from the release**, against a lateral scatter of **σ = 1.75 km**
— so the lane sits **1.3 σ** away, i.e. *inside* the traffic. Consequences, all
measured:

- `meta.summary`'s "no AIS report anywhere near" was false — nearest report
  **248 m**, nearest track **70 m**; 8 reports inside 500 m from 5 vessels, 33
  inside 1 km, 135 inside 2 km. **A2 replaced the sentence** with the true
  identity claim, but the *data* is unchanged.
- **`expectedTop1` is false under the `max` variant** — a toggle the interface
  exposes. `suspects[0]` is a 32 m tug (0.6572) with `dark-01` at **rank 3**
  (0.6390), separability **0.0058 < 0.015**, so the run reports insufficient
  evidence. Verified independently.
- **A3: this is the only scenario whose drift particles beach** (0.8% at h48).

**The question:** move corridor 3 further off the release, accepting that the
scene gets easier? Or leave it and accept that `kutch-dark` fails its own
`expectedTop1` under one of two variants? Moving it needs a land check against
the basemap raster — the method is in PART 5 and the coordinator can run it.

## 4.2 `gom-platform`'s stated test is now vacuous

`gate.considered` **180**, `gate.admitted` **0**. `run.suspects` is **2 rows,
both infrastructure**. Its `tests` string says "Infrastructure has to outrank
vessels without a special case" — there is no vessel in the ranking to outrank.

**Session 4's corridor fix caused this**: pushing traffic to 13.2 km to clear the
5 km claim emptied the gate. The scenario now proves nothing.

**The question:** restore a lane inside the origin field (needs a land check, and
risks re-breaking the "no vessel within 5 km" claim), or rewrite the test to
describe what the scenario now actually demonstrates?

## 4.3 `gom-berthed` can no longer show S_drift is load-bearing

`rankWithoutDrift = 1` — the truth is still first with the drift term removed
entirely. Structural: `ongoing: true` puts the slick head on the berth, so
proximity is **1.0000 by construction**. Making it genuinely adversarial means
`ongoing: false` so the slick drifts clear — a data change affecting slick
geometry, release, age refinement and copy.

## 4.4 `sParity` penalises the true vessel for having a long voyage

On `gom-moving` the vessel that laid the trail is **1° off the slick axis** and
scores **rank 49 of 51** — all 48 other admitted vessels beat it — because
`reachKm = max(6, lengthKm × 1.5)` admits **76 km** of transit against a 19 km
slick. A2 corrected the copy to describe this honestly rather than hide it, but
the scorer itself is untouched. Changing a term re-scores all five scenarios.

---

# PART 5 — REUSABLE METHODS

## 5.1 Land/water classification without coastline geometry

The project carries none (raster basemap; vector tiles need a key it
deliberately lacks). Fetch `Ocean/World_Ocean_Base` at **z=10**, read the pixel,
classify on **`blue − red`**. **Calibrated this session:** open Gulf `[-89.40,
28.20]` → **+64 water**; New Orleans `[-90.07, 29.95]` → **−20 land**. Threshold
**+12**. Corridor endpoints measured +33 to +36 (water).

Do it in the browser (canvas `getImageData`; Esri sends CORS headers) — Node has
no PNG decoder here. Serve sample points from `frontDemo/public/` and fetch them
same-origin; **delete the file afterwards**, `public/` is tracked.

## 5.2 Running the real simulator from a probe

```
node <script>.mjs          # with createJiti from node_modules/jiti/lib/jiti.mjs
```
Import `buildRun` from `src/sim/scenarios.ts` and read the `Run`. Put probes in
the scratchpad, never in `src/`. `frames[i].particles` is a **flat
`[lon,lat,…]` array**, 1920 points per frame, 77 frames spanning −28…+48 h.

## 5.3 Forcing reduced motion

Stub `window.matchMedia` for the `prefers-reduced-motion` query, then change
surface by **hash** — the shells are lazy and remount per surface and a hash
change does not reload, so the stub survives. **A JS stub cannot make a CSS media
query match**, which is exactly why it discriminates: a stubbed run proves the
*JS* guard did the work. For the CSS half use the injected stylesheet (C2).

## 5.4 Traps that cost real time

- **`getComputedStyle` is unreliable here for reading a React-driven state
  change** — it returned byte-identical values for both states of `goto T0`
  while `aria-pressed` was correct. **Read the `style` attribute**, which is what
  React writes.
- **A `scrollWidth` probe cannot see horizontal clipping** — `body` is
  `overflow-x: clip`. Compare an element's right edge against `clientWidth`.
- **Padding is not a floor** — the masthead overflows its own `pr-6` before it
  overflows the viewport, so "stops fitting" (284.3 px) and "loses ink"
  (260.3 px) are different widths.
- **React's cross-component render-phase warning is deduped by component name**
  and prints **once per session** — easy to scroll past.
- **A case-sensitive grep against `innerText` will lie to you** — several
  headings are uppercased in CSS.

---

# PART 6 — WHAT IS STILL NOT VERIFIED

Read before trusting PART 1.

- **`index.css`'s reduced-motion block has never executed.** That is C2.
- **`useDock.ts`'s render-phase `setActiveRaw`** produced no warning across the
  click-script, but StrictMode's double-invocation path was not separately
  exercised.
- **C1's basemap swap may emit a spurious "tiles unreachable" notice** if
  aborting in-flight tile requests surfaces as an `error` whose message contains
  "tile". Test: swap basemaps rapidly 4–5 times and watch for the notice. Fix if
  seen: also exclude `/abort/i`, or gate on a swap-generation counter.
- **C1's `basemapTint` swatch does nothing under `basemap: "none"`** — the six
  numeric controls get an inert note, the colour field does not.
- **A3 sampled 120 of 1920 particles per frame.** A full sweep would tighten the
  0.8 % figure; it will not change the conclusion.
- **Three `provenance` strings rest on Zhao et al. 2025** and cannot be checked
  without the paper. The simulation is internally consistent with all three,
  which is a weaker statement than true.
- **`expectedTop1` has no consumer** — grep finds it only in `scenarios.ts` and
  `types.ts`. The most falsifiable string in the file is never rendered, so
  nothing in the running app can catch it drifting.
- **On `mumbai-null` a refusing run still auto-selects a ship.**
  `spill.ts:151` sets `selectedId = built.suspects[0]?.id` unconditionally and
  `plates.tsx:597` draws its track. No name is printed, so "name nobody"
  survives — but it is worth a look.
- **`insufficientEvidence.area90Km2` reports the wrong frame.**
  `scoring.ts:318` uses `drift.convergence[0]`, and `convergence` is sorted
  **ascending by hour**, so index 0 is the most-backward (widest) frame. On
  `mumbai-null` it prints **129.60 km²** where the convergence figure is
  **15.25 km²**. Rendered in `panes.tsx:319` and `LogStream.tsx:107`. **Exact
  fix:** use `drift.convergence.reduce((m, c) => Math.min(m, c.area90Km2),
  Infinity)` in both the wind branch (~318) and the empty-rows branch (~324) —
  the form the separability branch (~331) already uses correctly.
- **`behaviour` is identically 0 for every candidate on `gom-moving`.**
  `movingDischarge` plants a 1.6 kn reduction; `rollingMin` needs
  `minRun < mean × 0.72` (≈5.72 kn) and the discharge speed is 6.4 kn, so the
  corroborating signal the generator deliberately plants is never detected.
- **The build's chunk-size warning is pre-existing** (`MapCanvas` ~1.2 MB) and
  was never investigated.

---

# PART 7 — FIRST FIVE MINUTES OF THE NEXT SESSION

1. `cd frontDemo && npx tsc --noEmit` → expect clean.
2. Decide whether to **commit** the working tree. 12 source files + `ISSUES.md`
   are uncommitted and now span four sessions of work. This is the single
   largest risk in the repo right now.
3. Read PART 2 and set up `.tmp/briefs`, `.tmp/reports`, `.tmp/state`.
4. Put PART 4's four questions to the director **before** dispatching, since
   4.1 and 4.2 may change what B2/C2 are worth doing.
5. Dispatch B (B2+B3, hunk lists required) and C (C2+C3, safe to pair).
   `BRIEF-B2.md` is already written.
