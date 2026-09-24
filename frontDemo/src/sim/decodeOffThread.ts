/**
 * Decode an uploaded GeoTIFF in a worker, so the page keeps painting while it
 * runs (`geotiff.worker.ts` says why that matters).
 *
 * A worker that cannot start, or that dies, is not a verdict on the file: the
 * same decode then runs on the main thread, exactly as it did before, and only
 * the live clock is lost.
 */

import { decodeGeoTiff, type GeoTiffOutcome } from "./geotiff";

export function decodeGeoTiffOffThread(file: File): Promise<GeoTiffOutcome> {
  if (typeof Worker === "undefined") return decodeGeoTiff(file);
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./geotiff.worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(decodeGeoTiff(file));
      return;
    }
    worker.onmessage = (event: MessageEvent<GeoTiffOutcome>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      console.warn(`GeoTIFF worker failed (${event.message || "no message"}); decoding on the main thread.`);
      resolve(decodeGeoTiff(file));
    };
    worker.postMessage(file);
  });
}
