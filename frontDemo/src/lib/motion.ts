import { useEffect, useRef, useState } from "react";
import { animate, createScope, utils } from "animejs";
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
 *
 * The setup may return its own cleanup for anything anime does not own -- a
 * DOM observer, a timer -- and it runs before the scope reverts.
 */
export function useAnimeScope(
  setup: (scope?: Scope) => void | (() => void),
  deps: unknown[] = [],
  opts: { backstop?: string; backstopAfter?: number } = {},
) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { backstop, backstopAfter = 1600 } = opts;

  useEffect(() => {
    if (!root.current) return;
    if (reduced) return;

    const el = root.current;
    let teardown: (() => void) | void;
    const scope = createScope({ root: el }).add((s) => {
      teardown = setup(s);
    });

    // Same guarantee as `useAnimeScopeInView`: a setup that hides its targets
    // has to arrange for them to come back even when the timeline does not run.
    const timer = backstop
      ? window.setTimeout(() => settle(el, backstop), backstopAfter)
      : 0;

    return () => {
      if (timer) window.clearTimeout(timer);
      if (typeof teardown === "function") teardown();
      scope.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, backstop, backstopAfter, ...deps]);

  return root;
}

/**
 * The same scope, held until the container reaches the viewport.
 *
 * `useAnimeScope` builds its timeline at mount. That is right for a block whose
 * mount is already gated -- the plates only build once their block nears the
 * viewport, so mount and arrival are near enough the same moment -- and wrong
 * for anything in a section that renders immediately. A timeline that runs four
 * screens below the fold has finished before the reader gets there, and all
 * they see is the finished state, which is the same as having written no
 * animation at all.
 *
 * So: identical contract, two extra conditions. The scope is not created until
 * the root has intersected once, and it is never created at all under reduced
 * motion, in which case whatever the setup would have animated has to already
 * be in its resting state in the markup.
 *
 * The second condition is `backstop`, and it is not optional in spirit. A setup
 * that primes its targets to `opacity: 0` and reveals them from a timeline is
 * betting that the timeline will run, and there is a specific, reproducible way
 * for that bet to lose: **a hidden tab throttles `requestAnimationFrame` to
 * roughly one frame a second**, so a one-second reveal takes the better part of
 * a minute and anything reading the page in the meantime -- a screenshot, a
 * scrape, a reader returning to the tab -- finds blank space where the figure
 * should be. `revealOnScroll` already carries a timed backstop for exactly this
 * reason. Pass a selector and anything under it still invisible after a beat is
 * simply shown.
 */
