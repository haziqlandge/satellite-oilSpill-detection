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
 *  - dock widths live here as numbers but are written straight onto the rail
 *    element during a drag, never through React. A resize handle that setStates
 *    on pointermove re-renders the contact table sixty times a second. (This
 *    said "written to CSS custom properties", which was true of a
 *    `--panel-scale` that has since been removed for doing nothing; the width
 *    itself was always a plain `style.width`)
 *  - every layout is recoverable. It persists, and there is always a reset
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

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
 * The size a panel gets the first time it becomes a window.
 *
 * Named rather than written inline in `float()` because the drag controller
 * below needs the same pair: a tab torn off its rail becomes a window before
 * `float()` has run, and the controller has to know how big that window will be
 * to work out where to put it under the pointer. Two literals that had to agree
 * is exactly the sort of agreement nobody maintains.
 */
const FLOAT_W = 430;
const FLOAT_H = 360;

/**
 * How much of a window has to stay on screen.
 *
 * A window dragged past the edge and released there is unreachable -- the title
 * bar is the only handle it has, and if the title bar is off screen there is no
 * gesture that brings it back short of `reset layout`. So the position is
 * clamped as it moves rather than after, and the same clamp is applied when the
 * viewport shrinks under a window that was already parked near the edge.
 *
 * `FloatShell` carries its own copy of these numbers for the drag it still owns
 * on the home page. It deliberately does not import them: the whole point of
 * the split is that the shared window component knows nothing about the
 * console's dock. The duplication is two constants and it is the cheaper of the
 * two prices.
 */
const KEEP_X = 140;
const KEEP_Y = 70;

function clampFloat(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(window.innerWidth - KEEP_X, x)),
    y: Math.max(0, Math.min(window.innerHeight - KEEP_Y, y)),
  };
}

/*
  `scaleFor` was here.

  It answered "how much does the type grow as a dock widens" with a damped,
  clamped ratio against the dock's reference width, and its docblock explained
  that the console's component family lives between 9 and 13 px so the scale had
  to be bounded or a widened panel would become a different product. The
  reasoning was sound and the function was correct. It simply never did
  anything: its only two callers wrote its result to a `--panel-scale` custom
  property that nothing in the console inherited, because every type size in the
  console is an absolute `text-[10px]`-style bracket. Measured across 300 / 430 /
  760 px, every leaf text node in a dock computed to an identical size at all
  three widths.

  Deleted rather than documented in place, and the argument for that is in
  `DockRail.tsx`'s note on the dock body element -- the short version being that
  this mechanism had already been recorded as *verified working* in a handoff,
  on the strength of two measurements that were both true and neither of which
  meant what it was taken to mean.

  If a dock's contents should ever genuinely scale with its width, the answer is
  not this function. It is `zoom` on the rail body, which is what the panel
  reader already uses for the same problem, and it costs the resize grip's
  arithmetic -- see `ISSUES.md` §5 and the note in `DockRail.tsx`.
*/

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
  /**
   * Pull a docked panel out into a window, or move an existing one.
   *
   * `at` is optional in every part. Omit it entirely and a *docked* panel
   * cascades from a corner while an *already floating* one keeps the geometry
   * it has -- see the implementation for why that asymmetry is the point. The
   * size is separately optional because the drag controller re-floats a window
   * many times inside one pointer stroke and has to hand back the size the
   * window had when the stroke began; without it, a window that crossed a tab
   * strip and came back off it would be silently resized to the default.
   */
  float: (
    id: PanelId,
    at?: { x: number; y: number; w?: number; h?: number },
  ) => void;
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

  /**
   * Make a panel a window, or raise and reposition one that already is.
   *
   * The fallbacks read off the panel's *current* placement, and that is what
   * makes this safe to call on something already floating. It used to
   * unconditionally write a fresh cascade position and a 430x360 size, so
   * `float()` on a window that was already open teleported it to a corner and
   * threw away whatever the operator had sized it to. Nothing reached that
   * before -- the panels menu only offers `float` when the panel is *not*
   * floating, and a dock tab only exists while the panel is docked.
   *
   * The drag reaches it. A tab dragged past the tear-off threshold floats the
   * panel, and a wobble of more than a few pixels during the *second* press of
   * a double-click can arm that threshold before `dblclick` fires -- at which
   * point the tab's own `onDoubleClick` runs `float()` a second time on a
   * window that is already under the pointer. With the old behaviour that
   * second call flung the window to a cascade slot mid-drag. With this one it
   * raises the window and changes nothing else, which is the only sane reading
   * of "float a panel that is already floating".
   *
   * That is deliberately the whole of the double-click defence. A timer or a
   * `detail` count would be a second mechanism guessing at the user's
   * intention; making the operation idempotent means the two gestures cannot
   * contradict each other whatever order they arrive in.
   */
  const float = useCallback(
    (id: PanelId, at?: { x: number; y: number; w?: number; h?: number }) => {
      const next = (topZ.current += 1);
      setLayout((l) => {
        const p = l[id];
        const open = p.kind === "float" ? p : null;
        // Cascade from a corner when there is nothing to inherit, so two panels
        // floated in a row do not land exactly on top of each other.
        const n = (Object.keys(l) as PanelId[]).filter(
          (k) => l[k].kind === "float",
        ).length;
        const x = at?.x ?? open?.x ?? 140 + n * 28;
        const y = at?.y ?? open?.y ?? 120 + n * 28;
        const w = at?.w ?? open?.w ?? FLOAT_W;
        const h = at?.h ?? open?.h ?? FLOAT_H;
        return { ...l, [id]: { kind: "float", x, y, w, h, z: next } };
      });
    },
    [],
  );

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
          // The same clamp the drag applies while a window is moving, so a
          // window cannot be somewhere on resize that the pointer could not
          // have put it.
          const { x, y } = clampFloat(p.x, p.y);
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

