/**
 * Scenario state, shared by every page.
 *
 * Building a scenario takes roughly half a second: an ensemble of twelve
 * members, thirty-eight hundred particles, seventy-nine timesteps of density
 * grids and contours, and a few tens of thousands of AIS reports. That is fast
 * enough to do on demand and far too slow to do during a render, so it happens
 * off the render path with a stated loading state rather than blocking the
 * frame and dropping the map.
 *
 * The state lives in the URL query so a particular view can be linked to, which
 * matters when the demo is being walked through by someone else.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { SCENARIOS, buildRun, type ScenarioId } from "./sim/scenarios";
import type { DriftVariant } from "./sim/scoring";
import type { Run } from "./sim/types";

export interface RunState {
  run: Run | null;
  loading: boolean;
  scenario: ScenarioId;
  setScenario: (id: ScenarioId) => void;
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
}

function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  const q = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return new URLSearchParams(q).get(name);
}

function isScenario(v: string | null): v is ScenarioId {
  return !!v && SCENARIOS.some((s) => s.id === v);
}

export function useRun(): RunState {
  const initial = readParam("scenario");
  const [scenario, setScenarioRaw] = useState<ScenarioId>(
    isScenario(initial) ? initial : "gom-berthed",
  );
  const [variant, setVariantRaw] = useState<DriftVariant>("integral");
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [hour, setHour] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ablated, setAblated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // Yielding to the browser first lets the loading state paint. Building
    // synchronously would freeze the frame for the whole run and the user would
    // see nothing change until it finished.
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
  }, [scenario, variant]);

  const setScenario = useCallback((id: ScenarioId) => {
    setScenarioRaw(id);
    if (typeof window !== "undefined") {
      const [path] = window.location.hash.split("?");
      const next = `${path || "#/"}?scenario=${id}`;
      history.replaceState(null, "", next);
    }
  }, []);

  const setVariant = useCallback((v: DriftVariant) => setVariantRaw(v), []);

  return useMemo(
    () => ({
      run,
      loading,
      scenario,
      setScenario,
      variant,
      setVariant,
      hour,
      setHour,
      selectedId,
      setSelectedId,
      ablated,
      setAblated,
    }),
    [
      run,
      loading,
      scenario,
      setScenario,
      variant,
      setVariant,
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
 * contribution of the one term the project adds.
 */
export function orderedSuspects(run: Run, ablated: boolean) {
  const rows = [...run.suspects];
  rows.sort((a, b) =>
    ablated
      ? a.rankWithoutDrift - b.rankWithoutDrift
      : a.rank - b.rank,
  );
  return rows;
}
