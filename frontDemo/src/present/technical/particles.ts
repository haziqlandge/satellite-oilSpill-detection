/**
 * Canvas drawing for the journey's dense layers: the coast as dots, the
 * OpenDrift particles, and the AIS tracks. SVG would be thousands of nodes;
 * these redraw whole every animation frame instead.
 */
import type { RealTrafficFile } from "../../sim/realAis";
import type { DriftJson } from "./data";
import type { Project } from "./geo";

export function clear(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

export function drawDots(ctx: CanvasRenderingContext2D, land: [number, number][], project: Project, color: string, radius: number): void {
  ctx.fillStyle = color;
  for (const [lon, lat] of land) {
    const [x, y] = project(lon, lat);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** One frame's particles, a flat [lon, lat, ...] list. */
export function drawFrame(ctx: CanvasRenderingContext2D, flat: number[], project: Project, color: string, radius: number): void {
  ctx.fillStyle = color;
  for (let k = 0; k + 1 < flat.length; k += 2) {
    const lon = flat[k];
    const lat = flat[k + 1];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const [x, y] = project(lon, lat);
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
}

/** Particles at a fractional hour, interpolated between the two hourly frames around it. */
export function particlesAt(drift: DriftJson, hour: number): number[] {
  const lo = Math.floor(hour);
  const f = hour - lo;
  const a = drift.frames[Math.max(0, Math.min(drift.frames.length - 1, lo + drift.backwardHours))].particles;
  const b = drift.frames[Math.max(0, Math.min(drift.frames.length - 1, lo + 1 + drift.backwardHours))].particles;
  if (f === 0 || a.length !== b.length) return a;
  const out = new Array<number>(a.length);
  for (let k = 0; k < a.length; k++) out[k] = a[k] + (b[k] - a[k]) * f;
  return out;
}

export function drawTracks(
  ctx: CanvasRenderingContext2D,
  vessels: RealTrafficFile["vessels"],
  project: Project,
  keep: ReadonlySet<string>,
  rejectedAlpha: number,
  keptAlpha: number,
): void {
  const pass = (kept: boolean) => {
    ctx.strokeStyle = kept ? `rgba(255,255,255,${keptAlpha})` : `rgba(150,158,172,${rejectedAlpha})`;
    ctx.lineWidth = kept ? 2.2 : 1;
    for (const v of vessels) {
      if (keep.has(v.id) !== kept || v.lon.length < 2) continue;
      ctx.beginPath();
      const breaks = new Set(v.breaks);
      for (let i = 0; i < v.lon.length; i++) {
        const [x, y] = project(v.lon[i], v.lat[i]);
        if (i === 0 || breaks.has(i)) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  };
  pass(false);
  pass(true);
}
