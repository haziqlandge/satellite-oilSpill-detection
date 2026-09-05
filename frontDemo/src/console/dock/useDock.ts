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
 * Four rules the rest of the console relies on:
 *
 *  - a panel is in exactly one place. Docked or floating, never both, never
 *    neither, and `closed` is a placement rather than an absence so reopening
 *    restores where it was
 *  - a dock's tab order is canonical, never positional. A placement records
 *    *which* dock a panel is in and nothing about where in it; the sequence is
 *    derived from the console's own numbering. See `RANK` for why the stored
 *    `order` this replaced could not be kept honest
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

/**
 * A panel sitting in a dock.
 *
 * The side, and nothing else. Where in the strip it appears is `RANK`'s job,
 * and there is deliberately no field here that could disagree with it.
 */
export interface DockPlacement {
  kind: "dock";
  side: DockSide;
}

export type Placement =
  | DockPlacement
  | { kind: "float"; x: number; y: number; w: number; h: number; z: number }
  /**
   * `from` stays an object with one field rather than collapsing to a bare
   * `DockSide`. It is the shape already written into every reader's
   * `localStorage`, so dropping the dead `order` out of it is a field the
   * migration ignores rather than a rename it has to translate for ever; and it
   * is the record of a *placement* a panel was closed from, which is the sort
   * of thing that gains a field again.
   */
  | { kind: "closed"; from: { side: DockSide } };

export interface PanelDef {
  id: PanelId;
  /** Shown on the tab and in the window title bar. */
  title: string;
  /** Two-digit index, the console's own numbering. */
  index: string;
  /** Keyboard shortcut, 1-6. Undefined for the utility panels. */
  key?: string;
}

/**
 * The console's numbering, and the single list every other ordering follows.
 *
 * `as const satisfies` rather than a `: PanelDef[]` annotation, and the two
 * halves do different jobs. `satisfies` keeps the entries checked against
 * `PanelDef` -- a typo in a field name is still an error here, which is the
 * whole value of the annotation this replaced. `as const` keeps the *ids*
 * literal instead of widening them to `PanelId`, which is what lets `RANK`
 * below fail to compile if this list ever stops naming every panel there is.
 *
 * That mattered because the annotation made the omission invisible. With
 * `PANELS: PanelDef[]`, adding a tenth member to the `PanelId` union and
 * forgetting to add it here produced exactly one error, on `DEFAULT_LAYOUT`,
 * and none at all on this list or on `RANK` -- so a developer who fixed the
 * error they were shown had a `RANK` with a hole in it and a `panelsIn`
 * comparator returning `NaN`. See `RANK` for what a `NaN` comparator does to a
 * tab row; it is the precise failure this whole refactor exists to remove, and
 * it was reachable by fixing the compiler's own error message.
 *
 * Consumers only ever read this -- `map`, `filter`, `find`, `forEach`, `some`,
 * `length` -- so the `readonly` that comes with `as const` costs nothing.
 *
 * The three utility panels carry `key: undefined` written out rather than the
 * field simply absent. `as const` types each entry by what it literally
 * contains, so an omitted `key` is a member of the union that has no such
 * property at all, and `PANELS.find((p) => p.key === ...)` -- which is how the
 * number-key shortcuts are resolved -- stops compiling. Writing the field is
 * also what `PanelDef` has said all along: *undefined for the utility panels*.
 */
export const PANELS = [
  { id: "detect", title: "detect", index: "01", key: "1" },
  { id: "drift", title: "drift", index: "02", key: "2" },
  { id: "traffic", title: "traffic", index: "03", key: "3" },
  { id: "attribute", title: "attribute", index: "04", key: "4" },
  { id: "evidence", title: "evidence", index: "05", key: "5" },
  { id: "method", title: "method", index: "06", key: "6" },
  { id: "layers", title: "control attributes", index: "//", key: undefined },
  { id: "palette", title: "colour attributes", index: "//", key: undefined },
  { id: "log", title: "event log", index: "//", key: undefined },
] as const satisfies readonly PanelDef[];

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
 *
 * Every panel is docked here, and the type says so: `DockPlacement` rather than
 * `Placement` is what lets `homeSide` below read a side straight off an entry,
 * with no fallback for a default that could not have one.
 *
 * The keys are in `PANELS` order, matching what `readStored` rebuilds, so the
 * two paths into `layout` produce records with identical key order. Nothing
 * reads the key order -- the tab sequence is derived and `dirty` compares panel
 * by panel -- but two paths that agree are two paths nobody has to compare.
 */
