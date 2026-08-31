/**
 * The three analytical panes: 04 ATTRIBUTE, 05 EVIDENCE, 06 METHOD.
 *
 * These do not move with the clock. A score is computed against the whole
 * record, so putting it in a pane that changes when the operator scrubs would
 * imply a per-hour score that does not exist.
 *
 * 04 and 05 are the two halves of the same constraint. C4 forbids a bare total,
 * so the ranked list in 04 is never the end of the interface: every row leads to
 * a card in 05 that decomposes the number into six named terms, prints the
 * weight applied to each, prints the text that produced it, and draws the
 * geometry the term was measured on. A console can afford that; a dashboard
 * usually decides it cannot.
 */

import { useMemo } from "react";
import {
  KIND_LABEL,
  KIND_SHORT,
  TERM_LABEL,
  TERM_ORDER,
  TERM_SHORT,
  formatHour,
  stamp,
} from "../../lib/format";
import { CONTACT_RADIUS_KM } from "../../lib/playback";
import {
  COMPARISON,
  LIMITS,
  PROVENANCE,
  PUBLISHED,
  SIMULATED,
  STAGES,
  TERM_NOTE,
  TERM_ORIGIN,
} from "../../content";
import {
  PROXIMITY_LAMBDA_KM,
  WEIGHTS,
  WEIGHTS_VERSION,
} from "../../sim/scoring";
import { SCENARIOS } from "../../sim/scenarios";
import { orderedSuspects, type RunState } from "../../useRun";
import type { Run, ScoreTermKey, Suspect } from "../../sim/types";
import {
  Alarm,
  AsciiBar,
  Block,
  Btn,
  Field,
  Flag,
  Note,
  Pane,
  Row,
  Table,
  Toggle,
} from "./components";
import { AnomalySeries, TermBar, TrackScope } from "./instruments";
import { PaneBody } from "./panes";

const KIND_TONE: Record<string, "ok" | "warn" | "alarm" | "dim"> = {
  ais_vessel: "ok",
  dark_vessel: "alarm",
  infrastructure: "warn",
};

/* ================================================================== *
 * 04 ATTRIBUTE
 * ================================================================== */

