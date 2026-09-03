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
  children,
}: FloatShellProps) {
  const box = useRef<HTMLDivElement>(null);

  /* --- move --------------------------------------------------------- */

  const onTitlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const el = box.current;
      if (!el) return;
      // Let the close and dock buttons in the bar do their own job.
      if ((e.target as HTMLElement).closest("button")) return;

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
    [x, y, onMove, onPointerDownCapture],
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
      ref={box}
      role="dialog"
      aria-label={`${title} window`}
      onPointerDown={() => onPointerDownCapture?.()}
      className="fixed flex flex-col border"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        zIndex: z,
        borderColor: "var(--accent)",
        background: "var(--base-2)",
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

      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{ fontSize: "calc(1em * var(--panel-scale, 1))" }}
      >
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
