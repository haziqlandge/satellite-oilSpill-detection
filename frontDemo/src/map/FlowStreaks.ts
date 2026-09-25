/**
 * Wind and current as moving streaks over the event, on a canvas above the map.
 *
 * Four tracers each for the air and the water (the user, 2026-09-26: a few
 * arrows, placed at random rather than on a grid, that move instead of turning
 * in place). A tracer starts somewhere random on or around the slick and its
 * hindcast and forecast regions, and is carried by the run's own flow grid
 * (`flowAt`) at the playhead hour. Its tail is the path it just travelled, so
 * it curves where the flow curves; the tail shortens from the far end as the
 * head moves on, and a plain `>` marks the head. After a few seconds it fades
 * and starts again somewhere else.
 *
 * The motion is scaled for reading, not to the clock: wind and water each
 * cross about a fifth of the event in three seconds at a typical speed, so
 * the slow current is still seen to move. Speed differences within a kind
 * are kept. Where the grid has no value (a current over land, outside its
 * box), the tracer ends and starts again elsewhere.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { flowAt } from "../sim/flow";
import { KM_PER_DEG_LAT, kmPerDegLon } from "../sim/geo";
import type { FlowGrid, LngLat } from "../sim/types";

type Kind = "wind" | "current";

const PER_KIND = 4;
/** A typical speed per kind, m/s: the speed at which a tracer crosses a fifth of the event in three seconds. */
const TYPICAL: Record<Kind, number> = { wind: 6, current: 0.25 };

interface Tracer {
  kind: Kind;
  trail: LngLat[];
  age: number;
  life: number;
}

