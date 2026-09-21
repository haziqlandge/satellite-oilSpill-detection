/**
 * The fractional playhead, published outside React.
 *
 * The transport already computes a continuous hour -- `Timeline`'s loop
 * accumulates `dt * speed` every frame -- but only whole hours ever reached the
 * application, and for good reason: a change of `hour` rebuilds every AIS
 * track, both origin contours and the release extent, and doing that sixty
 * times a second would cost a great deal for no visible gain.
 *
 * The particle cloud is the exception, and it was swept up in the same rule.
 * `ParticleOverlay` interpolates between whole-hour frames, so it is the one
 * consumer that does *not* round -- but it was only ever handed integers, which
 * pinned its blend factor at zero and turned a drift animation into a slideshow
 * advancing once per simulated hour. That is the whole of the stiffness.
 *
 * So the playhead is split in two. `hour` stays in React state at whole hours
 * and keeps driving the expensive layers. The fractional value goes through
 * this store straight to the canvas, which repaints from its own
 * `requestAnimationFrame` loop and never touches React. No re-render, no
 * reconciliation, no source updates -- one number and a canvas.
 *
 * Scrubbing and stepping publish here too, so there is exactly one place the
 * overlay reads time from and no way for the two to disagree.
 */

type Listener = (hour: number) => void;

const listeners = new Set<Listener>();
let current = 0;
let driving = false;

/** Publish the playhead from the transport. Safe to call every frame. */
export function setPlayhead(hour: number): void {
  if (hour === current) return;
  current = hour;
  for (const listener of listeners) listener(hour);
}

/**
 * Whether the transport currently owns the playhead.
 *
 * Without this the two publishers fight. During playback the loop emits a whole
 * hour to React as it crosses one, React re-renders, and the discrete path
 * would then publish that integer -- snapping the canvas back from 12.37 to
 * 12.00 for a single frame, every simulated hour. Visible, and exactly the
 * stutter this module exists to remove.
 */
export function setDriving(value: boolean): void {
  driving = value;
}

/**
 * Publish a discrete hour -- a scrub, a step, a jump to a checkpoint.
 *
 * Ignored while the transport is driving, so there is one writer at a time.
 */
export function syncPlayhead(hour: number): void {
  if (driving) return;
  setPlayhead(hour);
}

export function getPlayhead(): number {
  return current;
}

/**
 * Subscribe to the playhead. The listener is called immediately with the
 * current value, so a canvas mounting mid-playback does not wait a frame at
 * the wrong hour.
 */
export function subscribePlayhead(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
