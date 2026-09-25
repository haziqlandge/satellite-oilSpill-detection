/**
 * Wind, current and drift at the spill, at the playhead: a stack of small
 * compass cards in the map's top-right corner.
 *
 * Each arrow points where the air, the water or the oil is going, the same
 * convention as the map's arrows (`sim/flow.ts`). A simulated value carries a
 * SIM tag, so it never reads as a measured one; where a real value came from
 * ("sourced from ...") is said in the panels, not on the map. A value the run
 * does not have shows a dash rather than zero.
 */

import { driftMotion, flowMean, isSimulated, ringsBbox, speedToward, spillParts } from "../sim/flow";
import type { Run } from "../sim/types";
import type { MapPaint } from "../theme";

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg: number) => POINTS[Math.round(deg / 45) % 8];

interface Card {
  label: string;
  value: string | null;
  towardDeg: number | null;
  /** 0-1, how long the arrow is drawn. */
  strength: number;
  /** The second line: where it is heading, or what the number counts. */
  detail: string;
  colour: string;
  /** Tagged SIM on the card: a simulated value, or a place with no real data. */
  sim: boolean;
}

function Compass({ card }: { card: Card }) {
  const r = 12;
  const len = 4 + 8 * card.strength;
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" className="shrink-0">
      <circle cx="15" cy="15" r={r} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" />
      {card.label !== "Ships" && <line x1="15" y1="2" x2="15" y2="5" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.2" />}
      {card.label === "Ships" && (
        // A cargo ship side on: hull, bridge, funnel, on a waterline.
        <g fill={card.colour}>
          <path d="M5.5 16.5 H24.5 L22 20.5 H8.5 Z" />
          <rect x="17" y="12" width="4.5" height="4.5" />
          <rect x="18.5" y="9.5" width="2" height="2.5" />
          <rect x="8" y="13.5" width="3" height="3" opacity="0.75" />
          <rect x="11.5" y="13.5" width="3" height="3" opacity="0.75" />
          <line x1="6" y1="22.3" x2="24" y2="22.3" stroke={card.colour} strokeOpacity="0.45" strokeWidth="0.8" />
        </g>
      )}
      {card.towardDeg !== null && (
        <g transform={`rotate(${card.towardDeg.toFixed(1)} 15 15)`} style={{ transition: "transform 300ms linear" }}>
          <line x1="15" y1={15 + len} x2="15" y2={15 - len + 3} stroke={card.colour} strokeWidth="1.8" strokeLinecap="round" />
          <polygon points={`15,${15 - len - 1} ${11.5},${15 - len + 4} ${18.5},${15 - len + 4}`} fill={card.colour} />
        </g>
      )}
    </svg>
  );
}

export function FlowCards({ run, hour, paint }: { run: Run; hour: number; paint: MapPaint }) {
  // The mean over the spill and its surroundings, as each map arrow is its
  // cell's mean: a point lookup at a slick against the coast lands in the
  // current field's land cells and reads nothing.
  const around = ringsBbox(spillParts(run.detection), 1.5);
  const flow = run.flow;
  const wind = flow ? flowMean(flow, "wind", around, hour) : null;
  const current = flow ? flowMean(flow, "current", around, hour) : null;
  const drift = driftMotion(run.drift.frames, hour);

  const vector = (v: [number, number] | null, unit: string, full: number, digits: number) => {
    if (!v) return { value: null, towardDeg: null, strength: 0 };
    const { speed, towardDeg } = speedToward(v);
    return { value: `${speed.toFixed(digits)} ${unit}`, towardDeg, strength: Math.min(1, speed / full) };
  };
  const cards: Card[] = [
    {
      label: "Wind",
      ...vector(wind, "m/s", 12, 1),
      detail: "",
      colour: paint.wind,
      sim: isSimulated(flow?.windSource),
    },
    {
      label: "Current",
      ...vector(current, "m/s", 0.8, 2),
      detail: "",
      colour: paint.current,
      sim: isSimulated(flow?.currentSource),
    },
    {
      label: "Drift",
      value: drift ? `${drift.kmh.toFixed(2)} km/h` : null,
      towardDeg: drift?.towardDeg ?? null,
      strength: drift ? Math.min(1, drift.kmh / 3) : 0,
      detail: "",
      colour: paint.slick,
      // The drift is a simulation's only on an authored run, whose wind is.
      sim: isSimulated(flow?.windSource) && !run.meta.provenance.startsWith("REAL"),
    },
    {
      label: "Ships",
      value: `${run.vessels.length}`,
      towardDeg: null,
      strength: 0,
      detail: "vessels around the event",
      colour: paint.target,
      sim: isSimulated(run.trafficSource),
    },
  ];

  return (
    <div className="pointer-events-none absolute right-2 top-7 z-10 flex flex-col gap-1" aria-label="Flow at the spill">
      {cards.map((card) => (
        <div
          key={card.label}
          className="border-line bg-base-2/85 text-dim flex w-[172px] items-center gap-1.5 border px-1.5 py-1 font-mono text-[9.5px] leading-tight backdrop-blur"
          role="status"
          aria-label={card.value && card.towardDeg !== null
            ? `${card.label} ${card.value} toward ${Math.round(card.towardDeg)} degrees${card.sim ? ", simulated" : ""}`
            : `${card.label} ${card.value ?? "not available"}${card.sim ? ", simulated" : ""}`}
        >
          <Compass card={card} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1 whitespace-nowrap">
              <span className="uppercase tracking-wider">{card.label}</span>
              <span style={{ color: card.colour }}>{card.value ?? "—"}</span>
              {card.sim && (
                <span className="ml-auto border px-0.5 text-[8.5px] leading-none tracking-wider" style={{ borderColor: "var(--warn, #e0b050)", color: "var(--warn, #e0b050)" }}>
                  SIM
                </span>
              )}
            </div>
            <div className="truncate opacity-80">
              {card.towardDeg !== null ? `→ ${Math.round(card.towardDeg)}° ${compass(card.towardDeg)}` : card.detail || "—"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
