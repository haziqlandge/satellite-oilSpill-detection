import { useCallback, useEffect, useRef, useState } from "react";
import type { LayoutKey } from "../layouts/registry";
import { LAYOUTS } from "../layouts/registry";

const IDLE_MS = 2600;
/** Sliver left showing when tucked, so the rail stays grabbable. */
const TAB_PEEK = 18;
/** How far the rail compresses on the x axis when tucked. */
const SQUASH = 0.72;

/**
 * Sticky layout switcher.
 *
 * Resting state is tucked: the rail compresses against the right edge leaving
 * a grab tab, so it never competes with the page. Any click anywhere brings it
 * back, as does hover, focus, or a keyboard user tabbing into it. It re-tucks
 * after a short idle.
 *
 * Accessibility notes:
 *  - tucked is a visual state only. Buttons stay in the tab order and focus
 *    untucks the rail, so a keyboard user never chases a moving target.
 *  - Escape tucks it deliberately.
 *  - Under reduced motion the transform snaps instead of animating; the rail
 *    still tucks, because the point is to stay out of the way, not to move.
 *
 * The tuck is a CSS transition rather than an anime tween. It is a two-state
 * toggle that a user can interrupt at any moment, and CSS transitions retarget
 * from the current computed value for free; driving it with a JS tween left
 * animations stranded part-way whenever the state flipped mid-flight.
 */
export function LayoutSwitcher({
  active,
  onSelect,
}: {
  active: LayoutKey;
  onSelect: (key: LayoutKey) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<number | null>(null);
  const [tucked, setTucked] = useState(false);
  const [railWidth, setRailWidth] = useState(0);

  const scheduleTuck = useCallback(() => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setTucked(true), IDLE_MS);
  }, []);

  const wake = useCallback(() => {
    setTucked(false);
    scheduleTuck();
  }, [scheduleTuck]);

  // Any click anywhere on the page brings the rail back. pointerdown rather
  // than click so it responds on touch without waiting for the tap to resolve.
  useEffect(() => {
    const onPointerDown = () => wake();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (idleTimer.current) window.clearTimeout(idleTimer.current);
        setTucked(true);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    scheduleTuck();

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [wake, scheduleTuck]);

  // Rail width drives the tuck offset, so it is measured rather than assumed,
  // and re-measured when the viewport changes.
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const measure = () => setRailWidth(el.offsetWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className="fixed top-1/2 right-0 z-50 -translate-y-1/2"
      onMouseEnter={wake}
      onFocusCapture={wake}
    >
      <div
        ref={railRef}
        className="will-change-transform motion-safe:transition-[transform,opacity] motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          transformOrigin: "right center",
          // Offset accounts for the squash: scaling toward the right origin
          // already pulls the left edge in, so translating by the full width
          // would carry the peek off-screen with it.
          transform: tucked
            ? `translateX(${Math.max(0, railWidth * SQUASH - TAB_PEEK)}px) scaleX(${SQUASH})`
            : "translateX(0px) scaleX(1)",
          opacity: tucked ? 0.55 : 1,
        }}
      >
        <div
          className="flex flex-col gap-px border-y border-l p-px backdrop-blur-md"
          style={{
            borderColor: "var(--line)",
            background: "color-mix(in oklab, var(--base-2) 82%, transparent)",
            borderTopLeftRadius: "10px",
            borderBottomLeftRadius: "10px",
          }}
        >
          {/* Grab tab: the sliver that stays visible when tucked. */}
          <div
            aria-hidden
            className="mx-auto my-1.5 h-8 w-[3px] rounded-full"
            style={{ background: "var(--ink-faint)" }}
          />

          {LAYOUTS.map((l, i) => {
            const isActive = l.key === active;
            return (
              <button
                key={l.key}
                type="button"
                onClick={() => {
                  onSelect(l.key);
                  wake();
                }}
                aria-current={isActive ? "true" : undefined}
                title={`${l.name} - ${l.blurb}`}
                className="group relative flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
                style={{
                  background: isActive ? "var(--accent)" : "transparent",
                  color: isActive ? "var(--accent-ink)" : "var(--ink-dim)",
                }}
              >
                <span
                  className="font-mono text-[10px] tabular-nums"
                  style={{ opacity: isActive ? 0.75 : 0.5 }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-mono text-[11px] tracking-[0.14em] uppercase">
                  {l.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
