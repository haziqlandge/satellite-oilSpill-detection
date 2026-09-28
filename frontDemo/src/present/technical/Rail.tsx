/**
 * The stage rail along the top of the technical journey. A glow walks from
 * stage to stage (the reference video's chain highlight), so the room stays
 * oriented while the camera zooms in and out underneath.
 */
import { createTimeline, stagger, type Timeline } from "animejs";
import { Connector, drawConnector } from "../parts/Connector";
import { RAIL } from "./copy";

export const RAIL_Y = 136;
const X0 = 250;
const X1 = 1670;
export const railX = (i: number) => X0 + ((X1 - X0) * i) / (RAIL.length - 1);

export function Rail() {
  return (
    <div className="pt-rail" data-pt="rail">
      <Connector
        d={`M ${X0} ${RAIL_Y} H ${X1}`}
        width={1920}
        height={1080}
        style={{ left: 0, top: 0 }}
        data-pt="rail-line"
      />
      <div className="pt-rail-glow" data-pt="rail-glow" style={{ left: railX(0), top: RAIL_Y }} />
      {RAIL.map((label, i) => (
        <div key={label} className="pt-rail-node" data-pt={`rail-${i}`} style={{ left: railX(i), top: RAIL_Y }}>
          <span className="pt-rail-dot" />
          <span className="pt-rail-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

export function drawRail(root: HTMLElement): Timeline {
  return createTimeline()
    .sync(drawConnector(root.querySelector<SVGPathElement>('[data-pt="rail-line"] .pt-connector-reveal')!, 900), 0)
    .add(root.querySelectorAll(".pt-rail-node"), { opacity: [0, 1], scale: [0.4, 1], duration: 420, delay: stagger(60), ease: "outBack" }, 200);
}

/** Walk the glow to stage `i`: it turns red and white, and the one before it turns blue. */
export function railTo(root: HTMLElement, i: number): Timeline {
  const tl = createTimeline()
    .add(root.querySelector('[data-pt="rail-glow"]')!, { left: railX(i), opacity: 1, duration: 700, ease: "inOutCubic" }, 0);
  for (let j = 0; j < RAIL.length; j++) {
    const node = root.querySelector(`[data-pt="rail-${j}"]`)!;
    const state = j < i ? "done" : j === i ? "active" : "todo";
    tl.call(() => node.setAttribute("data-state", state), j === i ? 450 : 0);
  }
  return tl;
}
