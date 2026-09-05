/**
 * The colour panel, shared by both surfaces.
 *
 * One control at a time rather than a wall of swatches. The panel is for
 * *dialling in* a colour -- moving a channel and watching the map or the page
 * answer -- and a list of thirty pickers makes that a hunt through a list
 * instead. A group, then a field, then three channels.
 *
 * Two kinds of thing are edited through the same frame and they reach the
 * screen by completely different routes, which is why the group selector names
 * them plainly:
 *
 *  - **map ink** and **basemap look** are `MapPaint`, applied by MapLibre
 *    through `setPaintProperty`
 *  - **surface tokens** are CSS custom properties, and moving one recolours
 *    every figure, rule and label on the surface at once, because everything
 *    outside the map is token-driven
 *
 * The panel draws itself entirely from those same tokens, so it is the first
 * thing to show what a token change did.
 */

import { useMemo, useState } from "react";
import {
  MAP_CHOICE_FIELDS,
  MAP_COLOUR_FIELDS,
  MAP_FLAG_FIELDS,
  MAP_NUMBER_FIELDS,
  SURFACE_TOKENS,
  downloadPalette,
  hexToRgb,
  isHex,
  rgbToHex,
  usePalette,
  type MapChoiceField,
  type MapFlagField,
} from "../lib/palette";
import { canShowLabels } from "../map/basemap";
import { SURFACES, type MapPaint } from "../theme";

type Group = "ink" | "basemap" | "tokens";

const GROUPS: { key: Group; label: string }[] = [
  { key: "ink", label: "map ink" },
  { key: "basemap", label: "basemap look" },
  { key: "tokens", label: "surface tokens" },
];

