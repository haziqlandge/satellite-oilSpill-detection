/**
 * Drift particles, drawn on a canvas above the map.
 *
 * The particle cloud is the one layer that has to move every frame, and it is
 * also the argument the whole system makes: scrub backward and watch a few
 * thousand particles contract onto a berth. Putting it in a GeoJSON source
 * would re-parse and re-tile the whole cloud on every timestep.
 *
 * Instead the positions live in a Float64Array and are projected with the map's
 * own `project()` on each frame. That is a matrix multiply per particle, and at
 * fourteen hundred particles it costs well under a millisecond, so the cloud
 * stays locked to the map through pan, zoom and rotation without ever touching
 * the style.
 *
 * Positions are interpolated between whole-hour frames, which is what makes
 * dragging the time slider read as motion rather than as a slideshow.
 */

import type { Map as MapLibreMap } from "maplibre-gl";

export interface ParticleFrame {
  hour: number;
  particles: Float64Array;
}

export class ParticleOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private map: MapLibreMap;
  private frames: ParticleFrame[] = [];
  private releaseFrames: ParticleFrame[] = [];
  private releaseColour = "#ffffff";
  private hour = 0;
  private colour = "#ffffff";
  private visible = true;
  private raf = 0;
  private dirty = true;
  private disposed = false;

  constructor(map: MapLibreMap, container: HTMLElement) {
    this.map = map;
    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.zIndex = "2";
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    this.resize();
    this.onMove = this.onMove.bind(this);
    this.map.on("move", this.onMove);
    this.map.on("resize", this.onMove);
    this.loop();
  }

  private onMove() {
    this.dirty = true;
  }

  private resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { clientWidth: w, clientHeight: h } = this.map.getContainer();
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (this.ctx) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setFrames(frames: ParticleFrame[]) {
    this.frames = [...frames].sort((a, b) => a.hour - b.hour);
    this.dirty = true;
  }

  /**
   * Parcels of the release itself.
   *
   * Two clouds are shown at different times and they mean opposite things. The
   * release cloud is the oil, played forward from the first hour of the
   * discharge: that is what happened. The hindcast cloud is where the oil could
   * have come from, run backward from the observation: that is what the system
   * infers. Drawing them in different colours, and only one at a time, keeps
   * the two from being read as the same claim.
   */
  setReleaseFrames(frames: ParticleFrame[]) {
    this.releaseFrames = [...frames].sort((a, b) => a.hour - b.hour);
    this.dirty = true;
  }

  setReleaseColour(colour: string) {
    this.releaseColour = colour;
    this.dirty = true;
  }

  setHour(hour: number) {
    this.hour = hour;
    this.dirty = true;
  }

  setColour(colour: string) {
    this.colour = colour;
    this.dirty = true;
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.dirty = true;
  }

  private loop() {
    if (this.disposed) return;
    if (this.dirty) {
      this.draw();
      this.dirty = false;
    }
    this.raf = requestAnimationFrame(() => this.loop());
  }

  /** Positions at the requested hour, interpolated between whole-hour frames. */
  private sample(
    frames: ParticleFrame[],
  ): { a: Float64Array; b: Float64Array; t: number } | null {
    if (!frames.length) return null;
    if (this.hour < frames[0].hour - 0.5) return null;

    let lo = frames[0];
    let hi = frames[frames.length - 1];
    for (let i = 0; i < frames.length - 1; i++) {
      if (frames[i].hour <= this.hour && frames[i + 1].hour >= this.hour) {
        lo = frames[i];
        hi = frames[i + 1];
        break;
      }
    }

    const span = hi.hour - lo.hour;
    const t = span === 0 ? 0 : (this.hour - lo.hour) / span;
    return { a: lo.particles, b: hi.particles, t: Math.max(0, Math.min(1, t)) };
  }

  private draw() {
    const ctx = this.ctx;
    if (!ctx) return;

    const { clientWidth: w, clientHeight: h } = this.map.getContainer();
    if (this.canvas.width === 0 || Math.abs(this.canvas.clientWidth - w) > 1) {
      this.resize();
    }
    ctx.clearRect(0, 0, w, h);
    if (!this.visible) return;

    // Particles are drawn additively so overlapping ones read as density. That
    // is the point of the layer: where the cloud is concentrated is where the
    // oil was, or could have been.
    ctx.globalCompositeOperation = "lighter";

    // The release first, and only up to the pass. After that the oil on screen
    // is the forecast, which the map draws as contours rather than parcels.
    if (this.hour <= 0.5) {
      this.paint(ctx, this.sample(this.releaseFrames), this.releaseColour, 0.5, 2.2, w, h);
    }
    this.paint(ctx, this.sample(this.frames), this.colour, 0.3, 1.8, w, h);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private paint(
    ctx: CanvasRenderingContext2D,
    sampled: { a: Float64Array; b: Float64Array; t: number } | null,
    colour: string,
    alpha: number,
    size: number,
    w: number,
    h: number,
  ) {
    if (!sampled) return;
    const { a, b, t } = sampled;
    const n = Math.min(a.length, b.length) / 2;
    const half = size / 2;

    ctx.fillStyle = colour;
    ctx.globalAlpha = alpha;

    for (let i = 0; i < n; i++) {
      const lon = a[i * 2] + (b[i * 2] - a[i * 2]) * t;
      const lat = a[i * 2 + 1] + (b[i * 2 + 1] - a[i * 2 + 1]) * t;
      const p = this.map.project([lon, lat]);
      if (p.x < -20 || p.y < -20 || p.x > w + 20 || p.y > h + 20) continue;
      ctx.fillRect(p.x - half, p.y - half, size, size);
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.map.off("move", this.onMove);
    this.map.off("resize", this.onMove);
    this.canvas.remove();
  }
}
