/**
 * An objective's icon, which is also its status.
 *
 * Unsolved, it is the icon alone, in red. When a solution answering it lands,
 * the icon grows a little, a blue circle draws itself around it and fills, and
 * the disc spins edge-on like a coin to land on its back face: a white tick.
 * A solution that answers an objective already ticked pulses it instead.
 */
import { createTimeline, type Timeline } from "animejs";
import { Check, type Icon } from "@phosphor-icons/react";
import type { HTMLAttributes } from "react";

export function IconBadge({
  icon: IconComponent,
  size = 72,
  ...rest
}: { icon: Icon; size?: number } & HTMLAttributes<HTMLDivElement>) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="pt-badge" style={{ width: size, height: size }} {...rest}>
      <div className="pt-badge-glow" />
      <div className="pt-badge-coin">
        <div className="pt-face pt-front">
          <span className="pt-front-fill" />
          <IconComponent size={Math.round(size * 0.6)} weight="duotone" />
        </div>
        <div className="pt-face pt-back">
          <Check size={Math.round(size * 0.52)} weight="bold" color="#fff" />
        </div>
      </div>
      <svg className="pt-badge-ring" viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ strokeDasharray: c, strokeDashoffset: c }}
        />
      </svg>
    </div>
  );
}

export function flipToTick(el: HTMLElement): Timeline {
  const circle = el.querySelector("circle")!;
  const c = Number.parseFloat(circle.style.strokeDasharray);
  const front = el.querySelector(".pt-front")!;
  const fill = el.querySelector(".pt-front-fill")!;
  const coin = el.querySelector(".pt-badge-coin")!;
  const glow = el.querySelector(".pt-badge-glow")!;
  return createTimeline()
    .add(el, { scale: [1, 1.15], duration: 260, ease: "outQuad" }, 0)
    .set(circle, { opacity: 1 }, 120)
    .add(circle, { strokeDashoffset: [c, 0], duration: 460, ease: "inOutCubic" }, 120)
    .add(fill, { opacity: [0, 1], duration: 260, ease: "outQuad" }, 520)
    .add(front, { color: ["#d8344a", "#ffffff"], duration: 260, ease: "outQuad" }, 520)
    .add(circle, { opacity: [1, 0], duration: 200 }, 760)
    .add(coin, { rotateY: [0, 540], duration: 900, ease: "outCubic" }, 740)
    .add(glow, { opacity: [0, 1, 0.35], duration: 900, ease: "outQuad" }, 1100)
    .add(el, { scale: [1.15, 1], duration: 360, ease: "outBack" }, 1500);
}

export function pulseTick(el: HTMLElement): Timeline {
  const glow = el.querySelector(".pt-badge-glow")!;
  return createTimeline()
    .add(el, { scale: [1, 1.2, 1], duration: 620, ease: "outQuad" }, 0)
    .add(glow, { opacity: [0.35, 1, 0.35], duration: 700, ease: "outQuad" }, 0);
}