const DEFAULT_LAYOUT: Record<PanelId, DockPlacement> = {
  detect: { kind: "dock", side: "right" },
  drift: { kind: "dock", side: "right" },
  traffic: { kind: "dock", side: "right" },
  attribute: { kind: "dock", side: "right" },
  evidence: { kind: "dock", side: "right" },
  method: { kind: "dock", side: "right" },
  layers: { kind: "dock", side: "left" },
  palette: { kind: "dock", side: "left" },
  log: { kind: "dock", side: "left" },
};

/**
 * Where a dock's tabs get their order.
 *
 * `PANELS` is the console's numbering. It is what the panels menu lists, what
 * the panel reader's tab strip lists, where `01`..`06` and the utility panels'
 * `//` come from, and which key fronts which pane. A dock's tab strip has to
 * read as that same sequence, or the console has numbered its panels twice and
 * disagreed with itself.
 *
 * This used to be an explicit `order: number` on the placement, which `dock()`
 * computed as "however many panels are already in the target dock" -- an
 * append. `DEFAULT_LAYOUT` happened to be numbered canonically, so a fresh
 * console looked right, and then floating `02 drift` and pressing `Escape` gave
 * this, measured:
 *
 *     01 detect │ 03 traffic │ 04 attribute │ 05 evidence │ 02 drift │ 06 method
 *
 * -- a row in an order nothing in the product means. Note that `02` did not even
 * land *last*, which is what an append should have produced. With `drift` in a
 * window the right dock held five panels, so it came back numbered 5, `method`
 * was already numbered 5, and the tie fell to whichever `Object.keys` happened
 * to list first. `reopen()` was a second way in: it restored a saved
 * `from.order` that another panel could have taken in the meantime.
 *
 * **The fix that was rejected** was to keep the field and recompute it at every
 * insertion so it always agreed with this sequence. It works, and it leaves a
 * stored number whose agreement is *maintained* rather than structural -- and
 * the collision above is not hypothetical, it is what the arithmetic that
 * produces such a number does when a panel is missing from the count. The
 * cross-dock case then settles it: a guest has no canonical index in the rail it
 * was dropped on, so it needs an out-of-band value, and there is nowhere to put
 * one that some absent panel cannot come back and tie with.
 *
 * So the field is gone and the sequence is derived. A scrambled dock is no
 * longer *representable*: a docked placement is a side, and every path that
 * produces one -- the title bar's `dock` button, `Escape`, a tab's
 * double-click, the panels menu, `reopen()`, and the drag that lands a window on
 * a tab strip -- puts the panel in its own slot without any of them knowing that
 * is what they are doing.
 *
 * **Why the seed is typed off `PANELS` and the constant off `PanelId`.** The
 * two are deliberately different types, and the assignment between them is the
 * compile-time proof that this map is *total*. The reduce produces a
 * `Record<>` keyed by the ids `PANELS` actually contains; the constant is
 * declared as one keyed by every `PanelId` there is. If the list ever stops
 * naming a panel, the narrower record is missing a key the wider one requires
 * and this line fails to compile.
 *
 * It is worth the sentence because the failure it prevents is silent. A
 * missing id makes `RANK[x]` `undefined`, `undefined - number` is `NaN`, and a
 * comparator that returns `NaN` puts `Array.prototype.sort` into
 * implementation-defined behaviour -- which is a tab row in no order at all,
 * appearing without an error anywhere, in the one function whose entire
 * purpose is that such a row cannot happen. Making it a type error costs
 * nothing at runtime: this is the same `reduce` it always was.
 */
const RANK: Record<PanelId, number> = PANELS.reduce(
  (acc, p, i) => {
    acc[p.id] = i;
    return acc;
  },
  {} as Record<(typeof PANELS)[number]["id"], number>,
);

/**
 * Which dock a panel belongs to.
 *
 * Read off `DEFAULT_LAYOUT` rather than declared a second time on `PanelDef`.
 * The default arrangement is already the statement of where a panel lives, and
 * a `home` field beside it could only ever drift out of step with it.
 *
 * The rule this replaces was written out by hand inside `dock()` as
 * `id === "layers" || id === "log" ? "left" : "right"`, which omits `palette` --
 * so the colour panel, whose home is the left rail, came back on the right.
 * `close()` carried the same rule again as a bare `"right"`, so a *floating*
 * panel that was closed reopened on the right whatever it was.
 */
