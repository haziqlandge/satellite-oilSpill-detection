/**
 * A dock: a column of tabs, the fronted panel under them, a resize grip on the
 * inner edge and a collapse control on the outer one.
 *
 * The console's previous rail was a list of links with layer switches under it
 * and no indication that any of it could be moved. Everything here is meant to
 * announce itself: the grip has a visible ridge and a `col-resize` cursor, the
 * collapse control is a labelled button rather than a hover target, and the tab
 * bar says outright, on every tab, that dragging it off or double-clicking it
 * undocks the panel.
 *
 * The tab strip is also the console's only drop target. A floating window
 * dragged over it docks into this rail while the pointer is still down, and
 * moving back off pops it out again -- the gesture lives in `useDockDrag`, and
 * all this file contributes is the mark that says "this strip is a dock's" and
 * the press that may become a tear-off.
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
  DOCK_STRIP_ATTR,
  panelDef,
  type Dock,
  type DockDrag,
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
  drag,
  render,
}: {
  side: DockSide;
  dock: Dock;
  /** The console's drag controller, for the tear-off. See `useDockDrag`. */
  drag: DockDrag;
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
        background: "var(--base-2)",
        /*
          Widening a dock gives its contents more room. It does not enlarge
          them, and there is no longer anything here pretending otherwise.

          This element used to set a `--panel-scale` custom property from a
          `scaleFor(side, size)` and then its own
          `fontSize: calc(1em * var(--panel-scale, 1))`, under a comment
          claiming "every type size in the console family is expressed against
          this". That claim was false when it was written. Every size in the
          console is an absolute bracket -- `text-[10px]`, `text-[9.5px]` -- so
          the body's font-size was inherited by nothing, and the property was
          read in exactly two places, one of which was a floating window that
          is never a descendant of this element and so always took the
          fallback. Measured across 300 / 430 / 760 px, every leaf text node in
          a dock computed to the same size at all three widths.

          It was removed rather than re-documented because it had already
          fooled a verification pass: a handoff recorded "214 -> 383 px gives
          --panel-scale: 1.35, computed font-size: 21.6px" as a *passing* type
          -scale check. Both numbers were true and neither meant what it was
          taken to mean. A mechanism that reads as working to someone looking
          straight at it is worse than no mechanism, and a warning comment
          would have been one more thing to not read.

          Making it real is possible and was not done here: `zoom` on this
          element, which is what the panel reader below the workstation uses
          for exactly this problem (`ISSUES.md` §5). It is not free -- `zoom`
          scales this element's own box, so the rendered width would stop
          matching `size` and the resize grip's arithmetic with it, and
          `getBoundingClientRect` inside the rail would start returning zoomed
          pixels. That is a design decision with a real cost, not a cleanup.
        */
      }}
    >
      <TabBar side={side} dock={dock} drag={drag} ids={ids} active={active} />
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
 * A tab carries four affordances now and has to show all of them: click to
 * front, double-click to tear off into a window, *drag* to tear off into a
 * window that follows the pointer, and a close box. The close box is always
 * drawn rather than revealed on hover -- a control that appears only when the
 * pointer is already on it cannot be discovered by looking.
 *
 * This strip is also the drop target for the reverse gesture: a window dragged
 * over it docks here, live, while the pointer is still down. That is declared
 * by `DOCK_STRIP_ATTR` below rather than inferred from anything about the
 * element, because the console has a third tab strip -- the panel reader's --
 * that must never be a target and is otherwise indistinguishable. See
 * `stripAt` in `useDock` for why an attribute and not geometry.
 *
 * Two things a shut dock gets for free from how this is written. A collapsed
 * rail renders an `EdgeHandle` instead of any of this, so it has no strip and
 * cannot be dropped on; and a dock with no panels left in it renders nothing
 * at all, so it has no strip either. The second is a real hole in the gesture
 * -- empty a dock completely and there is no way to drag anything back into it
 * -- and it is deliberately not patched here, because the only patch is to
 * make an empty strip appear during a drag, which is a drop indicator, which
 * the specification rules out. The four other routes home are unaffected.
 */
function TabBar({
  side,
  dock,
  drag,
  ids,
  active,
}: {
  side: DockSide;
  dock: Dock;
  drag: DockDrag;
  ids: PanelId[];
  active: PanelId | null;
}) {
  return (
    <div
      className="flex shrink-0 flex-wrap items-stretch border-b"
      style={{ borderColor: "var(--line)", background: "var(--base-3)" }}
      role="tablist"
      aria-label={`${side} dock`}
      {...{ [DOCK_STRIP_ATTR]: side }}
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
              onPointerDown={(e) => drag.startTab(e, id, side)}
              onClick={() => dock.setActive(side, id)}
              onDoubleClick={() => dock.float(id)}
              title={`${def.title} — drag off to undock into a window, or double-click`}
              className="flex cursor-pointer items-baseline gap-1.5 py-[5px] pr-1 pl-2 text-[10px] tracking-[0.14em] whitespace-nowrap uppercase transition-colors"
              style={{
                color: on ? "var(--ink)" : "var(--ink-faint)",
                /*
                  Vertical panning still starts here, so the page under the
                  workstation can be scrolled from a tab on a touch screen;
                  horizontal movement comes to the tear-off instead of being
                  eaten by a scroll that ends the pointer stream. Docks are
                  desktop-only today, so this is insurance rather than a
                  behaviour anyone will meet -- but it is the correct
                  declaration for a control that is also a drag handle.
                */
                touchAction: "pan-y",
              }}
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
