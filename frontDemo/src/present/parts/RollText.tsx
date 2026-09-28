/**
 * A word that is whooshed out of its own box and replaced.
 *
 * The box does not move; the word inside it does. The old word leaves upward
 * and the new one arrives from below, both through a vertical-only motion blur
 * (an SVG `feGaussianBlur` with a zero x deviation, `#present-vblur`, rendered
 * once by the overlay), and the box eases to the new word's width.
 */
import { createTimeline, type Timeline } from "animejs";
import type { HTMLAttributes } from "react";

export function RollText({ from, to, ...rest }: { from: string; to: string } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className="pt-roll" {...rest}>
      <span className="pt-roll-a">{from}</span>
      <span className="pt-roll-b" aria-hidden="true">
        {to}
      </span>
    </span>
  );
}

export function rollText(el: HTMLElement): Timeline {
  const a = el.querySelector<HTMLElement>(".pt-roll-a")!;
  const b = el.querySelector<HTMLElement>(".pt-roll-b")!;
  const blur = document.querySelector("#present-vblur feGaussianBlur");
  const setBlur = (y: number) => blur?.setAttribute("stdDeviation", `0 ${y.toFixed(2)}`);
  const motion = { y: 0 };
  return createTimeline()
    .add(el, { width: [a.offsetWidth, b.offsetWidth], duration: 720, ease: "inOutCubic" }, 0)
    .add(a, { translateY: ["0%", "-118%"], duration: 520, ease: "inQuad" }, 0)
    .add(b, { translateY: ["118%", "0%"], duration: 640, ease: "outCubic" }, 170)
    .add(motion, { y: [0, 18], duration: 320, ease: "inQuad", onUpdate: () => setBlur(motion.y) }, 0)
    .add(motion, { y: [18, 0], duration: 520, ease: "outQuad", onUpdate: () => setBlur(motion.y) }, 320);
}