function homeSide(id: PanelId): DockSide {
  return DEFAULT_LAYOUT[id].side;
}

/**
 * The dock a panel goes to when the caller does not name one.
 *
 * Shared by `dock()` and `close()` so the two cannot answer it differently:
 * where it is if it is docked, where it was closed from if it is closed, and
 * its home dock if it is floating and has nothing else to say.
 */
function sideFor(p: Placement, id: PanelId): DockSide {
  if (p.kind === "dock") return p.side;
  if (p.kind === "closed") return p.from.side;
  return homeSide(id);
}

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

/**
 * One stored placement, rebuilt rather than trusted.
 *
 * Returns a fresh value or `null`, and never the object it was handed. Two
 * things follow from that. Fields the current shape does not have -- the `order`
 * that used to sit on a docked placement, and the one inside `from` -- are
 * dropped rather than carried forward invisibly and written back out on the next
 * save. And a placement whose fields are missing or the wrong type is *rejected*
 * instead of reaching React as a `{ kind: "float" }` with no coordinates, which
 * renders a window at `NaN`.
 */
function readPlacement(raw: unknown): Placement | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;

  const side = (v: unknown): DockSide | null =>
    v === "left" || v === "right" ? v : null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  if (p.kind === "dock") {
    const s = side(p.side);
    return s ? { kind: "dock", side: s } : null;
  }

  if (p.kind === "float") {
    const x = num(p.x);
    const y = num(p.y);
    const w = num(p.w);
    const h = num(p.h);
    const z = num(p.z);
    if (x === null || y === null || w === null || h === null || z === null) {
      return null;
    }
    return { kind: "float", x, y, w, h, z };
  }

  if (p.kind === "closed") {
    const s = side((p.from as Record<string, unknown> | undefined)?.side);
    return s ? { kind: "closed", from: { side: s } } : null;
  }

  return null;
}

/**
 * The saved arrangement, or nothing.
 *
 * A stored layout that does not name every current panel is discarded rather
 * than merged. Panels get added over time, and a stale entry would render a
 * console with a hole in it and no control that finds the missing pane. A
 * placement that names a panel but cannot be read is discarded on the same
 * grounds and by the same route -- the whole entry goes, and the console comes
 * up at its default.
 *
 * `sizes`, `collapsed` and `active` are passed through as they were parsed.
 * Their shape has not changed, and each has a recovery: a bad `active` resolves
 * to the dock's first tab, a collapsed dock has an edge handle, and a size can
 * be dragged. They are *not* validated, which means a hand-edited `sizes.left`
 * outside `DOCK_LIMITS` renders a dock at that width -- unreachable from the UI,
 * since every write goes through `setSize`, which clamps.
 */
function readStored(): Partial<Persisted> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const rec = parsed as Record<string, unknown>;

    const savedLayout = rec.layout;
    if (!savedLayout || typeof savedLayout !== "object") return null;
    const stored = savedLayout as Record<string, unknown>;

    const layout = {} as Layout;
    for (const p of PANELS) {
      const place = readPlacement(stored[p.id]);
      if (!place) return null;
      layout[p.id] = place;
    }

    return {
      layout,
      sizes: rec.sizes as DockSizes | undefined,
      collapsed: rec.collapsed as Persisted["collapsed"] | undefined,
      active: rec.active as Persisted["active"] | undefined,
    };
  } catch {
    return null;
  }
}

/**
 * The highest stacking number any restored window is already using.
 *
 * `topZ` used to start at 10 every session. Float two windows, reload, and the
 * lower one could not be brought to the front: `raise` handed it 11 while its
 * sibling still carried the 12 it was saved with, and it took as many clicks as
 * the gap to climb past.
 */
