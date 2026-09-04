/**
 * A dock: a column of tabs, the fronted panel under them, a resize grip on the
 * inner edge and a collapse control on the outer one.
 *
 * The console's previous rail was a list of links with layer switches under it
 * and no indication that any of it could be moved. Everything here is meant to
 * announce itself: the grip has a visible ridge and a `col-resize` cursor, the
 * collapse control is a labelled button rather than a hover target, and the tab
 * bar says outright that a double-click undocks.
 *
 * The resize is the one piece of this file with a performance constraint. A
 * pointer dragging across the console fires well over a hundred events a
 * second, and the fronted panel can be a forty-row contact table; routing the
 * width through `setState` re-renders that table on every one of them. So the
 * drag writes the width straight onto the element inside a rAF and only commits
 * to React state on pointer-up, which is also the only moment the layout needs
 * to persist. The resting width is rendered rather than written by an effect --
 * see the note on the body element for the bug that taught us the difference.
 */

import { useCallback, useRef, type ReactNode } from "react";
import {
  DOCK_LIMITS,
  panelDef,
  scaleFor,
  type Dock,
  type DockSide,
  type PanelId,
} from "./useDock";

/**
 * How far past its minimum a dock has to be dragged before it shuts.
 *
 * A fraction of the minimum rather than a pixel count, so the overshoot scales
 * with the dock: the left rail's floor is 150px and the right's is 300, and a
 * fixed 60px of travel would feel like a cliff on one and a nudge on the other.
 */
const SHUT_AT = 0.62;

/** The width of the strip left behind when a dock is shut. */
const HANDLE = 10;

