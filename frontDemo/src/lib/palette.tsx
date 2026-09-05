/**
 * Runtime colour control, for both surfaces.
 *
 * Colour in this project lives in two unrelated places and neither is
 * adjustable without an edit and a reload:
 *
 *  - the **tokens** are CSS custom properties, re-pointed under
 *    `[data-surface]` in `index.css`. Everything token-driven -- every plate,
 *    every chart, every rule and label on both surfaces -- follows them, so
 *    overriding a token recolours the whole surface at once
 *  - the **map paint** is a `MapPaint` literal in `theme.ts`, consumed by
 *    MapLibre through `setPaintProperty` rather than by CSS. No token reaches
 *    it, and it has to be overridden separately
 *
 * This module carries both as one overlay. Token overrides are written as
 * inline custom properties on the surface root, which is the same element that
 * already carries `data-surface` and the font variables; map overrides are
 * merged over the surface's shipped `MapPaint` and handed to `MapCanvas`,
 * whose theme effect already re-applies paint live.
 *
 * The overlay is **session state on purpose**. It is a dialling-in tool, not a
 * preference: a palette that survived a reload would quietly become the
 * product's real palette without anyone having edited the source it is supposed
 * to be tried out against. The export closes that loop instead -- it emits
 * every field with its default, its current value and the file and key that
 * owns it, which is enough to apply a palette to source in one pass.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { SURFACES, type MapPaint, type SurfaceKey } from "../theme";

/* ------------------------------------------------------------------ *
 * What can be changed
 * ------------------------------------------------------------------ */

export interface TokenSpec {
  /** The custom property, including the leading dashes. */
  name: string;
  label: string;
  /** The value shipped in `index.css`, for the reset and the export. */
  value: string;
  /**
   * What moving this actually changes, in plain words.
   *
   * Not the token's name restated. `--ink-dim` means nothing to anyone who did
   * not write it; what it *is* is the colour of the explanatory sentence under
   * a heading. Every control in this panel changes something a person can point
   * at on screen, and this field names that thing rather than the variable that
   * happens to carry it.
   */
  blurb: string;
}

/**
 * The token ladders, mirroring `index.css`.
 *
 * Held as a literal rather than read back from `getComputedStyle` because the
 * export needs the shipped default *and* the source location, and a computed
 * read of an already-overridden element can give neither.
 */
