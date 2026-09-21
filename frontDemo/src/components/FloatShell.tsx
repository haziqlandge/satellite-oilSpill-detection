/**
 * A floating window, without an opinion about what is in it or who owns it.
 *
 * Drag by the title bar, resize from the bottom-right corner, close from the
 * box. The chrome is deliberately flat -- one hard border in the surface's
 * accent, no radius, no blur -- because a drop shadow and rounded corners make
 * an operating system's window rather than this product's.
 *
 * This was the console's `FloatWindow` whole. It was split out when the home
 * page needed the same window for its colour panel: the console's version is
 * typed against `PanelId` and the dock's `Layout`, neither of which the home
 * page has. What is left here is the pointer mechanics and the chrome; the
 * dock-specific behaviour -- double-click to re-dock, `Escape` to re-dock,
 * raise on pointerdown -- stays in the console's adapter.
 *
 * Move and resize both write straight to the element inside a rAF and commit to
 * React only on pointer-up. The window can hold a live map or a forty-row
 * table, and re-rendering that a hundred times a second while it moves is how a
 * window manager starts dropping frames the moment anyone uses it.
 */

import { useCallback, useRef, type ReactNode } from "react";

export interface FloatShellProps {
  title: string;
  /** The small index glyph before the title. The console uses panel numbers. */
  index?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
  minW?: number;
  minH?: number;
  onMove: (x: number, y: number) => void;
  onSize: (w: number, h: number) => void;
  onClose?: () => void;
  /** Renders a `dock` button in the title bar when given. */
  onDock?: () => void;
  onTitleDoubleClick?: () => void;
  onPointerDownCapture?: () => void;
  /**
   * Take the title-bar drag over entirely.
   *
   * Given, this is called on a press of the title bar and the window's own
   * move handling does not run at all -- no listeners, no frame, no `onMove`.
   * It is not a notification alongside the built-in drag; it is a replacement
   * for it, and a caller that supplies it owns the whole gesture including
   * writing the final position back.
   *
   * The console needs that because its drag does something this component
   * cannot be told about: crossing a dock's tab strip *docks the panel while
   * the pointer is still down*, which unmounts this very component. A move
   * handler living here would stop existing halfway through its own gesture.
   * The home page's colour panel supplies neither this nor `onElement` and
   * keeps the self-contained drag below, which is the whole point of the two
   * being optional.
   */
  onDragTitle?: (e: React.PointerEvent) => void;
  /**
   * Handed the window's outermost element on mount and `null` on unmount.
   *
   * The escape hatch an owner needs to position the window imperatively, which
   * is the only way to move a window holding a live map without re-rendering
   * it on every frame -- see the note at the top of this file.
   *
   * **Must be stable across renders.** It is used as a callback ref, so a
   * fresh identity each render makes React detach and re-attach the element
   * every time, and an owner that treats those calls as mount and unmount
   * will see a stream of them.
   */
  onElement?: (el: HTMLElement | null) => void;
  children: ReactNode;
}