export function DockRail({
  side,
  dock,
  render,
}: {
  side: DockSide;
  dock: Dock;
  render: (id: PanelId) => ReactNode;
}) {
  const ids = dock.panelsIn(side);
  const active = dock.active[side];
  const collapsed = dock.collapsed[side];
  const size = dock.sizes[side];

  const host = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  /* --- resize ------------------------------------------------------- */

  const onGrip = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const el = host.current;
      if (!el) return;

      dragging.current = true;
      const [lo, hi] = DOCK_LIMITS[side];
      const startX = e.clientX;
      const startW = size;
      let frame = 0;
      let next = startW;
      let shut = false;

      // Written straight onto the element during the drag. React re-renders
      // with the committed value on pointer-up and takes the property back.
      const paint = () => {
        frame = 0;
        el.style.width = shut ? "0px" : `${next}px`;
        el.style.opacity = shut ? "0" : "1";
        el.style.setProperty("--panel-scale", String(scaleFor(side, next)));
      };

      const onMove = (ev: PointerEvent) => {
        // The left dock grows rightward and the right dock grows leftward, so
        // the delta is signed by which edge the grip is on.
        const delta = side === "left" ? ev.clientX - startX : startX - ev.clientX;
        const raw = startW + delta;
        // Dragged well past the minimum, the dock shuts rather than sticking at
        // its floor. The threshold is on the *unclamped* pointer position, so
        // there is a deliberate overshoot between "as narrow as it goes" and
        // "gone" -- a rail that vanished the instant it hit its minimum would
        // make the minimum unusable.
        shut = raw < lo * SHUT_AT;
        next = Math.max(lo, Math.min(hi, raw));
        if (!frame) frame = requestAnimationFrame(paint);
      };

      const onUp = () => {
        dragging.current = false;
        if (frame) cancelAnimationFrame(frame);
        // React finds out once, at the end. This is also the only point the
        // layout needs to be written to storage.
        el.style.opacity = "";
        if (shut) {
          // The width is kept, not zeroed: it is what the dock comes back at.
          dock.setCollapsed(side, true);
        } else {
          dock.setSize(side, next);
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      // Held on the body for the duration: without it the cursor flickers back
      // to a text caret every time the pointer leaves the 5px grip mid-drag.
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [dock, side, size],
  );

  const nudge = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 48 : 16;
      const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
      const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
      if (e.key === grow) {
        e.preventDefault();
        dock.setSize(side, size + step);
      } else if (e.key === shrink) {
        e.preventDefault();
        dock.setSize(side, size - step);
      }
    },
    [dock, side, size],
  );

  if (!ids.length) return null;

  const grip = (
    <div
      role="separator"
      aria-label={`Resize the ${side} dock`}
      aria-orientation="vertical"
      aria-valuenow={size}
      aria-valuemin={DOCK_LIMITS[side][0]}
      aria-valuemax={DOCK_LIMITS[side][1]}
      tabIndex={0}
      onPointerDown={onGrip}
      onKeyDown={nudge}
      onDoubleClick={() => dock.setSize(side, side === "left" ? 214 : 430)}
      title="Drag to resize. Double-click to reset. Arrow keys nudge."
      className="group relative w-[6px] shrink-0 cursor-col-resize"
      style={{ background: "var(--base-2)" }}
    >
      <span
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2"
        style={{ background: "var(--line)" }}
      />
      {/* The ridge. Three dashes at mid-height, brightening on hover and
          focus, because a drag target with no mark on it is a drag target
          nobody finds. */}
      <span
        className="absolute top-1/2 left-1/2 flex h-8 w-[6px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-[3px] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ opacity: 0.55 }}
        aria-hidden
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block h-px w-[4px]"
            style={{ background: "var(--accent)" }}
          />
        ))}
      </span>
    </div>
  );

  const collapseBtn = (
    <button
      type="button"
      onClick={() => dock.setCollapsed(side, true)}
      aria-expanded
      title={`Close the ${side} dock. Dragging the grip past its minimum does the same.`}
      className="flex w-[18px] shrink-0 cursor-pointer flex-col items-center justify-center gap-2 border-x transition-colors"
      style={{
        borderColor: "var(--line)",
        background: "var(--base-2)",
        color: "var(--ink-dim)",
      }}
    >
      <span className="text-[10px] leading-none" aria-hidden>
        {side === "left" ? "‹" : "›"}
      </span>
      <span
        className="text-[9px] tracking-[0.24em] whitespace-nowrap uppercase"
        style={{ writingMode: "vertical-rl", color: "var(--ink-faint)" }}
      >
        hide
      </span>
    </button>
  );

  if (collapsed) {
    return (
      <EdgeHandle
        side={side}
        ids={ids}
        onOpen={() => dock.setCollapsed(side, false)}
        onOpenAt={(px) => {
          dock.setSize(side, px);
          dock.setCollapsed(side, false);
        }}
      />
    );
  }

  const body = (
    <div
      ref={host}
      className="flex min-h-0 shrink-0 flex-col"
      style={{
        /*
          The width is rendered, not written by an effect.

          It used to be a CSS custom property set from a `useEffect` keyed on
          `[size, side]`. That worked until every panel in a dock was closed:
          the rail unmounts, and when a panel is reopened it mounts a fresh
          element whose deps have not changed, so the effect never re-runs, the
          property is never set, `width: var(--dock-w)` resolves to `auto`, and
          the reopened panel takes the whole viewport. Rendering the value means
          there is no frame in which it is undefined.
        */
        width: size,
        "--panel-scale": scaleFor(side, size),
        background: "var(--base-2)",
        // Every type size in the console family is expressed against this, so
        // widening a dock genuinely enlarges its contents rather than just
        // giving them more room to be small in.
        fontSize: "calc(1em * var(--panel-scale, 1))",
      } as React.CSSProperties}
    >
      <TabBar side={side} dock={dock} ids={ids} active={active} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {active ? render(active) : null}
      </div>
    </div>
  );

  return side === "left" ? (
    <>
      {collapseBtn}
      {body}
      {grip}
    </>
  ) : (
    <>
      {grip}
      {body}
      {collapseBtn}
    </>
  );
}

/**
 * What a shut dock leaves behind.
 *
 * A ten-pixel strip on the outer edge of the workspace, and it has to answer
 * two different gestures because a dock that shut under a drag should come back
 * under one:
 *
 *  - **click** and it reopens at whatever width it had when it was shut
 *  - **drag inward** and it reopens at the width you drag to, live, so the
 *    gesture that closed it is exactly reversible
 *
 * It replaces the eighteen-pixel collapse strip that used to carry the panel
 * names written vertically. That strip was a reasonable control and a poor
 * *edge*: eighteen pixels of bordered chrome with type in it reads as a very
 * narrow panel rather than as the absence of one, which rather defeats closing
 * the dock. This is a rule and a grip, and it says what it is on hover.
 */