export const SURFACE_TOKENS: Record<SurfaceKey, TokenSpec[]> = {
  site: [
    { name: "--ink", label: "headlines and body text", value: "#f4f1ea",
      blurb: "The main writing — headlines, paragraphs, and the numbers inside the figures." },
    { name: "--ink-dim", label: "captions and side notes", value: "#a49a8d",
      blurb: "The quieter writing: figure captions, margin notes, the sentence under a heading." },
    { name: "--ink-faint", label: "small labels", value: "#6a625a",
      blurb: "The smallest type — axis ticks, units, the little uppercase tag above a section." },
    { name: "--base", label: "the page background", value: "#0d0c0a",
      blurb: "The colour of the whole page, behind everything else." },
    { name: "--base-2", label: "background behind figures", value: "#141210",
      blurb: "The slightly lighter panel the framed charts and the maps sit on." },
    { name: "--base-3", label: "raised background", value: "#1d1a17",
      blurb: "For anything meant to sit one step above the page, such as a title bar." },
    { name: "--line", label: "rules and borders", value: "#2a2723",
      blurb: "Every hairline: the dividers between sections, chart frames, the grid inside a plot." },
    { name: "--accent", label: "the orange", value: "#ff7a2f",
      blurb: "The oil colour, and the page's one highlight: section numbers, the slick on every figure, and the ship in the margin." },
    { name: "--accent-ink", label: "text on orange", value: "#140a03",
      blurb: "What writing turns into when it sits on top of an orange fill." },
    { name: "--warn", label: "caution yellow", value: "#f0c419",
      blurb: "Marks something to be careful about — a weak wind gate, or fixed infrastructure on a map." },
    { name: "--alarm", label: "alarm red", value: "#ff4d4d",
      blurb: "The loudest state on the page: not enough evidence to name anyone, and ships with no transponder." },
    { name: "--cta", label: "the console button", value: "#ff4a1c",
      blurb: "The single filled button on the page — the door into the console." },
    { name: "--cta-ink", label: "text on that button", value: "#160702",
      blurb: "The writing inside the console button." },
  ],
  console: [
    { name: "--ink", label: "readout text", value: "#d5e0d9",
      blurb: "The main writing in every panel — values, panel titles, table cells." },
    { name: "--ink-dim", label: "explanatory text", value: "#83978c",
      blurb: "The sentences that explain a readout, and the names of tabs you are not on." },
    { name: "--ink-faint", label: "small labels", value: "#5a6b62",
      blurb: "Field labels, axis ticks and units — the smallest type on the surface." },
    { name: "--base", label: "the console background", value: "#0e1211",
      blurb: "The colour behind the whole workstation." },
    { name: "--base-2", label: "panel background", value: "#141a17",
      blurb: "The ground inside every docked panel and floating window." },
    { name: "--base-3", label: "panel title bars", value: "#1b231f",
      blurb: "The strip across the top of a panel, and the grips you drag to resize one." },
    { name: "--line", label: "rules and borders", value: "#26322c",
      blurb: "Every hairline: panel edges, table rules, and the grid drawn on the scopes." },
    { name: "--accent", label: "the phosphor green", value: "#4fe08a",
      blurb: "Active tabs, selected values, the playhead on the timeline, and the outline of a floating window." },
    { name: "--accent-ink", label: "text on green", value: "#02120a",
      blurb: "What writing turns into when it sits on a green fill." },
    { name: "--warn", label: "caution amber", value: "#ffbd2e",
      blurb: "The forecast horizon, the simulated-data flag, and platforms on the map." },
    { name: "--alarm", label: "alarm red", value: "#ff5f56",
      blurb: "Not enough evidence to name anyone, and radar contacts with no transponder." },
    { name: "--group", label: "control group bands", value: "#1c4a33",
      blurb: "The filled strip that names a group of switches in the control panel." },
    { name: "--group-ink", label: "text on those bands", value: "#bdf5d5",
      blurb: "The writing inside a control group band." },
  ],
};

/* ------------------------------------------------------------------ *
 * The map's fields, sorted by the control each one needs
 * ------------------------------------------------------------------ */

/**
 * The four lists below are the panel's field inventory, and between them they
 * must name every member of `MapPaint`.
 *
 * They are split by the *control* a field needs rather than by what it means,
 * because that is the only split the panel can act on: a hex string gets a
 * swatch and three channels, a number gets a slider, a fixed set of values
 * gets a menu, and a boolean gets a checkbox. Nothing else about a field
 * changes how it is edited.
 *
 * Each is written `as const satisfies` rather than annotated. The annotation
 * would widen every `key` to `keyof MapPaint`, and the whole point of the
 * arrangement is that the union of the four `key` types can be compared
 * against `keyof MapPaint` at compile time -- see `PAINT_COVERAGE` at the foot
 * of the file. That check is what closes the export gap at its source instead
 * of closing it once: a field added to `MapPaint` tomorrow fails the build
 * until somebody has decided which control it gets.
 */
export interface MapColourField {
  key: keyof MapPaint;
  label: string;
  blurb: string;
}

export interface MapNumberField {
  key: keyof MapPaint;
  label: string;
  blurb: string;
  min: number;
  max: number;
  step: number;
}

/** A field whose value is one of a fixed, named set rather than a quantity. */
export interface MapChoiceField {
  key: keyof MapPaint;
  label: string;
  blurb: string;
  options: readonly { value: string; label: string }[];
}

/** A field that is on or off. */
export interface MapFlagField {
  key: keyof MapPaint;
  label: string;
  blurb: string;
  /** Which group of the panel the checkbox belongs under. */
  group: "ink" | "basemap";
}