export function PalettePanel() {
  const palette = usePalette();
  const [group, setGroup] = useState<Group>("ink");
  const [inkField, setInkField] = useState<keyof MapPaint>("slick");
  const [numField, setNumField] = useState<keyof MapPaint>("basemapOpacity");
  const [tokenName, setTokenName] = useState<string>("--accent");

  const tokens = SURFACE_TOKENS[palette.surface];
  const shipped = SURFACES[palette.surface].map;

  // The value the selected control is currently showing, whichever group is
  // open. Falls back to the shipped literal when nothing has been overridden.
  const colour = useMemo(() => {
    if (group === "tokens") {
      const spec = tokens.find((t) => t.name === tokenName);
      return palette.tokens[tokenName] ?? spec?.value ?? "#000000";
    }
    const current = (palette.paint[inkField] ?? shipped[inkField]) as
      | string
      | undefined;
    return current ?? "#000000";
  }, [group, tokenName, inkField, palette.tokens, palette.paint, tokens, shipped]);

  const rgb = hexToRgb(colour);

  /** The plain-language sentence for whatever control is currently open. */
  const blurb = useMemo(() => {
    if (group === "tokens") {
      return tokens.find((t) => t.name === tokenName)?.blurb ?? "";
    }
    if (group === "basemap") {
      return MAP_NUMBER_FIELDS.find((f) => f.key === numField)?.blurb ?? "";
    }
    return MAP_COLOUR_FIELDS.find((f) => f.key === inkField)?.blurb ?? "";
  }, [group, tokenName, numField, inkField, tokens]);

  /** Whether the control currently open has been moved off its shipped value. */
  const fieldEdited =
    group === "tokens"
      ? palette.tokens[tokenName] !== undefined
      : palette.map[group === "basemap" ? numField : inkField] !== undefined;

  const revertField = () => {
    if (group === "tokens") palette.clearToken(tokenName);
    else palette.clearMapField(group === "basemap" ? numField : inkField);
  };

  const setColour = (next: string) => {
    if (group === "tokens") palette.setToken(tokenName, next);
    else palette.setMapField(inkField, next);
  };

  const setChannel = (channel: "r" | "g" | "b", value: number) => {
    setColour(rgbToHex({ ...rgb, [channel]: value }));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex-1 overflow-y-auto px-3 py-3"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {/* --- which family of things ---------------------------------- */}
        <Label>attribute group</Label>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGroup(g.key)}
              className="cursor-pointer border px-2 py-[3px] text-[9.5px] tracking-[0.16em] uppercase transition-colors"
              style={{
                borderColor: group === g.key ? "var(--accent)" : "var(--line)",
                color: group === g.key ? "var(--accent)" : "var(--ink-dim)",
                background:
                  group === g.key
                    ? "color-mix(in oklab, var(--accent) 12%, transparent)"
                    : "transparent",
              }}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* --- which one of them --------------------------------------- */}
        <div className="mt-4">
          <div className="flex items-baseline gap-2">
            <Label>attribute</Label>
            <span className="flex-1" />
            {/*
              Revert this one control, leaving every other change alone. A
              glyph rather than the word: it sits on the same line as the field
              it undoes, and "reset" spelled out there reads as resetting the
              whole panel, which is the button at the foot.
            */}
            <Revert
              disabled={!fieldEdited}
              title={
                fieldEdited
                  ? "Put this one back to the colour it shipped with"
                  : "This one is already at its shipped value"
              }
              onClick={revertField}
            />
          </div>
          {group === "ink" && (
            <Select
              value={inkField as string}
              onChange={(v) => setInkField(v as keyof MapPaint)}
              options={MAP_COLOUR_FIELDS.map((f) => ({
                value: f.key as string,
                label: f.label,
              }))}
            />
          )}
          {group === "basemap" && (
            <Select
              value={numField as string}
              onChange={(v) => setNumField(v as keyof MapPaint)}
              options={MAP_NUMBER_FIELDS.map((f) => ({
                value: f.key as string,
                label: f.label,
              }))}
            />
          )}
          {group === "tokens" && (
            <Select
              value={tokenName}
              onChange={setTokenName}
              options={tokens.map((t) => ({
                value: t.name,
                label: `${t.label}  ${t.name}`,
              }))}
            />
          )}
        </div>

        {/* --- what it is ---------------------------------------------- */}
        {/*
          Said in plain words, because none of these names mean anything from
          outside the code. "--ink-dim" is a variable; "the sentence under a
          heading" is a thing on screen you can look at while you drag a slider.
        */}
        <p
          className="mt-2.5 border-l pl-2.5 text-[11px] leading-[1.5]"
          style={{
            borderColor: "var(--accent)",
            color: "var(--ink-dim)",
            fontFamily: "var(--font-body)",
          }}
        >
          {blurb}
        </p>

        {/* --- the control --------------------------------------------- */}
        {group === "basemap" ? (
          <>
            <NumberControl field={numField} />
            {/*
              The two fields that are not a colour and not a quantity.

              They sit below the slider, permanently, rather than as entries in
              the attribute menu above -- the menu chooses which field the
              slider points at, and neither a menu nor a checkbox is something
              a slider can point at. `contourFill` was already drawn this way
              under the inks, so this is the panel's existing answer to the
              same problem rather than a new one.
            */}
            {MAP_CHOICE_FIELDS.map((f) => (
              <ChoiceControl key={f.key} field={f} />
            ))}
            {MAP_FLAG_FIELDS.filter((f) => f.group === "basemap").map((f) => (
              <FlagControl key={f.key} field={f} />
            ))}
          </>
        ) : (
          <>
            <div className="mt-4 flex items-center gap-3">
              <span
                className="block h-9 w-9 shrink-0 border"
                style={{ background: colour, borderColor: "var(--line)" }}
                aria-hidden
              />
              <HexField value={colour} onCommit={setColour} />
            </div>

            <div className="mt-3 space-y-2">
              <Channel
                name="R"
                value={rgb.r}
                onChange={(v) => setChannel("r", v)}
              />
              <Channel
                name="G"
                value={rgb.g}
                onChange={(v) => setChannel("g", v)}
              />
              <Channel
                name="B"
                value={rgb.b}
                onChange={(v) => setChannel("b", v)}
              />
            </div>
          </>
        )}

        {group === "ink" &&
          MAP_FLAG_FIELDS.filter((f) => f.group === "ink").map((f) => (
            <FlagControl key={f.key} field={f} />
          ))}

        {/*
          The question this panel gets asked, answered where it is asked.

          The world map is a single photograph from a tile server -- one image
          carrying land and sea together -- so nothing here can recolour one
          without the other. Separating them needs vector tiles with land and
          water as distinct shapes, which needs a keyed provider, and this map
          deliberately runs without a key.
        */}
        {(group === "basemap" ||
          inkField === "water" ||
          inkField === "basemapTint") && (
          <div
            className="mt-4 border-t pt-3"
            style={{ borderColor: "var(--line)" }}
          >
            <p
              className="text-[9px] tracking-[0.22em] uppercase"
              style={{ color: "var(--warn)" }}
            >
              Why land and sea move together
            </p>
            <p
              className="mt-1.5 text-[11px] leading-[1.6]"
              style={{ color: "var(--ink-dim)", fontFamily: "var(--font-body)" }}
            >
              The world map is one photograph from a tile server, with the
              coastline and the open sea already painted into the same image.
              It can be faded, drained of colour or washed over, but nothing can
              repaint half of it, because the map does not know which pixels are
              land. Telling them apart needs a different kind of basemap and an
              account key; this one runs without either.
            </p>
            <p
              className="mt-2 text-[11px] leading-[1.6]"
              style={{ color: "var(--ink-dim)", fontFamily: "var(--font-body)" }}
            >
              What does separate them: on the dark basemap the open sea is the
              darkest thing in the picture and the land is the lightest, so{" "}
              <em>lift the dark parts</em> mostly moves the sea and{" "}
              <em>hold the bright parts down</em> mostly moves the land. And
              taking <em>how visible the coastline is</em> to zero removes the
              photograph entirely, at which point the ground colour underneath
              is the sea and the only geography left is the grid.
            </p>
          </div>
        )}
      </div>

      {/* --- out ------------------------------------------------------- */}
      <div
        className="flex shrink-0 items-center gap-2 border-t px-3 py-2"
        style={{ borderColor: "var(--line)" }}
      >
        <Revert
          disabled={!palette.dirty}
          label="all"
          title="Put every colour back to what shipped"
          onClick={palette.reset}
        />
        <button
          type="button"
          onClick={() =>
            downloadPalette(palette.tokens, palette.map, palette.surface)
          }
          className="cursor-pointer border px-2 py-[3px] text-[9.5px] tracking-[0.16em] uppercase transition-colors"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          export colours
        </button>
        <span
          className="ml-auto text-[9px] tracking-[0.14em] uppercase"
          style={{ color: "var(--ink-faint)" }}
        >
          {palette.dirty ? "edited" : "shipped"}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Parts
 * ------------------------------------------------------------------ */

