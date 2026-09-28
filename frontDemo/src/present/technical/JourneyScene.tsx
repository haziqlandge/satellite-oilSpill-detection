/**
 * The technical approach as one real scene's journey: the Sentinel-1A pass of
 * 15 May 2023, 00:02 UTC, through every stage the pipeline runs on it.
 *
 * Four views of the same pass, each drawn at its own scale so nothing is ever
 * upscaled into mush: the Gulf (the pass in context), the scene (the whole
 * raster, its tiles and detections), a crop around the seed slick (cleaning
 * and measuring), and the drift area (forcing, hindcast, forecast, AIS). The
 * "camera" is a zoom between two views: the outgoing one flies up into the
 * region the incoming one shows, which grows out of that same region.
 */
import { createTimeline, stagger, svg, utils, type Timeline } from "animejs";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Crosshair, GraphicsCard, ShieldCheck, Timer, UploadSimple, type Icon } from "@phosphor-icons/react";
import type { BeatBuild } from "../engine";
import { TitlePill, openPill } from "../parts/TitlePill";
import { LABELS, TIMING } from "./copy";
import { driftBounds, frameAt, loadJourney, positionAt, type JourneyData } from "./data";
import { boundsOf, projector, rectOf, tileCount, type Box, type Project } from "./geo";
import { meanField, streamline } from "./streams";
import { DRIFT_CARDS, DRIFT_MAP, measureRows } from "./panels";
import { flowAt, speedToward } from "../../sim/flow";
import { clear, drawDots, drawFrame, drawTracks, particlesAt } from "./particles";
import { Rail, drawRail, railTo } from "./Rail";
import { tileStarts } from "../../sim/segmenter";
import "./journey.css";

const CONTENT: Box = { x: 100, y: 205, w: 1720, h: 830 };
const CLEAN_BOX: Box = { x: 150, y: 205, w: 960, h: 830 };
const GULF = boundsOf([-98, 18, -80, 31]);

interface Views {
  gulf: Project;
  scene: Project;
  clean: Project;
  drift: Project;
}

function makeViews(d: JourneyData): Views {
  return {
    gulf: projector(GULF, CONTENT),
    scene: projector(boundsOf(d.journey.scene.bounds), CONTENT),
    clean: projector(boundsOf(d.journey.clean.bounds), CLEAN_BOX),
    drift: projector(driftBounds(d.drift), DRIFT_MAP),
  };
}

