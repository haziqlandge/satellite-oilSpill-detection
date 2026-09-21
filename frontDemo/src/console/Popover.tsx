/**
 * A menu that hangs off a button and is not at the mercy of the layout.
 *
 * Both of the console's header menus -- the spill key and the panels menu --
 * were originally absolutely positioned inside the header. Both of them opened
 * correctly, set their state correctly, and rendered as a few-pixel green
 * sliver. Two separate ancestors were to blame at once:
 *
 *  - the header carried `overflow-x: auto` so its content could scroll on a
 *    narrow console, and an absolutely positioned child of an `overflow: auto`
 *    ancestor is clipped to it
 *  - even unclipped, a positioned child sits inside whatever stacking context
 *    its ancestors establish, so a `z-50` on the menu is only `z-50` *within
 *    the header*, and the workspace below could still paint over it
 *
 * Raising the z-index alone fixes neither reliably: the number is meaningless
 * across stacking contexts, and no z-index escapes an `overflow` clip. The
 * durable answer is to stop being a descendant. This renders into
 * `document.body` through a portal, positions itself from the trigger's
 * measured rect, and sits above everything the console draws.
 *
 * **Which is why the panel has to carry the surface with it.** Escaping the
 * clip means escaping `<div data-surface="console">` as well: the portal is a
 * sibling of `#root`, not a descendant, so it inherits the token ladder from
 * `:root` instead of the console's. That ladder is the generic fallback at the
 * top of `index.css`, and the difference is not subtle -- `--accent` there is
 * the home page's *orange*, so a menu hanging off a green console drew itself
 * with an orange border and orange checkmarks. Worse, `--warn`, `--alarm`,
 * `--group` and `--group-ink` are declared only under the two `[data-surface]`
 * blocks and not at `:root` at all, so `background: var(--group)` on the menu's
 * group band was invalid at computed-value time and resolved to nothing.
 *
 * The same break is what `§4.7` is about from the other end: token overrides
 * from the colour panel are inline custom properties on the surface root, and
 * an element that is not inside it cannot see them. Moving `--accent` recoloured
 * the whole console *except* its two menus.
 *
 * So the portal root repeats what `App.tsx`'s `SurfaceRoot` does -- the surface
 * attribute, then the overrides last so they win. It is a second surface root,
 * deliberately, and it has to stay in step with the first one.
 *
 * It stays open until the viewer dismisses it -- an outside press, `Escape`, or
 * the trigger again. Acting on a row never closes it, because opening four
 * panels should be four clicks rather than four round trips through the button.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { tokenStyle, usePalette } from "../lib/palette";
import { SURFACES } from "../theme";

/** Above the float windows (40+z) and above the scanline layer (60). */
export const POPOVER_Z = 200;

export interface PopoverAnchor {
  open: boolean;
  toggle: () => void;
  close: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** Spread onto the trigger button. */
  triggerProps: {
    ref: RefObject<HTMLButtonElement | null>;
    onClick: () => void;
    "aria-expanded": boolean;
    "aria-haspopup": "true";
  };
}

export function usePopover(): PopoverAnchor {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  return {
    open,
    toggle,
    close,
    triggerRef,
    triggerProps: {
      ref: triggerRef,
      onClick: toggle,
      "aria-expanded": open,
      "aria-haspopup": "true",
    },
  };
}

export function Popover({
  anchor,
  width,
  align = "left",
  children,
  label,
}: {
  anchor: PopoverAnchor;
  width: number;
  /** Which edge of the panel lines up with the trigger. */
  align?: "left" | "right";
  children: ReactNode;
  label: string;
}) {
  const { open, close, triggerRef } = anchor;
  const panel = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const palette = usePalette();
  const fonts = SURFACES[palette.surface].fonts;

  /**
   * Measured from the trigger, before paint.
   *
   * `useLayoutEffect` rather than `useEffect`: measuring after paint puts the
   * panel at its default position for one frame and then moves it, which reads
   * as a flinch every time the menu opens.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = triggerRef.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      const left =
        align === "right"
          ? Math.max(6, r.right - width)
          : Math.min(r.left, window.innerWidth - width - 6);
      setPos({ top: r.bottom + 4, left });
    };
    place();
    // A menu anchored to a button in a wrapping header has to follow it when
    // the header re-wraps, or it detaches and floats over the map.
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align, width, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // The trigger handles its own toggle; treating it as "outside" here
      // would close and immediately reopen on the same press.
      if (panel.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close, triggerRef]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      // The surface this menu belongs to, restated outside its root. Without
      // it every `var(--…)` below and in `children` resolves against `:root`.
      data-surface={palette.surface}
      className="fixed border"
      style={
        {
          top: pos.top,
          left: pos.left,
          width,
          zIndex: POPOVER_Z,
          // The font stacks travel with the tokens for the same reason, and
          // `fontFamily` travels with them because the portal inherits from
          // `<html>` rather than from the surface root -- which meant Tailwind
          // preflight`s system sans, measured rendering `-apple-system` across
          // all 39 text nodes of the panels menu while every character of the
          // console around it was IBM Plex Mono. Nothing inside either menu
          // sets a font of its own, so the variables alone fixed nothing.
          //
          // It is `fonts.body` and not `fonts.mono` so that this line stays a
          // copy of `SurfaceRoot`s (`App.tsx`), which is the thing it has to
          // keep in step with. They are the same stack on the console, where
          // the whole surface is monospace; on the site they are not, and a
          // popover opened there should read as that surface`s prose, not as
          // its code.
          "--font-display": fonts.display,
          "--font-body": fonts.body,
          "--font-mono": fonts.mono,
          fontFamily: fonts.body,
          // Last, so an override from the colour panel beats the block the
          // `data-surface` attribute above just selected -- the same ordering
          // `SurfaceRoot` uses, and the reason an inline custom property wins.
          ...tokenStyle(palette.tokens),
          borderColor: "var(--accent)",
          background: "var(--base-2)",
          boxShadow:
            "0 0 0 3px color-mix(in oklab, var(--base) 78%, transparent)",
          maxHeight: `calc(100dvh - ${pos.top + 12}px)`,
          overflowY: "auto",
          scrollbarWidth: "thin",
        } as CSSProperties
      }
    >
      {children}
    </div>,
    document.body,
  );
}