/**
 * Put something back to what it shipped with.
 *
 * A drawn glyph rather than an icon font or a word. The arrow is the universal
 * "revert" mark, it reads at eleven pixels where a word does not, and the same
 * control serves one field and the whole palette -- which is the point: two
 * differently-worded buttons for the same verb is how a panel starts feeling
 * arbitrary.
 *
 * Disabled rather than hidden when there is nothing to undo. A control that
 * appears only once you have made a change cannot be found before you need it.
 */
function Revert({
  onClick,
  disabled,
  title,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="flex shrink-0 cursor-pointer items-center gap-1 border px-1.5 py-[3px] transition-colors disabled:cursor-default disabled:opacity-35"
      style={{ borderColor: "var(--line)", color: "var(--ink-dim)" }}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden>
        {/* Three-quarter arc with an arrowhead on the open end: a reload mark,
            drawn rather than borrowed so it inherits `currentColor`. */}
        <path
          d="M13.2 8a5.2 5.2 0 1 1-1.6-3.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M13.4 1.6v3.3h-3.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label && (
        <span className="text-[9.5px] tracking-[0.16em] uppercase">{label}</span>
      )}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[9px] tracking-[0.24em] uppercase"
      style={{ color: "var(--ink-faint)" }}
    >
      {children}
    </p>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  // Readonly because the enum's options come from a frozen literal in
  // `palette.tsx`; the attribute menus above still hand it a fresh array.
  options: readonly { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1.5 w-full cursor-pointer border px-2 py-[5px] text-[11px]"
      style={{
        borderColor: "var(--line)",
        background: "var(--base-3)",
        color: "var(--ink)",
        fontFamily: "var(--font-mono)",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * One 0-255 channel.
 *
 * The track is tinted with the channel it drives, so the three rows read as
 * red, green and blue without a legend saying so.
 */
function Channel({
  name,
  value,
  onChange,
}: {
  name: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const tint =
    name === "R" ? "#ff5a5a" : name === "G" ? "#5ce08a" : "#5aa8ff";
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="w-3 text-[10px]"
        style={{ color: tint, fontFamily: "var(--font-mono)" }}
      >
        {name}
      </span>
      <input
        type="range"
        min={0}
        max={255}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${name} channel`}
        className="min-w-0 flex-1 cursor-pointer"
        style={{ accentColor: tint }}
      />
      <span
        className="num w-8 text-right text-[10px]"
        style={{ color: "var(--ink-dim)" }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The hex field.
 *
 * Kept as local text until it parses. Committing on every keystroke means the
 * first character typed after clearing the field is a colour on its own, and
 * the map flashes black between edits.
 */
function HexField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [seen, setSeen] = useState(value);

  /*
    Drop the draft when the value changes from outside.

    Without this the field keeps whatever was last typed into it, and the two
    ways the value can change underneath it are both routine: reverting the
    field, and switching to a different attribute. Either one left the input
    showing a colour belonging to something else -- so the panel said the ocean
    was magenta while the map, correctly, did not.

    The comparison is against the draft's *normalised* form so that ordinary
    typing is untouched: committing "ff0000" sets the value to "#ff0000", which
    is the same colour, and the draft survives.
  */
  if (value !== seen) {
    setSeen(value);
    const normalised = draft
      ? (draft.startsWith("#") ? draft : `#${draft}`).toLowerCase()
      : null;
    if (normalised !== value.toLowerCase()) setDraft(null);
  }

  const shown = draft ?? value;

  return (
    <input
      value={shown}
      spellCheck={false}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (isHex(next)) onCommit(next.startsWith("#") ? next : `#${next}`);
      }}
      onBlur={() => setDraft(null)}
      aria-label="Hex colour"
      className="min-w-0 flex-1 border px-2 py-[5px] text-[11px]"
      style={{
        borderColor: isHex(shown) ? "var(--line)" : "var(--alarm)",
        background: "var(--base-3)",
        color: "var(--ink)",
        fontFamily: "var(--font-mono)",
      }}
    />
  );
}

/** A slider over one of the basemap's numbers. */
function NumberControl({ field }: { field: keyof MapPaint }) {
  const palette = usePalette();
  const spec = MAP_NUMBER_FIELDS.find((f) => f.key === field);
  if (!spec) return null;
  const raw = palette.paint[field];
  const value = typeof raw === "number" ? raw : 0;

  /*
    Six of the eight sliders act on the raster basemap, and the raster layer
    only exists while a world map is chosen. Until `basemap` became editable
    there was no way to reach that state from the panel, so the sliders could
    never be inert and nothing had to say so; now the first thing anyone will
    do with the new menu is set it to "no world map", at which point five
    coastline sliders and a wash sit there moving numbers that reach nothing.

    Left live rather than disabled, deliberately. Their values are still real
    -- they are what the basemap will be drawn with the moment one is chosen
    again -- so dialling them in with no world up is a legitimate thing to do.
    The note says the setting is stored and not currently drawn, which is the
    true statement; a greyed-out slider would say the value did not exist.
  */
  const stored = field.startsWith("basemap") && palette.paint.basemap === "none";

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[10.5px]" style={{ color: "var(--ink-dim)" }}>
          {spec.label}
        </span>
        <span className="num text-[11px]" style={{ color: "var(--ink)" }}>
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => palette.setMapField(field, Number(e.target.value))}
        aria-label={spec.label}
        className="mt-2 w-full cursor-pointer"
        style={{ accentColor: "var(--accent)" }}
      />
      {stored && (
        <p className="mt-1.5 text-[10px]" style={{ color: "var(--warn)" }}>
          Kept, but not drawn: there is no world map up for it to act on.
        </p>
      )}
    </div>
  );
}