/* ===================================================================== *
 * THE DRAG -- a window dropped on a tab strip, and a tab pulled off one
 * ===================================================================== */

/**
 * The attribute that marks a tab strip as a drop target.
 *
 * `role="tablist"` is not usable for this. It appears three times in the
 * console's DOM -- the left rail, the right rail, and the panel reader below
 * the workstation -- and the reader is emphatically *not* a drop target: it is
 * a reading surface at page width, it has no concept of a fronted dock, and a
 * window dropped on it would have to go somewhere it does not have.
 *
 * The three could be told apart by DOM order or by y-position, and both are
 * the wrong kind of answer. DOM order is an accident of how `ConsoleShell`
 * happens to be written today; a y-threshold is a number that is right until
 * the header wraps to a second row on a narrow viewport, or the timeline band
 * changes height, or someone scrolls. Neither is a *statement*.
 *
 * So a rail's strip says outright what it is, and carries which dock it
 * belongs to in the same attribute. The reader's strip does not have it and
 * cannot accidentally acquire it. The hit test below reads the side straight
 * off the mark, so no geometry is involved at any point.
 */
export const DOCK_STRIP_ATTR = "data-dock-strip";

/**
 * How far a docked tab has to travel under a held pointer before it tears off.
 *
 * Small enough that the gesture feels immediate -- the spec asks for "more than
 * a few px" -- and large enough that a hand resting on a mouse button does not
 * produce a window nobody asked for. Measured as a Manhattan distance rather
 * than a Euclidean one: it is a threshold, not a measurement, and a square
 * threshold costs no square root.
 */
const TEAR_AT = 6;

/**
 * Which dock's tab strip is under this point, if any.
 *
 * `elementsFromPoint` rather than `elementFromPoint`, and that is not a
 * refinement. For the whole floating half of the gesture the dragged window is
 * *directly under the cursor* -- that is what following the pointer means --
 * so the singular call returns the window on every frame and the answer is
 * always "no strip". The plural call returns the entire hit-stack at that
 * point, so the strip under the window is found exactly as if the window were
 * not there.
 *
 * That is also why the dragged window is not given `pointer-events: none` for
 * the duration, which is the other usual fix: mutating the dragged element to
 * make a hit test work leaves a style to clean up on every exit path, and one
 * of those exit paths is the element unmounting mid-gesture.
 *
 * Elements that opt out of hit-testing are excluded by the platform, so the
 * console's full-viewport scanline layer -- `pointer-events: none`, `z-index:
 * 60`, on top of everything -- does not participate and needs no special case.
 */