/** Every colour field on `MapPaint`, in the order the panel lists them. */
export const MAP_COLOUR_FIELDS = [
  { key: "slick", label: "the oil itself", blurb:
    "The patch the detector outlined and called an operational discharge." },
  { key: "slickUnknown", label: "oil of unknown origin", blurb:
    "The same outline when the detector could not say where it came from. A separate colour so the two classes never blur together." },
  { key: "contour50", label: "the likely area", blurb:
    "The inner ring — where the oil most probably is at the hour on the clock." },
  { key: "contour90", label: "the outer area", blurb:
    "The wider ring. The oil is almost certainly inside it, but it rules out far less." },
  { key: "particle", label: "the drifting specks", blurb:
    "The cloud of individual particles the drift model pushes across the map." },
  { key: "forecast", label: "where it will reach", blurb:
    "The shaded footprint of everywhere the oil could get to over the forecast." },
  { key: "target", label: "radar contacts and markers", blurb:
    "Ships the radar saw that also match a transponder, plus the slick's head, tail and centre line." },
  { key: "dark", label: "ships with no transponder", blurb:
    "A radar contact broadcasting nothing. It is ranked but never named, so this one should stay loud." },
  { key: "suspect", label: "the suspected ship's track", blurb:
    "The path of whichever vessel is selected, and the stretch of it that puts the ship inside the oil's origin." },
  { key: "candidate", label: "other candidates' tracks", blurb:
    "Ships that survived the filter but are not selected. Kept close to the rejected traffic on purpose — a busy scene can hold twenty of them." },
  { key: "traffic", label: "ships that were ruled out", blurb:
    "Every other vessel in the scene. The dimmest thing on the map, deliberately." },
  { key: "infrastructure", label: "platforms and pipelines", blurb:
    "Fixed installations. They compete with ships on the same scale and can outrank them." },
  { key: "graticule", label: "the latitude and longitude grid", blurb:
    "The faint degree grid drawn over the sea." },
  { key: "water", label: "the ground under the world map", blurb:
    "A flat colour covering the whole map, drawn under everything. You only see it where the world map is faded or missing — fade that to nothing and this becomes the sea. It is also why the map is never blank when the tiles fail to load." },
  { key: "basemapTint", label: "wash over the world map", blurb:
    "A see-through layer between the world map and the data. It is how a grey coastline takes on this surface's colour — and it washes land and sea together, because it sits over both." },
] as const satisfies readonly MapColourField[];

/** The numeric side of the map's look. Sliders, not colour. */
export const MAP_NUMBER_FIELDS = [
  { key: "basemapOpacity", label: "how visible the coastline is",
    blurb: "Fades the real-world map in and out behind the data. At zero only the sea colour and the local grid are left.",
    min: 0, max: 1, step: 0.01 },
  { key: "basemapSaturation", label: "colour in the coastline",
    blurb: "Drains the world map to grey, or pushes its colour back in.",
    min: -1, max: 1, step: 0.01 },
  { key: "basemapContrast", label: "coastline contrast",
    blurb: "Hardens or flattens the difference between land and sea. Pushed too far it crushes the whole thing to black.",
    min: -1, max: 1, step: 0.01 },
  { key: "basemapBrightnessMin", label: "lift the dark parts",
    blurb: "Raises the darkest parts of the world map. On the dark basemap the open sea is the darkest thing in the picture, so this is the closest thing to a sea control — and it is what actually turns a near-black map grey.",
    min: 0, max: 1, step: 0.01 },
  { key: "basemapBrightnessMax", label: "hold the bright parts down",
    blurb: "Caps the lightest parts, which on the dark basemap are the land and the coastline. The nearest thing to a land control. On an already dark map it does little by itself.",
    min: 0, max: 1, step: 0.01 },
  { key: "basemapTintOpacity", label: "strength of the wash",
    blurb: "How much of the tint colour above sits over the coastline.",
    min: 0, max: 1, step: 0.01 },
  // "every drawn line on the map at once" is what this used to say, and it was
  // not true: `strokeScale` multiplies seven of the fourteen line weights in
  // `dataLayers`. The degree grid, the forecast's dashes, the slick's centre
  // line, the glow under the matched leg and the rings around radar contacts,
  // platforms and markers all carry a fixed weight on purpose -- they are
  // furniture and annotation rather than the results, and scaling them with
  // the results is what turns a thickened map into a solid one.
  { key: "strokeScale", label: "line thickness",
    blurb: "Thickens or thins the results together: ship tracks, the slick's outline, the credible-region rings and the released oil. The grid, the forecast's dashes, the centre line and the rings around contacts keep the weight they were drawn at.",
    min: 0.4, max: 2.4, step: 0.05 },
  { key: "graticuleStepDeg", label: "spacing of the grid",
    blurb: "How far apart the latitude and longitude lines are drawn, in degrees. A smaller number means a denser grid.",
    min: 0.05, max: 1, step: 0.05 },
] as const satisfies readonly MapNumberField[];

