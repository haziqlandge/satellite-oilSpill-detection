# Rollback point — map animation, 2026-08-31

Copies of every file that the map/particle animation work touched, taken
**before** any of it was applied. Paths mirror `frontDemo/src/`, so restoring is
a straight copy back over the tree.

## Restore everything

From `frontDemo/`:

```bash
cp -r .backup/2026-08-31-animation/src/. src/
```

## Restore one file

```bash
cp .backup/2026-08-31-animation/src/map/ParticleOverlay.ts src/map/ParticleOverlay.ts
```

`src/design.ts` and `src/map/basemap.ts` must be restored **together** — the new
`basemapTint` / `basemapTintOpacity` fields are declared in the first and read by
the second, so restoring one alone will not typecheck.

## What is in here, and what changed after it was taken

| File | Change made after this snapshot |
|---|---|
| `src/map/ParticleOverlay.ts` | Rewritten. The release cloud (the oil) is now the bright layer and accumulates from a single seed parcel; the hindcast ensemble is a faint haze before the pass and keeps full weight after it. Separate visibility for the two clouds, and normal rather than additive compositing on the light ground |
| `src/map/MapCanvas.tsx` | `particles` and `release` drive one cloud each instead of being ORed together; compositing mode derived from the ground colour; repaints the basemap tint |
| `src/map/basemap.ts` | New `basemap-tint` background layer between the world raster and the data layers |
| `src/design.ts` | Terminal gained a basemap (dark grey canvas, washed green) where it had none; Orbit's `map.candidate` went from grey-blue to orange; `MapPaint` gained the two tint fields |
| `src/components/DesignSwitcher.tsx` | No longer wakes on a `pointerdown` anywhere in the document; wakes only from its own rail, and stops swallowing presses aimed at the page underneath |
| `src/lib/playback.ts` | `phaseAt()` had `discharging` and `adrift` inverted |

## Verifying a rollback

```bash
npx tsc --noEmit
```

The animation itself is checked by eye: open Terminal (`localStorage.setItem('slickline:design','terminal')`),
scenario `kutch-dark`, jump to the first hour of the record and play forward. The
question the rollback answers is whether the cloud at `T-28h` is larger than the
slick at `T0`, which is the behaviour this work removed.
