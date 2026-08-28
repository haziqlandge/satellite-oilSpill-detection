# frontDemo - landing page layout study

Five switchable landing-page directions for the oil spill attribution system. **Design
exploration feeding PHASE-07, not PHASE-07 itself.** Nothing here is wired to the backend;
all content is static and lives in `src/content.ts`.

> **Ownership:** this folder belongs to the session on the original laptop. The session on
> the training machine owns `backend/` and `ml/` and should not edit it.

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

## The five directions

Switch between them from the rail on the right edge. The choice persists in `localStorage`.

| # | Name | Accent | Language |
|---|---|---|---|
| 1 | **Signal** | sodium orange `#ff8a3d` | Halftone print, asymmetric editorial, 0px corners, Space Grotesk |
| 2 | **Terminal** | phosphor green `#5df2a0` | CRT console, monospace throughout, scanlines, a boot transcript as the hero |
| 3 | **Orbit** | ice cyan `#43d9e8` | Mission control, radar scope, rounded panels, Chakra Petch |
| 4 | **Dossier** | signal red `#e5484d` | Forensic case file, hairline rules, a redaction bar that retracts to reveal the headline |
| 5 | **Deepwater** | iridescent magenta `#ff4fa3` | Atmospheric, very large light type, oil-on-water sheen, scroll-scrubbed parallax |

Each direction locks one accent across every section. Dark-locked by design - the brief
asked for dark with a few bright colours, so there is no light mode.

## The switcher

The interaction that was specifically requested:

- Sticky to the right edge, vertically centred
- **Tucks itself away** after ~2.6 s idle: compresses on the x axis toward the right edge
  (`scaleX(0.72)`) leaving a ~33 px grab tab
- **Any click anywhere on the page brings it back**, as does hovering the tab
- `Escape` tucks it deliberately

Implemented in `src/components/LayoutSwitcher.tsx`. The tuck is a **CSS transition, not an
anime.js tween** - it is a two-state toggle a user can interrupt at any moment, and CSS
retargets from the current computed value for free. Driving it with a JS tween left the
transform stranded part-way whenever the state flipped mid-flight.

Measured behaviour: 33 px tucked, opens within 200 ms of a click, holds 2.6 s, re-tucks.

## Stack

- **Vite + React 19 + TypeScript**
- **Tailwind v4** via `@tailwindcss/vite`. Design tokens are CSS custom properties in
  `src/index.css`; each layout re-points the same token names under `[data-layout="..."]`,
  so no component hard-codes a colour
- **anime.js v4.5** (`animate`, `createTimeline`, `stagger`, `svg.createDrawable`,
  `text.split`, `onScroll`, `createScope`)
- **@phosphor-icons/react** for icons
- Fonts self-hosted through `@fontsource`, never a `<link>` to Google Fonts

### anime.js v4, not v3

The API changed completely between v3 and v4. This project uses **named exports**
(`import { animate } from "animejs"`), not the v3 default `anime({ targets })`. Any v3
snippet found online will not work here.

Scroll animation uses anime's **`onScroll()` observer**, never a
`window.addEventListener("scroll")` handler - a scroll listener fires every frame and janks.
Note the option is **`repeat: false`**, not `once: true`; `once` is silently ignored.

Every layout wraps its animations in `createScope({ root })` so switching layouts reverts
the previous one's animations instead of leaking timers.

## Known issues

| Issue | Detail |
|---|---|
| **Focus does not untuck the rail** | Tabbing to a switcher button while tucked leaves it hidden, so a keyboard user aims at an off-screen target. `onFocusCapture` on the wrapper does not fire. Fix is to bind `onFocus={wake}` on the buttons themselves; the edit was drafted and not applied |
| Images are placeholders | `src/content.ts` points at `picsum.photos` seeds, duotoned and halftoned. **These are ordinary photographs, not radar.** Swap for real Sentinel-1 VV tiles before showing this to anyone who might mistake them for data |
| Requires network | The placeholder images are remote, so the demo will not render imagery offline |

## What is deliberate

- **No real vessel names.** The published cases name real ships. Putting a real vessel's
  name next to the word "polluter" on a marketing page is not something a layout study
  should do, so identities are masked (`MMSI 636•••••4`)
- **Every figure is sourced or marked illustrative.** The detection numbers come from
  Zhao et al. 2025; the candidate scores are labelled as examples. No invented precision
- **Dark vessels are ranked but never named**, matching the ethics constraints in
  `PLAN/CONSTRAINTS.md`

## Next steps

1. Pick a direction, or a hybrid
2. Fix the focus bug above
3. Replace placeholder imagery with real SAR tiles
4. Only then consider wiring it to the API in PHASE-07 - at which point the real work is
   the map, the time slider and the evidence card, none of which exist here yet