/**
 * Fields chosen from a fixed set. One so far.
 *
 * `basemap` is the only field on `MapPaint` that changes the *structure* of
 * the MapLibre style rather than a value inside it: it names which tile
 * service the raster source points at, so it cannot be dialled through
 * `setPaintProperty` the way every number above can. The blurb says so, in the
 * only terms that matter to whoever is moving it -- that the coastline goes
 * away for a moment while the new tiles arrive, and that nothing else does.
 */
export const MAP_CHOICE_FIELDS = [
  { key: "basemap", label: "which world map", blurb:
    "What the data is drawn on top of. The sea chart carries depth and sea-floor relief, which is what an instrument wants under it; the two diagrams carry the coastline and almost nothing else, one for a dark surface and one for a light one; the last draws no world at all and leaves the degree grid to hold the geography on its own. Changing this fetches a different set of tiles, so the coastline is missing for a moment while they arrive — the oil, the tracks and the rings stay exactly where they are.",
    options: [
      { value: "ocean", label: "sea chart — depth and sea-floor relief" },
      { value: "canvas", label: "dark diagram — coastline only" },
      { value: "paper", label: "light diagram — coastline on white" },
      { value: "none", label: "no world map — the grid alone" },
    ] },
] as const satisfies readonly MapChoiceField[];

/**
 * The map's two switches.
 *
 * They sit here rather than in the attribute menus for the same reason a
 * checkbox is not a swatch: the menus above choose *which* field the swatch or
 * the slider is pointed at, and a switch has nothing for them to point at. So
 * both are drawn permanently under their group, always visible, each with its
 * own revert.
 *
 * `contourFill` was already drawn this way and is simply described here now
 * instead of being hard-coded into the panel; `showLabels` joins it, which is
 * what took the export from twenty-four of `MapPaint`'s twenty-six fields to
 * all of them.
 */
export const MAP_FLAG_FIELDS = [
  { key: "contourFill", group: "ink", label: "fill the credible-region bands", blurb:
    "Whether the 50% and 90% rings are washed in or left as line work. Filled reads as an area and is easier to see at a glance; unfilled leaves the oil and the tracks underneath them unobscured." },
  { key: "showLabels", group: "basemap", label: "place names on the world map", blurb:
    "Coastlines, seas and ports, drawn from a second set of tiles over everything else. Turning this off stops those tiles being fetched at all, which is what separates it from the layer switch of the same name in the console: the switch hides the names, this one decides whether they are loaded." },
] as const satisfies readonly MapFlagField[];

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export interface PaletteApi {
  surface: SurfaceKey;
  /** Token overrides, keyed by custom property name. */
  tokens: Record<string, string>;
  /** Map paint overrides, merged over the surface's shipped literal. */
  map: Partial<MapPaint>;
  /** The merged paint every map on this surface should be drawn with. */
  paint: MapPaint;
  setToken: (name: string, value: string) => void;
  setMapField: (key: keyof MapPaint, value: string | number | boolean) => void;
  /** Put one field back to what shipped, leaving every other change alone. */
  clearToken: (name: string) => void;
  clearMapField: (key: keyof MapPaint) => void;
  reset: () => void;
  /** True once anything has been moved off its shipped value. */
  dirty: boolean;
}

const Ctx = createContext<PaletteApi | null>(null);

