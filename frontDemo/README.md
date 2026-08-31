# frontDemo — four products, one scientific engine

Four **independent interface concepts** over the same SAR + AIS oil-spill
attribution system. **Design exploration feeding PHASE-07, not PHASE-07 itself.**

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

## What changed, and why

The previous version was **one website with five themes**. It had a theme
abstraction whose `ui` object carried panel type, density, console arrangement,
button shape and radius, and every component branched on it. The conceptual
differences between the directions were much stronger than the visual ones,
because five directions were being funnelled through one `Panel`, one
`PageHeader`, one `Stat`, one `TopNav` and one twelve-column page.

It is now **four separate products sharing a scientific engine**:

```
shared data + shared scientific logic + independent presentation systems
```

not

```
shared page + theme variables
```

`src/designs/signal/` imports nothing from `src/designs/terminal/`. There is no
`designs/shared/`, deliberately — the moment one exists the four start
converging on it again. A `SignalEvidenceBlock`, a `TerminalPane`, an
`OrbitInstrument` and a `DossierExhibit` are conceptually different objects and
are written as such.

The four are lazy-loaded (`src/designs/registry.ts`). That is an isolation
decision before it is a performance one: a build error in one direction must not
take the other three down, and an error boundary per direction means a reader
can always switch away from a broken one.

---

## The four directions

Switch between them from the neutral control on the right edge. The choice
persists in `localStorage`. **The control is not part of any of the four** — it
uses none of their tokens and says on its face that it is a demo control,
because a shared navigation element is exactly how four products become one.

| # | Name | Product | Composition | Navigation | Map is |
|---|---|---|---|---|---|
| 01 | **Signal** | Investigative publication | Long-form editorial scroll, three-column spread with a fixed reading measure and real marginalia | Publication masthead, six sections of an issue | An evidence exhibit — one fixed plate with a caption |
| 02 | **Terminal** | Operations workstation | Fixed-viewport workstation, no page scroll | Numbered command rail | The primary workspace, UI arranged around it |
| 03 | **Orbit** | Mission control | Floating instrument rails over a full-bleed map | Mission status bar + mode rails | The product; everything orbits it |
| 04 | **Dossier** | Evidence archive | Document spreads, numbered exhibits, ruled sections | Roman-numeral case index | A forensic exhibit — a printed chart |

### Colour is the last layer

The four are meant to be distinguishable **in grayscale**. Composition,
navigation, density, typography and the relationship between text and map do the
work; the palette is applied afterwards.

**Dossier is the only light direction**, and not for variety's sake: a case file
is paper, and every convention it borrows — exhibit stamps, ruled margins,
marginal notes, redaction, footnotes — is a convention of ink on a light ground.
Its map uses Esri's light grey canvas so it reads as a printed chart. The other
three are dark, because the primary surface of this application is a map and a
light map loses the low-opacity credible-region contours entirely.

Each direction takes a different world underneath its data, and one of them
tints it. Esri's rasters are neutral grey and `raster-saturation` cannot put
colour into a source that has none, so `MapPaint.basemapTint` lays a translucent
background layer between the raster and the data instead. Terminal is the only
direction that uses it: a console wants the coastline present but subordinate
and in its own ink, not a grey map borrowed from somewhere brighter.

### Typography

Signal and Dossier deliberately **invert the same two families**. A grotesk
headline over a serif reading column is a magazine; a serif headline over a sans
body is a document. Same ink, opposite institutions.

| | Display | Body | Values |
|---|---|---|---|
| Signal | Archivo | Newsreader | IBM Plex Mono |
| Terminal | IBM Plex Mono | IBM Plex Mono | IBM Plex Mono |
| Orbit | Chakra Petch | Manrope | IBM Plex Mono |
| Dossier | Newsreader | Archivo | IBM Plex Mono |

---

## Architecture

```
src/
  sim/            the simulation. Untouched by the redesign
  map/            MapCanvas, layer definitions, particle overlay
  lib/
    format.ts     vocabulary: term labels, timestamps, ageStatement()
    playback.ts   the event, hour by hour: phase, extent, contacts
    project.ts    SVG projection arithmetic for figures
    motion.ts     anime.js scope + scroll reveal
    hash.ts       hash routing; each design defines its own sections
  useRun.ts       scenario state, shared across every design
  content.ts      the project's FACTS. Not its copy
  design.ts       the four directions: map paint, fonts, accents
  designs/
    signal/  terminal/  orbit/  dossier/
```

**What is shared is science or arithmetic.** `content.ts` holds the pipeline
stages, the six scoring terms, the prior-art comparison and the limits — those
are the project's positions. It deliberately does **not** hold headlines, ledges
or section names: a publication opening an investigation, a workstation
reporting its state, an instrument coming online and a case file being unsealed
are not the same sentence in four typefaces.

