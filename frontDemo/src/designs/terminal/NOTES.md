# Terminal — requests against shared files

Nothing outside `src/designs/terminal/` was edited. These are the changes this
direction would have made if it owned the shared code, with the workaround it is
using instead.

## 1. `src/map/MapCanvas.tsx` — expose the map instance

Terminal runs the map with `controls="none"` and draws its own furniture: a
crosshair with a live lon/lat readout, corner coordinate readouts, zoom buttons,
a zoom-level readout and a scale bar. All of that needs `unproject`,
`getBounds`, `getZoom`, `zoomIn`, `zoomOut` and `jumpTo` on the live MapLibre
instance, and `MapCanvas` does not hand it to its parent.

**Wanted:** an optional `onMap?: (map: MapLibreMap | null) => void` fired on
`load` and on teardown. It is additive and no existing caller changes.

**Workaround:** `Workspace.tsx` picks the instance up from the debug handle
`MapCanvas` publishes at construction (`window.__map`), through a structural
interface declaring only the six methods it uses, behind a `typeof === "function"`
guard, polled until it appears. Every readout it drives degrades to `--` rather
than throwing if the handle is absent or mid-teardown. This is a workaround, not
a design: it silently assumes exactly one map is mounted, which is true today
because `App` mounts one shell at a time.

## 2. `src/map/basemap.ts` — `labels` is meaningless under `basemap: "none"`

`hasLabels(paint)` is already false for Terminal, so the `labels` layer is never
added and `toggles.labels` controls nothing.

**Wanted:** either drop `labels` from `LayerToggles` when the paint has no
basemap, or have `DEFAULT_TOGGLES` derive from the paint.

**Workaround:** Terminal seeds its toggles with `labels: false` and does not
offer the switch, so the rail never shows a control that does nothing.

## 3. `src/sim/types.ts` — `ScenarioMeta.id` is `string`

`scenarioListing()` takes a `ScenarioId`, but `run.meta.id` is typed `string`, so
anything that wants the listing for the run it is holding has to cast.

**Wanted:** `ScenarioMeta.id: ScenarioId`.

**Workaround:** one cast in `LogStream.tsx`.

## 4. Not a request — a note on data scale

`gom-berthed` carries 258 vessels and routinely puts ~70 of them inside the 12 km
contact radius, while `Moment.inContact` is normally 0. Both are correct: a
vessel that discharged and kept steaming is clear of its own slick within the
hour. The traffic pane caps its table at 14 rows, prints the remainder as a
count, and says in copy that a zero inside the extent is the ordinary case, so
neither number reads as a bug.

## 5. `src/map/basemap.ts` — the graticule is painted in the traffic colour

`dataLayers()` gives the `graticule` layer `line-color: paint.traffic`, and
`MapCanvas`'s theme effect repaints it the same way. Terminal's `traffic` is
`#18241e`, one step off the `#050706` ground, and Terminal is the only direction
with `basemap: "none"` — so the graticule is the *only* geography on the display
and it is drawn in the dimmest colour in the palette.

**Wanted:** a `graticule` entry in `MapPaint`, so a direction that has nothing
else under its data can weight it independently of its traffic tracks.

**Workaround:** none needed for correctness — the lines are present and legible
close up, and the corner coordinate readouts, the crosshair readout and the
scale bar in `Workspace.tsx` carry the positional reference regardless. Left as
is rather than reaching into the shared layer from this directory.