export function useAnimeScopeInView(
  setup: (scope?: Scope) => void | (() => void),
  deps: unknown[] = [],
  opts: { backstop?: string; backstopAfter?: number } = {},
) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [arrived, setArrived] = useState(false);
  const { backstop, backstopAfter = 1600 } = opts;

  useEffect(() => {
    const el = root.current;
    if (!el || arrived) return;
    // No observer, no gate: run it rather than never running it.
    if (typeof IntersectionObserver === "undefined") {
      setArrived(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setArrived(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -60px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [arrived]);

  useEffect(() => {
    if (!root.current) return;
    if (reduced || !arrived) return;

    const el = root.current;
    let teardown: (() => void) | void;
    const scope = createScope({ root: el }).add((s) => {
      teardown = setup(s);
    });

    const timer = backstop
      ? window.setTimeout(() => settle(el, backstop), backstopAfter)
      : 0;

    return () => {
      if (timer) window.clearTimeout(timer);
      if (typeof teardown === "function") teardown();
      scope.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, arrived, backstop, backstopAfter, ...deps]);

  return root;
}

/**
 * Show anything a timeline primed and never brought back.
 *
 * Only elements that actually lost the bet are touched, so a timeline running
 * normally is never interfered with. Two ways of being hidden are recognised,
 * because anime hides things two ways:
 *
 *  - **transparent**, from a `utils.set({ opacity: 0 })`
 *  - **undrawn**, from `svg.createDrawable`, which leaves a stroked path with a
 *    `stroke-dasharray` whose visible run is effectively zero. That one is not
 *    transparent at all, so an opacity check alone walks straight past it --
 *    which is how a plate can be fully "visible" and completely blank
 */
function settle(root: HTMLElement, selector: string) {
  for (const target of root.querySelectorAll<HTMLElement>(selector)) {
    if (Number(getComputedStyle(target).opacity) < 0.05) {
      utils.set(target, {
        opacity: 1,
        translateX: 0,
        translateY: 0,
        scale: 1,
        scaleY: 1,
      });
    }

    const geo = target as unknown as SVGGeometryElement;
    if (typeof geo.getTotalLength !== "function") continue;
    let total = 0;
    try {
      total = geo.getTotalLength();
    } catch {
      continue;
    }
    if (!total) continue;
    const dash = Number.parseFloat(getComputedStyle(target).strokeDasharray);
    if (Number.isNaN(dash) || dash > total * 0.02) continue;
    // Undrawn. Take the dash off entirely and let the element's own attribute
    // -- which is where a *designed* dash pattern lives -- come back.
    target.style.removeProperty("stroke-dasharray");
    target.style.removeProperty("stroke-dashoffset");
    target.removeAttribute("stroke-dashoffset");
    if (Number.parseFloat(getComputedStyle(target).strokeDasharray) < total * 0.02) {
      target.removeAttribute("stroke-dasharray");
    }
  }
}

/**
 * Scroll reveal, on IntersectionObserver.
 *
 * This used to prime the elements to `opacity: 0` and hand the reveal to
 * anime's own `onScroll()` observer. Inside a `createScope`, that observer
 * resolves its scroll container against the scope root rather than the
 * viewport, so on Signal's investigation -- a scope whose root is the whole
 * article -- `enter` never fired. Every primed block below the fold, starting
 * with the full-bleed radar exhibit, stayed at zero opacity for the entire
 * session: no error, no console warning, just holes in the page where the
 * figures should be.
 *
 * The browser's own observer has no such ambiguity. It watches against the
 * viewport by default, it fires for elements already on screen at
 * registration, and it reports the element that entered, so each one animates
 * on its own arrival instead of the whole set sharing one trigger.
 *
 * Priming happens here rather than in a separate call, so there is no longer a
 * way to hide an element and forget to arrange for it to come back. If the
 * observer is unavailable, nothing is primed and the page renders static.
 */
export function revealOnScroll(
  selector: string,
  opts: { y?: number; delay?: number; duration?: number } = {},
): () => void {
  const { y = 26, delay = 60, duration = 780 } = opts;
  const targets = utils.$(selector) as unknown as HTMLElement[];
  if (!targets.length) return () => {};

  if (typeof IntersectionObserver === "undefined") return () => {};

  utils.set(targets, { opacity: 0, translateY: y });

  // Elements arriving together in one scroll step keep the staggered cadence;
  // the counter resets once the viewport has been still long enough that the
  // next arrival reads as a separate event rather than a continuation.
  let batch = 0;
  let batchAt = 0;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        observer.unobserve(el);
        pending.delete(el);

        const now = performance.now();
        batch = now - batchAt < 120 ? batch + 1 : 0;
        batchAt = now;

        animate(el, {
          opacity: [0, 1],
          translateY: [y, 0],
          duration,
          delay: batch * delay,
          ease: "out(3)",
        });
      }
    },
    { rootMargin: "0px 0px -80px 0px", threshold: 0 },
  );

  for (const el of targets) observer.observe(el);

  /**
   * The elements a fast scroll jumps clean over.
   *
   * An observer reports crossings, not positions. Flick the wheel hard enough
   * -- or land on a deep link, or drag the scrollbar -- and an element goes
   * from below the viewport to above it between two samples without ever
   * intersecting, so no callback is ever delivered and it stays at zero
   * opacity. The reader then scrolls back up to a hole.
   *
   * So: a passive listener, rAF-coalesced, that reveals anything already past.
   * It does no work per frame -- one rect read per still-hidden element, only
   * on frames where the page actually moved -- and it takes itself off the
   * window as soon as every target has been accounted for.
   */
  const pending = new Set(targets);
  let queued = false;

  const sweep = () => {
    queued = false;
    for (const el of pending) {
      if (!el.isConnected) {
        pending.delete(el);
        continue;
      }
      // Past the top of the viewport: it was missed, so show it outright
      // rather than animating something the reader has already gone by.
      if (el.getBoundingClientRect().bottom < 0) {
        pending.delete(el);
        observer.unobserve(el);
        utils.set(el, { opacity: 1, translateY: 0 });
      }
    }
    if (!pending.size) detach();
  };

  const onScrollEvent = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sweep);
  };

  let attached = true;
  const detach = () => {
    if (!attached) return;
    attached = false;
    window.removeEventListener("scroll", onScrollEvent);
  };
  window.addEventListener("scroll", onScrollEvent, { passive: true });

  /**
   * A backstop for anything the observer never reaches.
   *
   * Priming an element to `opacity: 0` is a bet that something will later set
   * it back. If that bet loses -- a browser that never fires the callback
   * because the tab was backgrounded during layout, an element inside a
   * container that clips it out of every root -- the reader gets an invisible
   * page and no error. This runs once, a beat after mount, and reveals
   * anything still hidden that is already inside the viewport.
   */
  const fallback = window.setTimeout(() => {
    for (const el of targets) {
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      const onScreen = r.top < window.innerHeight && r.bottom > 0;
      if (onScreen && Number(getComputedStyle(el).opacity) < 0.05) {
        observer.unobserve(el);
        pending.delete(el);
        utils.set(el, { opacity: 1, translateY: 0 });
      }
    }
  }, 1200);

  return () => {
    window.clearTimeout(fallback);
    detach();
    observer.disconnect();
  };
}
