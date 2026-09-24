/**
 * `decodeGeoTiff` off the main thread (`decodeOffThread.ts` starts it).
 *
 * The decode is one long chain of microtasks -- geotiff.js decompressing every
 * strip of every band, then the band statistics and the 8-bit mapping over
 * every pixel -- and no timer on the page fires until it ends. The Model Timing
 * pane's clock is a 100 ms timer, so "Decode raster" sat at a few ms and jumped
 * to its final figure when the decode finished (ISSUES.md F23). Run here, the
 * page keeps ticking.
 *
 * It is the same function the Node checks run, fixed LZW decoder included:
 * `decodeGeoTiff` registers it on this worker's own copy of geotiff.js.
 */

import { decodeGeoTiff } from "./geotiff";

self.onmessage = async (event: MessageEvent<File>) => {
  const outcome = await decodeGeoTiff(event.data);
  // The pixel buffers move rather than copy: 16 MB of RGBA for a 2048 tile.
  const transfer: Transferable[] = [];
  if (outcome.ok) {
    transfer.push(outcome.raster.rgba.buffer as ArrayBuffer);
    if (outcome.raster.valid) transfer.push(outcome.raster.valid.buffer as ArrayBuffer);
  }
  self.postMessage(outcome, { transfer });
};
