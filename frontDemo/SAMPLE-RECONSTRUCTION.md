# Sample reconstruction and hindcast changes — 2026-09-10

## Source of truth

The existing `public/data_sample/sample1.jpg` through `sample3.jpg` pair with
`clean1.jpg` through `clean3.jpg`. `scripts/extract-sample-geometry.py` traces the
largest dark component of each cleaned image into `src/sim/sampleGeometry.json`.
`src/sim/samples.ts` scales those outlines isotropically and builds complete Runs
through the existing ensemble, traffic, attribution and evidence pipeline.

Sample 1 is in the open Gulf of Mexico (25.6 N, 90.1 W), sample 2 in the Arabian
Sea (17.8 N, 67.8 E), and sample 3 in the South China Sea (12.6 N, 114.7 E).
Each has different traffic corridors, vessel counts, source behavior and forcing.
Coordinates, physical scale, AIS and timings are simulated, as disclosed in the
console. These images have no georeferencing. Do not present these as measured
real-world locations or as results of a trained model.

## Upload lifecycle

`SampleImagePanel.tsx` owns a module-level external store and processing timer.
Unmounting a dock panel must not clear the upload or cancel processing. A new
valid upload replaces the image; changing the selected scene does not. Invalid
uploads leave the existing job intact. Clipboard images without the sample
filename are matched against small pixel fingerprints of the supplied images.

The four processing stages each last five seconds. At upload acceptance the map
has no spill, release, particles, AIS, candidates, targets or historical areas.
At ten seconds the side panel displays the cleaned red boundary. Detection is
released to the map only after that image has loaded and painted. At twenty
seconds the other layers fade in and the timeline autoplays from T−36. Completed
samples unlock individually in the top picker. The runs are prepared privately;
they must not appear as selectable samples before their own upload completes.

Explicit scenario selection takes precedence over an older processing job.
There is no upload-panel effect that continuously reselects its sample. The
model timing panel reads the currently selected case; its simulated compute
durations are separate from the twenty-second presentation sequence.

## Shared hindcast geometry

`lib/reconstruction.ts` applies stable, case-specific origin displacement and
growth profiles to negative-hour particles and contours. Origins are 9–13 km
from T0 and initial areas are about 19–27% of T0. Four cases have a recession;
the other four grow steadily, with different growth rates. The cases retain
their existing hindcast horizons; the uploaded cases each span −36 to +72 h.
T0 and positive-hour forecast frame objects are passed through unchanged.

The console, site maps, drift scope, evidence field, timeline area and site
growth chart consume the same transformed frames. The evidence arrow follows
chronological direction. Original attribution grids, age estimation and refusal
tests remain the underlying simulation outputs and are explicitly described as
such in the drift panel. Do not rescale the forecast to make the hindcast smaller.

## Verification

`npm run build` runs TypeScript and the production Vite build.

Bundle `scripts/check-reconstruction.ts` with esbuild for Node and run it. It
checks all eight cases for finite particles, distinct sample tracks, complete
six-term evidence, full weather horizons, origin separation, variable recession,
matching graph/timeline areas, unique checkpoints and unchanged forecast frames.
It exports `/private/tmp/oilspill-frame-contours.json` for the coastal check.

Run `node scripts/check-ocean.mjs /path/to/ne_10m_land.geojson` with Natural Earth
1:10m land polygons from the Natural Earth vector repository. The check compares
every hourly contour and the rectangle enclosing every particle, including
polygon containment and boundary crossings. The current eight integral runs
pass: 738 hourly frames, 1,476 footprints, zero land intersections. This is
coastline-dataset validation, not a navigational guarantee for unresolved reefs.

The localhost console was also exercised through the browser file chooser for
all three images, with screenshots of the map, cleaned mask and timing panel,
and checks of scenario selection, image retention, traffic and evidence panels.

The live console was subsequently checked for the blank upload stage, completed
mask and animation, hindcast visibility switch, image retention after changing
panels, and the generic "Drop images here" upload instruction. The production
build passes after those changes.
