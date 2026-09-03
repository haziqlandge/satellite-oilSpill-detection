/**
 * Scenario state, per block.
 *
 * This replaces the old `useRun`, which held one scenario for the entire
 * application. That was right when the app was four products showing one case
 * at a time; it is wrong now. The home page shows four different data blocks at
 * once -- the radar frame, the drift playback, the damage footprint, the
 * traffic overlay -- and each carries its own spill control. Changing the case
 * under the drift playback must not reach across the page and change the radar
 * frame above it.
 *
 * So the state is per-block, and every block gets its own clock too. Two
 * playbacks on one page sharing an hour would scrub each other.
 *
 * Two things make this affordable:
 *
 *  - `buildRun` is memoised per `scenario:variant` in `sim/scenarios`, so the
 *    second block to ask for a case pays nothing for it
 *  - a block does not build its run until it nears the viewport. Building all
 *    five scenarios eagerly is about half a second each of blocking work, and
 *    doing that on load would freeze the page for two and a half seconds before
 *    anything appeared
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  SCENARIOS,
  buildRun,
  scenarioListing,
  type ScenarioId,
  type ScenarioListing,
} from "../sim/scenarios";
import type { DriftVariant } from "../sim/scoring";
import type { Run } from "../sim/types";

export interface SpillState {
  run: Run | null;
  loading: boolean;
  scenario: ScenarioId;
  setScenario: (id: ScenarioId) => void;
  listing: ScenarioListing;
  /** Step through the cases, for the arrow form of the control. */
  next: () => void;
  prev: () => void;
  variant: DriftVariant;
  setVariant: (v: DriftVariant) => void;
  /** Hours from acquisition. Negative is backward. */
  hour: number;
  setHour: (h: number) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** Recompute ranks with S_drift removed. The term ablation, live. */
  ablated: boolean;
  setAblated: (v: boolean) => void;
  /**
   * Attach to the block. Until it nears the viewport the run is not built.
   *
   * Optional in the sense that a surface which is always visible -- the console
   * -- can pass `eager` and ignore it.
   */
  ref: RefObject<HTMLDivElement | null>;
}

export interface SpillOptions {
  /** Build immediately rather than waiting for the block to approach view. */
  eager?: boolean;
  /** Sync the choice to `?scenario=` so a particular view can be linked to. */
  syncUrl?: boolean;
}

function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  const q = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return new URLSearchParams(q).get(name);
}

export function isScenario(v: string | null): v is ScenarioId {
  return !!v && SCENARIOS.some((s) => s.id === v);
}

export function useSpill(
  initial: ScenarioId = "gom-berthed",
  opts: SpillOptions = {},
): SpillState {
  const { eager = false, syncUrl = false } = opts;

  const fromUrl = syncUrl ? readParam("scenario") : null;
  const [scenario, setScenarioRaw] = useState<ScenarioId>(
    isScenario(fromUrl) ? fromUrl : initial,
  );
  const [variant, setVariant] = useState<DriftVariant>("integral");
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [hour, setHour] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ablated, setAblated] = useState(false);

  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(eager);

  /* --- the viewport gate ------------------------------------------- */

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    // No element to observe (or no observer at all): build rather than stall.
    // Priming a block to "not yet" is a bet that something will release it, and
    // that bet losing must not produce a permanently empty figure.
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      // A screen and a half of lead time, so the run is built and painted
      // before the reader arrives rather than while they are looking at it.
      { rootMargin: "150% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  /* --- the build ---------------------------------------------------- */

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);

    // Yielding to the browser first lets the loading state paint. Building
    // synchronously would freeze the frame for the whole run and nothing would
    // change on screen until it finished.
    const id = window.setTimeout(() => {
      const built = buildRun(scenario, variant);
      if (cancelled) return;
      setRun(built);
      setHour(0);
      setSelectedId(built.suspects[0]?.id ?? null);
      setLoading(false);
    }, 16);

    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [scenario, variant, visible]);

  const setScenario = useCallback(
    (id: ScenarioId) => {
      setScenarioRaw(id);
      if (syncUrl && typeof window !== "undefined") {
        const [path] = window.location.hash.split("?");
        history.replaceState(null, "", `${path || "#/"}?scenario=${id}`);
      }
    },
    [syncUrl],
  );

  const step = useCallback(
    (delta: number) => {
      const i = SCENARIOS.findIndex((s) => s.id === scenario);
      const n = SCENARIOS.length;
      setScenario(SCENARIOS[(((i + delta) % n) + n) % n].id);
    },
    [scenario, setScenario],
  );

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  return useMemo(
    () => ({
      run,
      loading,
      scenario,
      setScenario,
      listing: scenarioListing(scenario),
      next,
      prev,
      variant,
      setVariant,
      hour,
      setHour,
      selectedId,
      setSelectedId,
      ablated,
      setAblated,
      ref,
    }),
    [
      run,
      loading,
      scenario,
      setScenario,
      next,
      prev,
      variant,
      hour,
      selectedId,
      ablated,
    ],
  );
}

/**
 * Candidates in the order the interface should list them.
 *
 * When the ablation is on, the ranking is recomputed from the scores that
 * exclude S_drift. Nothing else changes, so what the viewer sees is exactly the
 * contribution of the one term this project adds.
 */
export function orderedSuspects(run: Run, ablated: boolean) {
  const rows = [...run.suspects];
  rows.sort((a, b) =>
    ablated ? a.rankWithoutDrift - b.rankWithoutDrift : a.rank - b.rank,
  );
  return rows;
}