export function PaletteProvider({
  surface,
  children,
}: {
  surface: SurfaceKey;
  children: ReactNode;
}) {
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [map, setMap] = useState<Partial<MapPaint>>({});

  const setToken = useCallback((name: string, value: string) => {
    setTokens((prev) => ({ ...prev, [name]: value }));
  }, []);

  const setMapField = useCallback(
    (key: keyof MapPaint, value: string | number | boolean) => {
      setMap((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // Deleting the key rather than writing the shipped value back: the override
  // record is the diff, and an entry that happens to equal the default would
  // still show up in the export as something somebody chose.
  const clearToken = useCallback((name: string) => {
    setTokens((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const clearMapField = useCallback((key: keyof MapPaint) => {
    setMap((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setTokens({});
    setMap({});
  }, []);

  const paint = useMemo(
    () => ({ ...SURFACES[surface].map, ...map }) as MapPaint,
    [surface, map],
  );

  const api = useMemo<PaletteApi>(
    () => ({
      surface,
      tokens,
      map,
      paint,
      setToken,
      setMapField,
      clearToken,
      clearMapField,
      reset,
      dirty: Object.keys(tokens).length > 0 || Object.keys(map).length > 0,
    }),
    [surface, tokens, map, paint, setToken, setMapField, clearToken, clearMapField, reset],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/**
 * The palette for the surface being rendered.
 *
 * Falls back to an inert overlay rather than throwing when no provider is
 * mounted, so a figure can be rendered outside the shell without one.
 */
export function usePalette(): PaletteApi {
  const ctx = useContext(Ctx);
  const inert = useMemo<PaletteApi>(
    () => ({
      surface: "site" as SurfaceKey,
      tokens: {},
      map: {},
      paint: SURFACES.site.map,
      setToken: () => {},
      setMapField: () => {},
      clearToken: () => {},
      clearMapField: () => {},
      reset: () => {},
      dirty: false,
    }),
    [],
  );
  return ctx ?? inert;
}

/** The merged map paint. The one thing most callers want. */
export function usePaint(): MapPaint {
  return usePalette().paint;
}

/** Token overrides as inline custom properties, for the surface root. */
export function tokenStyle(tokens: Record<string, string>): CSSProperties {
  return tokens as CSSProperties;
}

/* ------------------------------------------------------------------ *
 * Colour arithmetic
 * ------------------------------------------------------------------ */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const s = hex.trim().replace(/^#/, "");
  const full =
    s.length === 3
      ? s
          .split("")
          .map((c) => c + c)
          .join("")
      : s.padEnd(6, "0").slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Whether a string is a hex colour this panel can edit. */
export function isHex(value: string): boolean {
  return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

/**
 * One line of the export.
 *
 * `current` and `default` are already a union of the three primitive shapes
 * `MapPaint` uses, so the enum and the boolean the panel gained need nothing
 * added: `basemap` is a string like every colour, `showLabels` a boolean like
 * `contourFill`. Nothing is being coerced into a slot meant for something
 * else, and `changed` stays a strict comparison of two primitives, which is
 * exactly as sound for `"canvas" !== "ocean"` as it is for `true !== false`.
 *
 * The one place the record does bend is `default`: a field that is optional on
 * `MapPaint` and genuinely unset would be written as `""` rather than as
 * `null`, because there is no fourth member of the union to say "absent" with.
 * Both optional fields -- `basemapTint` and `basemapTintOpacity` -- are set on
 * both shipped surfaces, so no export has ever taken that branch; it is
 * recorded here so that the next person to make a field optional knows what it
 * will look like when one does.
 */
interface ExportField {
  current: string | number | boolean;
  default: string | number | boolean;
  changed: boolean;
  source: string;
}

/**
 * Every token and every paint field, with the file and key that owns it.
 *
 * Both surfaces are written whichever one the panel was opened on, so one file
 * carries a whole palette. The `source` string is the point of the export: it
 * is what turns "this looked right on screen" into an edit somebody can make.
 */
export function exportPalette(
  tokens: Record<string, string>,
  map: Partial<MapPaint>,
  surface: SurfaceKey,
): string {
  const out: Record<string, unknown> = {
    generatedBy: "SlickTrace colour panel",
    generatedAt: new Date().toISOString(),
    editedSurface: surface,
    note:
      "Token values live in src/index.css under their [data-surface] block; " +
      "map paint lives in src/theme.ts on SURFACES.<surface>.map. " +
      "Every member of the MapPaint interface is listed under map, and the " +
      "panel's field lists are checked against that interface at compile " +
      "time, so this file cannot fall behind it. " +
      "Fields with changed: false are still at their shipped value.",
  };

  for (const key of ["site", "console"] as SurfaceKey[]) {
    const tokenFields: Record<string, ExportField> = {};
    for (const spec of SURFACE_TOKENS[key]) {
      const overridden = key === surface ? tokens[spec.name] : undefined;
      tokenFields[spec.name] = {
        current: overridden ?? spec.value,
        default: spec.value,
        changed: overridden !== undefined && overridden !== spec.value,
        source: `src/index.css → [data-surface="${key}"] ${spec.name}`,
      };
    }

    const base = SURFACES[key].map;
    const paintFields: Record<string, ExportField> = {};
    // The panel's whole field inventory, which `PAINT_COVERAGE` below proves
    // is the whole of `MapPaint`. It used to be the colour and number lists
    // plus a hard-coded "contourFill", which is how `basemap` and `showLabels`
    // came to be missing: the list was the panel's editable fields, and those
    // two were not editable.
    const paintKeys: readonly (keyof MapPaint)[] = [
      ...MAP_COLOUR_FIELDS.map((f) => f.key),
      ...MAP_NUMBER_FIELDS.map((f) => f.key),
      ...MAP_CHOICE_FIELDS.map((f) => f.key),
      ...MAP_FLAG_FIELDS.map((f) => f.key),
    ];
    for (const field of paintKeys) {
      const shipped = base[field] as string | number | boolean | undefined;
      const overridden =
        key === surface
          ? (map[field] as string | number | boolean | undefined)
          : undefined;
      paintFields[field] = {
        current: overridden ?? shipped ?? "",
        default: shipped ?? "",
        changed: overridden !== undefined && overridden !== shipped,
        source: `src/theme.ts → SURFACES.${key}.map.${field}`,
      };
    }

    out[key] = { tokens: tokenFields, map: paintFields };
  }

  return JSON.stringify(out, null, 2);
}

/** Hand the export to the browser as a download. */
export function downloadPalette(
  tokens: Record<string, string>,
  map: Partial<MapPaint>,
  surface: SurfaceKey,
) {
  const blob = new Blob([exportPalette(tokens, map, surface)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "slicktrace-palette.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick rather than synchronously: revoking as soon as
  // `click()` returns races the download in Firefox, which has not necessarily
  // read the blob yet.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ *
 * Coverage
 * ------------------------------------------------------------------ */

/** Every `MapPaint` key the panel has a control for. */
type ControlledPaintKey =
  | (typeof MAP_COLOUR_FIELDS)[number]["key"]
  | (typeof MAP_NUMBER_FIELDS)[number]["key"]
  | (typeof MAP_CHOICE_FIELDS)[number]["key"]
  | (typeof MAP_FLAG_FIELDS)[number]["key"];

/** Every `MapPaint` key it does not. Should be, and is, `never`. */
type UncontrolledPaintKey = Exclude<keyof MapPaint, ControlledPaintKey>;

/**
 * Proof, at compile time, that the export describes all of `MapPaint`.
 *
 * The gap this closes was not that two fields had been forgotten. It was that
 * the export's field list was assembled from the panel's *editable* fields,
 * which made "what can be dialled in" and "what the file claims to describe"
 * the same list by construction -- so any field without a control silently
 * fell out of a file whose own note says it describes the map paint. Adding
 * the two missing keys would have fixed this once; it would not have stopped
 * the twenty-seventh field from doing exactly the same thing.
 *
 * So the invariant is asserted instead of maintained. If `MapPaint` gains a
 * member that none of the four field lists names, `UncontrolledPaintKey` stops
 * being `never`, the declared type of this constant becomes a tuple, and the
 * string below stops being assignable to it -- a build error that names the
 * field it is missing. Exported rather than local only because
 * `noUnusedLocals` is on and an unused constant is itself an error; nothing
 * reads it, and nothing should.
 */
export const PAINT_COVERAGE: [UncontrolledPaintKey] extends [never]
  ? "every MapPaint field has a control and is exported"
  : [
      "MapPaint fields with no control in the colour panel:",
      UncontrolledPaintKey,
    ] = "every MapPaint field has a control and is exported";
