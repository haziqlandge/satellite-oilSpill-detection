/**
 * The raised dark card, and its entrance: it arrives oversized and settles,
 * fading in as it shrinks (the reference video, 1:08).
 */
import { createTimeline, type Timeline } from "animejs";
import type { HTMLAttributes, ReactNode } from "react";

export function Card({ children, className = "", ...rest }: { children?: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`pt-card ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function enterCard(el: HTMLElement | SVGElement, delay = 0): Timeline {
  return createTimeline().add(el, { opacity: [0, 1], scale: [1.35, 1], duration: 700, ease: "outExpo" }, delay);
}
