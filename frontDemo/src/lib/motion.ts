import { useEffect, useRef, useState } from "react";
import { animate, createScope, onScroll, stagger, utils } from "animejs";
import type { Scope } from "animejs";

/**
 * Reduced-motion, tracked live rather than read once, so a user toggling the
 * OS setting mid-session gets the static page without a reload.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * anime.js scope bound to a container ref.
 *
 * createScope confines selectors to the container and reverts every animation
 * it created on cleanup, which is what keeps five mounted-then-unmounted
 * layouts from leaking timers into each other.
 */
export function useAnimeScope(
  setup: (scope?: Scope) => void,
  deps: unknown[] = [],
) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!root.current) return;
    if (reduced) return;

    const scope = createScope({ root: root.current }).add(setup);
    return () => scope.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, ...deps]);

  return root;
}

/**
 * Scroll-linked reveal.
 *
 * Uses anime's ScrollObserver (onScroll), never a scroll event listener --
 * a listener fires on every frame, re-renders, and janks on mobile.
 */
export function revealOnScroll(
  selector: string,
  opts: { y?: number; delay?: number; duration?: number } = {},
) {
  const { y = 26, delay = 60, duration = 780 } = opts;
  const targets = utils.$(selector);
  if (!targets.length) return;

  animate(targets, {
    opacity: [0, 1],
    translateY: [y, 0],
    duration,
    delay: stagger(delay),
    ease: "out(3)",
    autoplay: onScroll({ enter: "bottom-=80 top", repeat: false }),
  });
}

/** Sets the pre-reveal resting state so nothing flashes before the observer fires. */
export function primeReveal(selector: string, y = 26) {
  const targets = utils.$(selector);
  if (!targets.length) return;
  utils.set(targets, { opacity: 0, translateY: y });
}
