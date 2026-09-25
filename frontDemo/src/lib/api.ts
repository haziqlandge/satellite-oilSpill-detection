/**
 * The live pipeline's API (`backend/app`, FUTURE_WORK §3), as the console uses it.
 *
 * The API is optional. The console is a static build and every view it had
 * before runs without it; when the API answers (`npm run dev` proxies `/api`
 * to 127.0.0.1:8000, the `api` launch configuration), an uploaded GeoTIFF is
 * also sent to `POST /api/v1/runs`, and the real pipeline's stages stream back
 * over server-sent events as they happen. Nothing here times or invents a
 * stage: every state and duration is the one the pipeline process wrote.
 *
 * A finished run is read with the view the three exported real runs use
 * (`sim/realRun.ts`): the pipeline writes the same `drift.json`, `scene.json`
 * and `ais.json`.
 */

import { useSyncExternalStore } from "react";

/**
 * Where the live pipeline answers. Relative by default: the dev server and
 * `vite preview` proxy `/api` to a local uvicorn. A build can point at a hosted
 * pipeline instead (FUTURE_WORK §4.3) with `VITE_API_BASE=https://host/api/v1`
 * at build time; that host must list the site in `API_CORS_ORIGINS`.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "api/v1").replace(/\/+$/, "");

export type ApiStageState = "pending" | "running" | "done" | "failed" | "skipped" | "refused";

export interface ApiRunStage {
  key: string;
  label: string;
  state: ApiStageState;
  ms?: number | null;
  detail?: string | null;
  progress?: { done: number; total: number } | null;
  /** Epoch ms the pipeline stamped on the stage's start, while it runs (same machine, same clock). */
  startedAt?: number | null;
}

export interface ApiRunStatus {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  /** `complete`, or the refusal it ended on (`no_seed`, `no_time`, `no_precomputed`), or `failed`. */
  outcome: string | null;
  source: string | null;
  use_precomputed: boolean;
  created_at: string;
  stages: ApiRunStage[];
  detail: string | null;
  events_url: string;
  files: Record<string, string>;
  scene_id: string | null;
  seed_detection_id: string | null;
}

export interface ApiRunEvent {
  seq: number;
  at?: string;
  stage: string;
  state: ApiStageState | "progress";
  label?: string;
  ms?: number;
  detail?: string;
  done?: number;
  total?: number;
  data?: Record<string, unknown>;
  /** Present when the API, not the pipeline, wrote the event (a process that died). */
  by?: string;
}

/** An RFC 7807 problem the API answered with. */
export class ApiProblem extends Error {
  constructor(readonly status: number, readonly type: string, readonly title: string, readonly detail: string) {
    super(`${title}: ${detail}`);
  }
}

async function problemOf(response: Response): Promise<ApiProblem> {
  try {
    const body = await response.json();
    return new ApiProblem(response.status, body.type ?? "", body.title ?? response.statusText, body.detail ?? "");
  } catch {
    return new ApiProblem(response.status, "", response.statusText, `the API answered ${response.status}`);
  }
}

/** Only JSON counts: a dev server without the proxy answers `/api/...` with its index page. */
function isJson(response: Response) {
  return (response.headers.get("content-type") ?? "").includes("json");
}

/* ---- the API's own state, shared by every component ---------------------- */

export interface ApiState {
  /** null until the first probe answers. */
  up: boolean | null;
  runs: ApiRunStatus[];
}

let state: ApiState = { up: null, runs: [] };
const listeners = new Set<() => void>();
const publish = (patch: Partial<ApiState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};
/** Replace a run where it is in the list (newest first), or put a new one at the top. */
const upsert = (run: ApiRunStatus) =>
  publish({ runs: state.runs.some((r) => r.id === run.id)
    ? state.runs.map((r) => (r.id === run.id ? run : r))
    : [run, ...state.runs] });

export function useApi(): ApiState {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state,
    () => state,
  );
}

export function apiState(): ApiState {
  return state;
}

/** Whether the API answers, and every run it has made. Never throws. */
export async function refreshApi(timeoutMs = 2500): Promise<ApiState> {
  try {
    const response = await fetch(`${API_BASE}/runs`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok || !isJson(response)) {
      publish({ up: false });
      return state;
    }
    publish({ up: true, runs: (await response.json()) as ApiRunStatus[] });
  } catch {
    publish({ up: false });
  }
  return state;
}