function stripAt(x: number, y: number): DockSide | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const strip = el.closest(`[${DOCK_STRIP_ATTR}]`);
    const side = strip?.getAttribute(DOCK_STRIP_ATTR);
    if (side === "left" || side === "right") return side;
  }
  return null;
}

/**
 * One gesture in flight. Lives in a ref, never in state: every field here is
 * read and written from pointer handlers and an animation frame, and none of
 * them is something React should re-render for.
 */
interface DragState {
  id: PanelId;
  pointerId: number;
  /**
   * Where inside the window the pointer took hold of it. Held for the whole
   * gesture so that the grip point stays under the cursor across any number of
   * dock and un-dock transitions -- a window that jumped to a new offset every
   * time it came back off a strip would be unusable.
   */
  grabDX: number;
  grabDY: number;
  /** The size to restore the window at on every un-dock. */
  w: number;
  h: number;
  /** The dock the panel is in *right now*, or null while it is a window. */
  docked: DockSide | null;
  /**
   * Whether this gesture owns a window yet. A window drag is armed from the
   * first event; a tab press is not armed until it has travelled `TEAR_AT`,
   * and if it never does, the gesture ends having done nothing whatsoever --
   * which is what leaves the tab's own click and double-click intact.
   */
  armed: boolean;
  /**
   * Whether the pointer has left the press point by more than `TEAR_AT`.
   *
   * For a tab this is the same instant as `armed`. For a *window* drag it is
   * not, and the difference is a real defect it exists to close: a window can
   * be sitting on top of a rail's tab strip before anyone touches it -- that is
   * what a floating window over a dock looks like -- so a plain press on its
   * title bar would hit-test as "over a strip" and dock the window on
   * mouse-down, with no drag at all. Docking is a thing you do by moving
   * something; until the pointer has moved, there is no gesture to interpret.
   */
  travelled: boolean;
  /** Latest pointer position, viewport coordinates. */
  px: number;
  py: number;
  /** Where the press landed, for the tear-off threshold. */
  x0: number;
  y0: number;
  /** Set on every pointermove, cleared by the frame that hit-tests it. */
  moved: boolean;
  /**
   * What each dock was showing before this gesture fronted itself there.
   *
   * Dropping a panel on a strip makes it the fronted tab, which is the spec.
   * Taking it back off again would otherwise leave the dock fronting whatever
   * `panelsIn` lists first, so a reversible gesture would not actually be
   * reversible -- it would leave a changed rail behind. Remembered once per
   * dock, the first time the gesture enters it.
   */
  restore: Partial<Record<DockSide, PanelId | null>>;
}

export interface DockDrag {
  /** Begin dragging a window that is already floating, from its title bar. */
  startWindow: (e: ReactPointerEvent, id: PanelId) => void;
  /** Begin a press on a docked tab that may or may not become a tear-off. */
  startTab: (e: ReactPointerEvent, id: PanelId, side: DockSide) => void;
  /**
   * Callback ref for a floating window's own element.
   *
   * Must be a stable function -- it is used as a callback ref, so a fresh
   * identity on every render would detach and re-attach the element on every
   * render. `FloatWindow` memoises the per-panel closure it passes.
   */
  attach: (id: PanelId, el: HTMLElement | null) => void;
}

