/**
 * The console's window manager.
 *
 * A workstation is not a page. Photoshop, Clip Studio, a DAW, an IDE -- they
 * all share one arrangement: the work surface holds the middle, tool panels
 * dock to the edges, and any panel can be pulled off its dock into a window you
 * put where you like. That is what this implements, in about as little code as
 * the behaviour can honestly be had for.
 *
 * The state is one flat record of panel id to placement. Flat, rather than the
 * nested split-tree a full dock library keeps, because the console has two
 * fixed docks and no arbitrary splitting -- and a tree would cost an order of
 * magnitude more code for a rearrangement nobody asked for.
 *
 * Three rules the rest of the console relies on:
 *
 *  - a panel is in exactly one place. Docked or floating, never both, never
 *    neither, and `closed` is a placement rather than an absence so reopening
 *    restores where it was
 *  - dock widths live here as numbers but are written to CSS custom properties
 *    during a drag, never through React. A resize handle that setStates on
 *    pointermove re-renders the contact table sixty times a second
 *  - every layout is recoverable. It persists, and there is always a reset
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PanelId =
  | "detect"
  | "drift"
  | "traffic"
  | "attribute"
  | "evidence"
  | "method"
  | "layers"
  | "palette"
  | "log";

export type DockSide = "left" | "right";

export type Placement =
  | { kind: "dock"; side: DockSide; order: number }
  | { kind: "float"; x: number; y: number; w: number; h: number; z: number }
  | { kind: "closed"; from: { side: DockSide; order: number } };

export interface PanelDef {
  id: PanelId;
  /** Shown on the tab and in the window title bar. */
  title: string;
  /** Two-digit index, the console's own numbering. */
  index: string;
  /** Keyboard shortcut, 1-6. Undefined for the utility panels. */
  key?: string;
}

export const PANELS: PanelDef[] = [
  { id: "detect", title: "detect", index: "01", key: "1" },
  { id: "drift", title: "drift", index: "02", key: "2" },
  { id: "traffic", title: "traffic", index: "03", key: "3" },
  { id: "attribute", title: "attribute", index: "04", key: "4" },
  { id: "evidence", title: "evidence", index: "05", key: "5" },
  { id: "method", title: "method", index: "06", key: "6" },
  { id: "layers", title: "control attributes", index: "//" },
  { id: "palette", title: "colour attributes", index: "//" },
  { id: "log", title: "event log", index: "//" },
];

export function panelDef(id: PanelId): PanelDef {
  return PANELS.find((p) => p.id === id) ?? PANELS[0];
}

export type Layout = Record<PanelId, Placement>;

export interface DockSizes {
  left: number;
  right: number;
}

/**
 * The default arrangement.
 *
 * Analysis panes stack on the right in their numbered order; the controls and
 * the log take the left. The timeline band is deliberately not a panel: the
 * hour is the console's other axis, and an operator who closed it would be
 * scrubbing a clock they cannot see.
 */
const DEFAULT_LAYOUT: Layout = {
  layers: { kind: "dock", side: "left", order: 0 },
  palette: { kind: "dock", side: "left", order: 1 },
  log: { kind: "dock", side: "left", order: 2 },
  detect: { kind: "dock", side: "right", order: 0 },
  drift: { kind: "dock", side: "right", order: 1 },
  traffic: { kind: "dock", side: "right", order: 2 },
  attribute: { kind: "dock", side: "right", order: 3 },
  evidence: { kind: "dock", side: "right", order: 4 },
  method: { kind: "dock", side: "right", order: 5 },
};

const DEFAULT_SIZES: DockSizes = { left: 214, right: 430 };

export const DOCK_LIMITS: Record<DockSide, [number, number]> = {
  left: [150, 470],
  right: [300, 760],
};

/**
 * How much the type grows as a dock widens.
 *
 * The console's whole component family lives between 9 and 13 px, a range
 * chosen so that density is the design. Letting it scale without a ceiling
 * would turn a widened panel into a different product, so the scale is clamped
 * to a band either side of 1 and driven off the dock's own reference width.
 */
export function scaleFor(side: DockSide, size: number): number {
  const ref = DEFAULT_SIZES[side];
  const raw = 1 + (size / ref - 1) * 0.45;
  return Math.max(0.9, Math.min(1.35, Number(raw.toFixed(3))));
}

const STORAGE_KEY = "slicktrace:dock";

interface Persisted {
  layout: Layout;
  sizes: DockSizes;
  collapsed: Partial<Record<DockSide, boolean>>;
  active: Partial<Record<DockSide, PanelId>>;
}

