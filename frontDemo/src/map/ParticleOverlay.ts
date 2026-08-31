/**
 * Drift particles, drawn on a canvas above the map.
 *
 * Two clouds live on this canvas and they mean opposite things, so they are
 * drawn with opposite weights:
 *
 *  - the **release cloud** is the oil. It plays forward from the first parcel
 *    entering the water, so it starts as a single dot at the source and
 *    accumulates, hour by hour, until at the satellite pass it fills the extent
 *    the segmenter drew. That accumulation is the event, and it is the bright
 *    layer
 *  - the **origin field cloud** is the hindcast ensemble: where the oil could
 *    have come from. Running a diffusive process backward spreads it, so this
 *    cloud legitimately widens with backward time -- it is at its widest at the
 *    far end of the backward horizon, which is exactly when there is least oil
 *    in the water. Drawn at the same weight as the release it reads as a spill
 *    far larger than the one actually observed, which is the opposite of what
 *    it says. Before the pass it is therefore a faint haze behind the oil, and
 *    the 50/90 contours carry the credible regions
 *
 * After the pass the ensemble is the forecast -- where the oil is going, which
 * *is* oil -- so it returns to full weight there.
 *
 * The positions live in a Float64Array and are projected with the map's own
 * `project()` on each frame rather than going through a GeoJSON source, which
 * would re-parse and re-tile the whole cloud on every timestep. That is a
 * matrix multiply per particle, and at fourteen hundred particles it costs well
 * under a millisecond, so the cloud stays locked to the map through pan, zoom
 * and rotation without ever touching the style.
 *
 * Positions are interpolated between whole-hour frames, which is what makes
 * dragging the time slider read as motion rather than as a slideshow.
 */

import type { Map as MapLibreMap } from "maplibre-gl";

export interface ParticleFrame {
  hour: number;
  particles: Float64Array;
}

/** Positions at one instant, as two frames and the fraction between them. */
interface Sampled {
  a: Float64Array;
  b: Float64Array;
  t: number;
  /** How many parcels the sample carries. Drives the seed dot's size. */
  count: number;
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
  private fieldVisible = true;
  private releaseVisible = true;
  /**
   * Whether overlapping parcels add or paint over each other.
   *
   * Additive blending is what makes density legible on a dark ground: where the
   * cloud is concentrated it burns brighter. On a light ground it does the
   * opposite -- every parcel drives the pixel towards white and the cloud
   * disappears into the paper -- so the light direction composites normally.
   */
  private additive = true;
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

  /** The hindcast and forecast ensemble: the origin probability field. */
  setFrames(frames: ParticleFrame[]) {
    this.frames = [...frames].sort((a, b) => a.hour - b.hour);
    this.dirty = true;
  }

  /** Parcels of the release itself: the oil that is actually in the water. */
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

  /** The ensemble cloud. Driven by the `particles` layer toggle. */
  setVisible(visible: boolean) {
    this.fieldVisible = visible;
    this.dirty = true;
  }

  /** The oil. Driven by the `release` layer toggle. */
  setReleaseVisible(visible: boolean) {
    this.releaseVisible = visible;
    this.dirty = true;
  }

  setAdditive(additive: boolean) {
    this.additive = additive;
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

  /**
   * Positions at the requested hour, interpolated between whole-hour frames.
   *
   * `holdFirst` is for the release. Before its first frame there is nothing to
   * interpolate towards, but that is not "no data": it is the source sitting
   * there before it starts discharging. Holding the first frame puts the seed
   * parcel where the oil will enter the water, which is where the accumulation
   * the playback exists to show begins.
   */
  private sample(frames: ParticleFrame[], holdFirst: boolean): Sampled | null {
    if (!frames.length) return null;

    if (this.hour < frames[0].hour) {
      const first = frames[0].particles;
      if (holdFirst) return { a: first, b: first, t: 0, count: first.length / 2 };
      if (this.hour < frames[0].hour - 0.5) return null;
      return { a: first, b: first, t: 0, count: first.length / 2 };
    }

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
    return {
      a: lo.particles,
      b: hi.particles,
      t: Math.max(0, Math.min(1, t)),
      // The lower frame's count, so a parcel that has not entered the water yet
      // is not interpolated into existence half way through an hour.
      count: Math.min(lo.particles.length, hi.particles.length) / 2,
    };
  }

  /**
   * Size for the oil parcels.
   *
   * A one-parcel seed drawn at the same size as a twelve-hundred-parcel slick
   * is a pixel nobody will find. The marker grows as the cloud thins, so the
   * first hours of the release read as a dot rather than as nothing, and
   * shrinks back once there are enough parcels for density to do the work.
   */
  private releaseSize(count: number): number {
    if (count <= 8) return 5;
    if (count <= 40) return 3.8;
    if (count <= 160) return 3;
    return 2.4;
  }

  private draw() {
    const ctx = this.ctx;
    if (!ctx) return;

    const { clientWidth: w, clientHeight: h } = this.map.getContainer();
    if (this.canvas.width === 0 || Math.abs(this.canvas.clientWidth - w) > 1) {
      this.resize();
    }
    ctx.clearRect(0, 0, w, h);

    // Overlapping parcels read as density on a dark ground; see `additive`.
    ctx.globalCompositeOperation = this.additive ? "lighter" : "source-over";

    const beforePass = this.hour <= 0.5;

    // The origin field first, so the oil sits on top of it.
    //
    // It is held back only while the oil is drawn over it. The two clouds are
    // the same kind of mark, and the backward one is at its widest exactly when
    // there is least oil in the water, so at equal weight the hypothesis reads
    // as the bigger spill. With the release turned off there is nothing to
    // mistake it for and it is the subject of the panel, so it carries its own
    // weight -- as it does after the pass, where it is the forecast and the
    // forecast is oil.
    if (this.fieldVisible) {
      const field = this.sample(this.frames, false);
      const subordinate = beforePass && this.releaseVisible;
      if (subordinate) this.paint(ctx, field, this.colour, 0.16, 1.3, w, h, 2);
      else this.paint(ctx, field, this.colour, 0.3, 1.8, w, h, 1);
    }

    // The oil, from the first parcel in the water through to the pass. After
    // that the oil on screen is the forecast, which the map draws as contours.
    if (this.releaseVisible && beforePass) {
      const release = this.sample(this.releaseFrames, true);
      const size = this.releaseSize(release?.count ?? 0);
      this.paint(ctx, release, this.releaseColour, 0.6, size, w, h, 1);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private paint(
    ctx: CanvasRenderingContext2D,
    sampled: Sampled | null,
    colour: string,
    alpha: number,
    size: number,
    w: number,
    h: number,
    stride: number,
  ) {
    if (!sampled) return;
    const { a, b, t } = sampled;
    const n = Math.min(Math.min(a.length, b.length) / 2, sampled.count);
    const half = size / 2;

    ctx.fillStyle = colour;
    ctx.globalAlpha = alpha;

    for (let i = 0; i < n; i += stride) {
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