export function FloatShell({
  title,
  index,
  x,
  y,
  w,
  h,
  z = 40,
  minW = 260,
  minH = 150,
  onMove,
  onSize,
  onClose,
  onDock,
  onTitleDoubleClick,
  onPointerDownCapture,
  onDragTitle,
  onElement,
  children,
}: FloatShellProps) {
  const box = useRef<HTMLElement | null>(null);

  /**
   * One element, two readers: this component's own pointer handlers, and
   * whoever passed `onElement`. A callback ref rather than two refs on one
   * node, because the owner needs to know *when* the element appears -- a
   * console window that has just come back off a tab strip is a fresh element
   * that has to be found again mid-gesture, and only a ref call says so.
   */
  const attachBox = useCallback(
    (el: HTMLElement | null) => {
      box.current = el;
      onElement?.(el);
    },
    [onElement],
  );

  /* --- focus -------------------------------------------------------- */

  /**
   * Touching the window puts focus in it.
   *
   * The window's owner is allowed to scope a keyboard rule to "the window you
   * are in" -- the console scopes `Escape` that way, so that pressing it with
   * three windows open sends one home rather than all three. That test can
   * only be written against `document.activeElement`, and until this handler
   * existed there was no gesture that ever put `activeElement` inside a
   * window:
   *
   *  - the `<section>` was not focusable, so a click on the title bar or on
   *    any of the panel's own prose left focus on `<body>`;
   *  - both pointer handlers below call `preventDefault()`, which suppresses
   *    the compatibility `mousedown` and with it the focus that a click
   *    normally performs -- so even the resize corner, which *is* a `button`,
   *    did not take focus when it was grabbed;
   *  - a panel floated by double-clicking its dock tab is worse than neutral:
   *    the tab that had focus is unmounted by the very click that floats the
   *    panel, so `activeElement` falls back to `<body>`.
   *
   * The result was a documented shortcut that could be reached only by tabbing
   * into the window from the keyboard. `tabIndex={-1}` makes the window a
   * focus target without putting it in the tab order, and this runs in the
   * **capture** phase so that the resize corner's `stopPropagation()` cannot
   * skip it.
   *
   * The guard matters: focus is only taken when it is not already inside the
   * window, so clicking from one control in the panel to another does not pull
   * focus off the thing being clicked.
   */
  const onShellPointerDown = useCallback(() => {
    onPointerDownCapture?.();
    const el = box.current;
    if (el && !el.contains(document.activeElement)) {
      el.focus({ preventScroll: true });
    }
  }, [onPointerDownCapture]);

  /* --- move --------------------------------------------------------- */

  const onTitlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const el = box.current;
      if (!el) return;
      // Let the close and dock buttons in the bar do their own job.
      if ((e.target as HTMLElement).closest("button")) return;

      // Handed over whole, not shared. See `onDragTitle`.
      if (onDragTitle) {
        onDragTitle(e);
        return;
      }

      e.preventDefault();
      onPointerDownCapture?.();

      const startX = e.clientX;
      const startY = e.clientY;
      let nx = x;
      let ny = y;
      let frame = 0;

      const paint = () => {
        frame = 0;
        el.style.left = `${nx}px`;
        el.style.top = `${ny}px`;
      };

      const move = (ev: PointerEvent) => {
        // Clamped as it moves, not after: a window dragged past the edge and
        // released there would be unreachable, and the title bar is the only
        // handle it has.
        nx = Math.max(
          0,
          Math.min(window.innerWidth - 140, x + (ev.clientX - startX)),
        );
        ny = Math.max(
          0,
          Math.min(window.innerHeight - 70, y + (ev.clientY - startY)),
        );
        if (!frame) frame = requestAnimationFrame(paint);
      };

      const up = () => {
        if (frame) cancelAnimationFrame(frame);
        onMove(nx, ny);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.userSelect = "";
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      document.body.style.userSelect = "none";
    },
    [x, y, onMove, onPointerDownCapture, onDragTitle],
  );

  /* --- resize ------------------------------------------------------- */

  const onCornerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = box.current;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      onPointerDownCapture?.();

      const startX = e.clientX;
      const startY = e.clientY;
      let nw = w;
      let nh = h;
      let frame = 0;

      const paint = () => {
        frame = 0;
        el.style.width = `${nw}px`;
        el.style.height = `${nh}px`;
      };

      const move = (ev: PointerEvent) => {
        nw = Math.max(minW, w + (ev.clientX - startX));
        nh = Math.max(minH, h + (ev.clientY - startY));
        if (!frame) frame = requestAnimationFrame(paint);
      };

      const up = () => {
        if (frame) cancelAnimationFrame(frame);
        onSize(nw, nh);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      document.body.style.cursor = "nwse-resize";
      document.body.style.userSelect = "none";
    },
    [w, h, minW, minH, onSize, onPointerDownCapture],
  );

  return (
    <section
      ref={attachBox}
      role="dialog"
      aria-label={`${title} window`}
      /* Focusable by script, never by Tab -- see `onShellPointerDown`. The
         JSX prop is React's capture phase; the identically named *callback*
         in `FloatShellProps` is the owner's "this window was touched" hook,
         which is what `raise` hangs off. */
      tabIndex={-1}
      onPointerDownCapture={onShellPointerDown}
      className="fixed flex flex-col border"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        zIndex: z,
        borderColor: "var(--accent)",
        background: "var(--base-2)",
        // No focus ring on the window itself. It is only ever focused by the
        // pointer handler above and is not in the tab order, so there is no
        // keyboard state for a ring to report; the controls inside it keep
        // their own.
        outline: "none",
        // A window is lifted off the surface by one hairline of its own accent
        // and a flat wash, not by a blur.
        boxShadow: "0 0 0 3px color-mix(in oklab, var(--base) 74%, transparent)",
      }}
    >
      <header
        onPointerDown={onTitlePointerDown}
        onDoubleClick={onTitleDoubleClick}
        title={
          onTitleDoubleClick
            ? "Drag to move. Double-click to send back to its dock."
            : "Drag to move."
        }
        className="flex shrink-0 cursor-move items-center gap-2 border-b px-2 py-[5px]"
        style={{
          borderColor: "var(--line)",
          background: "color-mix(in oklab, var(--accent) 14%, var(--base-3))",
          /*
            The title bar is a drag handle, so the browser must not read a
            press on it as the start of a scroll. Without this a touch drag
            pans the page and the pointer stream ends in `pointercancel`
            partway through -- which the console's drag now handles, but
            handling it is not the same as the gesture working. The page below
            the workstation still scrolls everywhere else.
          */
          touchAction: "none",
        }}
      >
        {index && (
          <span className="num text-[9px]" style={{ color: "var(--accent)" }}>
            {index}
          </span>
        )}
        <h2
          className="text-[10px] tracking-[0.24em] uppercase"
          style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}
        >
          {title}
        </h2>
        <span className="flex-1" />
        {onDock && (
          <button
            type="button"
            onClick={onDock}
            title="Send back to its dock"
            aria-label={`Dock ${title}`}
            className="cursor-pointer border px-1 text-[9px] tracking-[0.14em] uppercase transition-colors"
            style={{ borderColor: "var(--line)", color: "var(--ink-dim)" }}
          >
            dock
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label={`Close ${title}`}
            className="cursor-pointer px-1 text-[12px] leading-none transition-colors hover:text-[var(--alarm)]"
            style={{ color: "var(--ink-faint)" }}
          >
            &times;
          </button>
        )}
      </header>

      {/*
        No font-size here. This carried
        `fontSize: "calc(1em * var(--panel-scale, 1))"`, copied from the
        console's dock body so that a panel torn into a window would keep
        whatever type scale its rail had.

        It could not have done that, and not merely because the console's type
        does not scale. `--panel-scale` was only ever set on a `DockRail`'s body
        element, and a floating window is *never a descendant of one* -- the
        console renders its windows at the root of `ConsoleShell`, and the home
        page renders this one at the root of `SiteShell`. Custom properties
        inherit down the DOM, not through whatever the window happens to be
        drawn on top of, so the `var()` took its fallback of 1 in every
        instance that has ever existed and the declaration read
        `font-size: calc(1em * 1)` -- which is to say, `font-size: 1em`, which
        is to say, nothing.
      */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>

      {/* Resize corner. Two rules rather than an icon font. */}
      <button
        type="button"
        onPointerDown={onCornerPointerDown}
        aria-label={`Resize ${title}`}
        title="Drag to resize"
        className="absolute right-0 bottom-0 h-4 w-4 cursor-nwse-resize"
        style={{ background: "transparent" }}
      >
        <span
          aria-hidden
          className="absolute right-[3px] bottom-[3px] block h-[7px] w-[7px]"
          style={{
            borderRight: "1px solid var(--accent)",
            borderBottom: "1px solid var(--accent)",
          }}
        />
      </button>
    </section>
  );
}