/**
 * Dragging a window into a dock, and a tab out of one.
 *
 * **Why this is a separate hook that `ConsoleShell` holds, rather than
 * handlers on the components that own the gesture.**
 *
 * The specification is that the window *actually docks while the pointer is
 * still down* -- no drop indicator, no preview, the rail re-renders with the
 * panel in it -- and that moving back off the strip pops it out again, any
 * number of times, until release. The consequence is easy to miss and fatal to
 * the obvious implementation: `ConsoleShell` renders a `FloatWindow` for each
 * id in `dock.floating`, so the instant the panel docks it is no longer in
 * that list and **the component that was handling the drag unmounts**, taking
 * its `pointermove` and `pointerup` listeners with it. The gesture would end
 * at the moment of docking and could never be reversed. The mirror image is
 * true of the tear-off: the tab a drag starts on is unmounted by the float
 * that drag produces.
 *
 * So the listeners cannot belong to either component. Three places they could
 * go were considered:
 *
 *  1. **Here** -- a controller owned by `ConsoleShell`, which owns `useDock`
 *     and does not unmount for anything either endpoint of the drag does. The
 *     components report a pointer-down and nothing else.
 *  2. **On `window`, installed by whoever starts the drag and deliberately not
 *     cleaned up when that component unmounts.** It is fewer lines and it
 *     works, and it is a listener whose lifetime is *by design* longer than
 *     the component that created it -- an unmount that no longer means what an
 *     unmount means everywhere else in the codebase. The failure it invites is
 *     silent and permanent: any path that ends a gesture without reaching the
 *     one `pointerup` handler leaks a live listener holding a closure over a
 *     dead component's props, and the next drag has two controllers fighting
 *     over the same panel. Rejected for that, not for the line count.
 *  3. **Keep the window mounted but hidden while it is "docked".** Nothing
 *     unmounts, so nothing has to move -- but the panel is then rendered
 *     twice, once in the rail and once in the hidden window, and these panels
 *     are a live map, a forty-row contact table and a full attribution report.
 *     It also needs a placement that does not exist ("docked, but with a
 *     window still open on it"), which every consumer of `Placement` would
 *     have to learn. Rejected as the most expensive answer to the cheapest
 *     part of the problem.
 *
 * (1) is what this is. The controller holds the pointer listeners on `window`
 * -- the same mechanism the resize grip, the edge handle and `FloatShell`'s
 * own move already use -- and it holds them for exactly as long as one
 * gesture, because the hook that installed them outlives every component that
 * can be involved in one.
 *
 * **No `setPointerCapture` anywhere.** Capture is released when the captured
 * element leaves the document, which is precisely the event this whole design
 * is built around; a capture taken on the window being dragged would be gone
 * at the first dock. `window` listeners have no such problem, and a mouse
 * button that is held delivers `pointermove` to the document regardless of
 * what is under it.
 *
 * **The frame loop runs for the whole gesture, not per move event.** The
 * position of a floating window is written straight onto its element rather
 * than through React, for the reason `FloatShell` gives at length -- a window
 * can hold a live map, and re-rendering it a hundred times a second is how a
 * window manager starts dropping frames. But an imperative write like that is
 * only as durable as the next render: anything that re-renders `ConsoleShell`
 * mid-drag -- and this gesture itself does, at every dock and un-dock, plus
 * `raise` on the press, plus the console's own clock -- re-applies `left` and
 * `top` from the layout and snaps the window back to where the last commit put
 * it. A frame loop that repaints unconditionally corrects that on the next
 * frame no matter what caused it, so the class of bug simply does not arise.
 * The hit test inside it is still gated on the pointer having actually moved,
 * because `elementsFromPoint` forces layout and there is no reason to pay for
 * it while the pointer is still.
 *
 * **Nothing here animates**, so nothing here consults `prefersReducedMotion`.
 * A dock is instantaneous by specification -- it is the absence of a preview
 * that makes the gesture legible -- and the window follows the pointer, which
 * is direct manipulation rather than motion. The only transitions in the
 * neighbourhood are the tabs' CSS `transition-colors`, already covered by the
 * universal reduced-motion clamp in `index.css`.
 */
