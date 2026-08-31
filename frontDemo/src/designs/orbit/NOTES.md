# ORBIT — requests against shared files

Nothing in here has been changed. Each item is something Orbit worked around
locally, recorded so whoever owns the shared layer can decide whether the
workaround should become an interface.

---

## 1. `MapCanvas` exposes no camera — RESOLVED

**Wanted:** a way for a direction to move the camera — either a `camera?: { centre, zoom, bearing }`
prop that the component eases to, or an `onMap?: (map) => void` escape hatch.

**Why:** Orbit is a mission-control surface whose whole premise is that the chart is
the product. Framing the chart on the origin field when the mode changes to
`reconstruct`, or on the selected candidate's matched leg in `attribute`, is the
single most valuable thing this direction could do and cannot.

**Resolved.** `MapCanvas` now takes a `camera?: { centre, zoom, durationMs }`
prop and eases to it, honouring `prefers-reduced-motion` by jumping instead.
`modes.ts` gained a `zoomOffset` per mode and `graticule` went back to being a
legibility choice; `FrameControl`'s RE-FRAME is a real recentre rather than a
graticule advance that recentres as a side effect. The original workaround, for
the record:

**Was worked around by:** `MapCanvas` re-running its scenario effect on
`paint.graticuleStepDeg`, and that effect begins with
`map.jumpTo({ center: run.meta.centre, zoom: run.meta.zoom })`. So every mission
mode declares a *distinct* graticule density (`modes.ts`), and the mode change
therefore re-frames on the scenario datum. The frame control in `MissionMap.tsx`
exposes the same lever directly and its RE-FRAME button advances to the next
detent so that it always actually does something.

This is honest — the graticule really does change, and the label says the control
re-frames — but it is a side effect standing in for an API. If the camera prop
lands, `modes.ts` should stop assigning graticule densities for routing reasons
and pick them for legibility instead.

`window.__map` was deliberately **not** used. It is a debug handle set by the
shared component, not an interface, and a direction reaching through it would
make the map's ownership a fiction.

---

## 2. `controls="none"` also drops the scale bar — NOT A DEFECT

Orbit uses `controls="scale"`, not `"none"` as the direction brief specified.

`"none"` suppresses both the `NavigationControl` and the `ScaleControl`. The
NavigationControl is genuinely unwanted here — `index.css` already hides
`.maplibregl-ctrl-top-right` for `[data-design="orbit"]` — but the ScaleControl is
not chrome. It is measured from the live camera, it cannot be reproduced from
outside the map component (see item 1), and every judgement a viewer makes about
how far a track passed from a slick depends on it. A bathymetric chart with no
distance scale is not a chart.

**No change needed.** `"scale"` already means exactly this: the implementation
mounts `NavigationControl` only for `"full"` and `ScaleControl` for anything
other than `"none"`. So `controls="scale"` drops the zoom buttons and keeps the
measurement, which is what this direction wanted. The prop is documented in
`MapCanvas` now so the next reader does not have to infer it.

---

## 3. No `caution` / `alarm` colour tokens outside Terminal

`index.css` defines `--warn` and `--alarm` only under `[data-design="terminal"]`.
Orbit needs a caution ink (an instrument in a degraded state) and an alarm ink
(`insufficient_evidence`, the state C3 requires to be prominent), and hard-coding
a hex was not acceptable.

**Worked around by:** `useTone()` in `instruments.tsx` takes them from the
direction's own `MapPaint` — `def.map.infrastructure` for caution,
`def.map.dark` for alarm. This turned out better than a new token would have
been: a gold ring on the chart and a gold lamp on the fascia are now literally
the same value, so the panel and the map agree. Recording it anyway because it is
an unobvious dependency — changing `MapPaint.dark` now also changes what a
mission hold looks like.

---

## 4. Pseudo-element and keyframe rules cannot go in a style attribute

Orbit needs: scrollbar suppression on the rails, the mobile strip and the brief
(`::-webkit-scrollbar`), scroll snapping on the strip's children (`> *`), and the
hold-lamp keyframes.

**Worked around by:** a `<style>` element mounted by `OrbitShell` (`ScopedStyle`),
with every selector prefixed `orbit-` so it cannot reach another direction. If a
shared home for per-direction CSS appears, these five rules belong there.

Note that reduced-motion is already handled — `index.css` clamps every
`animation-duration` globally — so `.orbit-pulse` degrades without extra work.

---

## 5. `MapCanvas` hands out no projection

Anything Orbit draws over the chart therefore cannot be geographic. The frame
chrome in `MissionMap.tsx` (registration marks, boresight, acquisition sweep) is
deliberately *frame* furniture only, and the boresight is labelled as the centre
of the frame rather than as a position, because a range ring or a bearing drawn
without the map's own projection would be decoration wearing a scientific
costume. On a page that accuses vessels of pollution that is not an acceptable
trade.

The scientific overlays that *do* need geometry are drawn in their own SVG with
`lib/project` instead, at instrument scale — see INS-11, the field scope.

**Wanted (low priority):** `onProjection?: (project: (p: LngLat) => [number, number]) => void`,
fired on move. Would let a direction annotate the chart in its own hand.
