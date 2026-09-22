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
 * WHAT IS DRAWN AND WHAT IS DATA. The stored frames are the ensemble's own
 * positions, one per simulated hour. Everything between them is interpolation
 * and the interface says so. Catmull-Rom is used rather than a straight line
 * because a parcel on a curving current does not travel in hourly chords, and
 * the corners a linear blend puts at every whole hour are an artefact of the
 * sampling rather than anything in the flow. It can overshoot a chord slightly
 * on a tight turn; over one hour of drift that is tens of metres, far below the
 * ensemble's own spread, and it is never allowed to stand in for a stored
 * position.
 */

import type { Map as MapLibreMap } from "maplibre-gl";

export interface ParticleFrame {
  hour: number;
  particles: Float64Array;
}

/** Positions around one instant: four frames and the fraction between the middle two. */
interface Sampled {
  p0: Float64Array;
  p1: Float64Array;
  p2: Float64Array;
  p3: Float64Array;
  t: number;
  /** How many parcels the sample carries. Drives the seed dot's size. */
  count: number;
}

/**
 * Uniform Catmull-Rom through `b` and `c`, with `a` and `d` setting the slope.
 *
 * The curve passes exactly through the stored positions at t=0 and t=1, so a
 * whole hour still shows the ensemble's own answer; only the sub-hour path
 * between them is inferred.
 */
function catmull(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t2 +
      (-a + 3 * b - 3 * c + d) * t3)
  );
}

/**
 * A stable per-parcel number in [0,1), from its index alone.
 *
 * Used for size and brightness only, never for position. A cloud of identically
 * sized dots reads as a texture swatch rather than as parcels of oil, but
 * nudging where a parcel *is* would be inventing data, and the whole claim of
 * this view is that these are the ensemble's positions.
 */
