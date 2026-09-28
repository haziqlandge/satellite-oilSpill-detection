/**
 * The statement sequence (T): the problem, its objectives, the proposed
 * solution. Everything is rendered hidden up front; each beat below animates
 * elements that already exist. Copy is in `copy.ts`, geometry in `layout.ts`.
 */
import { createTimeline, stagger, utils, type Timeline } from "animejs";
import { useEffect, useRef } from "react";
import type { BeatBuild } from "../engine";
import { enterCard } from "../parts/Card";
import { flipToTick, pulseTick } from "../parts/IconBadge";
import { RollText, rollText } from "../parts/RollText";
import { TitlePill, openPill } from "../parts/TitlePill";
import type { SceneProps } from "../types";
import { MAY_RUN, OBJECTIVES, PILL, SOLUTIONS, STATEMENT, STATEMENT_BEATS, tickPlan } from "./copy";
import { COLUMN_RECTS, HERO, ICON, PILLS, SOLUTION_SLOTS, STATEMENT_TOP, rowRects } from "./layout";
import { ObjectiveCard } from "./ObjectiveCard";
import { SolutionCard } from "./solutions/SolutionCard";
import { visualTimeline, type WeatherScene } from "./solutions/visuals";

export { STATEMENT_BEATS };

type Q = (sel: string) => HTMLElement;

function objectiveBeat(q: Q, k: number): Timeline {
  const rects = rowRects(k);
  const tl = createTimeline();
  for (let i = 0; i < k - 1; i++) {
    tl.add(q(`[data-pt="obj-${i}"]`), { left: rects[i].x, duration: 650, ease: "inOutCubic" }, 0);
  }
  const card = q(`[data-pt="obj-${k - 1}"]`);
  utils.set(card, { left: rects[k - 1].x, top: rects[k - 1].y });
  const icon = card.querySelector(".pt-obj-icon")!;
  const text = card.querySelectorAll(".pt-obj-stack > *");
  return tl
    .sync(enterCard(card), 120)
    .add(icon, { opacity: [0, 1], scale: [0.5, 1], rotate: [-12, 0], duration: 620, ease: "outBack" }, 380)
    .add(
      text,
      { opacity: [0, 1], translateY: [14, 0], filter: ["blur(6px)", "blur(0px)"], duration: 480, delay: stagger(90), ease: "outCubic" },
      560,
    );
}

function reflowBeat(q: Q): Timeline {
  const tl = createTimeline();
  COLUMN_RECTS.forEach((r, i) => {
    const card = q(`[data-pt="obj-${i}"]`);
    const at = i * 80;
    tl.add(card, { left: r.x, top: r.y, width: r.w, height: r.h, duration: 900, ease: "inOutCubic" }, at)
      .add(
        card.querySelector(".pt-obj-icon")!,
        { left: ICON.column.left, top: ICON.column.top, scale: ICON.column.scale, duration: 900, ease: "inOutCubic" },
        at,
      )
      .add(card.querySelector(".pt-obj-stack")!, { opacity: 0, duration: 260, ease: "outQuad" }, at)
      .add(card.querySelector(".pt-obj-side")!, { opacity: [0, 1], translateX: [16, 0], duration: 460, ease: "outCubic" }, at + 560);
  });
  // Each split pill spans its own side. The objectives pill is a little wider
  // than its column at full size, so both shrink by the same factor (their
  // words stay one size) and the solution pill's plate stretches across the right.
  const pill = q('[data-pt="pill"]');
  const k = PILLS.left.w / pill.offsetWidth;
  const sol = q('[data-pt="solpill"]');
  utils.set(sol, { left: PILLS.right.x, top: PILLS.right.y, width: PILLS.right.w / k, translateY: "-50%", scale: k, transformOrigin: "0% 50%" });
  utils.set(pill, { transformOrigin: "0% 50%" });
  return tl
    .add(pill, { left: PILLS.left.x, top: PILLS.left.y, translateX: ["-50%", "0%"], scale: k, duration: 900, ease: "inOutCubic" }, 0)
    .add(sol, { opacity: [0, 1], translateX: [70, 0], filter: ["blur(8px)", "blur(0px)"], duration: 760, ease: "outCubic" }, 620);
}

const TICKS = tickPlan(SOLUTIONS);

/**
 * One solution lands large at the centre of the right side and plays its
 * picture, then holds there until the presenter presses Q again.
 */
function solutionBeat(q: Q, i: number, scene: WeatherScene | null): Timeline {
  const card = q(`[data-pt="sol-${i}"]`);
  const slot = SOLUTION_SLOTS[i];
  const sol = SOLUTIONS[i];
  const big = sol.kind === "image" ? HERO.imageScale : HERO.iconScale;
  const dx = HERO.cx - (slot.x + slot.w / 2);
  const dy = HERO.cy - (slot.y + slot.h / 2);
  utils.set(card, { translateX: dx, translateY: dy, zIndex: 20 + i });
  const tl = createTimeline()
    .add(card, { opacity: [0, 1], scale: [big * 1.25, big], duration: 700, ease: "outExpo" }, 0)
    .add(
      card.querySelectorAll(".pt-sol-title, .pt-sol-caption, .pt-sol-iconrow"),
      { opacity: [0, 1], translateY: [10, 0], duration: 420, delay: stagger(90), ease: "outCubic" },
      300,
    );
  const picture = visualTimeline(sol.id, card, scene);
  if (picture) tl.sync(picture, 500);
  return tl;
}