const pathOf = (project: Project, ring: [number, number][]) =>
  ring.map(([lon, lat], i) => {
    const [x, y] = project(lon, lat);
    return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ") + " Z";

/** Count a number up into an element as a beat plays (so a snap lands on the final figure). */
function countUp(tl: Timeline, el: Element | null, to: number, dp: number, at: number, dur = 900, suffix = ""): Timeline {
  if (!el) return tl;
  const n = { v: 0 };
  return tl.add(n, { v: [0, to], duration: dur, ease: "outCubic", onUpdate: () => (el.textContent = `${n.v.toFixed(dp)}${suffix}`) }, at);
}

/* --- callouts: a dot on the picture, a leader line, words ------------- */

function Callout({ x, y, dx, dy, children, tone = "" }: { x: number; y: number; dx: number; dy: number; children: ReactNode; tone?: string }) {
  return (
    <div className={`pt-callout ${tone}`} style={{ left: x, top: y }}>
      <svg className="pt-callout-line" width="1" height="1">
        <line x1={0} y1={0} x2={dx} y2={dy} />
      </svg>
      <span className="pt-callout-dot" />
      <span className="pt-callout-text" style={{ left: dx, top: dy }}>
        {children}
      </span>
    </div>
  );
}

function calloutsIn(els: Iterable<Element>, at: number, tl: Timeline, gap = 220): Timeline {
  let t = at;
  for (const el of els) {
    tl.add(el.querySelector(".pt-callout-dot")!, { opacity: [0, 1], scale: [0, 1], duration: 300, ease: "outBack" }, t)
      .add(svg.createDrawable(el.querySelector("line")!), { draw: ["0 0", "0 1"], duration: 360, ease: "outCubic" }, t + 150)
      .add(el.querySelector(".pt-callout-text")!, { opacity: [0, 1], translateX: [-8, 0], duration: 360, ease: "outCubic" }, t + 380);
    tl.set(el, { opacity: 1 }, t);
    t += gap;
  }
  return tl;
}

/* --- the camera ------------------------------------------------------ */

/** Zoom from a wide view into a detail view whose content fills `toBox`, through `focus` (in `from`). */
function zoomIn(tl: Timeline, from: HTMLElement, to: HTMLElement, focus: Box, toBox: Box, at: number, dur = 1300): Timeline {
  const s = toBox.w / focus.w;
  return tl
    .add(from, {
      translateX: [0, toBox.x - s * focus.x],
      translateY: [0, toBox.y - s * focus.y],
      scale: [1, s],
      duration: dur,
      ease: "inOutCubic",
    }, at)
    .add(from, { opacity: [1, 0], duration: dur * 0.5, ease: "inQuad" }, at + dur * 0.15)
    .add(to, {
      translateX: [focus.x - toBox.x / s, 0],
      translateY: [focus.y - toBox.y / s, 0],
      scale: [1 / s, 1],
      duration: dur,
      ease: "inOutCubic",
    }, at)
    .add(to, { opacity: [0, 1], duration: dur * 0.5, ease: "outQuad" }, at + dur * 0.25);
}

/** The reverse: the detail view (content in `fromBox`) shrinks back into `focus` inside the wide view. */
function zoomOut(tl: Timeline, from: HTMLElement, to: HTMLElement, focus: Box, fromBox: Box, at: number, dur = 1300): Timeline {
  const s = fromBox.w / focus.w;
  return tl
    .add(from, {
      translateX: [0, focus.x - fromBox.x / s],
      translateY: [0, focus.y - fromBox.y / s],
      scale: [1, 1 / s],
      duration: dur,
      ease: "inOutCubic",
    }, at)
    .add(from, { opacity: [1, 0], duration: dur * 0.5, ease: "inQuad" }, at + dur * 0.35)
    .add(to, {
      translateX: [fromBox.x - s * focus.x, 0],
      translateY: [fromBox.y - s * focus.y, 0],
      scale: [s, 1],
      duration: dur,
      ease: "inOutCubic",
    }, at)
    .add(to, { opacity: [0, 1], duration: dur * 0.5, ease: "outQuad" }, at + dur * 0.1);
}

/* --- the scene ------------------------------------------------------- */

export function JourneyScene({ onBeats }: { onBeats: (beats: Record<string, BeatBuild>) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<JourneyData | null>(null);
  const live = useRef<{ data: JourneyData; views: Views } | null>(null);

  useEffect(() => {
    let alive = true;
    loadJourney()
      .then((d) => {
        if (!alive) return;
        live.current = { data: d, views: makeViews(d) };
        setData(d);
      })
      .catch((e) => console.error(e));
    return () => {
      alive = false;
    };
  }, []);

  // Static canvases, drawn once the pass has loaded.
  useEffect(() => {
    if (!data || !live.current) return;
    const el = root.current!;
    const { views } = live.current;
    const dots = (sel: string, project: Project, r: number, color: string) => {
      const c = el.querySelector<HTMLCanvasElement>(sel);
      const ctx = c?.getContext("2d");
      if (ctx) drawDots(ctx, data.coast.land, project, color, r);
    };
    dots('[data-pt="gulf-dots"]', views.gulf, 2.4, "#4b515c");
    const dd = el.querySelector<HTMLCanvasElement>('[data-pt="drift-dots"]')?.getContext("2d");
    if (dd) drawDots(dd, data.coastDrift.land, views.drift, "#4b515c", 3.2);
  }, [data]);

  useEffect(() => {
    const el = root.current!;
    const q = (sel: string) => el.querySelector<HTMLElement>(sel)!;
    const view = (name: string) => q(`[data-view="${name}"]`);
    utils.set(q('[data-pt="tpill"]'), { left: 960, top: 540, translateX: "-50%", translateY: "-50%" });
    const ready = () => live.current;

    const beats: Record<string, BeatBuild> = {
      pill: () =>
        createTimeline()
          .sync(openPill(q('[data-pt="tpill"]')), 0)
          .add(q('[data-pt="tpill"]'), { top: 62, scale: [1, 0.82], duration: 800, ease: "inOutCubic" }, 700)
          .sync(drawRail(el), 1100),

      acquire: () => {
        const tl = createTimeline().sync(railTo(el, 0), 0);
        const g = view("gulf");
        tl.add(g, { opacity: [0, 1], duration: 600 }, 0)
          .add(g.querySelector('[data-pt="gulf-dots"]')!, { opacity: [0, 1], duration: 900 }, 0)
          .add(svg.createDrawable(g.querySelector('[data-pt="footprint"]')!), { draw: ["0 0", "0 1"], duration: 1000, ease: "inOutQuad" }, 600)
          .add(g.querySelector('[data-pt="gulf-scene"]')!, { opacity: [0, 1], scale: [1.08, 1], duration: 900, ease: "outCubic" }, 1300);
        return calloutsIn(g.querySelectorAll(".pt-callout"), 2000, tl);
      },

      clean: () => {
        const r = ready();
        const tl = createTimeline().sync(railTo(el, 1), 0);
        if (!r) return tl;
        const c = view("clean");
        zoomIn(tl, view("gulf"), c, rectOf(r.views.gulf, boundsOf(r.data.journey.clean.bounds)), rectOf(r.views.clean, boundsOf(r.data.journey.clean.bounds)), 0, 1500);
        tl.add(c.querySelector('[data-pt="clean-raw-tag"]')!, { opacity: [0, 1], duration: 300 }, 1400)
          .add(c.querySelector('[data-pt="wipe"]')!, { clipPath: ["inset(0% 100% 0% 0%)", "inset(0% 0% 0% 0%)"], duration: 1800, ease: "inOutCubic" }, 1800)
          .add(c.querySelector('[data-pt="wipe-edge"]')!, { left: ["0%", "100%"], opacity: [1, 1, 0], duration: 1800, ease: "inOutCubic" }, 1800)
          .add(c.querySelector('[data-pt="clean-tag"]')!, { opacity: [0, 1], duration: 300 }, 3300)
          .add(c.querySelectorAll('[data-pt="steps"] li'), { opacity: [0, 1], translateX: [20, 0], duration: 420, delay: stagger(260), ease: "outCubic" }, 1900)
          .add(c.querySelectorAll('[data-pt="bands"] .pt-band'), { opacity: [0, 1], duration: 300, delay: stagger(150) }, 3200)
          .add(c.querySelectorAll('[data-pt="bands"] .pt-band-fill'), { scaleX: [0, 1], duration: 900, delay: stagger(150), ease: "outCubic" }, 3300)
          .add(c.querySelector('[data-pt="band-note"]')!, { opacity: [0, 1], duration: 400 }, 4200);
        return tl;
      },

      slice: () => {
        const r = ready();
        const tl = createTimeline().sync(railTo(el, 2), 0);
        if (!r) return tl;
        const s = view("scene");
        const cb = boundsOf(r.data.journey.clean.bounds);
        zoomOut(tl, view("clean"), s, rectOf(r.views.scene, cb), rectOf(r.views.clean, cb), 0, 1400);
        const n = { v: 0 };
        const total = tileCount(r.data.journey.scene.widthPx, r.data.journey.scene.heightPx);
        const count = s.querySelector<HTMLElement>('[data-pt="tile-count"]')!;
        return tl
          .add(s.querySelectorAll(".pt-grid-row"), { opacity: [0, 1], duration: 260, delay: stagger(55) }, 1200)
          .add(s.querySelector('[data-pt="tile-label"]')!, { opacity: [0, 1], duration: 400 }, 1200)
          .add(n, { v: [0, total], duration: 1500, ease: "outCubic", onUpdate: () => (count.textContent = Math.round(n.v).toLocaleString("en-US")) }, 1200);
      },

      segment: () => {
        const r = ready();
        const tl = createTimeline().sync(railTo(el, 3), 0);
        if (!r) return tl;
        const s = view("scene");
        const polys = s.querySelectorAll(".pt-det");
        tl.add(s.querySelectorAll(".pt-grid-row"), { opacity: 0.35, duration: 500 }, 0)
          .add(s.querySelectorAll(".pt-tile-hit"), { opacity: [0, 1, 0.55], duration: 800, delay: stagger(60) }, 200)
          .add(polys, { opacity: [0, 1], duration: 400, delay: stagger(Math.min(8, 1400 / Math.max(1, polys.length))) }, 600)
          .add(s.querySelector('[data-pt="det-label"]')!, { opacity: [0, 1], duration: 400 }, 900);
        const c = view("clean");
        const cb = boundsOf(r.data.journey.clean.bounds);
        tl.set(c.querySelector('[data-pt="clean-side"]')!, { opacity: 0 }, 2300)
          .set(c.querySelector('[data-pt="wipe-edge"]')!, { opacity: 0 }, 2300)
          .set(c.querySelectorAll(".pt-img-tag"), { opacity: 0 }, 2300);
        zoomIn(tl, s, c, rectOf(r.views.scene, cb), rectOf(r.views.clean, cb), 2300, 1400);
        return tl.add(c.querySelector('[data-pt="seed"]')!, { opacity: [0, 0.85], duration: 600 }, 3500);
      },

      measure: () => {
        const tl = createTimeline().sync(railTo(el, 4), 0);
        const c = view("clean");
        if (!ready()) return tl;
        tl.add(c.querySelector('[data-pt="seed"]')!, { opacity: 0.35, duration: 500 }, 0)
          .set(c.querySelector('[data-pt="axis"]')!, { opacity: 1 }, 200)
          .add(svg.createDrawable(c.querySelector('[data-pt="axis"]')!), { draw: ["0 0", "0 1"], duration: 900, ease: "inOutQuad" }, 200)
          .add(c.querySelectorAll('[data-pt="ends"] > *'), { opacity: [0, 1], scale: [0, 1], duration: 360, delay: stagger(200), ease: "outBack" }, 900)
          .add(c.querySelectorAll(".pt-width-tick"), { opacity: [0, 1], duration: 200, delay: stagger(50) }, 1100);
        return calloutsIn(c.querySelectorAll('[data-pt="measures"] .pt-callout'), 1700, tl, 260);
      },

      weather: () => {
        const r = ready();
        const tl = createTimeline().sync(railTo(el, 5), 0);
        if (!r) return tl;
        const d = view("drift");
        const cb = boundsOf(r.data.journey.clean.bounds);
        zoomOut(tl, view("clean"), d, rectOf(r.views.drift, cb), rectOf(r.views.clean, cb), 0, 1500);
        tl.add(d.querySelectorAll('[data-pt="grid"], [data-pt="drift-seed"]'), { opacity: [0, 1], duration: 500 }, 1200)
          .add(d.querySelector('[data-pt="arrows"]')!, { opacity: [0, 1], duration: 200 }, 1500);
        const streams = [...d.querySelectorAll<SVGPathElement>(".pt-stream")];
        if (streams.length) {
          tl.add(svg.createDrawable(streams), { draw: ["0 0", "0 1"], duration: 1600, delay: stagger(180), ease: "inOutSine" }, 1500);
        }
        const card = d.querySelector<HTMLElement>('[data-pt="forcing"]')!;
        utils.set(card, { top: DRIFT_CARDS.forcingTop });
        tl.add(card, { opacity: [0, 1], scale: [1.25, 1], duration: 650, ease: "outExpo" }, 1300)
          .add(card.querySelectorAll(".pt-src"), { opacity: [0, 1], scale: [0.6, 1], duration: 420, delay: stagger(260), ease: "outBack" }, 1550)
          .add(svg.createDrawable(card.querySelectorAll(".pt-g-draw")), { draw: ["0 0", "0 1"], duration: 800, delay: stagger(90), ease: "inOutSine" }, 1650)
          .add(card.querySelectorAll(".pt-g-flow, .pt-g-swell"), { opacity: [0, 1], duration: 500, delay: stagger(80) }, 2000)
          .add(card.querySelectorAll(".pt-src-text > *, .pt-forcing-note"), { opacity: [0, 1], translateX: [-10, 0], duration: 420, delay: stagger(110), ease: "outCubic" }, 1750);
        countUp(tl, card.querySelector('[data-pt="wind-ms"]'), Number(card.dataset.wind), 2, 1900);
        return countUp(tl, card.querySelector('[data-pt="current-ms"]'), Number(card.dataset.current), 2, 2150);
      },

      hindcast: () => {
        const r = ready();
        const tl = createTimeline().sync(railTo(el, 6), 0);
        if (!r) return tl;
        const d = view("drift");
        const ctx = d.querySelector<HTMLCanvasElement>('[data-pt="particles"]')!.getContext("2d")!;
        const clock = d.querySelector<HTMLElement>('[data-pt="clock"]')!;
        const h = { v: 0 };
        const paint = () => {
          clear(ctx);
          drawFrame(ctx, particlesAt(r.data.drift, h.v), r.views.drift, "rgba(143,184,255,0.9)", 1.6);
          clock.textContent = `${Math.round(-h.v)} ${LABELS.back}`;
        };
        const hours = d.querySelector<HTMLElement>('[data-pt="hours"]')!;
        utils.set(hours, { height: DRIFT_CARDS.pillH });
        return tl
          .add(d.querySelector('[data-pt="arrows"]')!, { opacity: 0.35, duration: 500 }, 0)
          .add(d.querySelector('[data-pt="forcing"]')!, { top: [DRIFT_CARDS.forcingTop, DRIFT_CARDS.forcingPushed], duration: 700, ease: "inOutCubic" }, 0)
          .add(hours, { opacity: [0, 1], scale: [0.7, 1], duration: 420, ease: "outBack" }, 250)
          .add(hours, { height: [DRIFT_CARDS.pillH, DRIFT_CARDS.hourH], duration: 650, ease: "inOutCubic" }, 600)
          .add(clock, { opacity: [0, 1], translateY: [8, 0], duration: 360 }, 650)
          .add(hours.querySelectorAll(".pt-hour-key:nth-of-type(-n+3)"), { opacity: [0, 1], translateY: [10, 0], duration: 380, delay: stagger(90), ease: "outCubic" }, 850)
          .add(hours.querySelectorAll(".pt-hour-key:nth-of-type(n+4)"), { opacity: [0, 0.4], translateY: [10, 0], duration: 380, delay: stagger(90), ease: "outCubic" }, 1030)
          .add(h, { v: [0, -r.data.drift.backwardHours], duration: 4200, ease: "inOutSine", onUpdate: paint }, 300)
          .add(d.querySelector('[data-pt="c90-back"]')!, { opacity: [0, 0.8], duration: 700 }, 3900)
          .add(d.querySelector('[data-pt="c50-back"]')!, { opacity: [0, 0.9], duration: 700 }, 4300)
          .add(d.querySelector('[data-pt="origin-label"]')!, { opacity: [0, 1], duration: 400 }, 4700);
      },

      forecast: () => {
        const r = ready();
        const tl = createTimeline().sync(railTo(el, 7), 0);
        if (!r) return tl;
        const d = view("drift");
        const ctx = d.querySelector<HTMLCanvasElement>('[data-pt="particles"]')!.getContext("2d")!;
        const clock = d.querySelector<HTMLElement>('[data-pt="clock"]')!;
        const h = { v: -r.data.drift.backwardHours };
        const paint = () => {
          clear(ctx);
          drawFrame(ctx, particlesAt(r.data.drift, h.v), r.views.drift, h.v > 0 ? "rgba(232,240,255,0.9)" : "rgba(143,184,255,0.9)", 1.6);
          clock.textContent = h.v > 0 ? `${Math.round(h.v)} ${LABELS.ahead}` : `${Math.round(-h.v)} ${LABELS.back}`;
        };
        return tl
          .add(h, { v: [-r.data.drift.backwardHours, 0], duration: 700, ease: "inQuad", onUpdate: paint }, 0)
          .add(d.querySelectorAll('[data-pt="hours"] .pt-hour-key:nth-of-type(-n+3)'), { opacity: 0.45, duration: 500 }, 500)
          .add(d.querySelectorAll('[data-pt="hours"] .pt-hour-key:nth-of-type(n+4)'), { opacity: 1, duration: 500 }, 500)
          .add(h, { v: [0, r.data.drift.forwardHours], duration: 4200, ease: "inOutSine", onUpdate: paint }, 700)
          .add(d.querySelector('[data-pt="c90-ahead"]')!, { opacity: [0, 0.75], duration: 800 }, 4300);
      },

      gate: () => {
        const r = ready();
        const tl = createTimeline().sync(railTo(el, 8), 0);
        if (!r) return tl;
        const d = view("drift");
        const ctx = d.querySelector<HTMLCanvasElement>('[data-pt="tracks"]')!.getContext("2d")!;
        const keep = new Set(r.data.journey.gate.admittedIds);
        const a = { all: 0, rejected: 0.4, kept: 0.4 };
        const paint = () => {
          clear(ctx);
          ctx.globalAlpha = a.all;
          drawTracks(ctx, r.data.ais.vessels, r.views.drift, keep, a.rejected, a.kept);
          ctx.globalAlpha = 1;
        };
        tl
          .add(d.querySelectorAll('[data-pt="particles"], [data-pt="c90-ahead"]'), { opacity: 0.12, duration: 600 }, 0)
          .add(d.querySelectorAll('[data-pt="hours"], [data-pt="forcing"]'), { opacity: 0, scale: 0.9, translateX: 40, duration: 450, delay: stagger(90), ease: "inQuad" }, 0)
          .add(d.querySelector('[data-pt="arrows"]')!, { opacity: 0.12, duration: 600 }, 0)
          .add(a, { all: [0, 1], duration: 1200, ease: "outQuad", onUpdate: paint }, 200)
          .add(a, { rejected: [0.4, 0.06], kept: [0.4, 1], duration: 1400, ease: "inOutQuad", onUpdate: paint }, 1800)
          .add(d.querySelectorAll(".pt-cfar"), { opacity: [0, 1], scale: [0, 1], duration: 400, delay: stagger(90), ease: "outBack" }, 2600)
          .add(d.querySelector('[data-pt="gate-card"]')!, { opacity: [0, 1], scale: [1.2, 1], duration: 600, ease: "outExpo" }, 450)
          .add(d.querySelectorAll('[data-pt="gate-card"] .pt-gate-row'), { opacity: [0, 1], translateX: [-10, 0], duration: 380, delay: stagger(700), ease: "outCubic" }, 700)
          .set(d.querySelector('[data-pt="suspect-track"]')!, { opacity: 1 }, 3500)
          .add(svg.createDrawable(d.querySelector('[data-pt="suspect-track"]')!), { draw: ["0 0", "0 1"], duration: 1600, ease: "inOutSine" }, 3500)
          .add(d.querySelector('[data-pt="suspect-ship"]')!, { opacity: [0, 1], scale: [0, 1.25, 1], duration: 600, ease: "outBack" }, 4900)
          .add(d.querySelector('[data-pt="suspect-ring"]')!, { opacity: [0.9, 0], scale: [1, 3.2], duration: 1400, ease: "outQuad" }, 5100);
        const g = d.querySelector('[data-pt="gate-card"]')!;
        countUp(tl, g.querySelector('[data-pt="n-window"]'), r.data.journey.gate.considered, 0, 750, 900);
        countUp(tl, g.querySelector('[data-pt="n-field"]'), r.data.journey.gate.admitted, 0, 1450, 900);
        countUp(tl, g.querySelector('[data-pt="n-dark"]'), r.data.scene.cfar.targets.length, 0, 2150, 500);
        const suspect = d.querySelector('[data-pt="suspect-callout"]');
        return suspect ? calloutsIn([suspect], 5300, tl) : tl;
      },

      score: () => {
        const r = ready();
        const tl = createTimeline().sync(railTo(el, 9), 0);
        if (!r) return tl;
        const sc = view("score");
        return tl
          .add(view("drift"), { opacity: 0.12, duration: 700 }, 0)
          .add(view("drift").querySelector('[data-pt="gate-card"]')!, { opacity: 0, duration: 400 }, 0)
          .add(sc, { opacity: [0, 1], duration: 300 }, 400)
          .add(sc.querySelector('[data-pt="score-title"]')!, { opacity: [0, 1], translateY: [12, 0], duration: 500 }, 400)
          .add(svg.createDrawable(sc.querySelectorAll(".pt-tree")), { draw: ["0 0", "0 1"], duration: 700, ease: "inOutQuad" }, 700)
          .add(sc.querySelectorAll(".pt-card"), { opacity: [0, 1], scale: [1.3, 1], duration: 650, delay: stagger(200), ease: "outExpo" }, 1200)
          .add(sc.querySelectorAll(".pt-term-row"), { opacity: [0, 1], translateX: [-10, 0], duration: 360, delay: stagger(140) }, 1700)
          .add(sc.querySelectorAll(".pt-term-fill"), { scaleX: [0, 1], duration: 800, delay: stagger(140), ease: "outCubic" }, 1800)
          .add(sc.querySelector('[data-pt="score-total"]')!, { opacity: [0, 1], scale: [1.3, 1], duration: 600, ease: "outBack" }, 2800);
      },

      timing: () => {
        const tl = createTimeline().sync(railTo(el, 10), 0);
        const t = view("timing");
        tl.add(view("score"), { opacity: 0, translateY: -30, duration: 500, ease: "inQuad" }, 0)
          .add(view("drift"), { opacity: 0, duration: 500 }, 0)
          .add(t, { opacity: [0, 1], duration: 300 }, 350)
          .add(t.querySelectorAll('[data-pt="timing-head"] > *'), { opacity: [0, 1], translateY: [12, 0], duration: 500, delay: stagger(120) }, 400)
          .add(t.querySelectorAll(".pt-card, .pt-strip"), { opacity: [0, 1], scale: [1.15, 1], duration: 600, delay: stagger(150), ease: "outExpo" }, 700);
        const rows = [...t.querySelectorAll<HTMLElement>(".pt-t-row")];
        rows.forEach((row, i) => {
          const at = 1100 + i * 240;
          const ms = Number(row.dataset.ms);
          const big = ms >= 1000;
          tl.add(row, { opacity: [0, 1], translateX: [-10, 0], duration: 300, ease: "outCubic" }, at)
            .add(row.querySelector(".pt-t-check")!, { opacity: [0, 1], scale: [0, 1.3, 1], duration: 360, ease: "outBack" }, at + 120)
            .add(row.querySelector(".pt-t-fill")!, { scaleX: [0, 1], duration: 520, ease: "outCubic" }, at + 120)
            .add(t.querySelector(`[data-pt="seg-${i}"]`)!, { scaleX: [0, 1], duration: 260, ease: "linear" }, at + 120);
          countUp(tl, row.querySelector(".pt-t-value"), big ? ms / 1000 : ms, big ? 1 : 0, at + 120, 520, big ? " s" : " ms");
        });
        const done = 1100 + rows.length * 240;
        tl.add(t.querySelectorAll(".pt-t-group, .pt-t-stat"), { opacity: [0, 1], translateX: [12, 0], duration: 380, delay: stagger(110), ease: "outCubic" }, 900)
          .add(t.querySelectorAll(".pt-t-icon"), { scale: [0.4, 1], rotate: [-20, 0], duration: 480, delay: stagger(130), ease: "outBack" }, 950);
        countUp(tl, t.querySelector('[data-pt="t-total"]'), TIMING.totalS, 1, 1100, done - 1100, " s");
        countUp(tl, t.querySelector('[data-pt="t-infer"]'), TIMING.inferenceS, 1, 1100 + 2 * 240, 700, " s");
        countUp(tl, t.querySelector('[data-pt="t-conf"]'), TIMING.confidencePct, 0, done - 400, 800, "%");
        return countUp(tl, t.querySelector('[data-pt="t-reject"]'), TIMING.rejectedPct, 0, done - 250, 800, "%");
      },
    };
    onBeats(beats);
  }, [onBeats]);

  return (
    <div ref={root} className="pt-journey">
      {data && live.current && <PassViews data={data} views={live.current.views} />}
      <Rail />
      <TitlePill data-pt="tpill">{LABELS.pill}</TitlePill>
    </div>
  );
}

/* --- the four views, rendered from the pass's own files ---------------- */

function PassViews({ data, views }: { data: JourneyData; views: Views }) {
  const sceneB = boundsOf(data.journey.scene.bounds);
  const cleanB = boundsOf(data.journey.clean.bounds);
  const c = data.scene.characterisation;
  const seed = data.scene.detections.find((d) => d.seed) ?? data.scene.detections[0];
  const age = data.drift.age.age_hours;

  // Gulf view.
  const gScene = rectOf(views.gulf, sceneB);
  const [fx, fy] = [gScene.x, gScene.y];

  // Clean view.
  const cRect = rectOf(views.clean, cleanB);

  // Scene view: the segmenter's tiles, grouped by row for the sweep.
  const sRect = rectOf(views.scene, sceneB);
  const W = data.journey.scene.widthPx;
  const H = data.journey.scene.heightPx;
  const stride = Math.round(1024 * 0.9);
  const cols = tileStarts(W, 1024, stride);
  const rows = tileStarts(H, 1024, stride);
  const kx = sRect.w / W;
  const ky = sRect.h / H;
  const toPx = ([lon, lat]: [number, number]): [number, number] => [
    ((lon - sceneB.west) / (sceneB.east - sceneB.west)) * W,
    ((sceneB.north - lat) / (sceneB.north - sceneB.south)) * H,
  ];
  const detBoxes = data.scene.detections.map((d) => {
    const px = d.ring.map(toPx);
    return [Math.min(...px.map((p) => p[0])), Math.min(...px.map((p) => p[1])), Math.max(...px.map((p) => p[0])), Math.max(...px.map((p) => p[1]))];
  });
  const hit = (x0: number, y0: number) => detBoxes.some(([a, b, cc, dd]) => cc >= x0 && a <= x0 + 1024 && dd >= y0 && b <= y0 + 1024);

  // Measure: width ticks at 12 stations along the medial axis.
  const axis = c.medialAxis;
  const ticks = Array.from({ length: 12 }, (_, k) => {
    const i = Math.round((k * (axis.length - 1)) / 11);
    const a = axis[Math.max(0, i - 1)];
    const b = axis[Math.min(axis.length - 1, i + 1)];
    const cos = Math.cos((axis[i][1] * Math.PI) / 180);
    const ex = (b[0] - a[0]) * cos;
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    const w = c.widthMProfile[Math.round((k * (c.widthMProfile.length - 1)) / 11)] / 2 / 111320;
    const nx = (-ey / len) * w;
    const ny = (ex / len) * w;
    const [x1, y1] = views.clean(axis[i][0] + nx / cos, axis[i][1] + ny);
    const [x2, y2] = views.clean(axis[i][0] - nx / cos, axis[i][1] - ny);
    return { x1, y1, x2, y2 };
  });
  const at = (p: [number, number]) => views.clean(p[0], p[1]);
  const labelX = cRect.x + cRect.w + 70;
  // One column of measures, in the same top-to-bottom order as their anchors
  // along the axis, so no leader line crosses another.
  const [topEnd, bottomEnd] = at(c.tail)[1] <= at(c.head)[1] ? [c.tail, c.head] : [c.head, c.tail];
  const topIsTail = topEnd === c.tail;
  const byY = [...axis].sort((a, b) => at(a)[1] - at(b)[1]);
  const measures = measureRows(c, age, topIsTail);
  const yTop = at(topEnd)[1] - 30;
  const yBottom = at(bottomEnd)[1] + 30;
  const placed = measures.map((m, i) => {
    const f = i / (measures.length - 1);
    const anchor = i === 0 ? topEnd : i === measures.length - 1 ? bottomEnd : byY[Math.round(f * (byY.length - 1))];
    const [x, y] = at(anchor);
    return { ...m, x, y, dx: labelX - x, dy: yTop + f * (yBottom - yTop) - y };
  });

  // Drift view.
  const f = data.scene.flow;
  const back = frameAt(data.drift, -data.drift.backwardHours);
  const ahead = frameAt(data.drift, data.drift.forwardHours);
  const cells = (rings: [number, number][][]) => rings.map((r) => pathOf(views.drift, r)).join(" ");
  const db = driftBounds(data.drift);
  const ticks25 = (a: number, b: number) => {
    const out: number[] = [];
    for (let v = Math.ceil(a / 0.25) * 0.25; v <= b; v += 0.25) out.push(Number(v.toFixed(2)));
    return out;
  };
  const grid = { lons: ticks25(db.west, db.east), lats: ticks25(db.south, db.north) };
  const windMean = meanField(f, "wind");
  const currentMean = meanField(f, "current");
  const along = ([fx, fy]: [number, number]): [number, number] => [db.west + fx * (db.east - db.west), db.south + fy * (db.north - db.south)];
  const step = (db.east - db.west) / 70;
  const streams = [
    ...(windMean ? [[0.12, 0.3], [0.4, 0.75], [0.66, 0.2]].map((s0) => ({ kind: "wind", pts: streamline(f, windMean, along(s0 as [number, number]), step, 34) })) : []),
    ...(currentMean ? [[0.22, 0.62], [0.52, 0.38], [0.8, 0.7]].map((s0) => ({ kind: "current", pts: streamline(f, currentMean, along(s0 as [number, number]), step, 34) })) : []),
  ].filter((line) => line.pts.length > 3);
  const [ox, oy] = views.drift(back.contour50[0]?.[0]?.[0] ?? data.drift.seed[0], back.contour50[0]?.[0]?.[1] ?? data.drift.seed[1]);
  const gate = data.journey.gate;
  // Case 2's published ship on its recorded track, and where it was at the pass.
  const suspect = data.suspect
    ? (() => {
        const v = data.suspect!;
        const [x, y] = views.drift(...positionAt(v, 0));
        const path = v.lon.map((lon, i) => `${i ? "L" : "M"}${views.drift(lon, v.lat[i]).map((n) => n.toFixed(1)).join(" ")}`).join(" ");
        return { x, y, path };
      })()
    : null;
  const score = data.journey.score;
  const ranking = data.journey.ranking;
  const k0 = Math.max(0, data.scene.wind.hours.indexOf(0));
  const cur = flowAt(data.scene.flow, "current", data.scene.wind.gridPoint, 0);
  const forcing = {
    windMs: data.scene.wind.ms[k0],
    windFrom: Math.round(data.scene.wind.fromDeg[k0]),
    current: cur ? speedToward(cur) : null,
  };
  const DC = DRIFT_CARDS;

  return (
    <>
      {/* gulf ----------------------------------------------------------- */}
      <div className="pt-view" data-view="gulf">
        <canvas data-pt="gulf-dots" width={1920} height={1080} className="pt-layer" />
        <svg className="pt-layer" viewBox="0 0 1920 1080">
          <rect data-pt="footprint" x={gScene.x} y={gScene.y} width={gScene.w} height={gScene.h} className="pt-footprint" />
        </svg>
        <img data-pt="gulf-scene" src="/present/may/scene.webp" alt="" className="pt-geo-img" style={{ left: gScene.x, top: gScene.y, width: gScene.w, height: gScene.h }} />
        <Callout x={fx + gScene.w} y={fy + 8} dx={120} dy={-60}>{LABELS.sensor}</Callout>
        <Callout x={fx + gScene.w} y={fy + gScene.h * 0.5} dx={160} dy={0}>{LABELS.when}</Callout>
        <Callout x={fx + gScene.w * 0.5} y={fy + gScene.h} dx={140} dy={90}>{LABELS.metadata}</Callout>
      </div>

      {/* clean ----------------------------------------------------------- */}
      <div className="pt-view" data-view="clean">
        <div className="pt-geo-img" style={{ left: cRect.x, top: cRect.y, width: cRect.w, height: cRect.h }}>
          <img src="/present/may/raw-crop.webp" alt="" className="pt-fill" />
          <div className="pt-fill" data-pt="wipe" style={{ clipPath: "inset(0% 100% 0% 0%)" }}>
            <img src="/present/may/clean-crop.webp" alt="" className="pt-fill" />
          </div>
          <div className="pt-wipe-edge" data-pt="wipe-edge" />
          <span className="pt-tag pt-img-tag" data-pt="clean-raw-tag">{LABELS.raw}</span>
          <span className="pt-tag pt-img-tag pt-tag-tr pt-tag-blue" data-pt="clean-tag">{LABELS.filtered}</span>
        </div>
        <svg className="pt-layer" viewBox="0 0 1920 1080">
          <path data-pt="seed" d={pathOf(views.clean, seed.ring)} className="pt-seed" />
          <polyline data-pt="axis" points={axis.map((p) => at(p).join(",")).join(" ")} className="pt-axis" />
          {ticks.map((t, i) => (
            <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className="pt-width-tick" />
          ))}
          <g data-pt="ends">
            <circle cx={at(c.head)[0]} cy={at(c.head)[1]} r={9} className="pt-end" />
            <circle cx={at(c.tail)[0]} cy={at(c.tail)[1]} r={9} className="pt-end" />
          </g>
        </svg>
        <div className="pt-clean-side" data-pt="clean-side" style={{ left: labelX, top: cRect.y + 40 }}>
          <ul className="pt-steps" data-pt="steps">
            {[LABELS.calibrated, LABELS.lee, LABELS.land, LABELS.db].map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <div className="pt-bands" data-pt="bands">
            {[
              [LABELS.vv, 7.01],
              [LABELS.vh, 0.51],
            ].map(([k, v]) => (
              <div key={k} className="pt-band">
                <span className="pt-band-name pt-head">{k}</span>
                <span className="pt-band-track">
                  <span className="pt-band-fill" style={{ width: `${(Number(v) / 7.01) * 100}%` }} />
                </span>
                <span className="pt-band-value">{v} dB</span>
              </div>
            ))}
            <p className="pt-band-note" data-pt="band-note">{LABELS.bandNote}</p>
          </div>
        </div>
        <div data-pt="measures">
          {placed.map((m, i) => (
            <Callout key={i} x={m.x} y={m.y} dx={m.dx} dy={m.dy} tone={m.tone}>
              <b className="pt-m-name">{m.name}</b>
              {m.value && <span className="pt-m-value">{m.value}</span>}
            </Callout>
          ))}
        </div>
      </div>

      {/* scene ----------------------------------------------------------- */}
      <div className="pt-view" data-view="scene" style={{ clipPath: `inset(${CONTENT.y}px ${1920 - CONTENT.x - CONTENT.w}px ${1080 - CONTENT.y - CONTENT.h}px ${CONTENT.x}px)` }}>
        <img src="/present/may/scene.webp" alt="" className="pt-geo-img" style={{ left: sRect.x, top: sRect.y, width: sRect.w, height: sRect.h }} />
        <svg className="pt-layer" viewBox="0 0 1920 1080">
          {rows.map((y0) => (
            <g key={y0} className="pt-grid-row">
              {cols.map((x0) => (
                <rect key={x0} x={sRect.x + x0 * kx} y={sRect.y + y0 * ky} width={1024 * kx} height={1024 * ky} className="pt-grid-cell" />
              ))}
            </g>
          ))}
          {rows.flatMap((y0) =>
            cols.filter((x0) => hit(x0, y0)).map((x0) => (
              <rect key={`h${x0}-${y0}`} x={sRect.x + x0 * kx} y={sRect.y + y0 * ky} width={1024 * kx} height={1024 * ky} className="pt-tile-hit" />
            )),
          )}
          {data.scene.detections.map((d, i) => (
            <path key={i} d={pathOf(views.scene, d.ring)} className="pt-det" />
          ))}
        </svg>
        <div className="pt-view-label" data-pt="tile-label" style={{ left: CONTENT.x, top: CONTENT.y + CONTENT.h - 70 }}>
          <b className="pt-head" data-pt="tile-count">0</b> {LABELS.tiles}
        </div>
        <div className="pt-view-label pt-view-label-r" data-pt="det-label" style={{ right: 1920 - CONTENT.x - CONTENT.w, top: CONTENT.y + CONTENT.h - 70 }}>
          <b className="pt-head pt-red">{data.scene.detections.length}</b> {LABELS.detections}
        </div>
      </div>

      {/* drift ----------------------------------------------------------- */}
      <div className="pt-view" data-view="drift" style={{ clipPath: `inset(${CONTENT.y}px ${1920 - CONTENT.x - CONTENT.w}px ${1080 - CONTENT.y - CONTENT.h}px ${CONTENT.x}px)` }}>
        <div className="pt-drift-map" style={{ clipPath: `inset(${DRIFT_MAP.y}px ${1920 - DRIFT_MAP.x - DRIFT_MAP.w}px ${1080 - DRIFT_MAP.y - DRIFT_MAP.h}px ${DRIFT_MAP.x}px)` }}>
        <svg className="pt-layer" viewBox="0 0 1920 1080" data-pt="grid">
          {grid.lons.map((lon) => {
            const [x] = views.drift(lon, db.south);
            return (
              <g key={`x${lon}`}>
                <line x1={x} y1={DRIFT_MAP.y} x2={x} y2={DRIFT_MAP.y + DRIFT_MAP.h} className="pt-graticule" />
                <text x={x + 8} y={DRIFT_MAP.y + DRIFT_MAP.h - 14} className="pt-graticule-label">{`${Math.abs(lon).toFixed(2)} W`}</text>
              </g>
            );
          })}
          {grid.lats.map((lat) => {
            const [, y] = views.drift(db.west, lat);
            return (
              <g key={`y${lat}`}>
                <line x1={DRIFT_MAP.x} y1={y} x2={DRIFT_MAP.x + DRIFT_MAP.w} y2={y} className="pt-graticule" />
                <text x={DRIFT_MAP.x + 10} y={y - 8} className="pt-graticule-label">{`${lat.toFixed(2)} N`}</text>
              </g>
            );
          })}
        </svg>
        <canvas data-pt="drift-dots" width={1920} height={1080} className="pt-layer" />
        <canvas data-pt="tracks" width={1920} height={1080} className="pt-layer" />
        <svg className="pt-layer" viewBox="0 0 1920 1080">
          <path data-pt="c90-back" d={cells(back.contour90)} className="pt-cells pt-cells-90" />
          <path data-pt="c50-back" d={cells(back.contour50)} className="pt-cells pt-cells-50" />
          <path data-pt="c90-ahead" d={cells(ahead.contour90)} className="pt-cells pt-cells-ahead" />
          <path data-pt="drift-seed" d={pathOf(views.drift, seed.ring)} className="pt-drift-seed" />
          <g data-pt="arrows">
            {streams.map((line, i) => (
              <path
                key={i}
                d={line.pts.map(([lon, lat], k) => `${k ? "L" : "M"}${views.drift(lon, lat).map((v) => v.toFixed(1)).join(" ")}`).join(" ")}
                className={`pt-stream pt-stream-${line.kind}`}
                markerEnd={`url(#pt-head-${line.kind === "wind" ? "w" : "c"})`}
              />
            ))}
          </g>
          {data.scene.cfar.targets.map((t, i) => {
            const [x, y] = views.drift(t.position[0], t.position[1]);
            return <rect key={i} x={x - 7} y={y - 7} width={14} height={14} className="pt-cfar" />;
          })}
          {suspect && (
            <>
              <path data-pt="suspect-track" d={suspect.path} className="pt-suspect-track" />
              <circle data-pt="suspect-ring" cx={suspect.x} cy={suspect.y} r={16} className="pt-suspect-ring" />
              <circle data-pt="suspect-ship" cx={suspect.x} cy={suspect.y} r={11} className="pt-suspect-ship" />
            </>
          )}
          <defs>
            <marker id="pt-head-w" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0 0 L10 5 L0 10 Z" fill="#fff" />
            </marker>
            <marker id="pt-head-c" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0 0 L10 5 L0 10 Z" fill="#2f7cf6" />
            </marker>
          </defs>
        </svg>
        <canvas data-pt="particles" width={1920} height={1080} className="pt-layer" />
        {suspect && (
          <div data-pt="suspect-callout" className="pt-callout pt-callout-red" style={{ left: suspect.x, top: suspect.y }}>
            <svg className="pt-callout-line" width="1" height="1">
              <line x1={0} y1={0} x2={110} y2={-110} />
            </svg>
            <span className="pt-callout-dot" />
            <span className="pt-callout-text pt-suspect-text" style={{ left: 110, top: -110 }}>
              {score.label}
              <small>{`${LABELS.suspected} \u00b7 ${LABELS.score} ${data.journey.score.total.toFixed(2)}`}</small>
            </span>
          </div>
        )}
        <div className="pt-view-label" data-pt="origin-label" style={{ left: ox + 30, top: oy - 60 }}>
          {LABELS.origin}
        </div>
        </div>
        <div className="pt-dcard pt-forcing" data-pt="forcing" data-wind={forcing.windMs} data-current={forcing.current?.speed ?? 0} style={{ left: DC.x, top: DC.forcingTop, width: DC.w, height: DC.forcingH }}>
          <div className="pt-src-row">
            <WindGlyph />
            <div className="pt-src-text">
              <b>
                <span className="pt-src pt-src-w">{LABELS.era5}</span>
                {LABELS.windName}
              </b>
              <span className="pt-src-value">
                <em data-pt="wind-ms">{forcing.windMs.toFixed(2)}</em> m/s {LABELS.from} {forcing.windFrom}°
              </span>
            </div>
          </div>
          <div className="pt-src-row">
            <WaveGlyph />
            <div className="pt-src-text">
              <b>
                <span className="pt-src pt-src-c">{LABELS.cmems}</span>
                {LABELS.currentName}
              </b>
              <span className="pt-src-value">
                <em data-pt="current-ms">{(forcing.current?.speed ?? 0).toFixed(2)}</em> m/s {LABELS.toward} {Math.round(forcing.current?.towardDeg ?? 0)}°
              </span>
            </div>
          </div>
          <div className="pt-forcing-note">{LABELS.forcingNote}</div>
        </div>
        <div className="pt-dcard pt-hours" data-pt="hours" style={{ left: DC.x, top: DC.top, width: DC.w, height: DC.pillH }}>
          <div className="pt-clock pt-head" data-pt="clock" />
          <div className="pt-hour-key"><i className="pt-dot pt-dot-back" />{LABELS.hindcastKey}</div>
          <div className="pt-hour-key"><i className="pt-swatch pt-swatch-back" />{LABELS.originKey}</div>
          <div className="pt-hour-key"><i className="pt-dot pt-dot-ahead" />{LABELS.forecastKey}</div>
          <div className="pt-hour-key"><i className="pt-swatch pt-swatch-ahead" />{LABELS.aheadKey}</div>
        </div>
        <div className="pt-dcard pt-gate-card" data-pt="gate-card" style={{ left: DC.x, top: DC.top, width: DC.w, height: DC.gateH }}>
          <div className="pt-gate-title pt-head">{LABELS.gateTitle}</div>
          <div className="pt-gate-row"><i className="pt-key pt-key-grey" /><b className="pt-head" data-pt="n-window">{gate.considered}</b><span>{LABELS.inWindow}</span></div>
          <div className="pt-gate-row"><i className="pt-key pt-key-w" /><b className="pt-head" data-pt="n-field">{gate.admitted}</b><span>{LABELS.gate}</span></div>
          <div className="pt-gate-row"><i className="pt-key pt-key-dark" /><b className="pt-head" data-pt="n-dark">{data.scene.cfar.targets.length}</b><span>{LABELS.dark}</span></div>
          <div className="pt-gate-row pt-gate-suspect"><i className="pt-dot pt-dot-red" /><span><b>{score.label}</b> {LABELS.suspectKey}</span></div>
        </div>
      </div>

      {/* score ----------------------------------------------------------- */}
      <div className="pt-view pt-scoreview" data-view="score">
        <div className="pt-score-title pt-head" data-pt="score-title">{LABELS.scoreTitle}</div>
        <svg className="pt-layer" viewBox="0 0 1920 1080">
          <path className="pt-tree" d="M 960 300 V 360 H 620 V 410" />
          <path className="pt-tree" d="M 960 360 H 1300 V 410" />
        </svg>
        <div className="pt-card pt-score-card" style={{ left: 330, top: 410, width: 580, height: 560 }}>
          <div className="pt-score-head pt-head">{score.label}</div>
          <div className="pt-score-sub">
            {`${score.detail.split(" \u00b7 ")[0]} \u00b7 ${LABELS.suspected} \u00b7 ${LABELS.rank} ${score.rank} ${LABELS.of} ${score.of}`}
          </div>
          {score.terms.map((t) => (
            <div key={t.key} className="pt-term-row">
              <span className="pt-term-name">{t.label}</span>
              <span className="pt-term-track">
                <span className="pt-term-fill" style={{ width: `${Math.round(t.value * 100)}%` }} />
              </span>
              <span className="pt-term-value">{t.value.toFixed(2)}</span>
              <span className="pt-term-weight">
                {LABELS.weight} {t.weight.toFixed(2)}
              </span>
            </div>
          ))}
          <div className="pt-score-total" data-pt="score-total">
            {LABELS.score} <b className="pt-head">{score.total.toFixed(2)}</b>
          </div>
          {score.isTruth && <div className="pt-score-note">{LABELS.named}</div>}
        </div>
        <div className="pt-card pt-rank-card" style={{ left: 1010, top: 410, width: 580, height: 560 }}>
          <div className="pt-score-head pt-head">{LABELS.ranked}</div>
          {ranking.map((r) => (
            <div key={r.rank} className={`pt-term-row pt-rank-row${r.isTruth ? " pt-rank-top" : ""}`}>
              <span className="pt-rank-no">{r.rank}</span>
              <span className="pt-rank-name">
                {r.label}
                <small>{r.kind}</small>
              </span>
              <span className="pt-rank-score">{r.total.toFixed(2)}</span>
            </div>
          ))}
          <p className="pt-rank-note">{LABELS.rankedNote}</p>
        </div>
      </div>

      {/* timing ---------------------------------------------------------- */}
      <TimingView />
    </>
  );
}

/* --- the weather card's two glyphs ------------------------------------------ */

/**
 * ERA5: an open line cloud with air blowing through it, after the user's
 * reference (2026-09-27): the top streak curls up, the bottom one curls down.
 * The cloud draws on; the streaks keep blowing (CSS) while the card is up.
 */
function WindGlyph() {
  return (
    <svg className="pt-glyph pt-glyph-w" width="76" height="64" viewBox="0 0 76 64">
      <path className="pt-g-draw" d="M24 44 H10 A7.5 7.5 0 0 1 9 29.5 A7 7 0 0 1 18.5 22.8" />
      <path className="pt-g-draw" d="M21 19.6 L21.1 19.5" />
      <path className="pt-g-draw" d="M24 17 A14 14 0 0 1 45.5 24" />
      <path className="pt-g-flow" d="M26 29 H65 A8 8 0 1 0 58 19" />
      <path className="pt-g-flow" d="M16 34 H47" />
      <path className="pt-g-flow" d="M31 39 H61 A5.5 5.5 0 1 1 55.5 48" />
    </svg>
  );
}

/**
 * CMEMS: three swell lines (the user, 2026-09-27: waves only, no crest). Each
 * scrolls one wavelength on a loop at its own speed, its ends faded, while the
 * card is up.
 */
const swell = (y: number) => `M-16 ${y} q4 -5 8 0` + " t8 0".repeat(13);

function WaveGlyph() {
  return (
    <svg className="pt-glyph pt-glyph-c" width="76" height="64" viewBox="0 0 76 64">
      <defs>
        <linearGradient id="pt-swell-fade" x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.16" stopColor="#fff" />
          <stop offset="0.84" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="pt-swell-mask" maskUnits="userSpaceOnUse">
          <rect x="2" y="0" width="72" height="64" fill="url(#pt-swell-fade)" />
        </mask>
      </defs>
      <g mask="url(#pt-swell-mask)">
        <g className="pt-g-swell">
          <path d={swell(18)} />
        </g>
        <g className="pt-g-swell">
          <path d={swell(32)} />
        </g>
        <g className="pt-g-swell">
          <path d={swell(46)} />
        </g>
      </g>
    </svg>
  );
}

/* --- the Timing beat: the deck's measured 00016 run ------------------------ */

const TMAX = Math.max(...TIMING.stages.map((st) => st.ms));
const TSUM = TIMING.stages.reduce((a, st) => a + st.ms, 0);
const STRIP = { x: 260, y: 350, w: 1400, h: 30 };

function Stat({ icon: I, value, label, pt }: { icon: Icon; value: string; label: string; pt?: string }) {
  return (
    <div className="pt-t-stat">
      <span className="pt-t-icon">
        <I size={30} weight="duotone" />
      </span>
      <span className="pt-t-stat-text">
        <b className="pt-head" data-pt={pt}>
          {value}
        </b>
        <span>{label}</span>
      </span>
    </div>
  );
}

function TimingView() {
  let x = STRIP.x;
  const segs = TIMING.stages.map((st) => {
    const w = Math.max(3, (st.ms / TSUM) * STRIP.w);
    const seg = { x, w, model: st.model };
    x += w;
    return seg;
  });
  return (
    <div className="pt-view pt-timing" data-view="timing">
      <div className="pt-timing-head" data-pt="timing-head">
        <div className="pt-score-title pt-head">{LABELS.timingTitle}</div>
        <div className="pt-timing-sub">{LABELS.timingSub}</div>
      </div>
      <div className="pt-strip" style={{ left: STRIP.x, top: STRIP.y, width: STRIP.w, height: STRIP.h }}>
        {segs.map((sg, i) => (
          <span key={i} data-pt={`seg-${i}`} className={`pt-seg${sg.model ? " pt-seg-model" : ""}${i === 2 ? " pt-seg-infer" : ""}`} style={{ left: sg.x - STRIP.x, width: sg.w }} />
        ))}
      </div>
      <div className="pt-card pt-t-rows" style={{ left: 260, top: 420, width: 880, height: 590 }}>
        {TIMING.stages.map((st, i) => (
          <div key={st.name} className={`pt-t-row${i === 2 ? " pt-t-infer" : ""}`} data-ms={st.ms}>
            <span className="pt-t-check">✓</span>
            <span className="pt-t-name">
              {st.name}
              <small>{st.detail}</small>
            </span>
            <span className="pt-t-track">
              <span className={`pt-t-fill${st.model ? " pt-t-fill-model" : ""}`} style={{ width: `${Math.max(0.6, (st.ms / TMAX) * 100)}%` }} />
            </span>
            <span className="pt-t-value">{st.ms >= 1000 ? `${(st.ms / 1000).toFixed(1)} s` : `${st.ms} ms`}</span>
          </div>
        ))}
      </div>
      <div className="pt-card pt-t-stats" style={{ left: 1180, top: 420, width: 480, height: 590 }}>
        <div className="pt-t-group pt-head">{LABELS.speed}</div>
        <Stat icon={Timer} value={`${TIMING.totalS.toFixed(1)} s`} label={LABELS.total} pt="t-total" />
        <Stat icon={GraphicsCard} value={`${TIMING.inferenceS.toFixed(1)} s`} label={LABELS.inference} pt="t-infer" />
        <Stat icon={UploadSimple} value={LABELS.typicalValue} label={LABELS.typical} />
        <div className="pt-t-group pt-head">{LABELS.model}</div>
        <Stat icon={Crosshair} value={`${TIMING.confidencePct}%`} label={LABELS.confidence} pt="t-conf" />
        <Stat icon={ShieldCheck} value={`${TIMING.rejectedPct}%`} label={LABELS.rejected} pt="t-reject" />
      </div>
    </div>
  );
}
