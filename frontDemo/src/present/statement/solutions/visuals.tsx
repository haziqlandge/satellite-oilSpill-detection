/**
 * The four image cards' pictures, and what each does while it is large.
 *
 * Each visual renders hidden-but-laid-out markup inside its card and exports a
 * builder that animates it; the solution beat syncs that into the card's own
 * landing, so Q snapping the beat also snaps the picture to its end state.
 */
import { createTimeline, stagger, type Timeline } from "animejs";
import { tileStarts } from "../../../sim/segmenter";
import { flowAt, speedToward } from "../../../sim/flow";
import type { FlowGrid } from "../../../sim/types";
import { VISUAL_COPY } from "../copy";

/* --- 1. the training mosaic ------------------------------------------ */

const TILES = Array.from({ length: 12 }, (_, i) => `/present/tiles/zenodo-${String(i).padStart(2, "0")}.webp`);
const TRAIN_TILES = 4227;

export function MosaicVisual() {
  return (
    <div className="pt-vis pt-mosaic">
      {TILES.map((src) => (
        <img key={src} src={src} alt="" className="pt-mosaic-tile" />
      ))}
      <div className="pt-mosaic-count">
        <span className="pt-head" data-pt="count">
          0
        </span>
        <small>{VISUAL_COPY.tiles}</small>
      </div>
    </div>
  );
}

function mosaicTimeline(card: HTMLElement): Timeline {
  const count = card.querySelector<HTMLElement>('[data-pt="count"]')!;
  const n = { v: 0 };
  return createTimeline()
    .add(card.querySelectorAll(".pt-mosaic-tile"), {
      opacity: [0, 1],
      scale: [0.6, 1],
      duration: 520,
      delay: stagger(55, { grid: [4, 3], from: "center" }),
      ease: "outBack",
    }, 0)
    .add(card.querySelector(".pt-mosaic-count")!, { opacity: [0, 1], translateY: [12, 0], duration: 400, ease: "outCubic" }, 300)
    .add(n, {
      v: [0, TRAIN_TILES],
      duration: 1400,
      ease: "outCubic",
      onUpdate: () => (count.textContent = Math.round(n.v).toLocaleString("en-US")),
    }, 300);
}

/* --- 2. sliced, then segmented --------------------------------------- */

// Zenodo 00016 as the console's add-image panel saw it: 2048 px square, cut
// by the browser segmenter's own tiling (1024 px, 10% overlap) into 9 tiles.
const SCENE_PX = 2048;
const TILE_PX = 1024;
const STARTS = tileStarts(SCENE_PX, TILE_PX, Math.round(TILE_PX * 0.9));

export function SliceMaskVisual() {
  const f = 200 / SCENE_PX;
  return (
    <div className="pt-vis pt-slice">
      <div className="pt-slice-pane" data-pt="sar">
        <img src="/present/capture/sar-00016.webp" alt="" />
        <svg viewBox="0 0 200 200" className="pt-slice-grid">
          {STARTS.flatMap((y) =>
            STARTS.map((x) => (
              <rect key={`${x}-${y}`} x={x * f + 0.5} y={y * f + 0.5} width={TILE_PX * f - 1} height={TILE_PX * f - 1} />
            )),
          )}
        </svg>
        <span className="pt-tag">{VISUAL_COPY.sar}</span>
        <span className="pt-tag pt-tag-br" data-pt="tilecount">
          {STARTS.length * STARTS.length} {VISUAL_COPY.sliceTiles}
        </span>
      </div>
      <div className="pt-slice-arrow">&rarr;</div>
      <div className="pt-slice-pane" data-pt="mask">
        <img src="/present/capture/mask-00016.webp" alt="" />
        <span className="pt-tag pt-tag-red">{VISUAL_COPY.mask}</span>
        <span className="pt-tag pt-tag-br pt-tag-red">0.91 {VISUAL_COPY.confidence}</span>
      </div>
    </div>
  );
}

function sliceTimeline(card: HTMLElement): Timeline {
  const rects = card.querySelectorAll(".pt-slice-grid rect");
  return createTimeline()
    .add(card.querySelector('[data-pt="sar"]')!, { opacity: [0, 1], duration: 300 }, 0)
    .add(rects, {
      opacity: [0, 1, 0.55],
      fillOpacity: [0, 0.35, 0.06],
      duration: 520,
      delay: stagger(110),
      ease: "outQuad",
    }, 200)
    .add(card.querySelector('[data-pt="tilecount"]')!, { opacity: [0, 1], duration: 300 }, 200 + rects.length * 110)
    .add(card.querySelector('[data-pt="mask"]')!, {
      opacity: [0, 1],
      clipPath: ["inset(0% 100% 0% 0%)", "inset(0% 0% 0% 0%)"],
      duration: 760,
      ease: "inOutCubic",
    }, 400 + rects.length * 110)
    .add(card.querySelector(".pt-slice-arrow")!, { opacity: [0, 1], translateX: [-10, 0], duration: 300 }, 300 + rects.length * 110);
}