/**
 * The press after a solution lands: it shrinks into its slot, and as it
 * settles the objectives it answers flip to ticks (or pulse, if already ticked).
 */
function stackBeat(q: Q, i: number): Timeline {
  const tl = createTimeline().add(q(`[data-pt="sol-${i}"]`), { translateX: 0, translateY: 0, scale: 1, duration: 900, ease: "inOutCubic" }, 0);
  const badge = (id: string) => q(`[data-pt="obj-${OBJECTIVES.findIndex((o) => o.id === id)}"] [data-pt="badge"]`);
  TICKS[i].flip.forEach((id, j) => tl.sync(flipToTick(badge(id)), 650 + j * 180));
  TICKS[i].pulse.forEach((id, j) => tl.sync(pulseTick(badge(id)), 650 + j * 180));
  return tl;
}

export function StatementScene({ register }: Pick<SceneProps, "register">) {
  const root = useRef<HTMLDivElement>(null);
  const scene = useRef<WeatherScene | null>(null);

  // The May run's own forcing, for the weather terminal. Fetched while the
  // presenter is still on the statement, long before solution 3 lands.
  useEffect(() => {
    let live = true;
    fetch(`/${MAY_RUN}/scene.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live) scene.current = j;
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const el = root.current!;
    const q: Q = (sel) => el.querySelector<HTMLElement>(sel)!;
    utils.set(q('[data-pt="pill"]'), { left: PILLS.centre.x, top: PILLS.centre.y, translateX: "-50%", translateY: "-50%" });

    const beats: Record<string, BeatBuild> = {
      pill: () => openPill(q('[data-pt="pill"]')),
      statement: () =>
        createTimeline()
          .add(q('[data-pt="pill"]'), { top: PILLS.top.y, duration: 720, ease: "inOutCubic" }, 0)
          .add(
            el.querySelectorAll(".pt-word"),
            {
              opacity: [0, 1],
              translateY: [18, 0],
              filter: ["blur(8px)", "blur(0px)"],
              duration: 520,
              delay: stagger(45),
              ease: "outCubic",
            },
            380,
          )
          .add(q('[data-pt="desc"]'), { opacity: [0, 1], translateY: [16, 0], duration: 620, ease: "outCubic" }, 1300)
          .add(el.querySelectorAll('[data-pt="chip"]'), { opacity: [0, 1], scale: [1.35, 1], duration: 620, delay: stagger(110), ease: "outExpo" }, 1650),
      roll: () =>
        createTimeline()
          .add(q('[data-pt="body"]'), { opacity: [1, 0], translateY: [0, -70], filter: ["blur(0px)", "blur(12px)"], duration: 560, ease: "inQuad" }, 0)
          .sync(rollText(q('[data-pt="roll"]')), 200),
      reflow: () => reflowBeat(q),
    };
    for (let k = 1; k <= 5; k++) beats[`obj${k}`] = () => objectiveBeat(q, k);
    for (let i = 0; i < SOLUTIONS.length; i++) {
      beats[`sol${i + 1}`] = () => solutionBeat(q, i, scene.current);
      beats[`sol${i + 1}-stack`] = () => stackBeat(q, i);
    }
    register(beats);
  }, [register]);

  return (
    <div ref={root} className="pt-statement">
      <TitlePill data-pt="pill">
        <span>{PILL.problem}</span>
        <RollText data-pt="roll" from={PILL.statement} to={PILL.objectives} />
      </TitlePill>

      <div className="pt-st-body" data-pt="body" style={{ top: STATEMENT_TOP }}>
        <p className="pt-st-title">
          {STATEMENT.title.flatMap((part, i) =>
            part.text
              .split(/(\s+)/)
              .filter(Boolean)
              .map((w, j) =>
                /^\s+$/.test(w) ? (
                  w
                ) : (
                  <span key={`${i}-${j}`} className={`pt-word${part.red ? " pt-red" : ""}`}>
                    {w}
                  </span>
                ),
              ),
          )}
        </p>
        <p className="pt-st-desc" data-pt="desc">
          {STATEMENT.description}
        </p>
        <div className="pt-st-chips">
          {STATEMENT.chips.map((c) => (
            <span key={c} className="pt-chip" data-pt="chip">
              {c}
            </span>
          ))}
        </div>
      </div>

      {OBJECTIVES.map((o, i) => (
        <ObjectiveCard key={o.id} index={i} icon={o.icon} heading={o.heading} body={o.body} />
      ))}

      <TitlePill data-pt="solpill">{PILL.solution}</TitlePill>

      {SOLUTIONS.map((sol, i) => (
        <SolutionCard key={sol.id} index={i} {...sol} slot={SOLUTION_SLOTS[i]} />
      ))}
    </div>
  );
}