/**
 * A field chosen from a fixed set of named values.
 *
 * The panel's own menus -- which attribute, which token -- are already a
 * `<select>`, so an enum gets the same control rather than a fourth idiom
 * invented for it. What it does not share with them is position: those menus
 * choose what the swatch below points at, this one *is* the value, so it is
 * ruled off from them and carries its own sentence.
 *
 * Reverting it means what it means everywhere else in this panel: drop the
 * override and let the merged paint fall back to the surface's shipped
 * literal. The overlay is a diff keyed by field rather than a store of values,
 * so nothing about an enum needs its own path through it.
 */
function ChoiceControl({ field }: { field: MapChoiceField }) {
  const palette = usePalette();
  const value = String(palette.paint[field.key] ?? "");
  const edited = palette.map[field.key] !== undefined;

  return (
    <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-baseline gap-2">
        <Label>{field.label}</Label>
        <span className="flex-1" />
        <Revert
          disabled={!edited}
          title={
            edited
              ? "Put this back to the world map that shipped"
              : "This is already at its shipped value"
          }
          onClick={() => palette.clearMapField(field.key)}
        />
      </div>
      <Select
        value={value}
        onChange={(v) => palette.setMapField(field.key, v)}
        options={field.options}
      />
      <p
        className="mt-2 text-[11px] leading-[1.5]"
        style={{ color: "var(--ink-dim)", fontFamily: "var(--font-body)" }}
      >
        {field.blurb}
      </p>
    </div>
  );
}