export function useDockDrag(dock: Dock): DockDrag {
  /**
   * The dock API, kept current for handlers that are created once.
   *
   * Every callback below is `useCallback([])` so that the listeners can be
   * added and removed by identity, which means none of them may close over
   * `dock` -- a new object on every render. Updated in an effect rather than
   * during render, so a concurrent render that is thrown away cannot leave a
   * stale API behind. A pointer event always arrives after the commit and the
   * effects of the render that drew what it landed on, so the value read here
   * is the value that is on screen.
   */
  const api = useRef(dock);
  useEffect(() => {
    api.current = dock;
  });

  const els = useRef(new Map<PanelId, HTMLElement>());
  const drag = useRef<DragState | null>(null);
  const frame = useRef(0);

  const attach = useCallback((id: PanelId, el: HTMLElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  }, []);

  /** Where the window should sit, given where the pointer is holding it. */
  const posFor = useCallback(
    (d: DragState) => clampFloat(d.px - d.grabDX, d.py - d.grabDY),
    [],
  );

  const tick = useCallback(() => {
    const d = drag.current;
    if (!d) {
      frame.current = 0;
      return;
    }
    frame.current = requestAnimationFrame(tick);
    if (!d.armed) return;

    if (d.moved && d.travelled) {
      d.moved = false;
      const over = stripAt(d.px, d.py);
      /*
        A collapsed dock is not a target. This is belt and braces and worth
        keeping as both: a collapsed rail renders an `EdgeHandle` and no tab
        strip at all, so `stripAt` cannot return its side today -- but that is
        a fact about how `DockRail` happens to render, and the rule is a fact
        about the specification. If the edge handle ever grows a strip-like
        affordance, this line is what stops it becoming a drop target by
        accident.
      */
      const side = over && !api.current.collapsed[over] ? over : null;

      if (side !== d.docked) {
        const leaving = d.docked;
        if (side) {
          // Remembered before `dock` fronts us, and only the first time this
          // gesture visits this dock -- entering it twice must not record our
          // own panel as the thing to restore.
          if (!(side in d.restore)) d.restore[side] = api.current.active[side];
          // `dock` fronts the panel itself, which is the spec's "the dropped
          // panel becomes the fronted tab", and puts it in its canonical slot,
          // because a docked placement is a side and nothing else.
          api.current.dock(d.id, side);
        } else {
          const at = posFor(d);
          api.current.float(d.id, { ...at, w: d.w, h: d.h });
        }
        if (leaving) {
          const back = d.restore[leaving];
          if (back && back !== d.id) api.current.setActive(leaving, back);
        }
        d.docked = side;
      }
    }

    if (d.docked === null) {
      const el = els.current.get(d.id);
      if (el) {
        const at = posFor(d);
        el.style.left = `${at.x}px`;
        el.style.top = `${at.y}px`;
      }
    }
  }, [posFor]);

  const onMove = useCallback(
    (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      d.px = ev.clientX;
      d.py = ev.clientY;
      d.moved = true;

      if (d.travelled) return;
      if (
        Math.abs(ev.clientX - d.x0) + Math.abs(ev.clientY - d.y0) <=
        TEAR_AT
      ) {
        return;
      }
      // Past the threshold. For a window drag that is all this means -- the
      // window was already following the pointer, and what changes is that
      // tab strips start being targets. For a tab press it is the tear-off.
      d.travelled = true;
      if (d.armed) return;
      /*
        The tear-off. The panel becomes a window immediately and under the
        pointer, rather than on release -- the tab it came from is gone by the
        next frame, so anything less than immediate would leave the gesture
        holding nothing.

        `userSelect` is suppressed here rather than at pointer-down: a press
        that never becomes a drag must leave the document exactly as it found
        it, because that press is a click or half of a double-click.
      */
      d.armed = true;
      document.body.style.userSelect = "none";
      const at = posFor(d);
      api.current.float(d.id, { ...at, w: d.w, h: d.h });
      d.docked = null;
    },
    [posFor],
  );

  const onEnd = useCallback(
    (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || ev.pointerId !== d.pointerId) return;

      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (frame.current) {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
      }
      drag.current = null;

      // Never armed: this was a click on a tab, and the whole job is to have
      // left no trace for the tab's own handlers to trip over.
      if (!d.armed) return;

      document.body.style.userSelect = "";
      /*
        Commit the position React does not know about yet. The docked case
        needs nothing: `dock()` already wrote the placement, live, which is the
        specification.

        `pointercancel` lands here too, and deliberately ends the gesture where
        it stands rather than rewinding it. There is nothing to rewind -- every
        dock and un-dock in the stroke was committed as it happened -- and the
        only uncommitted state is the position painted on the element, which is
        what this writes down. A cancel that snapped the window back to where
        the drag began would be the one part of the gesture that was not
        reversible.
      */
      if (d.docked === null) {
        const at = posFor(d);
        api.current.moveFloat(d.id, at.x, at.y);
      }
    },
    [onMove, posFor],
  );

  const listen = useCallback(() => {
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    if (!frame.current) frame.current = requestAnimationFrame(tick);
  }, [onMove, onEnd, tick]);

  const startWindow = useCallback(
    (e: ReactPointerEvent, id: PanelId) => {
      if (e.button !== 0) return;
      const p = api.current.layout[id];
      if (p.kind !== "float") return;
      /*
        `preventDefault` for the same reason `FloatShell`'s own move handler
        does it: without it, a drag across the console selects every run of
        text it crosses. It does suppress the focus a press would otherwise
        perform -- that is the defect B1 found in exactly this position -- but
        `FloatShell` takes focus itself in the capture phase, which runs before
        this, so `Escape` still reaches the window being dragged.
      */
      e.preventDefault();
      const rect = els.current.get(id)?.getBoundingClientRect();
      drag.current = {
        id,
        pointerId: e.pointerId,
        // The rect is what the window is actually at, which mid-flight is not
        // necessarily what the layout says -- a previous drag may have painted
        // it. Falling back to the placement is only for the impossible case of
        // a title bar pressed before its own element registered.
        grabDX: e.clientX - (rect?.left ?? p.x),
        grabDY: e.clientY - (rect?.top ?? p.y),
        w: p.w,
        h: p.h,
        docked: null,
        armed: true,
        travelled: false,
        px: e.clientX,
        py: e.clientY,
        x0: e.clientX,
        y0: e.clientY,
        moved: false,
        restore: {},
      };
      document.body.style.userSelect = "none";
      listen();
    },
    [listen],
  );

  const startTab = useCallback(
    (e: ReactPointerEvent, id: PanelId, side: DockSide) => {
      if (e.button !== 0) return;
      /*
        No `preventDefault`, no `stopPropagation`, and nothing written to the
        document. A press on a tab is a click until it has travelled far
        enough not to be, and both of the tab's existing gestures have to
        survive it untouched: the click that fronts the panel, and the
        double-click that floats it. Suppressing the default here would take
        the focus with it, which is the defect B1 found on the window's title
        bar.

        The threshold and the double-click are therefore not separated by any
        rule that has to guess -- no timer, no `detail` count, no
        `pointercancel` heuristic, all of which have to decide what a gesture
        *meant*. A press that stays within `TEAR_AT` does nothing at all and
        the click path is untouched; a press that leaves it has already become
        a drag by any reading. The one overlap left -- a double-click whose
        second press wobbles past the threshold -- is handled at the other end,
        by `float()` being idempotent about position. See its docblock.
      */
      const rect = e.currentTarget.getBoundingClientRect();
      drag.current = {
        id,
        pointerId: e.pointerId,
        // Measured against the tab, so the new window's title bar arrives under
        // the cursor at the same relative spot the tab was grabbed at. The tab
        // is narrower than the window, so this always lands inside it.
        grabDX: e.clientX - rect.left,
        grabDY: e.clientY - rect.top,
        w: FLOAT_W,
        h: FLOAT_H,
        docked: side,
        armed: false,
        travelled: false,
        px: e.clientX,
        py: e.clientY,
        x0: e.clientX,
        y0: e.clientY,
        moved: false,
        restore: {},
      };
      listen();
    },
    [listen],
  );

  /**
   * A gesture cannot outlive the console.
   *
   * Unmounting mid-drag is not reachable by pointer -- there is no control
   * that navigates away while a button is held -- but a hot reload during
   * development is, and a listener left on `window` holding a closure over a
   * disposed hook is the exact failure that ruled out option (2) above. It
   * would be poor form to reject that design and then leave its bug in.
   */
  useEffect(
    () => () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (frame.current) cancelAnimationFrame(frame.current);
      document.body.style.userSelect = "";
    },
    [onMove, onEnd],
  );

  return { startWindow, startTab, attach };
}