/* --- 3. the weather terminal ----------------------------------------- */

export interface WeatherScene {
  wind: { gridPoint: [number, number]; hours: number[]; ms: number[]; fromDeg: number[] };
  flow: FlowGrid;
}

const deg = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)} ${v >= 0 ? pos : neg}`;

/** The terminal's lines, from the May run's own forcing at the hour of the pass. */
export function weatherLines(scene: WeatherScene | null): string[] {
  if (!scene) return [`$ ${VISUAL_COPY.termWind}`, `$ ${VISUAL_COPY.termCurrent}`];
  const [lon, lat] = scene.wind.gridPoint;
  const k = scene.wind.hours.indexOf(0);
  const current = flowAt(scene.flow, "current", [lon, lat], 0);
  const c = current ? speedToward(current) : null;
  return [
    `$ ${VISUAL_COPY.termWind}  ${deg(lat, "N", "S")}  ${deg(lon, "E", "W")}  15 May 2023  00:00 UTC`,
    `  10 m wind        ${scene.wind.ms[k].toFixed(2)} m/s   from ${Math.round(scene.wind.fromDeg[k])}°`,
    `$ ${VISUAL_COPY.termCurrent}  ${VISUAL_COPY.termSame}`,
    c ? `  surface current  ${c.speed.toFixed(2)} m/s   toward ${Math.round(c.towardDeg)}°` : "",
    `  ${scene.flow.hours.length} ${VISUAL_COPY.termFrames}`,
  ].filter(Boolean);
}

export function TerminalVisual() {
  return (
    <div className="pt-vis pt-term">
      <div className="pt-term-bar">
        <i />
        <i />
        <i />
      </div>
      <pre className="pt-term-body" data-pt="term" />
    </div>
  );
}

function terminalTimeline(card: HTMLElement, lines: string[]): Timeline {
  const body = card.querySelector<HTMLElement>('[data-pt="term"]')!;
  body.replaceChildren(
    ...lines.map((line) => {
      const row = document.createElement("div");
      row.className = line.startsWith("$") ? "pt-term-cmd" : "pt-term-out";
      row.dataset.full = line;
      return row;
    }),
  );
  const tl = createTimeline();
  let at = 150;
  for (const row of Array.from(body.children) as HTMLElement[]) {
    const full = row.dataset.full ?? "";
    const typed = { n: 0 };
    const ms = full.startsWith("$") ? full.length * 18 : 260;
    tl.add(typed, {
      n: [0, full.length],
      duration: ms,
      ease: "linear",
      onUpdate: () => (row.textContent = full.slice(0, Math.round(typed.n))),
    }, at);
    at += ms + 180;
  }
  return tl;
}

/* --- 4. the drift map capture ---------------------------------------- */

export function CaptureVisual() {
  return (
    <div className="pt-vis pt-capture">
      <img src="/present/capture/map-20230515.webp" alt="" data-pt="map" />
      <span className="pt-tag pt-tag-blue pt-tag-tr">{VISUAL_COPY.hindcast}</span>
      <span className="pt-tag pt-tag-bl">{VISUAL_COPY.forecast}</span>
    </div>
  );
}

function captureTimeline(card: HTMLElement): Timeline {
  return createTimeline()
    .add(card.querySelector('[data-pt="map"]')!, { scale: [1, 1.07], duration: 2600, ease: "outSine" }, 0)
    .add(card.querySelectorAll(".pt-capture .pt-tag"), { opacity: [0, 1], translateY: [8, 0], duration: 400, delay: stagger(250) }, 600);
}

/** The picture animation for an image solution, or null for an icon card. */
export function visualTimeline(id: string, card: HTMLElement, scene: WeatherScene | null): Timeline | null {
  if (id === "model") return mosaicTimeline(card);
  if (id === "slice") return sliceTimeline(card);
  if (id === "weather") return terminalTimeline(card, weatherLines(scene));
  if (id === "drift") return captureTimeline(card);
  return null;
}
