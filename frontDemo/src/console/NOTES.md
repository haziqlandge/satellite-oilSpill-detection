# Console — notes and outstanding requests

This file used to record what Terminal *would* have changed in shared code if it
owned it, plus the workaround it was using instead. The design study is over and
the console is no longer a guest in this tree, so most of those entries have been
resolved outright. What is left is one small typing wish and two notes.

---

## Resolved

**`MapCanvas` now hands over the instance.** The console draws its own map
furniture — crosshair with a live lon/lat readout, corner coordinates, zoom
buttons, zoom readout, scale bar — and all of it needs `unproject`,
`getBounds`, `getZoom`, `zoomIn`, `zoomOut` and `jumpTo` on the live MapLibre
instance. It used to pick that up from the `window.__map` debug handle, polled
until it appeared.

That workaround assumed exactly one map was mounted and had no teardown signal.
It was survivable while the console had a single fixed map; it stopped being
survivable the moment a panel could be torn off into a floating window that
mounts its own. `Workspace` now takes the instance through `MapCanvas`'s
`onMap?: (map: MapLibreMap | null) => void`, still behind a structural interface
declaring only the six methods it uses, and every readout it drives still
degrades to `--` rather than throwing.

**`labels` is a real control again.** It was dead under `basemap: "none"`, so the
rail did not offer it. The console draws the dark grey canvas now, so the labels
raster exists and `place labels` is a switch in CONTROL ATTRIBUTES like any
other.

**The graticule has its own ink.** `MapPaint.graticule` exists rather than the
layer borrowing `paint.traffic`, which had the console's only geography drawn in
the dimmest colour in the palette.

---

## 1. ~~`src/sim/types.ts` — `ScenarioMeta.id` is `string`~~ — resolved

`scenarioListing()` takes a `ScenarioId`, but `run.meta.id` was typed `string`,
so anything holding a run and wanting its listing had to cast.

**Done.** `ScenarioId` now lives in `sim/types.ts`. It could not be imported the
other way -- `scenarios.ts` already imports `types.ts`, so pulling the type
upward would have been a cycle -- and `scenarios.ts` re-exports it, which is
why no import site changed. Both casts are gone: the one here, and a redundant
one in `site/SpillSelect.tsx` on a value that was already `ScenarioId`.

---

## 2. A note on data scale

`gom-berthed` carries 258 vessels and routinely puts ~70 of them inside the 12 km
contact radius, while `Moment.inContact` is normally 0. Both are correct: a
vessel that discharged and kept steaming is clear of its own slick within the
hour. The traffic pane caps its table at 14 rows, prints the remainder as a
count, and says in copy that a zero inside the extent is the ordinary case, so
neither number reads as a bug.

---

## 3. A note on the dock

Two invariants the rest of the console leans on, both easy to break by accident:

- **A panel is in exactly one place.** `closed` is a placement rather than an
  absence, which is what lets reopening restore where the panel was.
- **The resting dock width is rendered, not written by an effect.** It used to be
  a custom property set from a `useEffect`; closing every panel unmounts the
  rail, and reopening mounts a fresh element whose deps have not changed, so the
  effect never re-ran and the panel took the whole viewport. Only the drag writes
  to the DOM now, and React owns the value either side of it.