### The event playback

`src/lib/playback.ts` is the derivation all four share for showing the spill as
something that **happened** rather than a finished shape. `momentAt(run, hour)`
returns the phase, how much oil is in the water, the surface extent, and which
vessels were within 12 km at that instant — from the first parcel entering the
water through to the forecast horizon. Each direction renders it in its own
grammar: Signal as small multiples across a spread, Terminal as an operational
timeline with a log stream, Orbit as the mission's central animation, Dossier as
a chronological register.

The proximity list is explicitly **not a ranking**. It is who was in the
neighbourhood, which is a far weaker claim than a candidate, and all four say so.

---

## Scientific integrity

These are correctness requirements from `PLAN/CONSTRAINTS.md`, not disclaimer
text, and they survive in all four directions:

- **Age is never a bare scalar.** `ageStatement()` in `lib/format.ts` handles the
  case the old UI got wrong: for an ongoing discharge the interval collapses to
  `0–0 h`, and printing that as a measurement is false precision in the opposite
  direction. It states "ongoing" instead, with the method beside it.
- **Damping is a relative dB index, never a thickness.** There is no field for
  microns or for spilled volume anywhere in the interface.
- **`insufficient_evidence` is prominent, never an empty list.** The
  `mumbai-null` scenario triggers it.
- **Every score decomposes** into six named terms with weights and the geometry
  that produced them. No bare totals.
- **Backward drift is an ensemble** producing credible regions. Nothing implies
  it recovers a precise point.
- **Wind gate is a continuous multiplier**, surfaced, never a silent filter.
- **Dark vessels are ranked but never named.** All identities are masked
  (`MMSI 636•••••4`).
- **Simulated data stays visibly simulated**, integrated per direction: a source
  note in Signal, a status flag in Terminal, telemetry metadata in Orbit, an
  evidence classification in Dossier.
- Language is **candidate, suspected, score** — never responsible or confirmed.

---

## Stack

- **Vite + React 19 + TypeScript**, `strict`, `noUnusedLocals`
- **Tailwind v4** via `@tailwindcss/vite`. Tokens are CSS custom properties in
  `src/index.css`, re-pointed under `[data-design="..."]`
- **anime.js v4.5** — named exports (`animate`, `createTimeline`, `stagger`,
  `svg.createDrawable`, `text.split`, `onScroll`, `createScope`, `utils`). Any v3
  snippet found online will not work here
- **MapLibre GL JS**, no API key. Esri basemaps, no token
- Fonts self-hosted through `@fontsource`, never a `<link>` to Google Fonts

### Three bugs worth not reintroducing

**Drawing the oil and the hindcast at the same weight.** They are the same kind
of mark and they mean opposite things. The backward ensemble is at its widest at
the far end of the backward horizon — reversal spreads, it does not focus —
which is exactly the hour when least oil is in the water. Painted at equal
weight, the playback claims the spill was larger before it began than at the
moment it was photographed. `ParticleOverlay` keeps the oil bright and the
hindcast a faint haze behind it while the two are on screen together, and gives
the haze its full weight only when there is no oil cloud to be confused with.


**`body { overflow-x: hidden }`.** CSS will not give you `overflow-x: hidden`
with `overflow-y: visible` — the used value of the other axis becomes `auto`,
which makes the body the scroll container. The viewport then never scrolls, so
`window` scroll events never fire, so anime's `onScroll()` observer never
triggers, so every element primed to `opacity: 0` stays there and the page below
the fold renders as a black rectangle with nothing in the console. Use
`overflow-x: clip`.

**`onScroll({ enter: ... })` threshold order.** It reads
`"<target edge> <container edge>"`. `"bottom-=80 top"` asks for the moment the
target's bottom reaches the viewport's top — that is the element *leaving*
upward. `"top bottom-=80"` is the one that means "arriving". `revealFallback()`
in `lib/motion.ts` is the backstop: priming an element to invisible is a bet that
something will set it back, and that bet losing must not produce a blank page.

---

## Known issues

| Issue | Detail |
|---|---|
| Age interval is degenerate for ongoing releases | The simulation returns `[0, 0, 0]` for four of the five scenarios. `ageStatement()` presents this honestly, but the underlying `source_coincidence` estimator is worth revisiting in PHASE-04 |
| Requires network for the basemap | True of all four now — Terminal used to draw no world at all. Everything else is generated locally; the map reports a tile failure in the corner and the graticule, scene, slick, origin field and traffic all still draw (C12) |
| Not wired to the API | All content comes from `src/sim/`. PHASE-07 is where that becomes a transport change |