function readStored(): Partial<Persisted> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    // A stored layout that does not name every current panel is discarded
    // rather than merged. Panels get added over time, and a stale entry would
    // render a console with a hole in it and no control that finds the missing
    // pane.
    if (!parsed.layout) return null;
    for (const p of PANELS) if (!parsed.layout[p.id]) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface Dock {
  layout: Layout;
  sizes: DockSizes;
  collapsed: Record<DockSide, boolean>;
  /** Which tab is fronted in each dock. */
  active: Record<DockSide, PanelId | null>;
  panelsIn: (side: DockSide) => PanelId[];
  floating: PanelId[];
  closed: PanelId[];
  setActive: (side: DockSide, id: PanelId) => void;
  toggleCollapsed: (side: DockSide) => void;
  /**
   * Shut a dock outright, or bring it back.
   *
   * Separate from `toggleCollapsed` because the drag needs to *set* a state
   * rather than flip one: a grip dragged past its minimum must end up shut
   * whether or not it already was, and the edge handle must end up open.
   */
  setCollapsed: (side: DockSide, value: boolean) => void;
  setSize: (side: DockSide, px: number) => void;
  /** Pull a docked panel out into a window, or push a window back. */
  float: (id: PanelId, at?: { x: number; y: number }) => void;
  dock: (id: PanelId, side?: DockSide) => void;
  close: (id: PanelId) => void;
  reopen: (id: PanelId) => void;
  moveFloat: (id: PanelId, x: number, y: number) => void;
  sizeFloat: (id: PanelId, w: number, h: number) => void;
  raise: (id: PanelId) => void;
  reset: () => void;
  dirty: boolean;
}

const SIDES: DockSide[] = ["left", "right"];

