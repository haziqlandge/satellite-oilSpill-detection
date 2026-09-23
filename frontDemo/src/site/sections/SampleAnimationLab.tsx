/**
 * Simulation studio for uploaded sample images.
 *
 * The flow is intentionally synthetic, but it mirrors the operational panel
 * language: upload or paste a `sample1`/`sample2`/`sample3` image, run a staged
 * pipeline, and expose an animation + hindcast/forecast + vessel evidence panel.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Body,
  Head,
  Page,
  SectionMark,
  Wide,
} from "../components";
import { Loading } from "../Loading";
import { Row } from "../instruments";
import {
  DEMO_PRESETS,
  DEMO_SAMPLE_KEYS,
  type DemoJobStatus,
  type DemoSampleKey,
  FRAME_TICK_MS,
  parseSampleFromFileName,
  PROCESS_MESSAGE_MS,
  PROCESS_MESSAGES,
} from "../demoData";

const INITIAL_JOBS: Record<DemoSampleKey, DemoJobStatus> = {
  sample1: {
    state: "idle",
    message: "Waiting for sample1",
    step: -1,
    startedAt: null,
    completedAt: null,
    sourceName: null,
  },
  sample2: {
    state: "idle",
    message: "Waiting for sample2",
    step: -1,
    startedAt: null,
    completedAt: null,
    sourceName: null,
  },
  sample3: {
    state: "idle",
    message: "Waiting for sample3",
    step: -1,
    startedAt: null,
    completedAt: null,
    sourceName: null,
  },
};

function msToText(ms: number) {
  const seconds = ms / 1000;
  if (seconds >= 1) return `${seconds.toFixed(1)} s`;
  return `${ms} ms`;
}

function getFrameImage(
  presetId: DemoSampleKey,
  uploads: Record<DemoSampleKey, string | null>,
) {
  const preset = DEMO_PRESETS[presetId];
  return uploads[presetId] ?? preset.sampleImage;
}

export function SampleAnimationLab() {
  const [jobs, setJobs] = useState<Record<DemoSampleKey, DemoJobStatus>>(
    INITIAL_JOBS,
  );
  const [uploads, setUploads] = useState<Record<DemoSampleKey, string | null>>({
    sample1: null,
    sample2: null,
    sample3: null,
  });
  const [activeProcessing, setActiveProcessing] = useState<DemoSampleKey | null>(
    null,
  );
  const [selectedPreset, setSelectedPreset] = useState<DemoSampleKey | null>(null);
  const [error, setError] = useState("");
  const [frameIndex, setFrameIndex] = useState(0);

  const fileInput = useRef<HTMLInputElement>(null);

  const completed = useMemo(
    () =>
      DEMO_SAMPLE_KEYS.filter((id) => jobs[id].state === "complete"),
    [jobs],
  );

  const selectedPresetData = selectedPreset
    ? DEMO_PRESETS[selectedPreset]
    : null;
  const selectedJob = selectedPreset ? jobs[selectedPreset] : null;

  useEffect(() => {
    if (selectedPreset && jobs[selectedPreset].state !== "idle") return;
    if (completed.length > 0) {
      setSelectedPreset(completed[completed.length - 1]);
      return;
    }
    setSelectedPreset(activeProcessing ?? null);
  }, [jobs, completed, activeProcessing, selectedPreset]);

  useEffect(() => {
    const preset = selectedPreset;
    const job = preset ? jobs[preset] : null;
    if (!preset || !job || job.state !== "complete") {
      setFrameIndex(0);
      return;
    }
    const frameCount = DEMO_PRESETS[preset].animationFrames.length;
    const timer = setInterval(
      () => setFrameIndex((v) => (v + 1) % frameCount),
      FRAME_TICK_MS,
    );
    return () => clearInterval(timer);
  }, [selectedPreset, jobs]);

  useEffect(() => {
    const sample = activeProcessing;
    if (!sample) return;
    const current = jobs[sample];
    if (current.state !== "processing") return;

    const tick = setTimeout(() => {
      setJobs((prev) => {
        const snapshot = prev[sample];
        if (!snapshot || snapshot.state !== "processing") return prev;
        const nextStep = snapshot.step + 1;
        if (nextStep >= PROCESS_MESSAGES.length) {
          return {
            ...prev,
            [sample]: {
              ...snapshot,
              state: "complete",
              step: nextStep,
              message: "Complete",
              completedAt: Date.now(),
            },
          };
        }

        return {
          ...prev,
          [sample]: {
            ...snapshot,
            step: nextStep,
            message: PROCESS_MESSAGES[nextStep],
          },
        };
      });
    }, PROCESS_MESSAGE_MS);

    return () => clearTimeout(tick);
  }, [jobs, activeProcessing]);

  const runPreset = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Please upload an image file.");
        return;
      }
      const sample = parseSampleFromFileName(file.name);
      if (!sample) {
        setError(
          "Please upload a file named sample1 / sample2 / sample3 to run the prebuilt animation.",
        );
        return;
      }

      setError("");
      const nextUploads = { ...uploads };
      if (nextUploads[sample]) {
        URL.revokeObjectURL(nextUploads[sample]!);
      }
      nextUploads[sample] = URL.createObjectURL(file);
      setUploads(nextUploads);

      setJobs((prev) => {
        const next: Record<DemoSampleKey, DemoJobStatus> = { ...prev };
        for (const key of DEMO_SAMPLE_KEYS) {
          if (key === sample) continue;
          if (next[key].state === "processing") {
            next[key] = {
              state: "idle",
              message: "Superseded by a new upload",
              step: -1,
              startedAt: null,
              completedAt: null,
              sourceName: null,
            };
          }
        }

        next[sample] = {
          state: "processing",
          message: PROCESS_MESSAGES[0],
          step: 0,
          startedAt: Date.now(),
          completedAt: null,
          sourceName: file.name,
        };
        return next;
      });

      setActiveProcessing(sample);
      setSelectedPreset(sample);
    },
    [uploads],
  );

  const onFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) runPreset(file);
      if (fileInput.current) fileInput.current.value = "";
    },
    [runPreset],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files?.[0];
      if (file) runPreset(file);
    },
    [runPreset],
  );

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const file = event.clipboardData.files?.[0] || null;
      if (file) {
        event.preventDefault();
        runPreset(file);
      }
    },
    [runPreset],
  );

  const active = activeProcessing ? jobs[activeProcessing] : null;
  const activePreset = activeProcessing ? DEMO_PRESETS[activeProcessing] : null;
  const activeSource = activeProcessing ? uploads[activeProcessing] : null;
  const frame = selectedPresetData
    ? selectedPresetData.animationFrames[
        Math.min(frameIndex, selectedPresetData.animationFrames.length - 1)
      ]
    : null;

  return (
    <section id="demo" className="scroll-mt-[70px] py-14">
      <Page>
        <SectionMark index={6} kicker="Demo" title="Sample animation workstation" />
        <Wide className="mt-9">
          <Body>
            Drop any image file named <code>sample1</code>, <code>sample2</code>,
            or <code>sample3</code> into the panel below or paste from clipboard.
            The system then simulates a full run and reveals the matching
            animation and evidence cards.
          </Body>
        </Wide>

        <Wide className="mt-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="border p-4" style={{ borderColor: "var(--line)" }}>
                <Head level={3} className="text-[20px] leading-tight">
                  Input slot for sample1 / sample2 / sample3
                </Head>
                <Body className="mt-2" size="small">
                  Paste with your cursor here, or use the upload button to browse.
                </Body>
                <div
                  className="mt-4 min-h-[220px] border-2 border-dashed px-6 py-5 transition-colors"
                  style={{ borderColor: "var(--line)" }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDrop}
                  onPaste={onPaste}
                  tabIndex={0}
                  role="button"
                  aria-label="Drop sample image area"
                >
                  <div className="flex h-full min-h-[170px] flex-col items-center justify-center gap-3 text-center">
                    <p className="text-faint font-mono text-[10px] tracking-[0.24em] uppercase">
                      Drag and drop sample1 / sample2 / sample3
                    </p>
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      className="border px-4 py-2 text-[11px] tracking-[0.18em] uppercase transition-colors"
                      style={{
                        borderColor: "var(--accent)",
                        color: "var(--accent)",
                      }}
                    >
                      Upload image
                    </button>
                    {error && <p className="text-warn text-[12px]">{error}</p>}
                    {active && active.state !== "idle" ? (
                      <div className="flex items-center gap-3 text-faint text-[12px]">
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border border-[var(--line)] border-t-[var(--accent)]" />
                        <span>{active.message}</span>
                      </div>
                    ) : (
                      <p className="text-faint text-[12px]">
                        Current state updates every 5 seconds while processing.
                      </p>
                    )}
                  </div>
                </div>

                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onFileInput}
                />

                <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
                  {DEMO_SAMPLE_KEYS.map((key) => {
                    const job = jobs[key];
                    const preset = DEMO_PRESETS[key];
                    const tone =
                      job.state === "complete"
                        ? "var(--accent)"
                        : job.state === "processing"
                          ? "var(--warn)"
                          : "var(--ink-dim)";
                    return (
                      <div
                        key={key}
                        className="border px-3 py-2"
                        style={{ borderColor: "var(--line)", color: tone }}
                      >
                        <p className="font-mono text-[9px] tracking-[0.18em] uppercase">
                          {preset.id}
                        </p>
                        <p className="mt-1 text-[12px]">{job.message}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {active && active.state === "processing" && activeSource && activePreset && (
                <div
                  className="border p-4"
                  style={{ borderColor: "var(--line)", background: "var(--base-2)" }}
                >
                  <p className="font-mono text-[10px] tracking-[0.24em] uppercase text-faint">
                    Running prebuilt sample inference
                  </p>
                  <p className="mt-2 text-[12px] text-ink">{active.message}</p>
                  <div className="mt-4 overflow-hidden border" style={{ borderColor: "var(--line)" }}>
                    <img
                      src={activeSource || activePreset.sampleImage}
                      alt="processing input preview"
                      className="h-48 w-full object-cover blur-[1px] grayscale"
                    />
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="border" style={{ borderColor: "var(--line)" }}>
                <div className="border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
                  <p className="text-faint font-mono text-[10px] tracking-[0.24em] uppercase">
                    Simulation result
                  </p>
                </div>

                {selectedPreset && selectedPresetData && selectedJob ? (
                  selectedJob.state === "processing" ? (
                    <div className="space-y-3 p-4">
                      <p className="text-[12px]">
                        {activeProcessing === selectedPreset ? "Processing" : "Queued"}
                      </p>
                      <div className="flex items-center gap-3">
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border border-[var(--line)] border-t-[var(--accent)]" />
                        <span className="text-faint text-[12px]">
                          {selectedJob.message}
                        </span>
                      </div>
                    </div>
                  ) : selectedJob.state === "complete" ? (
                    <div className="space-y-4 p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        {completed.length > 0 ? (
                          <>
                            <label
                              htmlFor="demo-animation-select"
                              className="text-faint font-mono text-[10px] tracking-[0.24em] uppercase"
                            >
                              Top animation
                            </label>
                            <select
                              id="demo-animation-select"
                              value={selectedPreset}
                              onChange={(e) => setSelectedPreset(e.target.value as DemoSampleKey)}
                              className="bg-transparent border border-[var(--line)] px-2 py-1.5 text-[11px] tracking-[0.12em]"
                              style={{ color: "var(--ink)" }}
                            >
                              {completed.map((id) => (
                                <option key={id} value={id} style={{ background: "var(--base)" }}>
                                  {DEMO_PRESETS[id].id}
                                </option>
                              ))}
                            </select>
                          </>
                        ) : null}
                      </div>

                      {frame ? (
                        <div className="relative overflow-hidden border" style={{ borderColor: "var(--line)" }}>
                          <img
                            src={getFrameImage(selectedPreset, uploads)}
                            alt={`${selectedPresetData.id} animation frame`}
                            className="h-64 w-full object-cover transition-all duration-500"
                            style={{
                              filter: frame.filter ?? "none",
                              transform: `scale(${frame.scale ?? 1})`,
                            }}
                          />
                          <div
                            className="absolute right-2 top-2 border px-2 py-1 text-[10px] tracking-[0.16em] uppercase"
                            style={{ borderColor: "color-mix(in oklab, var(--line) 72%, transparent)" }}
                          >
                            {frame.label}
                          </div>
                        </div>
                      ) : (
                        <Loading label="Loading frame" />
                      )}

                      <div className="space-y-3">
                        <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-faint">
                          {selectedPresetData.title}
                        </p>
                        <p className="text-dim text-[12px] leading-relaxed">
                          {selectedPresetData.summary}
                        </p>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="border p-3" style={{ borderColor: "var(--line)" }}>
                            <p className="text-faint font-mono text-[10px] tracking-[0.2em] uppercase">
                              Hindcast package
                            </p>
                            <Row label="Window" value={selectedPresetData.hindcast.window} />
                            <Row label="Peak area" value={`${selectedPresetData.hindcast.maxSpreadKm2} km²`} />
                            <Row label="Confidence" value={selectedPresetData.hindcast.confidence} />
                            <p className="text-[11px] text-faint mt-2">
                              Simulated hindcast is inferred from the clean mask and tuned to the
                              uploaded case geometry.
                            </p>
                          </div>
                          <div className="border p-3" style={{ borderColor: "var(--line)" }}>
                            <p className="text-faint font-mono text-[10px] tracking-[0.2em] uppercase">
                              Forecast package
                            </p>
                            <Row label="Horizon" value={selectedPresetData.forecast.horizon} />
                            <Row label="90% envelope" value={`${selectedPresetData.forecast.envelopeKm2} km²`} />
                            <Row
                              label="Envelope growth"
                              value={selectedPresetData.forecast.spreadRate}
                            />
                            <Row
                              label="Confidence"
                              value={selectedPresetData.forecast.confidence}
                            />
                          </div>
                        </div>

                        <details className="border p-3" style={{ borderColor: "var(--line)" }}>
                          <summary className="cursor-pointer text-faint text-[10px] tracking-[0.24em] uppercase">
                            Fake AIS / vessel information
                          </summary>
                          <div className="mt-3 space-y-2">
                            <Row label="Vessel" value={selectedPresetData.ais.vessel} />
                            <Row
                              label="MMSI"
                              value={selectedPresetData.ais.mmsi}
                              tone="var(--ink-faint)"
                            />
                            <Row label="Last seen" value={selectedPresetData.ais.lastSeen} />
                            <Row label="Distance to slick" value={`${selectedPresetData.ais.distanceNm} nm`} />
                            <Row label="Match score" value={selectedPresetData.ais.confidence} />
                          </div>
                        </details>

                        <details className="border p-3" style={{ borderColor: "var(--line)" }}>
                          <summary className="cursor-pointer text-faint text-[10px] tracking-[0.24em] uppercase">
                            Model train time (simulated)
                          </summary>
                          <div className="mt-3 space-y-1.5">
                            {selectedPresetData.timings.map((entry, index) => (
                              <div
                                key={`${selectedPreset}-${entry.label}-${index}`}
                                className="flex items-baseline gap-2"
                              >
                                <span className="text-faint font-mono text-[10px] tracking-[0.14em] uppercase">
                                  {entry.label}
                                </span>
                                <span className="h-px flex-1 border-b border-[var(--line)]" />
                                <span className="num text-[11px]">{msToText(entry.durationMs)}</span>
                              </div>
                            ))}
                            <Row
                              label="Total"
                              value={msToText(
                                selectedPresetData.timings.reduce(
                                  (total, step) => total + step.durationMs,
                                  0,
                                ),
                              )}
                            />
                          </div>
                        </details>
                      </div>
                    </div>
                  ) : (
                    <p className="p-4 text-faint text-[12px]">
                      Upload any sample1 / sample2 / sample3 file and wait for processing.
                    </p>
                  )
                ) : (
                  <p className="p-4 text-faint text-[12px]">
                    Upload any sample1 / sample2 / sample3 file and the panel will
                    switch from processing mode into the animation view.
                  </p>
                )}
              </div>
            </div>
          </div>
        </Wide>
      </Page>
    </section>
  );
}
