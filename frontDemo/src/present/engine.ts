/**
 * The beat runner behind every Q press.
 *
 * A sequence is an ordered list of beats; a beat builds one animation over
 * elements its scene already rendered, hidden. The runner owns only the order
 * and one rule a live presenter depends on: Q while a beat is still animating
 * snaps it to its end state instead of starting the next one, so a nervous
 * double tap never loses a beat and never leaves an element half drawn.
 *
 * `Playable` is the slice of an anime.js v4 `Timeline` this needs, which is
 * also what lets `scripts/check-present.ts` drive the runner with fakes.
 */

export interface Playable {
  duration: number;
  completed: boolean;
  seek(ms: number): unknown;
  pause(): unknown;
  then(fn: () => void): unknown;
}

/** Builds and starts one beat's animation; `null` is a beat with nothing to animate. */
export type BeatBuild = () => Playable | null;

export class BeatRunner {
  private i = -1;
  private current: Playable | null = null;
  private settled = true;
  private ended = false;
  private disposed = false;

  constructor(
    private readonly beats: readonly BeatBuild[],
    private readonly onEnd: () => void,
  ) {}

  get index(): number {
    return this.i;
  }

  /** Whether the current beat has finished or been snapped (for debugging a live run). */
  get settledNow(): boolean {
    return this.settled || !!this.current?.completed;
  }

  start(): void {
    this.play(0);
  }

  next(): "snapped" | "played" | "ended" {
    const p = this.current;
    if (p && !this.settled && !p.completed) {
      p.seek(p.duration);
      this.settled = true;
      if (this.isLast()) this.end();
      return "snapped";
    }
    if (this.i + 1 < this.beats.length) {
      this.play(this.i + 1);
      return "played";
    }
    return "ended";
  }

  /** Stop without ending: a restart or an unmount, never a finished sequence. */
  dispose(): void {
    this.disposed = true;
    this.current?.pause();
  }

  private isLast(): boolean {
    return this.i === this.beats.length - 1;
  }

  private play(i: number): void {
    this.i = i;
    const last = this.isLast();
    const p = this.beats[i]();
    this.current = p;
    this.settled = !p;
    if (!p) {
      if (last) this.end();
      return;
    }
    p.then(() => {
      if (this.current === p) this.settled = true;
      if (last) this.end();
    });
  }

  private end(): void {
    if (this.ended || this.disposed) return;
    this.ended = true;
    this.onEnd();
  }
}
