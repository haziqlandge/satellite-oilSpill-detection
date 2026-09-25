/**
 * One live pipeline run's stages, as they happen (FUTURE_WORK §3, the stages streamed).
 *
 * Every state, detail and duration here is what the pipeline process on this
 * machine wrote as it went (`backend/pipeline/run.py`), streamed over
 * server-sent events (`lib/api.ts`). The one thing computed in the browser is
 * the ticking elapsed time of the stage that is running now, from the start
 * the pipeline stamped on it; a finished stage shows the pipeline's own figure.
 *
 * A refusal is drawn as a result, not an error (C3): a run that ends because
 * no detection meets the seed rule, or because nobody can be ranked, says so
 * in the pipeline's own words, in the warning tone, not hidden.
 */

import { useEffect, useRef, useState } from "react";
import { getRun, useApi, watchRun, type ApiRunStage, type ApiRunStatus } from "../lib/api";
import { registerApiRun, type RealRunId } from "../sim/realRun";
import { Flag, useFollowRunning } from "./components";

const formatMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

const OUTCOME: Record<string, { label: string; tone: "ok" | "warn" | "alarm" }> = {
  complete: { label: "complete", tone: "ok" },
  no_seed: { label: "refused · no seed", tone: "warn" },
  no_time: { label: "refused · no time", tone: "warn" },
  no_precomputed: { label: "refused · no precomputed", tone: "warn" },
  failed: { label: "failed", tone: "alarm" },
};

function StageIcon({ state }: { state: ApiRunStage["state"] }) {
  if (state === "running")
    return <span className="h-3 w-3 animate-spin rounded-full border-2" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />;
  if (state === "done") return <span style={{ color: "var(--accent)" }}>✓</span>;
  if (state === "failed") return <span style={{ color: "var(--alarm)" }}>✕</span>;
  if (state === "refused") return <span style={{ color: "var(--warn, var(--alarm))" }}>⊘</span>;
  if (state === "skipped") return <span style={{ color: "var(--ink-faint)" }}>–</span>;
  return <span className="h-2 w-2 rounded-full border" style={{ borderColor: "var(--ink-faint)" }} />;
}

export function ServerRunTimings({ runId }: { runId: string }) {
  const api = useApi();
  const run = api.runs.find((r) => r.id === runId);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!run) void getRun(runId).then(() => watchRun(runId), () => undefined);
    else watchRun(runId);
    // Only the id: the run object changes on every event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const running = run?.stages.some((s) => s.state === "running") ?? false;
  const list = useRef<HTMLUListElement>(null);
  useFollowRunning(list, run?.stages.find((s) => s.state === "running")?.key ?? run?.status ?? "");
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(timer);
  }, [running]);

  if (!run) return <p className="mt-2 px-2 text-[10px]" style={{ color: "var(--ink-faint)" }}>reading run {runId} from the API…</p>;

  const now = Date.now();
  const elapsed = (s: ApiRunStage) =>
    s.state === "running" && s.startedAt ? Math.max(0, now - s.startedAt) : s.ms ?? 0;
  const total = run.stages.reduce((sum, s) => sum + elapsed(s), 0);
  const outcome = run.outcome ? OUTCOME[run.outcome] ?? { label: run.outcome, tone: "warn" as const } : null;
  const refused = run.stages.filter((s) => s.state === "refused");

  return <div data-server-run={run.id} data-server-status={run.status}>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-2">
      <p className="num text-[10px]" style={{ color: "var(--ink-faint)" }}>
        live pipeline · POST /api/v1/runs · {run.id}</p>
      {outcome ? <Flag tone={outcome.tone}>{outcome.label}</Flag>
        : <Flag tone="ok">{run.status === "queued" ? "queued" : "running"}</Flag>}
    </div>
    <p className="num mt-1 px-2 text-[10px]" style={{ color: "var(--ink-faint)" }}>
      {run.source}{run.use_precomputed ? " · PRECOMPUTED segmentation requested" : ""}</p>
    <ul ref={list} className="mt-2 border" style={{ borderColor: "var(--line)" }} data-server-stages>
      {run.stages.map((s) =>
        <li key={s.key} data-stage={s.key} data-stage-status={s.state}
          className="flex items-start justify-between gap-3 border-b px-2 py-2 text-[11px]" style={{ borderColor: "var(--line)" }}>
          <span className="flex min-w-0 items-start gap-2">
            <span className="mt-[2px] flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden><StageIcon state={s.state} /></span>
            <span className="min-w-0">
              <span style={{ color: s.state === "pending" || s.state === "skipped" ? "var(--ink-faint)" : undefined }}>{s.label}</span>
              {s.state === "running" && s.progress && s.progress.total > 0 &&
                <span className="num block text-[9.5px]" style={{ color: "var(--accent)" }}>
                  {s.key.startsWith("drift") ? "member" : "tile"} {s.progress.done} of {s.progress.total}</span>}
              {s.detail && s.state !== "skipped" && <span className="block text-[9.5px] leading-[1.45]" style={{
                color: s.state === "failed" ? "var(--alarm)" : s.state === "refused" ? "var(--ink)" : "var(--ink-faint)",
              }}>{s.detail}</span>}
            </span>
          </span>
          <span className="num shrink-0" style={{
            color: s.state === "failed" ? "var(--alarm)" : s.state === "pending" || s.state === "skipped" ? "var(--ink-faint)" : "var(--accent)",
          }}>{s.state === "pending" || s.state === "skipped" ? "—" : formatMs(elapsed(s))}</span>
        </li>)}
      <li className="flex justify-between px-2 py-2 text-[11px] font-medium">
        <span>Total{running ? " so far" : ""}</span><span className="num">{formatMs(total)}</span></li>
    </ul>
    {run.status === "failed" && run.detail &&
      <p role="alert" className="mt-2 px-2 text-[10px] leading-[1.5]" style={{ color: "var(--alarm)" }}>{run.detail}</p>}
    {refused.length > 0 && <p className="mt-2 border-l-2 px-2 text-[10px] leading-[1.5]"
      style={{ borderColor: "var(--warn, var(--alarm))" }} data-server-refusal>
      {refused.map((s) => s.label).join(" · ")} refused — a result, not a failure (C3).</p>}
    <p className="mt-2 px-2 text-[9.5px] leading-[1.5]" style={{ color: "var(--ink-faint)" }}>
      Each stage's state and time come from the pipeline process on this machine, streamed as it
      writes them; only the running stage's clock ticks here. The drift is OpenDrift on ERA5 wind,
      and on CMEMS currents when Copernicus Marine credentials are set (the wind stage says which).</p>
  </div>;
}

/**
 * Make a finished, complete API run selectable as a real-run view; null for a
 * run that refused or failed, which has no drift to show.
 */
export function registerIfComplete(run: ApiRunStatus): RealRunId | null {
  if (run.status !== "done" || run.outcome !== "complete" || !run.files["drift.json"] || !run.files["scene.json"]) return null;
  return registerApiRun({ id: run.id, source: run.source ?? run.id, hasAis: !!run.files["ais.json"] });
}