export class FlowStreaks {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private flow: FlowGrid | null = null;
  private seeds: LngLat[] = [];
  private boxKm = 50;
  private hour = 0;
  private colours: Record<Kind, string> = { wind: "#f2d16b", current: "#5cc8ff" };
  private visible: Record<Kind, boolean> = { wind: true, current: true };
  private tracers: Tracer[] = [];
  private raf = 0;
  private last = 0;
  private readonly still = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private map: MapLibreMap, container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "3" });
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.resize();
    this.map.on("resize", this.onResize);
  }

  /** The run's grid and the rings of the event it moves over: the slick, every hindcast and forecast region. */
  setData(flow: FlowGrid | null, rings: LngLat[][]) {
    this.flow = flow;
    this.seeds = rings.flat().filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (this.seeds.length) {
      const xs = this.seeds.map((p) => p[0]);
      const ys = this.seeds.map((p) => p[1]);
      const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
      this.boxKm = Math.max(5, (Math.max(...xs) - Math.min(...xs)) * kmPerDegLon(mid),
        (Math.max(...ys) - Math.min(...ys)) * KM_PER_DEG_LAT);
    }
    this.tracers = [];
    if (flow && this.seeds.length) {
      for (const kind of ["wind", "current"] as const)
        for (let i = 0; i < PER_KIND; i++) this.tracers.push(this.spawn(kind, Math.random()));
    }
    if (this.still) this.settle();
    this.kick();
  }

  setHour(hour: number) {
    this.hour = hour;
    if (this.still) {
      this.settle();
      this.draw();
    }
  }

  setColours(colours: Record<Kind, string>) {
    this.colours = colours;
    this.draw();
  }

  setVisible(visible: Record<Kind, boolean>) {
    this.visible = visible;
    this.kick();
    this.draw();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.map.off("resize", this.onResize);
    this.canvas.remove();
  }

  private onResize = () => {
    this.resize();
    this.draw();
  };

  private resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { clientWidth: w, clientHeight: h } = this.map.getContainer();
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /** A fresh tracer at a random point near the event, apart from the others of its kind. */
  private spawn(kind: Kind, ageFraction = 0): Tracer {
    const jitterKm = this.boxKm * 0.12;
    let best: LngLat = this.seeds[0];
    let bestGap = -1;
    for (let attempt = 0; attempt < 12; attempt++) {
      const base = this.seeds[Math.floor(Math.random() * this.seeds.length)];
      const p: LngLat = [
        base[0] + ((Math.random() * 2 - 1) * jitterKm) / kmPerDegLon(base[1]),
        base[1] + ((Math.random() * 2 - 1) * jitterKm) / KM_PER_DEG_LAT,
      ];
      if (this.flow && !flowAt(this.flow, kind, p, this.clampedHour())) continue;
      const others = this.tracers.filter((t) => t.kind === kind).map((t) => t.trail[t.trail.length - 1]);
      const gap = Math.min(Infinity, ...others.map((q) => Math.hypot((q[0] - p[0]) * kmPerDegLon(p[1]), (q[1] - p[1]) * KM_PER_DEG_LAT)));
      if (gap > bestGap) {
        best = p;
        bestGap = gap;
      }
      if (gap > this.boxKm / 4) break;
    }
    const life = 5 + Math.random() * 3;
    return { kind, trail: [best], age: ageFraction * life, life };
  }

  private clampedHour(): number {
    const hours = this.flow?.hours;
    if (!hours?.length) return this.hour;
    return Math.min(hours[hours.length - 1], Math.max(hours[0], this.hour));
  }

  /** Move one tracer on by `dt` seconds of display time; false when it has left the field. */
  private step(t: Tracer, dt: number): boolean {
    if (!this.flow) return false;
    const head = t.trail[t.trail.length - 1];
    const v = flowAt(this.flow, t.kind, head, this.clampedHour());
    if (!v) return false;
    // km per display second, per m/s of flow.
    const k = (this.boxKm / 5 / 3) / TYPICAL[t.kind];
    const next: LngLat = [
      head[0] + (v[0] * k * dt) / kmPerDegLon(head[1]),
      head[1] + (v[1] * k * dt) / KM_PER_DEG_LAT,
    ];
    t.trail.push(next);
    // The tail is the last fifth of the event's size of path: trimmed from its far end.
    const maxKm = this.boxKm * 0.2;
    let length = 0;
    for (let i = t.trail.length - 1; i > 0; i--) {
      const a = t.trail[i];
      const b = t.trail[i - 1];
      length += Math.hypot((a[0] - b[0]) * kmPerDegLon(a[1]), (a[1] - b[1]) * KM_PER_DEG_LAT);
      if (length > maxKm) {
        t.trail.splice(0, i - 1);
        break;
      }
    }
    if (t.trail.length > 400) t.trail.splice(0, t.trail.length - 400);
    return true;
  }

  /** Reduced motion: each tracer drawn once, its full tail laid out, and still. */
  private settle() {
    for (const t of this.tracers) {
      t.trail = [t.trail[0]];
      t.age = t.life / 2;
      for (let i = 0; i < 120 && this.step(t, 0.05); i++);
    }
  }

  private kick() {
    if (this.still || this.raf || !this.flow || !this.tracers.length) return;
    if (!this.visible.wind && !this.visible.current) return;
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      for (let i = 0; i < this.tracers.length; i++) {
        const t = this.tracers[i];
        t.age += dt;
        if (t.age > t.life || !this.step(t, dt)) this.tracers[i] = this.spawn(t.kind);
      }
      this.draw();
      this.raf = this.visible.wind || this.visible.current ? requestAnimationFrame(loop) : 0;
    };
    this.raf = requestAnimationFrame(loop);
  }

  private draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const t of this.tracers) {
      if (!this.visible[t.kind] || t.trail.length < 2) continue;
      const pts = t.trail.map((p) => this.map.project(p));
      // Fade in over the first second, out over the last.
      const envelope = Math.min(1, t.age / 1, (t.life - t.age) / 1);
      if (envelope <= 0) continue;
      const colour = this.colours[t.kind];
      const width = t.kind === "wind" ? 2.2 : 2.6;
      // The tail fades toward its far end: drawn in short runs of rising alpha.
      const n = pts.length;
      const runs = 12;
      for (let r = 0; r < runs; r++) {
        const from = Math.floor((r * (n - 1)) / runs);
        const to = Math.floor(((r + 1) * (n - 1)) / runs);
        if (to <= from) continue;
        ctx.beginPath();
        ctx.moveTo(pts[from].x, pts[from].y);
        for (let i = from + 1; i <= to; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = colour;
        ctx.globalAlpha = envelope * (0.08 + 0.87 * ((r + 1) / runs));
        ctx.lineWidth = width;
        ctx.stroke();
      }
      // The head: a plain chevron along the last few pixels of travel.
      const head = pts[n - 1];
      let k = n - 2;
      while (k > 0 && Math.hypot(head.x - pts[k].x, head.y - pts[k].y) < 6) k--;
      const angle = Math.atan2(head.y - pts[k].y, head.x - pts[k].x);
      const size = 9;
      ctx.globalAlpha = envelope;
      ctx.beginPath();
      ctx.moveTo(head.x - size * Math.cos(angle - 0.55), head.y - size * Math.sin(angle - 0.55));
      ctx.lineTo(head.x, head.y);
      ctx.lineTo(head.x - size * Math.cos(angle + 0.55), head.y - size * Math.sin(angle + 0.55));
      ctx.lineWidth = width;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