/**
 * A field that is on or off.
 *
 * `contourFill` was drawn like this before anything else was, and it is the
 * right shape for the job: a switch with the sentence that says what it
 * switches, ruled off from the controls above it. What it lacked was a revert,
 * which every other control in the panel has -- so a checkbox was the one
 * thing you could move and then only put back by resetting the whole palette,
 * or by remembering what it had been.
 *
 * `disabledNote` is for a switch that is currently inert. `showLabels` under
 * `basemap: "none"` is the case: there is no world for names to sit on, so
 * rather than offer a control that quietly does nothing, the checkbox is
 * disabled and the sentence says why.
 */
function FlagControl({ field }: { field: MapFlagField }) {
  const palette = usePalette();
  const on = palette.paint[field.key] === true;
  const edited = palette.map[field.key] !== undefined;
  const inert = field.key === "showLabels" && !canShowLabels(palette.paint);

  return (
    <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center gap-2">
        <label
          className="flex min-w-0 flex-1 items-center gap-2 text-[10.5px]"
          style={{
            color: "var(--ink-dim)",
            cursor: inert ? "default" : "pointer",
            opacity: inert ? 0.45 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={on}
            disabled={inert}
            onChange={(e) => palette.setMapField(field.key, e.target.checked)}
            style={{ accentColor: "var(--accent)" }}
          />
          {field.label}
        </label>
        <Revert
          disabled={!edited}
          title={
            edited
              ? "Put this one back to the setting it shipped with"
              : "This one is already at its shipped value"
          }
          onClick={() => palette.clearMapField(field.key)}
        />
      </div>
      <p
        className="mt-1.5 text-[11px] leading-[1.5]"
        style={{ color: "var(--ink-dim)", fontFamily: "var(--font-body)" }}
      >
        {inert
          ? "There is no world map to draw names on. Choose one of the three above and this comes back."
          : field.blurb}
      </p>
    </div>
  );
}
