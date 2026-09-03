/**
 * A panel torn off its dock.
 *
 * The window itself -- drag, resize, chrome -- is `components/FloatShell`,
 * shared with the home page's colour panel. What stays here is everything that
 * is about the *dock* rather than about the window: committing the new position
 * and size to the layout, sending the panel home on a double-click or `Escape`,
 * and raising it above its siblings when it is touched.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { FloatShell } from "../../components/FloatShell";
import { panelDef, type Dock, type PanelId } from "./useDock";

export function FloatWindow({
  id,
  dock,
  children,
}: {
  id: PanelId;
  dock: Dock;
  children: ReactNode;
}) {
  const placement = dock.layout[id];
  const def = panelDef(id);
  const box = useRef<HTMLDivElement>(null);

  const { close, dock: redock, moveFloat, sizeFloat, raise } = dock;

  /* --- escape ------------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = box.current;
      // Only the window the pointer or focus is actually in. Escape with three
      // windows open should not shut all three.
      if (el && el.contains(document.activeElement)) redock(id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, redock]);

  if (placement.kind !== "float") return null;

  return (
    <div ref={box} className="contents">
      <FloatShell
        title={def.title}
        index={def.index}
        x={placement.x}
        y={placement.y}
        w={placement.w}
        h={placement.h}
        z={40 + placement.z}
        onMove={(x, y) => moveFloat(id, x, y)}
        onSize={(w, h) => sizeFloat(id, w, h)}
        onDock={() => redock(id)}
        onClose={() => close(id)}
        onTitleDoubleClick={() => redock(id)}
        onPointerDownCapture={() => raise(id)}
      >
        {children}
      </FloatShell>
    </div>
  );
}