export async function getRun(id: string): Promise<ApiRunStatus> {
  const response = await fetch(`${API_BASE}/runs/${id}`);
  if (!response.ok || !isJson(response)) throw await problemOf(response);
  const run = (await response.json()) as ApiRunStatus;
  upsert(run);
  return run;
}

/**
 * Send a raster to the live pipeline: its bytes as the body, no multipart.
 * `usePrecomputed` asks for the stored segmentation of this exact file and
 * model (§1.5); the API refuses with the reason (409) when there is none.
 */
export async function startRun(file: File, opts: { usePrecomputed?: boolean } = {}): Promise<ApiRunStatus> {
  const params = new URLSearchParams({ name: file.name, use_precomputed: String(!!opts.usePrecomputed) });
  const response = await fetch(`${API_BASE}/runs?${params}`, {
    method: "POST",
    headers: { "content-type": "image/tiff" },
    body: file,
  });
  if (response.status !== 202 || !isJson(response)) throw await problemOf(response);
  const run = (await response.json()) as ApiRunStatus;
  upsert(run);
  return run;
}

/** Fold one event into a run's stage list, as the API's own status does. */
export function applyEvent(stages: ApiRunStage[], event: ApiRunEvent): ApiRunStage[] {
  return stages.map((stage) => {
    if (stage.key !== event.stage) return stage;
    if (event.state === "progress")
      return { ...stage, progress: { done: event.done ?? 0, total: event.total ?? 0 } };
    return {
      ...stage,
      state: event.state,
      ms: event.ms ?? (event.state === "running" ? null : stage.ms),
      detail: event.detail ?? (event.state === "running" ? null : stage.detail),
      startedAt: event.state === "running" && event.at ? Date.parse(event.at) : null,
    };
  });
}

/**
 * Follow a run's events. The stream replays the whole history first, so a
 * late subscriber misses nothing; `onEnd` runs once, after the run's last event.
 * Returns the unsubscribe.
 */
export function followRun(id: string, onEvent: (event: ApiRunEvent) => void, onEnd: () => void): () => void {
  const source = new EventSource(`${API_BASE}/runs/${id}/events`);
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    source.close();
    onEnd();
  };
  source.onmessage = (message) => {
    const event = JSON.parse(message.data) as ApiRunEvent;
    onEvent(event);
    if (event.stage === "run" && (event.state === "done" || event.state === "failed")) end();
  };
  source.addEventListener("end", end);
  // EventSource reconnects by itself on a dropped stream, resuming after the
  // last id it saw; only a stream it has given up on (CLOSED) ends here.
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) end();
  };
  return () => { ended = true; source.close(); };
}

export function runFileUrl(id: string, name: string): string {
  return `${API_BASE}/runs/${id}/files/${name}`;
}

/* ---- watching a run: one stream per run, shared by every reader ------------ */

const watching = new Map<string, () => void>();
const finishedListeners = new Set<(run: ApiRunStatus) => void>();

/** Called once per run when it reaches its last event, with the API's final status. */
export function onRunFinished(listener: (run: ApiRunStatus) => void): () => void {
  finishedListeners.add(listener);
  return () => { finishedListeners.delete(listener); };
}

function patchRun(id: string, update: (run: ApiRunStatus) => ApiRunStatus) {
  publish({ runs: state.runs.map((run) => (run.id === id ? update(run) : run)) });
}

/**
 * Follow a run into the shared state until it ends, then read its final
 * status (outcome, files) and tell `onRunFinished` listeners. Idempotent.
 */
export function watchRun(id: string): void {
  if (watching.has(id)) return;
  const known = state.runs.find((run) => run.id === id);
  if (known && (known.status === "done" || known.status === "failed")) return;
  const stop = followRun(
    id,
    (event) => patchRun(id, (run) => ({
      ...run,
      status: event.stage === "run" && (event.state === "done" || event.state === "failed") ? event.state
        : run.status === "queued" ? "running" : run.status,
      stages: applyEvent(run.stages, event),
      detail: event.stage === "run" && event.detail ? event.detail : run.detail,
    })),
    () => {
      watching.delete(id);
      void getRun(id).then((run) => finishedListeners.forEach((listener) => listener(run)), () => undefined);
    },
  );
  watching.set(id, stop);
}