function highestZ(layout: Layout): number {
  let top = 10;
  for (const p of Object.values(layout) as Placement[]) {
    if (p.kind === "float" && p.z > top) top = p.z;
  }
  return top;
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
  /**
   * Put a panel in a dock. Omit `side` to send it where it belongs -- the dock
   * it was closed from, or its home. Pass one to put it in a named dock, which
   * is what a window dropped on the other rail's tab strip does.
   *
   * Neither form takes a position: the slot is `RANK`'s.
   */
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
  //
  // Seeded above whatever the restored windows are already carrying -- see
  // `highestZ`. `stored.current` is fixed for the life of the hook, so this is
  // the same number on every render and only the first one is kept.
  const topZ = useRef(highestZ(stored.current?.layout ?? DEFAULT_LAYOUT));

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

  /**
   * A dock's tabs, left to right.
   *
   * Membership is stored, sequence is not. Two keys:
   *
   *  - **natives before guests.** A panel dropped on a dock that is not its home
   *    goes after everything that belongs there, because the numbering was drawn
   *    for one rail and there is no natural place to interleave `03 traffic`
   *    with `// event log`
   *  - **`RANK` within each group.** Two guests are necessarily from the same
   *    home dock, so their numbering relative to each other still means
   *    something, and using it keeps the whole sequence independent of the order
   *    the panels arrived in -- which is the property the drop gesture needs
   */
  const panelsIn = useCallback(
    (side: DockSide): PanelId[] =>
      (Object.keys(layout) as PanelId[])
        .filter((id) => {
          const p = layout[id];
          return p.kind === "dock" && p.side === side;
        })
        .sort((a, b) => {
          const ga = homeSide(a) === side ? 0 : 1;
          const gb = homeSide(b) === side ? 0 : 1;
          return ga - gb || RANK[a] - RANK[b];
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

  /**
   * Put a panel in a dock.
   *
   * With no `side` it goes where `sideFor` says -- back where it was closed
   * from, or home. With one it goes there, which is how a window dropped on a
   * tab strip lands on a dock that is not its own. Neither says *where* in the
   * strip; nothing here can.
   *
   * `setActiveRaw` is called from inside the `setLayout` updater deliberately,
   * and it has to stay that way. The target is a function of the placement the
   * panel has *now*, and the drop gesture calls this repeatedly inside a single
   * pointer stroke -- a version that read `layout` from the closure would work
   * on the first call of a gesture and on a stale record afterwards. The inner
   * call is idempotent, so a double-invoked updater costs nothing.
   */
  const dock = useCallback((id: PanelId, side?: DockSide) => {
    setLayout((l) => {
      const target = side ?? sideFor(l[id], id);
      setActiveRaw((a) => ({ ...a, [target]: id }));
      return { ...l, [id]: { kind: "dock", side: target } };
    });
  }, []);

  const close = useCallback((id: PanelId) => {
    setLayout((l) => ({
      ...l,
      // Where it goes back to. A docked panel remembers its dock even when that
      // is not its home one; a floating panel has no dock to remember and gets
      // its home. Both through `sideFor`, so this and `dock` cannot disagree.
      [id]: { kind: "closed", from: { side: sideFor(l[id], id) } },
    }));
  }, []);

  const reopen = useCallback((id: PanelId) => {
    setLayout((l) => {
      const p = l[id];
      // Only a closed panel reopens. The panels menu's `open all` calls this on
      // every panel there is, and a floating one has to stay floating.
      if (p.kind !== "closed") return l;
      setActiveRaw((a) => ({ ...a, [p.from.side]: id }));
      return { ...l, [id]: { kind: "dock", side: p.from.side } };
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

  /**
   * Whether `reset layout` has anything to undo.
   *
   * Compared panel by panel rather than through `JSON.stringify`, which is what
   * this was. Serialising makes the answer depend on how the record happens to
   * be written out -- the order of its keys, and the order of the fields inside
   * each placement -- and nothing else in this file cares about either. The two
   * paths into `layout`, the literal and whatever `readStored` rebuilds, have to
   * agree as *values*; that they agree as strings as well is a coincidence
   * somebody would have to keep true, and the next field added to
   * `DockPlacement` is exactly the edit that breaks it without a symptom, leaving
   * `reset layout` lit with nothing behind it.
   *
   * Every entry in `DEFAULT_LAYOUT` is a dock, so the comparison is the whole
   * question: is this panel docked, and on the side it started on. Which is also
   * why floating a panel and sending it back now clears the flag -- the round
   * trip is exact, where the stored `order` used to bring it home carrying a
   * different number.
   *
   * The fronted tab is not part of this, and was not before. Clicking a tab is
   * not a change to the layout, and a `reset layout` that lit up because someone
   * looked at a different pane would mean nothing.
   */
  const dirty =
    PANELS.some((p) => {
      const place = layout[p.id];
      return place.kind !== "dock" || place.side !== DEFAULT_LAYOUT[p.id].side;
    }) ||
    sizes.left !== DEFAULT_SIZES.left ||
    sizes.right !== DEFAULT_SIZES.right ||
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
