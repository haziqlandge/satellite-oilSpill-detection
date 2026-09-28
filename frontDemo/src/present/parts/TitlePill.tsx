/**
 * The red title pill. Its plate stretches open from the centre, then the words
 * land -- the reference video's section header.
 */
import { createTimeline, type Timeline } from "animejs";
import type { HTMLAttributes, ReactNode } from "react";

export function TitlePill({
  children,
  className = "",
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`pt-pill ${className}`} {...rest}>
      <span className="pt-pill-bg" />
      <span className="pt-pill-text">{children}</span>
    </div>
  );
}

export function openPill(el: HTMLElement): Timeline {
  const bg = el.querySelector(".pt-pill-bg");
  const text = el.querySelector(".pt-pill-text");
  return createTimeline()
    .set(el, { opacity: 1 }, 0)
    .add(bg!, { scaleX: [0, 1], opacity: [0, 1], duration: 560, ease: "outExpo" }, 0)
    .add(
      text!,
      { opacity: [0, 1], translateY: [16, 0], filter: ["blur(8px)", "blur(0px)"], duration: 460, ease: "outCubic" },
      240,
    );
}