export function Attribute({ run, state }: { run: Run; state: RunState }) {
  const { ablated, setAblated, selectedId, setSelectedId } = state;
  const rows = useMemo(() => orderedSuspects(run, ablated), [run, ablated]);
  const halt = run.drift.insufficientEvidence;

  // The margin between the top two. A different statement from insufficient
  // evidence: a narrow margin means two candidates are hard to separate, a
  // diffuse field means none of them can be.
  const separability =
    rows.length >= 2
      ? (ablated ? rows[0].totalWithoutDrift - rows[1].totalWithoutDrift : rows[0].total - rows[1].total)
      : null;

  const moved = rows.filter((s) => s.rank !== s.rankWithoutDrift).length;

  return (
    <Pane
      index="04"
      title="Attribute"
      tone={halt ? "alarm" : "ok"}
      right={
        halt ? (
          <Flag tone="alarm" filled>
            halt
          </Flag>
        ) : (
          <Flag tone="ok">{rows.length} candidates</Flag>
        )
      }
    >
      <PaneBody>
        {halt && (
          <div className="mb-3">
            <Alarm code="E-C3" title="attribution withheld">
              <p>
                90% origin contour {halt.area90Km2.toFixed(0)} km². {halt.reason}
              </p>
              <p className="mt-2" style={{ color: "var(--ink-dim)" }}>
                No candidate is ranked from this field. The hypotheses the gate
                admitted are listed below unranked, because suppressing them
                entirely would hide what the system actually considered — but no
                order among them is a finding, and none of these scores should be
                read as one.
              </p>
            </Alarm>
          </div>
        )}

        <Block label="Weights" right={WEIGHTS_VERSION}>
          <div className="grid grid-cols-2 gap-x-4">
            {TERM_ORDER.map((k) => (
              <Row key={k} label={TERM_SHORT[k]} value={WEIGHTS[k].toFixed(2)} tone="dim" />
            ))}
          </div>
          <Note label="hand-set, never fitted">
            Three ground-truth cases cannot support fitting six weights, and a
            weight tuned until a fixture passes is not evidence. They are printed
            here, versioned, so that any result on this console can be
            recomputed by hand.
          </Note>
        </Block>

        <Block
          label={halt ? "Hypotheses considered" : "Candidates"}
          right={ablated ? "s_drift removed" : `x${run.characterisation.windGateMultiplier.toFixed(2)} gate`}
        >
          <Table
            head={["#", "candidate", "kind", "score", "", "no drift"]}
            align={["right", "left", "left", "right", "left", "right"]}
            keys={rows.map((s) => s.id)}
            activeKey={selectedId}
            onSelect={setSelectedId}
            empty="no candidate intersected the origin field inside the backward horizon"
            rows={rows.map((s) => {
              const rank = ablated ? s.rankWithoutDrift : s.rank;
              const total = ablated ? s.totalWithoutDrift : s.total;
              return [
                <span style={{ color: halt ? "var(--ink-faint)" : "var(--accent)" }}>
                  {halt ? "—" : String(rank).padStart(2, "0")}
                </span>,
                <span style={{ color: "var(--ink)" }}>{s.label}</span>,
                <Flag tone={KIND_TONE[s.kind] ?? "dim"}>{KIND_SHORT[s.kind]}</Flag>,
                <span style={{ color: "var(--ink)" }}>{total.toFixed(3)}</span>,
                <AsciiBar value={total} width={10} tone={halt ? "faint" : "ok"} />,
                <span style={{ color: "var(--ink-faint)" }}>
                  {s.totalWithoutDrift.toFixed(3)}
                  {s.rankWithoutDrift !== s.rank && (
                    <span style={{ color: "var(--warn)" }}> #{s.rankWithoutDrift}</span>
                  )}
                </span>,
              ];
            })}
          />
          {rows.length > 0 && !halt && (
            <p className="mt-1.5 text-[10px]" style={{ color: "var(--ink-faint)" }}>
              select a row to open its evidence card in pane 05
            </p>
          )}
        </Block>

        <Block label="Ablation" right={ablated ? "on" : "off"}>
          <Toggle
            on={ablated}
            onChange={setAblated}
            label="recompute without s_drift"
            tone="warn"
          />
          <div className="mt-1.5">
            <Row
              label="rank changes"
              value={`${moved} of ${rows.length}`}
              tone={moved ? "warn" : "dim"}
            />
            <Row
              label="separability"
              value={separability === null ? "—" : separability.toFixed(3)}
              tone={separability !== null && separability < 0.015 ? "alarm" : "dim"}
            />
          </div>
          <Note label="what the drift term is worth">
            The remaining five terms are renormalised over their own weights so
            the comparison is fair. Nothing else changes, so whatever moves in
            this list is the contribution of the one term no reviewed system
            computes: agreement between a track and the backward origin field at
            matching times.
          </Note>
        </Block>

        <Block label="Language">
          <Note tone="warn" label="candidate · suspected · score">
            Never responsible, confirmed or guilty. A ranked candidate is a
            hypothesis with its working shown, and the alternatives stay on the
            list beside it. Unlit contacts are scored and ranked but carry no
            identity and are never resolved to a vessel; AIS identities are
            masked throughout.
          </Note>
        </Block>
      </PaneBody>
    </Pane>
  );
}

/* ================================================================== *
 * 05 EVIDENCE
 * ================================================================== */

