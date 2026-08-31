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
 *
 * The threshold reads `"<target edge> <container edge>"`. It used to say
 * `"bottom-=80 top"`, which asks for the moment the target's *bottom* reaches
 * the viewport's *top* -- that is the element leaving upward, not arriving. So
 * nothing ever entered: every primed element sat at `opacity: 0` for the whole
 * session and the page below the fold rendered as a black rectangle, with no
 * error anywhere to say so. `"top bottom-=80"` is the one that means "the
 * target's top has come 80px inside the bottom of the viewport".
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
    autoplay: onScroll({ enter: "top bottom-=80", repeat: false }),
  });
}

/**
 * A backstop for anything the observer never reaches.
 *
 * Priming an element to `opacity: 0` is a bet that something will later set it
 * back. If that bet loses -- an observer misconfigured, a container that turns
 * out not to be the scroller, a browser that never fires the callback because
 * the tab was backgrounded during layout -- the reader gets an invisible page
 * and no error. This runs once, a beat after mount, and reveals anything still
 * hidden that is already inside the viewport. It costs one pass and removes a
 * whole class of silent failure.
 */
export function revealFallback(selector: string, afterMs = 1200) {
  const id = window.setTimeout(() => {
    for (const el of utils.$(selector) as unknown as HTMLElement[]) {
      const r = el.getBoundingClientRect();
      const onScreen = r.top < window.innerHeight && r.bottom > 0;
      if (onScreen && Number(getComputedStyle(el).opacity) < 0.05) {
        utils.set(el, { opacity: 1, translateY: 0 });
      }
    }
  }, afterMs);
  return () => window.clearTimeout(id);
}

/** Sets the pre-reveal resting state so nothing flashes before the observer fires. */
export function primeReveal(selector: string, y = 26) {
  const targets = utils.$(selector);
  if (!targets.length) return;
  utils.set(targets, { opacity: 0, translateY: y });
}
