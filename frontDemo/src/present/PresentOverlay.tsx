/**
 * THE PRESENTATION OVERLAY -- the console's two narrated sequences.
 *
 * T plays the problem statement, its objectives and the proposed solution; X
 * plays the technical approach on one real Sentinel-1 pass and then the stack.
 * Q moves one beat on and Z leaves. T ends by opening a circle in the ground
 * that reveals the live console underneath, which never unmounts; X ends on a
 * thank-you screen that stays until Z.
 *
 * Provenance. By the user's decision (2026-09-27) nothing on this layer's
 * screen says what is real and what is authored; the record is here, in each
 * scene's `PROVENANCE` export, and in `scripts/export_present_assets.py`. In
 * short: every image, detection, weather field, particle and AIS track is the
 * console's own real data; the one authored thing is the scoring illustration
 * in the technical sequence (Case 2's top candidate), shown as how scoring
 * works and never as the 15 May result.
 *
 * Lazy by design: `PresentMount` imports this only on the first T or X.
 */
import { createTimeline, type Timeline } from "animejs";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import "./present.css";
import { BeatRunner, type BeatBuild } from "./engine";
import { SEQUENCES } from "./scenes";
import { Stage } from "./stage";
import type { OverlayHandle, SequenceId } from "./types";

export type { OverlayHandle, SceneProps, SequenceId } from "./types";

/*
  The overlay is never partly transparent. Over the console's WebGL map, a
  full-screen layer at, say, 50% opacity stalled the session machine's browser
  for two seconds a frame (measured 2026-09-27, GT 710, ANGLE D3D11), while a
  clip-path costs a few milliseconds. So it arrives, leaves and reveals the
  console through a circle: an iris closing in (T, X), the same circle shrinking
  away (Z), and a hole opening from the centre (the reveal).
*/

/** Grow (0 to 1) or shrink (1 to 0) a centred circle clip over the viewport. */
function iris(el: HTMLElement, from: number, to: number, duration: number): Timeline {
  const far = Math.hypot(window.innerWidth, window.innerHeight) / 2 + 2;
  const c = { k: from };
  return createTimeline().add(c, {
    k: [from, to],
    duration,
    ease: "inOutCubic",
    onUpdate: () => (el.style.clipPath = `circle(${(c.k * far).toFixed(1)}px at 50% 50%)`),
  });
}

/** The whole viewport minus a centred circle of radius r: evenodd leaves a hole. */
function holed(r: number): string {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cx = w / 2;
  const cy = h / 2;
  return (
    `path(evenodd, "M0 0H${w}V${h}H0Z` +
    `M${(cx - r).toFixed(1)} ${cy}a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(2 * r).toFixed(1)} 0` +
    `a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(-2 * r).toFixed(1)} 0Z")`
  );
}

const PresentOverlay = forwardRef<OverlayHandle, { sequence: SequenceId; showNames: boolean; onClosed: () => void }>(
  function PresentOverlay({ sequence, showNames, onClosed }, ref) {
    const root = useRef<HTMLDivElement>(null);
    const scene = useRef<HTMLDivElement>(null);
    const runner = useRef<BeatRunner | null>(null);
    const closing = useRef(false);
    const { beats: names, Scene } = SEQUENCES[sequence];

    // Stable for the overlay's lifetime: the console re-renders often, and a
    // new `register` each time would re-run the scene's setup mid-sequence.
    const closed = useRef(onClosed);
    closed.current = onClosed;
    const finish = useCallback(() => {
      if (closing.current) return;
      closing.current = true;
      closed.current();
    }, []);

    const register = useCallback(
      (sceneBeats: Record<string, BeatBuild>) => {
        if (runner.current) return;
        const own: Record<string, BeatBuild> = {
          blackout: () => iris(root.current!, 0, 1, 700),
          reveal: () => {
            const el = root.current!;
            const hole = { r: 0 };
            const far = Math.hypot(window.innerWidth, window.innerHeight) / 2 + 2;
            return createTimeline()
              .add(scene.current!, { scale: [1, 0.96], opacity: [1, 0.55], duration: 1200, ease: "inOutCubic" }, 0)
              .add(
                hole,
                { r: [0, far], duration: 1200, ease: "inOutCubic", onUpdate: () => (el.style.clipPath = holed(hole.r)) },
                0,
              );
          },
        };
        const all = { ...sceneBeats, ...own };
        const missing = names.filter((n) => !all[n]);
        if (missing.length) throw new Error(`present: no builder for beat(s) ${missing.join(", ")}`);
        // A sequence that ends on the reveal closes itself; one that ends on a
        // closing screen (X ends on the thank you) stays up until Z.
        runner.current = new BeatRunner(names.map((n) => all[n]), names.at(-1) === "reveal" ? finish : () => {});
        runner.current.start();
        if (import.meta.env.DEV) (window as unknown as { __present?: BeatRunner }).__present = runner.current;
      },
      // `names` and `Scene` are fixed for this mount: a new sequence remounts (PresentMount's key).
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        next: () => {
          runner.current?.next();
        },
        close: () => {
          if (closing.current) return;
          runner.current?.dispose();
          iris(root.current!, 1, 0, 450).then(finish);
        },
      }),
      [finish],
    );

    // Cleared as well as disposed: StrictMode runs every effect twice in
    // development, and the scene's second `register` must then build a fresh
    // runner rather than find the disposed one and return.
    useEffect(
      () => () => {
        runner.current?.dispose();
        runner.current = null;
      },
      [],
    );

    return (
      <div ref={root} className="pt-root" data-present={sequence}>
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
          <filter id="present-vblur" x="-10%" y="-60%" width="120%" height="220%">
            <feGaussianBlur stdDeviation="0 0" />
          </filter>
        </svg>
        <Stage>
          <div ref={scene} className="pt-scene">
            <Scene register={register} showNames={showNames} />
          </div>
        </Stage>
      </div>
    );
  },
);

export default PresentOverlay;