export function Evidence({ run, state }: { run: Run; state: RunState }) {
  const { ablated, hour, selectedId, setSelectedId, setHour } = state;
  const rows = useMemo(() => orderedSuspects(run, ablated), [run, ablated]);
  const selected: Suspect | null =
    run.suspects.find((s) => s.id === selectedId) ?? rows[0] ?? null;

  if (!selected) {
    return (
      <Pane index="05" title="Evidence" right={<Flag tone="dim">no card</Flag>}>
        <PaneBody>
          <Note label="nothing to open">
            No candidate survived the gate for this scene, so there is no evidence
            card to print. That is a result, not a gap: the pipeline is allowed to
            reach the end and name nobody.
          </Note>
        </PaneBody>
      </Pane>
    );
  }

  const card = selected.evidence;
  const terms = TERM_ORDER.map((k) => card.terms.find((t) => t.key === k)).filter(
    (t): t is NonNullable<typeof t> => !!t,
  );
  const rawSum = terms.reduce((s, t) => s + t.value * t.weight, 0);
  const gate = run.characterisation.windGateMultiplier;
  // `originWindow` is a pair of epoch milliseconds, not hours. Printing it
  // straight through `formatHour` produced `T+1701691039000h`, and handing its
  // midpoint to `setHour` would have thrown the timeline a billion hours past
  // the forecast horizon. The console works in hours from the acquisition, so
  // it converts once, here, and keeps the UTC stamps beside them.
  const ow0 = (card.originWindow[0] - run.meta.acquiredAt) / 3600_000;
  const ow1 = (card.originWindow[1] - run.meta.acquiredAt) / 3600_000;
  const rank = ablated ? selected.rankWithoutDrift : selected.rank;
  const total = ablated ? selected.totalWithoutDrift : selected.total;

  return (
    <Pane
      index="05"
      title="Evidence"
      right={<Flag tone={KIND_TONE[selected.kind] ?? "dim"}>{KIND_SHORT[selected.kind]}</Flag>}
    >
      <PaneBody>
        <Block label="Candidate" right={run.drift.insufficientEvidence ? "unranked" : `rank ${rank}`}>
          <p className="num text-[15px]" style={{ color: "var(--accent)" }}>
            {selected.label}
          </p>
          <p className="mt-1 text-[10.5px] leading-[1.55]" style={{ color: "var(--ink-dim)" }}>
            {selected.detail}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <Field label="score" value={total.toFixed(3)} tone="ok" />
            <Field label="kind" value={KIND_LABEL[selected.kind]} />
            <Field
              label="origin win"
              value={`${formatHour(Math.round(ow0))}..${formatHour(Math.round(ow1))}`}
              title={`${stamp(card.originWindow[0])} to ${stamp(card.originWindow[1])}`}
            />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {rows.length > 1 &&
              rows.map((s) => (
                <Btn
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  active={s.id === selected.id}
                  title={s.label}
                >
                  {String(ablated ? s.rankWithoutDrift : s.rank).padStart(2, "0")}
                </Btn>
              ))}
            <Btn
              onClick={() => setHour(Math.round((ow0 + ow1) / 2))}
              title="Move the timeline into this candidate's origin window"
            >
              goto window
            </Btn>
          </div>
        </Block>

        <Block label="Track vs field" right={card.matchedSegment ? "matched" : "no match"}>
          <TrackScope
            run={run}
            track={selected.track}
            matched={card.matchedSegment}
            position={selected.position}
            hour={hour}
          />
        </Block>

        <Block label="Terms" right={`${terms.length} of 6`}>
          {terms.map((t) => (
            <div key={t.key} className="mt-2 first:mt-0">
              <div className="flex items-baseline gap-2">
                <span
                  className="num w-[7ch] shrink-0 text-[10px]"
                  style={{ color: "var(--ink-faint)" }}
                >
                  {TERM_SHORT[t.key]}
                </span>
                <div className="min-w-0 flex-1">
                  <TermBar value={t.value} weight={t.weight} />
                </div>
                <span className="num shrink-0 text-[11px]" style={{ color: "var(--ink)" }}>
                  {t.value.toFixed(2)}
                </span>
                <span
                  className="num w-[6ch] shrink-0 text-right text-[10px]"
                  style={{ color: "var(--ink-faint)" }}
                >
                  x{t.weight.toFixed(2)}
                </span>
                <span
                  className="num w-[6ch] shrink-0 text-right text-[10.5px]"
                  style={{ color: "var(--accent)" }}
                >
                  {(t.value * t.weight).toFixed(3)}
                </span>
              </div>
              <p
                className="mt-0.5 pl-[8ch] text-[10px] leading-[1.5]"
                style={{ color: "var(--ink-dim)" }}
              >
                {t.detail}
              </p>
            </div>
          ))}

          <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--line)" }}>
            <Row label="weighted sum" value={rawSum.toFixed(3)} tone="dim" />
            <Row
              label="wind gate"
              value={`x${gate.toFixed(2)}`}
              tone={gate < 0.75 ? "warn" : "dim"}
            />
            <Row label="total" value={selected.total.toFixed(3)} tone="ok" />
          </div>
          <Note label="never a bare total">
            The total is the weighted sum scaled by the wind gate, and both halves
            are printed because a score with no decomposition is an accusation
            with no working. Each line above carries the value the term took, the
            weight applied to it, and the text that produced it.
          </Note>
        </Block>

        <Block label="Behaviour flags" right={`${card.anomalies.length}`}>
          {card.anomalies.length === 0 ? (
            <p className="text-[10.5px]" style={{ color: "var(--ink-faint)" }}>
              none raised
            </p>
          ) : (
            card.anomalies.map((f) => (
              <div key={f.code} className="mt-2.5 first:mt-0">
                <div className="flex items-baseline gap-2">
                  <Flag tone="warn">{f.code.replace(/_/g, " ")}</Flag>
                  <span className="text-[10.5px]" style={{ color: "var(--ink)" }}>
                    {f.label}
                  </span>
                </div>
                <p
                  className="mt-1 text-[10px] leading-[1.5]"
                  style={{ color: "var(--ink-dim)" }}
                >
                  {f.detail}
                </p>
                <p className="mt-1 text-[9px] tracking-[0.16em] uppercase" style={{ color: "var(--ink-faint)" }}>
                  {f.seriesLabel}
                </p>
                <AnomalySeries flag={f} />
              </div>
            ))
          )}
          <Note label="a raw gap is not evidence">
            Every flag carries the series that raised it, and a reception gap is
            normalised against the density the region actually supports before it
            counts for anything. There are legitimate reasons to go dark.
          </Note>
        </Block>

        <Block label="Caveats" right={`${card.caveats.length}`}>
          {card.caveats.map((c, i) => (
            <p
              key={i}
              className="mt-1.5 flex gap-2 text-[10px] leading-[1.55] first:mt-0"
              style={{ color: "var(--ink-dim)" }}
            >
              <span className="num shrink-0" style={{ color: "var(--warn)" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{c}</span>
            </p>
          ))}
        </Block>
      </PaneBody>
    </Pane>
  );
}

/* ================================================================== *
 * 06 METHOD
 * ================================================================== */

export function Method({ state }: { state: RunState }) {
  return (
    <Pane index="06" title="Method" right={<Flag tone="warn">sim</Flag>}>
      <PaneBody>
        <Block label="Pipeline" right={`${STAGES.length} stages`}>
          {STAGES.map((s, i) => (
            <div key={s.key} className="mt-3 first:mt-0">
              <div className="flex items-baseline gap-2">
                <span className="num text-[10px]" style={{ color: "var(--accent)" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="num text-[11px]" style={{ color: "var(--ink)" }}>
                  {s.proc}
                </span>
                <span
                  className="ml-auto text-[9px] tracking-[0.2em] uppercase"
                  style={{ color: "var(--ink-faint)" }}
                >
                  {s.name}
                </span>
              </div>
              <p
                className="mt-1 pl-[3ch] text-[10px] leading-[1.55]"
                style={{ color: "var(--ink-dim)" }}
              >
                {s.body}
              </p>
            </div>
          ))}
        </Block>

        <Block label="Terms" right={WEIGHTS_VERSION}>
          {TERM_ORDER.map((k: ScoreTermKey) => (
            <div key={k} className="mt-3 first:mt-0">
              <div className="flex items-baseline gap-2">
                <span className="num w-[7ch] shrink-0 text-[10px]" style={{ color: "var(--accent)" }}>
                  {TERM_SHORT[k]}
                </span>
                <span className="text-[10.5px]" style={{ color: "var(--ink)" }}>
                  {TERM_LABEL[k]}
                </span>
                <span className="num ml-auto text-[10px]" style={{ color: "var(--ink-faint)" }}>
                  x{WEIGHTS[k].toFixed(2)}
                </span>
                <Flag tone={TERM_ORIGIN[k] === "This project" ? "ok" : "dim"}>
                  {TERM_ORIGIN[k] === "This project" ? "ours" : "cerulean"}
                </Flag>
              </div>
              <p
                className="mt-1 pl-[7ch] text-[10px] leading-[1.55]"
                style={{ color: "var(--ink-dim)" }}
              >
                {TERM_NOTE[k]}
              </p>
            </div>
          ))}
        </Block>

        <Block label="Constants">
          <Row label="weights" value={WEIGHTS_VERSION} />
          <Row label="prox lambda" value={`${PROXIMITY_LAMBDA_KM.toFixed(1)} km`} />
          <Row label="contact radius" value={`${CONTACT_RADIUS_KM} km`} />
        </Block>

        <Block label="Limits" right={`${LIMITS.length}`}>
          {LIMITS.map((l) => (
            <div key={l.key} className="mt-3 first:mt-0">
              <div className="flex items-baseline gap-2">
                <span className="num shrink-0 text-[10px]" style={{ color: "var(--warn)" }}>
                  !
                </span>
                <span className="text-[10.5px]" style={{ color: "var(--ink)" }}>
                  {l.title}
                </span>
              </div>
              <p
                className="mt-1 pl-[3ch] text-[10px] leading-[1.55]"
                style={{ color: "var(--ink-dim)" }}
              >
                {l.body}
              </p>
            </div>
          ))}
        </Block>

        <Block label="Against prior art">
          <Table
            head={["system", "detect", "drift", "ais", "explain"]}
            rows={COMPARISON.map((c) => [
              <span style={{ color: c.ours ? "var(--accent)" : "var(--ink-dim)" }}>
                {c.system}
              </span>,
              c.detect,
              c.drift,
              c.ais,
              c.explain,
            ])}
          />
        </Block>

        <Block label="Test cases" right={`${SCENARIOS.length}`}>
          {SCENARIOS.map((s) => (
            <div key={s.id} className="mt-2 first:mt-0">
              <button
                type="button"
                onClick={() => state.setScenario(s.id)}
                className="flex w-full items-baseline gap-2 text-left"
              >
                <span
                  className="num shrink-0 text-[10px]"
                  style={{ color: state.scenario === s.id ? "var(--accent)" : "var(--ink-faint)" }}
                >
                  {state.scenario === s.id ? ">" : " "}
                </span>
                <span className="text-[10.5px]" style={{ color: "var(--ink)" }}>
                  {s.name}
                </span>
                <span className="num ml-auto text-[9px]" style={{ color: "var(--ink-faint)" }}>
                  {s.id}
                </span>
              </button>
              <p
                className="mt-0.5 pl-[3ch] text-[10px] leading-[1.5]"
                style={{ color: "var(--ink-dim)" }}
              >
                {s.tests}
              </p>
            </div>
          ))}
        </Block>

        <Block label="Provenance" right="c10">
          <Note tone="warn" label={PROVENANCE.flag}>
            {PROVENANCE.full}
          </Note>
          <div className="mt-3">
            <p className="text-[9px] tracking-[0.22em] uppercase" style={{ color: "var(--ink-faint)" }}>
              published
            </p>
            {PUBLISHED.map((p, i) => (
              <p
                key={i}
                className="mt-1 flex gap-2 text-[10px] leading-[1.5]"
                style={{ color: "var(--ink-dim)" }}
              >
                <span className="num shrink-0" style={{ color: "var(--accent)" }}>
                  +
                </span>
                <span>{p}</span>
              </p>
            ))}
          </div>
          <div className="mt-3">
            <p className="text-[9px] tracking-[0.22em] uppercase" style={{ color: "var(--ink-faint)" }}>
              simulated
            </p>
            {SIMULATED.map((p, i) => (
              <p
                key={i}
                className="mt-1 flex gap-2 text-[10px] leading-[1.5]"
                style={{ color: "var(--ink-dim)" }}
              >
                <span className="num shrink-0" style={{ color: "var(--warn)" }}>
                  ~
                </span>
                <span>{p}</span>
              </p>
            ))}
          </div>
        </Block>
      </PaneBody>
    </Pane>
  );
}
