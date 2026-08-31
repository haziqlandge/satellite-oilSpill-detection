/**
 * The demo control that swaps between the four directions.
 *
 * Deliberately not part of any of them. It uses none of the design tokens, has
 * its own fixed neutral chrome, and says on its face that it is a demo control,
 * because the moment it starts to look like site furniture it becomes a fifth
 * design decision that all four have to accommodate. Four independent products
 * cannot share a navigation element.
 *
 * Behaviour: it tucks itself against the right edge after a short idle, and
 * hover, focus or a press *on the rail itself* brings it back. Escape tucks it
 * deliberately.
 *
 * It used to wake on a `pointerdown` anywhere in the document, which made a
 * demo control that is not part of any of the four directions answer every
 * click meant for one of them -- selecting a candidate on the map, opening a
 * case, scrubbing the timeline. The rail is also `pointer-events: none` at the
 * wrapper and `auto` only on the panel, so once tucked its old footprint stops
 * swallowing presses aimed at the page underneath.
 *
 * The tuck is a CSS transition rather than a JS tween. It is a two-state toggle
 * the user can interrupt at any moment, and a CSS transition retargets from the
 * current computed value for free; a tween leaves the transform stranded part
 * way whenever the state flips mid flight.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DESIGNS, type DesignKey } from "../design";

const IDLE_MS = 2600;
/** Sliver left showing when tucked, so the rail stays grabbable. */
const TAB_PEEK = 22;
const SQUASH = 0.7;

export function DesignSwitcher({
  active,
  onSelect,
}: {
  active: DesignKey;
  onSelect: (key: DesignKey) => void;
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (idleTimer.current) window.clearTimeout(idleTimer.current);
        setTucked(true);
      }
    };

    document.addEventListener("keydown", onKey);
    scheduleTuck();

    return () => {
      document.removeEventListener("keydown", onKey);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [scheduleTuck]);

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
    <div className="pointer-events-none fixed top-1/2 right-0 z-[70] -translate-y-1/2">
      <div
        ref={railRef}
        onMouseEnter={wake}
        onPointerDown={wake}
        onFocusCapture={wake}
        className="pointer-events-auto will-change-transform motion-safe:transition-[transform,opacity] motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          transformOrigin: "right center",
          transform: tucked
            ? `translateX(${Math.max(0, railWidth * SQUASH - TAB_PEEK)}px) scaleX(${SQUASH})`
            : "translateX(0px) scaleX(1)",
          opacity: tucked ? 0.5 : 1,
        }}
      >
        <div
          className="flex flex-col overflow-hidden border-y border-l backdrop-blur-md"
          style={{
            borderColor: "rgb(255 255 255 / 0.14)",
            background: "rgb(14 15 17 / 0.9)",
            borderTopLeftRadius: 10,
            borderBottomLeftRadius: 10,
            boxShadow: "0 12px 40px rgb(0 0 0 / 0.4)",
          }}
        >
          <p
            className="px-3 pt-2.5 pb-2 font-mono text-[9px] tracking-[0.2em] uppercase"
            style={{ color: "rgb(255 255 255 / 0.38)" }}
          >
            Design direction
          </p>

          {DESIGNS.map((d) => {
            const isActive = d.key === active;
            return (
              <button
                key={d.key}
                type="button"
                onFocus={wake}
                onClick={() => {
                  onSelect(d.key);
                  wake();
                }}
                aria-current={isActive ? "true" : undefined}
                title={`${d.name}. ${d.discipline}`}
                className="group flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                style={{
                  background: isActive ? "rgb(255 255 255 / 0.1)" : "transparent",
                  color: isActive ? "#fff" : "rgb(255 255 255 / 0.55)",
                }}
              >
                <span
                  aria-hidden
                  className="h-5 w-[2px] shrink-0"
                  style={{ background: isActive ? d.accent : "transparent" }}
                />
                <span className="font-mono text-[10px] tabular-nums opacity-50">
                  {d.index}
                </span>
                <span className="font-mono text-[11px] tracking-[0.12em] uppercase">
                  {d.name}
                </span>
              </button>
            );
          })}

          <p
            className="px-3 pt-2 pb-2.5 font-mono text-[9px] leading-relaxed"
            style={{ color: "rgb(255 255 255 / 0.28)" }}
          >
            Demo control. Not site navigation.
          </p>
        </div>
      </div>
    </div>
  );
}