export function useDock(): Dock {
  const stored = useRef<Partial<Persisted> | null | undefined>(undefined);
  if (stored.current === undefined) stored.current = readStored();

  const [layout, setLayout] = useState<Layout>(
    () => stored.current?.layout ?? DEFAULT_LAYOUT,
  );
  const [sizes, setSizes] = useState<DockSizes>(() => ({
    ...DEFAULT_SIZES,
    ...(stored.current?.sizes ?? {}),
  }));
  const [collapsed, setCollapsed] = useState<Record<DockSide, boolean>>(() => ({
    left: false,
    right: false,
    ...(stored.current?.collapsed ?? {}),
  }));
  const [activeRaw, setActiveRaw] = useState<Partial<Record<DockSide, PanelId>>>(
    () => stored.current?.active ?? { left: "layers", right: "detect" },
  );
  // The stacking counter. A ref, not state: nothing renders from it, and
  // holding it in state would schedule a render every time a window took
  // focus without anything on screen depending on the number itself.
  const topZ = useRef(10);

  /* --- persistence -------------------------------------------------- */

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ layout, sizes, collapsed, active: activeRaw }),
      );
    } catch {
      /* private mode: the layout is simply not remembered */
    }
  }, [layout, sizes, collapsed, activeRaw]);

  /* --- derived ------------------------------------------------------ */

  const panelsIn = useCallback(
    (side: DockSide): PanelId[] =>
      (Object.keys(layout) as PanelId[])
        .filter((id) => {
          const p = layout[id];
          return p.kind === "dock" && p.side === side;
        })
        .sort((a, b) => {
          const pa = layout[a] as { order: number };
          const pb = layout[b] as { order: number };
          return pa.order - pb.order;
        }),
    [layout],
  );

  const floating = useMemo(
    () =>
      (Object.keys(layout) as PanelId[]).filter(
        (id) => layout[id].kind === "float",
      ),
    [layout],
  );

  const closed = useMemo(
    () =>
      (Object.keys(layout) as PanelId[]).filter(
        (id) => layout[id].kind === "closed",
      ),
    [layout],
  );

  // The fronted tab is resolved rather than stored: a dock whose active panel
  // was just floated or closed has to front something that is actually in it.
  const active = useMemo(() => {
    const out = {} as Record<DockSide, PanelId | null>;
    for (const side of SIDES) {
      const inDock = panelsIn(side);
      const want = activeRaw[side];
      out[side] = want && inDock.includes(want) ? want : (inDock[0] ?? null);
    }
    return out;
  }, [activeRaw, panelsIn]);

  /* --- operations --------------------------------------------------- */

  const setActive = useCallback((side: DockSide, id: PanelId) => {
    setActiveRaw((a) => ({ ...a, [side]: id }));
  }, []);

  const toggleCollapsed = useCallback((side: DockSide) => {
    setCollapsed((c) => ({ ...c, [side]: !c[side] }));
  }, []);

  const setCollapsedSide = useCallback((side: DockSide, value: boolean) => {
    setCollapsed((c) => (c[side] === value ? c : { ...c, [side]: value }));
  }, []);

  const setSize = useCallback((side: DockSide, px: number) => {
    const [lo, hi] = DOCK_LIMITS[side];
    setSizes((s) => ({ ...s, [side]: Math.max(lo, Math.min(hi, px)) }));
  }, []);

  const raise = useCallback((id: PanelId) => {
    const next = (topZ.current += 1);
    setLayout((l) => {
      const p = l[id];
      return p.kind === "float" ? { ...l, [id]: { ...p, z: next } } : l;
    });
  }, []);

  const float = useCallback((id: PanelId, at?: { x: number; y: number }) => {
    const next = (topZ.current += 1);
    setLayout((l) => {
      // Cascade from a corner when no position is given, so two panels floated
      // in a row do not land exactly on top of each other.
      const n = (Object.keys(l) as PanelId[]).filter(
        (k) => l[k].kind === "float",
      ).length;
      const x = at?.x ?? 140 + n * 28;
      const y = at?.y ?? 120 + n * 28;
      return { ...l, [id]: { kind: "float", x, y, w: 430, h: 360, z: next } };
    });
  }, []);

  const dock = useCallback((id: PanelId, side?: DockSide) => {
    setLayout((l) => {
      const prev = l[id];
      const target =
        side ??
        (prev.kind === "closed"
          ? prev.from.side
          : id === "layers" || id === "log"
            ? "left"
            : "right");
      const order =
        prev.kind === "closed"
          ? prev.from.order
          : (Object.keys(l) as PanelId[]).filter((k) => {
              const p = l[k];
              return p.kind === "dock" && p.side === target;
            }).length;
      setActiveRaw((a) => ({ ...a, [target]: id }));
      return { ...l, [id]: { kind: "dock", side: target, order } };
    });
  }, []);

  const close = useCallback((id: PanelId) => {
    setLayout((l) => {
      const p = l[id];
      const from =
        p.kind === "dock"
          ? { side: p.side, order: p.order }
          : { side: "right" as DockSide, order: 99 };
      return { ...l, [id]: { kind: "closed", from } };
    });
  }, []);

  const reopen = useCallback((id: PanelId) => {
    setLayout((l) => {
      const p = l[id];
      if (p.kind !== "closed") return l;
      setActiveRaw((a) => ({ ...a, [p.from.side]: id }));
      return {
        ...l,
        [id]: { kind: "dock", side: p.from.side, order: p.from.order },
      };
    });
  }, []);

  const moveFloat = useCallback((id: PanelId, x: number, y: number) => {
    setLayout((l) => {
      const p = l[id];
      return p.kind === "float" ? { ...l, [id]: { ...p, x, y } } : l;
    });
  }, []);

  const sizeFloat = useCallback((id: PanelId, w: number, h: number) => {
    setLayout((l) => {
      const p = l[id];
      return p.kind === "float"
        ? { ...l, [id]: { ...p, w: Math.max(260, w), h: Math.max(150, h) } }
        : l;
    });
  }, []);

  const reset = useCallback(() => {
    setLayout(DEFAULT_LAYOUT);
    setSizes(DEFAULT_SIZES);
    setCollapsed({ left: false, right: false });
    setActiveRaw({ left: "layers", right: "detect" });
  }, []);

  /**
   * Windows follow the viewport when it shrinks.
   *
   * A float parked near the right edge of a wide window is simply gone after
   * the window is narrowed -- off screen, unreachable, and still in the saved
   * layout, so a reload does not fix it either. Clamping on resize is what
   * keeps the reset control from being the only way back.
   */
  useEffect(() => {
    const onResize = () => {
      setLayout((l) => {
        let changed = false;
        const next = { ...l };
        for (const id of Object.keys(l) as PanelId[]) {
          const p = l[id];
          if (p.kind !== "float") continue;
          const x = Math.max(0, Math.min(window.innerWidth - 140, p.x));
          const y = Math.max(0, Math.min(window.innerHeight - 70, p.y));
          if (x !== p.x || y !== p.y) {
            next[id] = { ...p, x, y };
            changed = true;
          }
        }
        return changed ? next : l;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const dirty =
    JSON.stringify(layout) !== JSON.stringify(DEFAULT_LAYOUT) ||
    JSON.stringify(sizes) !== JSON.stringify(DEFAULT_SIZES) ||
    collapsed.left ||
    collapsed.right;

  return {
    layout,
    sizes,
    collapsed,
    active,
    panelsIn,
    floating,
    closed,
    setActive,
    toggleCollapsed,
    setCollapsed: setCollapsedSide,
    setSize,
    float,
    dock,
    close,
    reopen,
    moveFloat,
    sizeFloat,
    raise,
    reset,
    dirty,
  };
}
