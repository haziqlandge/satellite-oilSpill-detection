/**
 * The tech stack: a layered tree. The journey above it collapses and flies off,
 * the "TECH STACK" pill opens, dashed connectors run down to five layer pills,
 * and each Q drops one layer's tool cards in, the reference video's card motion.
 */
import { createTimeline, stagger, utils, type Timeline } from "animejs";
import { useEffect, useRef } from "react";
import type { BeatBuild } from "../engine";
import { Connector, drawConnector } from "../parts/Connector";
import { TitlePill, openPill } from "../parts/TitlePill";
import { LABELS } from "./copy";
import { IMAGE_LOGOS, LOGOS } from "./logos";
import { LAYERS, STACK, type Tool } from "./stack";
import "./stack.css";

const PILL_Y = 110;
const colX = (i: number) => STACK.x0 + i * STACK.dx;

function ToolMark({ tool }: { tool: Tool }) {
  if (tool.logo) {
    return (
      <svg viewBox="0 0 24 24" className="pt-tool-logo" aria-hidden="true">
        <path d={LOGOS[tool.logo]} />
      </svg>
    );
  }
  if (tool.image) return <img src={IMAGE_LOGOS[tool.image]} alt="" className="pt-tool-img" />;
  return <span className="pt-tool-mono pt-head">{tool.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}</span>;
}

export function StackScene({ onBeats }: { onBeats: (beats: Record<string, BeatBuild>) => void }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current!;
    const q = (sel: string) => el.querySelector<HTMLElement>(sel)!;
    const journey = el.parentElement!.querySelector<HTMLElement>(".pt-journey")!;
    utils.set(q('[data-pt="stack-pill"]'), { left: 960, top: PILL_Y, translateX: "-50%", translateY: "-50%" });
    // Centred by anime.js, not CSS: its scale pops would otherwise replace a CSS translate.
    utils.set(el.querySelectorAll(".pt-layer-pill"), { translateX: "-50%", translateY: "-50%" });

    const beats: Record<string, BeatBuild> = {
      stackIn: () => {
        const tl = createTimeline()
          .add(journey.querySelectorAll(".pt-view"), { opacity: 0, duration: 650, ease: "inQuad" }, 0)
          .add(journey.querySelector('[data-pt="rail"]')!, { translateY: -160, opacity: 0, duration: 700, ease: "inCubic" }, 200)
          .add(journey.querySelector('[data-pt="tpill"]')!, { translateY: ["-50%", "-260%"], opacity: 0, duration: 700, ease: "inCubic" }, 200)
          .sync(openPill(q('[data-pt="stack-pill"]')), 900);
        el.querySelectorAll<SVGPathElement>(".pt-stack-links .pt-connector-reveal").forEach((p, i) => {
          tl.sync(drawConnector(p, 650), 1350 + i * 70);
        });
        return tl.add(el.querySelectorAll(".pt-layer-pill"), {
          opacity: [0, 1],
          scale: [0.6, 1],
          duration: 480,
          delay: stagger(90),
          ease: "outBack",
        }, 1850);
      },
    };
    LAYERS.forEach((_, i) => {
      beats[`layer${i + 1}`] = (): Timeline =>
        createTimeline()
          .add(q(`[data-pt="layer-${i}"]`), { scale: [1, 1.12, 1], duration: 500, ease: "outQuad" }, 0)
          .add(el.querySelectorAll(`[data-col="${i}"]`), {
            opacity: [0, 1],
            scale: [1.35, 1],
            duration: 650,
            delay: stagger(85),
            ease: "outExpo",
          }, 150);
    });
    onBeats(beats);
  }, [onBeats]);

  return (
    <div ref={root} className="pt-stack">
      <TitlePill data-pt="stack-pill">{LABELS.stack}</TitlePill>
      <div className="pt-stack-links">
        {LAYERS.map((l, i) => (
          <Connector
            key={l.name}
            d={`M 960 ${PILL_Y + 36} V ${PILL_Y + 80} H ${colX(i)} V ${STACK.pillY - 22}`}
            width={1920}
            height={1080}
            style={{ left: 0, top: 0 }}
          />
        ))}
      </div>
      {LAYERS.map((l, i) => (
        <div key={l.name} className="pt-layer-pill pt-head" data-pt={`layer-${i}`} style={{ left: colX(i), top: STACK.pillY }}>
          {l.name}
        </div>
      ))}
      {LAYERS.flatMap((l, i) =>
        l.tools.map((t, j) => (
          <div
            key={`${l.name}-${t.name}`}
            className="pt-card pt-tool"
            data-col={i}
            style={{ left: colX(i) - STACK.w / 2, top: STACK.top + j * STACK.pitch, width: STACK.w, height: STACK.h }}
          >
            <span className="pt-tool-mark">
              <ToolMark tool={t} />
            </span>
            <span className="pt-tool-text">
              <span className="pt-tool-name">{t.name}</span>
              {t.note && <span className="pt-tool-note">{t.note}</span>}
            </span>
          </div>
        )),
      )}
    </div>
  );
}