function jitter(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * A colour at a given alpha, for the stamp's gradient stops.
 *
 * The gradient needs intermediate opacities and the palette hands over hex, so
 * this is the one place the two meet. Anything it cannot parse is returned
 * unchanged at full alpha and transparent at zero, which degrades to the old
 * hard-edged stamp rather than to nothing drawn.
 */
function rgba(colour: string, alpha: number): string {
  const hex = colour.trim().replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (full.length !== 6) return alpha <= 0 ? "transparent" : colour;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return alpha <= 0 ? "transparent" : colour;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

  /**
   * Soft round stamps, one per colour and size, built once and reused.
   *
   * `fillRect` gave every parcel four corners and a hard edge, which at two
   * pixels across is the difference between a cloud and a screen door. A
   * pre-rendered radial gradient drawn with `drawImage` costs a blit instead of
   * a path, so it is also cheaper than the rectangle it replaces.
   */
  private sprites = new Map<string, HTMLCanvasElement>();

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

  private sprite(colour: string, size: number): HTMLCanvasElement {
    // Quantised so a continuously varying size does not mint a sprite a frame.
    const step = Math.max(1, Math.round(size * 4)) / 4;
    const key = `${colour}|${step}`;
    const cached = this.sprites.get(key);
    if (cached) return cached;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Three times the nominal size: the parcel is the bright core and the rest
    // is the falloff that lets neighbours merge into density rather than
    // stippling.
    const diameter = Math.max(2, Math.ceil(step * 2.4 * dpr));
    const stamp = document.createElement("canvas");
    stamp.width = diameter;
    stamp.height = diameter;
    const g = stamp.getContext("2d");
    if (g) {
      const r = diameter / 2;
      const gradient = g.createRadialGradient(r, r, 0, r, r, r);
      /*
        A falloff, not a disc with a soft edge.

        The first version held full opacity out to 45% of the radius and only
        then faded, which is a solid core wearing a halo. Under additive
        blending that is the worst possible shape: each parcel contributes a
        flat slab of ink, the slabs stack wherever the cloud is dense, and the
        centre clips to white. Measured on the hindcast at T-27h, 51% of the
        lit pixels were fully saturated -- over half the cloud carried no
        density information at all, because every value above the ceiling looks
        the same.

        Fading from the centre puts most of each parcel's ink near its own
        middle and very little at its edge, so parcels still merge but the sum
        stays on the part of the scale where differences are visible.
      */
      gradient.addColorStop(0, rgba(colour, 1));
      gradient.addColorStop(0.25, rgba(colour, 0.55));
      gradient.addColorStop(0.6, rgba(colour, 0.16));
      gradient.addColorStop(1, rgba(colour, 0));
      g.fillStyle = gradient;
      g.globalAlpha = 1;
      g.beginPath();
      g.arc(r, r, r, 0, Math.PI * 2);
      g.fill();
    }
    this.sprites.set(key, stamp);
    return stamp;
  }

  /**
   * Positions around the requested hour, as four frames and a fraction.
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
      const held = { p0: first, p1: first, p2: first, p3: first, t: 0, count: first.length / 2 };
      if (holdFirst) return held;
      if (this.hour < frames[0].hour - 0.5) return null;
      return held;
    }

    let i = frames.length - 2;
    for (let k = 0; k < frames.length - 1; k++) {
      if (frames[k].hour <= this.hour && frames[k + 1].hour >= this.hour) {
        i = k;
        break;
      }
    }
    // Clamped at both ends, so the first and last spans keep a straight tangent
    // rather than borrowing a frame that does not exist.
    const p0 = frames[Math.max(0, i - 1)].particles;
    const p1 = frames[i].particles;
    const p2 = frames[i + 1].particles;
    const p3 = frames[Math.min(frames.length - 1, i + 2)].particles;

    const span = frames[i + 1].hour - frames[i].hour;
    const t = span === 0 ? 0 : (this.hour - frames[i].hour) / span;
    return {
      p0,
      p1,
      p2,
      p3,
      t: Math.max(0, Math.min(1, t)),
      // The shortest of the four, so a parcel that has not entered the water
      // yet is not interpolated into existence half way through an hour.
      count: Math.min(p0.length, p1.length, p2.length, p3.length) / 2,
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

    /*
      Always clear. There used to be a fading trail here and it flickered.

      The fade was conditional: a small forward step in the hour left 78% of the
      previous frame behind, and anything else -- a scrub, a jump, a pan -- wiped
      the canvas, because a streak across those describes a path nothing took.
      That condition is the bug. Whether a frame fades or wipes then depends on
      how long the frame took, and during playback the frames are not evenly
      spaced: every simulated hour React rebuilds the AIS tracks, the contours
      and the release extent, which is long enough to push that frame's step
      over the threshold. So the canvas wiped roughly once a simulated hour and
      faded in between, and a wipe next to a frame carrying four accumulated
      copies of the cloud is a visible flash.

      Scrubbing never flickered because it always took the clear path -- which
      is also the rendering that was wanted. Making the trail unconditional
      would have fixed the flicker by keeping the smear through scrubs, and
      tuning the threshold only moves the frame rate at which it returns. A
      renderer whose output depends on frame timing is the thing to remove, not
      to calibrate.
    */
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
      const subordinate = beforePass && this.releaseVisible && this.releaseFrames.length > 0;
      if (subordinate) {
        // Behind the oil: a haze, and nothing more.
        this.paint(ctx, field, this.colour, 0.1, 1.5, w, h, 3);
      } else if (beforePass) {
        // The release is hidden, so the origin field is the subject of the
        // panel and carries its own weight at full density.
        this.paint(ctx, field, this.colour, 0.14, 2.0, w, h, 2);
      } else {
        /*
          The forecast, deliberately thinner than the hindcast at full weight.

          After the pass the ensemble is oil, so it is not held back the way the
          haze is -- but the 50% and 90% contours are already drawn over it and
          they, not the stippling, are what the forecast is read from. At stride
          1 with a soft stamp roughly three times the footprint of the square it
          replaced, the parcels merge into a solid mass that hides the very
          contours it sits under. Every third parcel at a slightly smaller stamp
          keeps the texture and the sense of where the cloud is dense, without
          painting over the answer.
        */
        this.paint(ctx, field, this.colour, 0.12, 1.8, w, h, 3);
      }
    }

    // The oil, from the first parcel in the water through to the pass. After
    // that the oil on screen is the forecast, which the map draws as contours.
    if (this.releaseVisible && beforePass) {
      const release = this.sample(this.releaseFrames, true);
      const size = this.releaseSize(release?.count ?? 0);
      this.paint(ctx, release, this.releaseColour, 0.34, size, w, h, 1);
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
    const { p0, p1, p2, p3, t } = sampled;
    const n = Math.min(
      Math.min(p0.length, p1.length, p2.length, p3.length) / 2,
      sampled.count,
    );

    // Two stamps rather than one per parcel: a continuous size would mint a
    // sprite per parcel per frame, and at this scale the eye reads the mix as
    // variation without needing a spectrum of it.
    const small = this.sprite(colour, size * 0.8);
    const large = this.sprite(colour, size * 1.25);

    for (let i = 0; i < n; i += stride) {
      const k = i * 2;
      const lon = catmull(p0[k], p1[k], p2[k], p3[k], t);
      const lat = catmull(p0[k + 1], p1[k + 1], p2[k + 1], p3[k + 1], t);
      const p = this.map.project([lon, lat]);
      if (p.x < -20 || p.y < -20 || p.x > w + 20 || p.y > h + 20) continue;

      const j = jitter(i);
      const stamp = j < 0.5 ? small : large;
      // Brightness varies with the same number, so the two stamp sizes do not
      // read as two populations.
      ctx.globalAlpha = alpha * (0.72 + j * 0.42);
      const d = stamp.width / Math.min(2, window.devicePixelRatio || 1);
      ctx.drawImage(stamp, p.x - d / 2, p.y - d / 2, d, d);
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.map.off("move", this.onMove);
    this.map.off("resize", this.onMove);
    this.canvas.remove();
    this.sprites.clear();
  }
}