function EdgeHandle({
  side,
  ids,
  onOpen,
  onOpenAt,
}: {
  side: DockSide;
  ids: PanelId[];
  onOpen: () => void;
  onOpenAt: (px: number) => void;
}) {
  const dragged = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const [lo, hi] = DOCK_LIMITS[side];
      const startX = e.clientX;
      let width = 0;
      dragged.current = false;

      const move = (ev: PointerEvent) => {
        const delta = side === "left" ? ev.clientX - startX : startX - ev.clientX;
        // A few pixels of slop before this counts as a drag, so a slightly
        // shaky click still reads as a click.
        if (Math.abs(delta) > 4) dragged.current = true;
        width = Math.max(lo, Math.min(hi, delta));
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        if (dragged.current) onOpenAt(width);
        else onOpen();
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [side, onOpen, onOpenAt],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open the ${side} dock: ${ids.map((i) => panelDef(i).title).join(", ")}`}
      title={`${ids.map((i) => panelDef(i).title).join(" · ")}\nClick to open, or drag inward to set the width.`}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group relative shrink-0 cursor-col-resize"
      style={{
        width: HANDLE,
        background: "var(--base-2)",
        borderInlineStart: side === "right" ? "1px solid var(--line)" : undefined,
        borderInlineEnd: side === "left" ? "1px solid var(--line)" : undefined,
      }}
    >
      {/* Three dashes at mid-height, the same mark the resize grip carries, so
          the two read as the same mechanism in two states. */}
      <span
        aria-hidden
        className="absolute top-1/2 left-1/2 flex h-10 w-[6px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-[3px] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ opacity: 0.4 }}
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="block h-px w-[5px]"
            style={{ background: "var(--accent)" }}
          />
        ))}
      </span>
    </div>
  );
}

/**
 * The tabs.
 *
 * A tab carries three affordances and has to show all of them: click to front,
 * double-click to tear off into a window, and a close box. The close box is
 * always drawn rather than revealed on hover -- a control that appears only
 * when the pointer is already on it cannot be discovered by looking.
 */
function TabBar({
  side,
  dock,
  ids,
  active,
}: {
  side: DockSide;
  dock: Dock;
  ids: PanelId[];
  active: PanelId | null;
}) {
  return (
    <div
      className="flex shrink-0 flex-wrap items-stretch border-b"
      style={{ borderColor: "var(--line)", background: "var(--base-3)" }}
      role="tablist"
      aria-label={`${side} dock`}
    >
      {ids.map((id) => {
        const def = panelDef(id);
        const on = id === active;
        return (
          <div
            key={id}
            className="flex items-stretch"
            style={{
              background: on
                ? "color-mix(in oklab, var(--accent) 12%, transparent)"
                : "transparent",
              boxShadow: on ? "inset 0 -2px 0 var(--accent)" : undefined,
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => dock.setActive(side, id)}
              onDoubleClick={() => dock.float(id)}
              title={`${def.title} — double-click to undock into a window`}
              className="flex cursor-pointer items-baseline gap-1.5 py-[5px] pr-1 pl-2 text-[10px] tracking-[0.14em] whitespace-nowrap uppercase transition-colors"
              style={{ color: on ? "var(--ink)" : "var(--ink-faint)" }}
            >
              <span
                className="num text-[9px]"
                style={{ color: on ? "var(--accent)" : "var(--ink-faint)" }}
              >
                {def.index}
              </span>
              {def.title}
            </button>
            <button
              type="button"
              onClick={() => dock.close(id)}
              title={`Close ${def.title}. Reopen it from the panels menu.`}
              aria-label={`Close ${def.title}`}
              className="cursor-pointer px-1.5 text-[11px] leading-none transition-colors hover:text-[var(--alarm)]"
              style={{ color: "var(--ink-faint)" }}
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
}
