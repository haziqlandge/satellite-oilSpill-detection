/**
 * Where the statement sequence's cards stand, in stage pixels (1920 x 1080).
 *
 * Both states of a moving card are written down rather than measured: the row
 * the objectives build in the middle of the screen, and the column they reflow
 * into on the left, about 36% of the width, leaving the wider right side for
 * the solutions and their images.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ROW = { w: 330, h: 384, gap: 24, top: 404, centre: 960 };

export function rowRects(visible: number): Rect[] {
  const total = visible * ROW.w + (visible - 1) * ROW.gap;
  const x0 = ROW.centre - total / 2;
  return Array.from({ length: visible }, (_, i) => ({ x: x0 + i * (ROW.w + ROW.gap), y: ROW.top, w: ROW.w, h: ROW.h }));
}

/**
 * The split screen: 70 px margins either side, the objective column on the
 * left and the solution grid on the right sharing one top and one bottom edge
 * (the user, 2026-09-27: the right side ran higher and lower than the left).
 */
export const SPLIT = { margin: 70, top: 172, bottom: 1030, pillY: 104 } as const;

const COLUMN = { x: SPLIT.margin, w: 600, h: 158, gap: 17, top: SPLIT.top };

/** The right side: from 60 px after the column to the right margin. */
export const RIGHT = { x: SPLIT.margin + 600 + 60, w: 1920 - SPLIT.margin - (SPLIT.margin + 600 + 60) } as const;

export const COLUMN_RECTS: readonly Rect[] = Array.from({ length: 5 }, (_, i) => ({
  x: COLUMN.x,
  y: COLUMN.top + i * (COLUMN.h + COLUMN.gap),
  w: COLUMN.w,
  h: COLUMN.h,
}));

/** The objective icon inside a card, in each state (card-relative). */
export const ICON = {
  size: 96,
  row: { left: (ROW.w - 96) / 2, top: 48, scale: 1 },
  column: { left: 28, top: (COLUMN.h - 72) / 2, scale: 0.75 },
} as const;

/**
 * Heading pills: the statement's centre, the top of the centred statement and
 * objective row (both groups sit about the middle of the screen), and each
 * side's left edge once the screen splits. Split pills span their own side.
 */
export const PILLS = {
  centre: { x: 960, y: 540 },
  top: { x: 960, y: 300 },
  left: { x: COLUMN.x, y: SPLIT.pillY, w: COLUMN.w },
  right: { x: RIGHT.x, y: SPLIT.pillY, w: RIGHT.w },
} as const;

/** Where the statement's title starts, under its pill. */
export const STATEMENT_TOP = 384;

/**
 * The right side, about 64% of the width: a 2 x 2 grid of image cards, then a
 * row of three icon cards. The last solutions are icons on purpose -- by then
 * the space an image would need is taken.
 */
const IMG = { w: 540, h: 330, gap: 20 };
const ICON_ROW = { y: SPLIT.top + 2 * (IMG.h + IMG.gap), gap: 20 };
const ICON_W = (RIGHT.w - 2 * ICON_ROW.gap) / 3;
export const SOLUTION_SLOTS: readonly Rect[] = [
  { x: RIGHT.x, y: SPLIT.top, w: IMG.w, h: IMG.h },
  { x: RIGHT.x + RIGHT.w - IMG.w, y: SPLIT.top, w: IMG.w, h: IMG.h },
  { x: RIGHT.x, y: SPLIT.top + IMG.h + IMG.gap, w: IMG.w, h: IMG.h },
  { x: RIGHT.x + RIGHT.w - IMG.w, y: SPLIT.top + IMG.h + IMG.gap, w: IMG.w, h: IMG.h },
  ...[0, 1, 2].map((k) => ({ x: RIGHT.x + k * (ICON_W + ICON_ROW.gap), y: ICON_ROW.y, w: ICON_W, h: SPLIT.bottom - ICON_ROW.y })),
];

/** Where a solution first lands, large, before it settles into its slot: the middle of the right side. */
export const HERO = { cx: RIGHT.x + RIGHT.w / 2, cy: (SPLIT.top + SPLIT.bottom) / 2, imageScale: 1.6, iconScale: 1.8 } as const;
