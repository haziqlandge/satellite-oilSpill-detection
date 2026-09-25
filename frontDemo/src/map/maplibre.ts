/**
 * MapLibre, with its worker handed over explicitly. Import it from here.
 *
 * MapLibre 6 is ESM and finds its worker at run time, next to its own module
 * (`new URL("./maplibre-gl-worker.mjs", import.meta.url)`). Vite moves that
 * module -- pre-bundled into `.vite/deps` in development, hashed into
 * `assets/` in a build -- and the worker is not beside it in either, so every
 * map failed with "Worker failed to load". `?worker&url` makes Vite bundle the
 * worker (and the chunk it shares with the main thread) and gives its URL,
 * which `setWorkerUrl` hands to MapLibre before any map exists.
 */

import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

maplibregl.setWorkerUrl(workerUrl);

export default maplibregl;
