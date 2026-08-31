/**
 * Deterministic PRNG.
 *
 * Every scenario is generated from a fixed seed, so the same demo runs the same
 * way on every machine and a screenshot can be reproduced. Math.random would
 * make the origin field different on every reload, which is the one thing a
 * probability field must not do while someone is comparing two runs.
 */

export interface Rng {
  next(): number;
  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Standard normal via Box-Muller. */
  normal(): number;
  int(lo: number, hi: number): number;
  pick<T>(items: readonly T[]): T;
}

export function makeRng(seed: number): Rng {
  // mulberry32: small, fast, good enough for visual simulation.
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let spare: number | null = null;
  const normal = () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = next() * 2 - 1;
      v = next() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * m;
    return u * m;
  };

  return {
    next,
    normal,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + next() * (hi - lo)),
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}

/** Seed from a string, so scenario ids produce stable but distinct fields. */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
