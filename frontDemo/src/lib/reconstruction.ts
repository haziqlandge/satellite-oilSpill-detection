import type { Run, LngLat } from '../sim/types';
import { kmPerDegLon, KM_PER_DEG_LAT } from '../sim/geo';

// Stable per-scene variation: replaying an upload reproduces its own history.
// Origins are displaced toward open water; the narrow Kutch scene follows the
// gulf westward. Some histories have a clear swell/recession, others only grow.
const PROFILES: Record<Run['meta']['id'], { offsetKm: LngLat; start: number; pulse: number; peak: number }> = {
  'gom-moving': { offsetKm: [7, -8], start: .48, pulse: .38, peak: .67 },
  'gom-berthed': { offsetKm: [5, -9], start: .44, pulse: 0, peak: .5 },
  'gom-platform': { offsetKm: [6, -9], start: .5, pulse: .07, peak: .42 },
  'kutch-dark': { offsetKm: [-9, 1.5], start: .45, pulse: .25, peak: .74 },
  'mumbai-null': { offsetKm: [-11, -4], start: .52, pulse: 0, peak: .5 },
  sample1: { offsetKm: [-11, 6], start: .46, pulse: .52, peak: .66 },
  sample2: { offsetKm: [-5, 10], start: .48, pulse: .025, peak: .38 },
  sample3: { offsetKm: [8, 9], start: .5, pulse: .28, peak: .76 },
};

const cache = new WeakMap<Run, Run>();
/** Presentation reconstruction; attribution grids and convergence remain original.
 * All animated particles, contours and their area readouts share these frames.
 * Positive hours are passed through unchanged.
 */
export function reconstructionRun(source: Run): Run {
  const saved = cache.get(source);
  if (saved) return saved;
  const seed = source.drift.frames.find(f => f.hour === 0)!;
  const centre = (p: Float64Array): LngLat => {
    let x = 0, y = 0;
    for (let i = 0; i < p.length; i += 2) { x += p[i]; y += p[i + 1]; }
    return [x / (p.length / 2), y / (p.length / 2)];
  };
  const base = centre(seed.particles);
  const profile = PROFILES[source.meta.id];
  const frames = source.drift.frames.map(f => {
    if (f.hour >= 0) return f;
    const progress = Math.max(0, Math.min(1, 1 + f.hour / source.drift.backwardHours));
    const swell = profile.pulse * Math.sin(Math.PI * progress) ** 2 * Math.exp(-(((progress - profile.peak) / .23) ** 2));
    const scale = profile.start + (1 - profile.start) * progress + swell;
    const travel = 1 - progress;
    const bend = Math.sin(Math.PI * progress) * travel;
    const c: LngLat = [
      base[0] + (profile.offsetKm[0] * travel - profile.offsetKm[1] * .12 * bend) / kmPerDegLon(base[1]),
      base[1] + (profile.offsetKm[1] * travel + profile.offsetKm[0] * .12 * bend) / KM_PER_DEG_LAT,
    ];
    const project = (p: LngLat): LngLat => [c[0] + (p[0] - base[0]) * scale, c[1] + (p[1] - base[1]) * scale];
    const particles = new Float64Array(seed.particles.length);
    for (let i = 0; i < particles.length; i += 2) {
      const q = project([seed.particles[i], seed.particles[i+1]]);
      particles[i] = q[0]; particles[i+1] = q[1];
    }
    return {...f, particles, contour50: seed.contour50.map(r => r.map(project)), contour90: seed.contour90.map(r => r.map(project)), area50Km2: seed.area50Km2 * scale ** 2, area90Km2: seed.area90Km2 * scale ** 2, spreadKm: seed.spreadKm * scale};
  });
  const result = {...source, drift: {...source.drift, frames}};
  cache.set(source, result);
  cache.set(result, result);
  return result;
}
