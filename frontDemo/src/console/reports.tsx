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
} from "../lib/format";
import { CONTACT_RADIUS_KM, eventSpan } from "../lib/playback";
import {
  COMPARISON,
  LIMITS,
  PROVENANCE,
  PUBLISHED,
  SIMULATED,
  STAGES,
  TERM_NOTE,
  TERM_ORIGIN,
} from "../content";
import {
  PROXIMITY_LAMBDA_KM,
  WEIGHTS,
  WEIGHTS_VERSION,
} from "../sim/scoring";
import { SCENARIOS } from "../sim/scenarios";
import { orderedSuspects, type SpillState } from "../lib/spill";
import type { Run, ScoreTermKey, Suspect } from "../sim/types";
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

/* ------------------------------------------------------------------ *
 * Naming a candidate the console has refused to rank
 * ------------------------------------------------------------------ */

/**
 * What a candidate is called when there is no rank to call it by.
 *
 * Under a C3 halt, 04 prints `—` in every rank cell and heads the block
 * *Hypotheses considered*. 05's card carried the same refusal in its `unranked`
 * meta and then printed `01`…`51` on the buttons underneath it -- the console
 * showing the ordering it had just declined to give, in the pane whose whole
 * job is to show working. The buttons could not simply be blanked: they are
 * 05's only selector, because 04 and 05 share the right dock and only one of
 * them is on screen at a time.
 *
 * So under halt the button carries the candidate's own identity instead. What
 * that identity *is* differs by kind, and the difference is the point:
 *
 *  - **AIS vessel** -- the masked MMSI. `Suspect.id` is the raw one and must
 *    never reach the screen (`Vessel.label`: "Real identities are never
 *    rendered by this demo"; 04's own Language note: "AIS identities are masked
 *    throughout"), so the text comes off `label`, with the `MMSI` prefix
 *    dropped. That word is the *type*, and the block says it once rather than
 *    fifty-one times
 *  - **Infrastructure** -- the installation's designation, off the authored id:
 *    `infra-mh-north` → `MH-NORTH`, which is what "Mumbai High North complex"
 *    is called on a chart. Nothing about infrastructure is masked; 04 prints
 *    these labels in full
 *  - **Unlit contact** -- the radar designation, `DARK-01`, and nothing else.
 *    A dark vessel is the one candidate that genuinely has no identity, which
 *    is the case this whole project exists for, so the tag names the *contact*
 *    rather than a vessel
 *
 * ### This branch has never executed, and cannot from the current fixtures
 *
 * Two facts, both worth stating so nobody re-derives them:
 *
 *  - the identity form is only reached under halt, and `mumbai-null` is the
 *    only scenario that halts. Its fifty-one admitted candidates are
 *    forty-nine AIS vessels and the two Mumbai High platforms -- **no dark
 *    contact**. So the `DARK-` arm above is written, typed and dead
 *  - `scenarios.ts` pushes to `darkTargets` at exactly one site (line 770) with
 *    a hard-coded `id: "dark-01"`, and only when `spec.source.type === "dark"`.
 *    There is no construction in this simulator that yields a second one, so a
 *    `DARK-02` cannot occur and the plural case needs no disambiguation
 *
 * If a halting scenario ever admits a dark contact, this is the arm to check
 * first, and `disambiguate` will already handle a repeat if one becomes
 * possible.
 *
 * ### The collision, which is real and not hypothetical
 *
 * `maskMmsi` keeps three digits and the last one, so two admitted vessels can
 * mask to the same string -- and two of `mumbai-null`'s forty-nine do:
 * `248104476` and `248230366` both print `MMSI 248•••••6`. Under halt every
 * other cell of theirs is identical as well (rank `—`, score `0.000`, no-drift
 * `0.000`), so before this they were two rows and two buttons no reader could
 * tell apart, one of which silently swapped the card for a different vessel.
 *
 * They are marked `·A` / `·B`, dimmed so the mark reads as console furniture
 * rather than as a digit of the identity. Lettering is assigned by `id` and not
 * by list position, because `rows` reorders when the ablation is toggled and a
 * disambiguator that swaps which contact is `A` half way through a reading is
 * worse than the ambiguity it replaced.
 *
 * `text` is a parameter rather than fixed, because the two panes print
 * different strings: 04's table prints the full `label`, 05's button prints the
 * identity alone. Each disambiguates exactly what it puts on screen -- which
 * also covers the case the identity form would miss, two `Unlit contact` rows
 * in 04 whose designations differ.
 */
export interface CandidateTag {
  /** The string this surface prints for the candidate. */
  text: string;
  /** `A`, `B`, … only when another candidate prints the same string. */
  mark: string | null;
  /** How many candidates share it. 1 whenever `mark` is null. */
  shared: number;
}

const MARKS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The identity a candidate carries, for a surface that cannot use its rank. */
function identityOf(s: Suspect): string {
  if (s.kind === "ais_vessel") return s.label.replace(/^MMSI\s+/, "");
  return s.id.replace(/^infra-/, "").toUpperCase();
}

function disambiguate(
  rows: Suspect[],
  text: (s: Suspect) => string,
): Map<string, CandidateTag> {
  const groups = new Map<string, Suspect[]>();
  for (const s of rows) {
    const key = text(s);
    const seen = groups.get(key);
    if (seen) seen.push(s);
    else groups.set(key, [s]);
  }

  const out = new Map<string, CandidateTag>();
  for (const [key, group] of groups) {
    if (group.length === 1) {
      out.set(group[0].id, { text: key, mark: null, shared: 1 });
      continue;
    }
    [...group]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .forEach((s, i) =>
        out.set(s.id, {
          text: key,
          mark: MARKS[i] ?? String(i + 1),
          shared: group.length,
        }),
      );
  }
  return out;
}

/**
 * A tag and, when it needs one, its disambiguating mark.
 *
 * The mark carries no title of its own on purpose: both call sites already put
 * one on the row or the button around it, and a nested `title` would replace
 * that tooltip with a fragment of itself exactly where a reader hovers to ask
 * what the mark means.
 */
function Tagged({
  tag,
  fallback,
}: {
  tag: CandidateTag | undefined;
  /** Printed if the lookup misses, so a miss degrades to the plain string
      rather than to an empty cell. */
  fallback: string;
}) {
  if (!tag) return <>{fallback}</>;
  return (
    <>
      {tag.text}
      {tag.mark && (
        <span style={{ color: "var(--ink-faint)" }}>{`·${tag.mark}`}</span>
      )}
    </>
  );
}

/** How a shared identity is explained, in a tooltip. Empty when unshared. */
function sharedNote(tag: CandidateTag | undefined): string {
  if (!tag?.mark) return "";
  // Leading space, because every call site appends this to a sentence that has
  // already been terminated. Returning "" for the unshared case is what stops
  // that space becoming a trailing one on the other fifty tooltips.
  return ` Marked ${tag.mark}: ${tag.shared} admitted contacts mask to this same identity, and the mark is this console's way of telling them apart — it is not part of the identity.`;
}

/* ================================================================== *
 * 04 ATTRIBUTE
 * ================================================================== */

export function Attribute({ run, state }: { run: Run; state: SpillState }) {
  const { ablated, setAblated, selectedId, setSelectedId } = state;
  const rows = useMemo(() => orderedSuspects(run, ablated), [run, ablated]);
  const halt = run.drift.insufficientEvidence;
  // This table prints `label`, so that is what it disambiguates.
  const tags = useMemo(() => disambiguate(rows, (s) => s.label), [rows]);

  // The margin between the top two. A different statement from insufficient
  // evidence: a narrow margin means two candidates are hard to separate, a
  // diffuse field means none of them can be.
  const separability =
    rows.length >= 2
      ? (ablated ? rows[0].totalWithoutDrift - rows[1].totalWithoutDrift : rows[0].total - rows[1].total)
      : null;

  const moved = rows.filter((s) => s.rank !== s.rankWithoutDrift).length;

  /*
    The diffuse test, recomputed here so the alarm can say whether it is the
    reason.

    `insufficientEvidence` carries one number and a sentence, and the number
    means a different thing depending on which of the scorer's four branches
    set it -- the *first* convergence sample for the wind-gate and no-candidate
    causes, the tightest for the separability cause, drift's own figure for the
    diffuse one. Printing it unqualified as "90% origin contour N km²" at the
    head of the refusal read as the cause, and on `mumbai-null` it read as a
    contradictory one: 130 km² announced above a rule that only refuses above
    300. That is the same defect §6c fixed one pane over, and the same fix
    applies -- state the test rather than a number that resembles it.

    This is not the drift pane's readout repeated. Pane 02 prints the test and
    says in its own note that it cannot see the other three causes; what is
    added here is the one thing that pane cannot say, which is whether the test
    is what withheld *this* run.
  */
  const originMin = run.drift.convergence.reduce(
    (m, c) => Math.min(m, c.area90Km2),
    Infinity,
  );
  const haveOrigin = Number.isFinite(originMin);
  const threshold = run.drift.diffuseThresholdKm2;
  const tooDiffuse = haveOrigin && originMin > threshold;

  // The gate scales both sides of the ablation, so at zero the comparison has
  // nothing left to compare. See the note inside the block.
  const gate = run.characterisation.windGateMultiplier;
  const gateInert = gate <= 0;

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
              <p>{halt.reason}</p>
              {haveOrigin && (
                <p className="mt-2" style={{ color: "var(--ink-dim)" }}>
                  {tooDiffuse
                    ? `The backward 90% origin contour never closed tighter than ${originMin.toFixed(0)} km², against this scenario's ${threshold.toFixed(0)} km² limit. That test is the reason.`
                    : `The origin field is not the reason: its backward 90% contour closes to ${originMin.toFixed(0)} km² against a ${threshold.toFixed(0)} km² limit, so the diffuse test passes. A run can still be withheld for causes that test cannot see, and this is one.`}
                </p>
              )}
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
              const tag = tags.get(s.id);
              return [
                <span style={{ color: halt ? "var(--ink-faint)" : "var(--accent)" }}>
                  {halt ? "—" : String(rank).padStart(2, "0")}
                </span>,
                <span
                  style={{ color: "var(--ink)" }}
                  title={tag?.mark ? sharedNote(tag).trim() : undefined}
                >
                  <Tagged tag={tag} fallback={s.label} />
                </span>,
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
          {/*
            The hint used to be suppressed under halt, presumably to avoid the
            word "candidate" while the console was refusing to name one. It cost
            more than it saved: the halt branch is exactly where a reader is
            least likely to guess that a row is clickable, and pane 05 is where
            the working for these hypotheses is. The sentence is re-worded
            instead of withheld.
          */}
          {rows.length > 0 && (
            <p className="mt-1.5 text-[10px]" style={{ color: "var(--ink-faint)" }}>
              {halt
                ? "select a row to open its working in pane 05 — a card, not a place in a list"
                : "select a row to open its evidence card in pane 05"}
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
          {/*
            Why `0 of 51` is not a finding about s_drift.

            `combineWithout` scales its result by the same wind gate `combine`
            does, so at a gate of zero both the ranked and the ablated total are
            zero for every candidate and neither list can move. Left unsaid, the
            two rows above read as "removing the drift term changed nothing",
            which is the opposite of what the cards show: on `mumbai-null` the
            top hypothesis carries an unscaled drift contribution of 0.097 out
            of a 0.494 weighted sum. The gate is what flattened it, not the
            term.
          */}
          {gateInert && (
            <Note tone="warn" label="the ablation is inert here">
              Nothing can move while the gate multiplier is {gate.toFixed(2)}.
              It scales both totals in this comparison, so every candidate sits
              at 0.000 on either side of it. That is a statement about the wind
              and not about s_drift, whose unscaled contribution is printed on
              each card in pane 05.
            </Note>
          )}
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

export function Evidence({ run, state }: { run: Run; state: SpillState }) {
  const { ablated, hour, selectedId, setSelectedId, setHour } = state;
  const rows = useMemo(() => orderedSuspects(run, ablated), [run, ablated]);
  const halt = run.drift.insufficientEvidence;
  // The buttons print the identity alone, so that is what they disambiguate.
  // 04 disambiguates `label`; the two sets coincide for AIS vessels and can
  // legitimately differ for the other kinds.
  const tags = useMemo(() => disambiguate(rows, identityOf), [rows]);
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
  // Where the jump control below lands: the part of *this candidate's* origin
  // window that the clock can actually reach, which is the window's close
  // pulled into the timeline's span.
  //
  // Deliberately neither of the two shorter spellings. A literal `0` duplicates
  // knowledge that lives in `playback.ts`. `eventSpan(run)[0]` is worse than the
  // literal: it reads as the safe derivation, but it is a derivation of the
  // wrong quantity -- if the span ever regained a lead-in it would jump to the
  // *start* of the backward horizon, and this control's whole claim is that it
  // goes to the pass. Clamping the window's own close is the one form that
  // stays true to the sentence in the title under either end moving.
  //
  // All three agree today, on every fixture: `scoring.ts` closes every origin
  // window on `acquiredAt` (all three scorers write the same
  // `[acquiredAt - backwardHours, acquiredAt]` pair) and `playback.ts` opens
  // every span on that same instant. The backward horizon and the forward one
  // are hinged on one timestamp, so the two intervals meet at exactly one hour.
  // That is structure rather than coincidence, but it is still worth deriving,
  // because the agreement is what makes the sentence in the title true and the
  // reader cannot see it from here.
  const [spanH0, spanH1] = eventSpan(run);
  const windowEnd = Math.max(spanH0, Math.min(spanH1, ow1));
  // The 0.01 h tolerance is Timeline.tsx's own epsilon for "the clock is at
  // this mark". Playback accumulates fractional hours, so an equality test
  // would flicker off during a run for no reason a reader could see.
  const atWindowEnd = Math.abs(hour - windowEnd) < 0.01;
  const rank = ablated ? selected.rankWithoutDrift : selected.rank;
  const total = ablated ? selected.totalWithoutDrift : selected.total;

  return (
    <Pane
      index="05"
      title="Evidence"
      right={<Flag tone={KIND_TONE[selected.kind] ?? "dim"}>{KIND_SHORT[selected.kind]}</Flag>}
    >
      <PaneBody>
        {/*
          "Hypothesis" under halt, and it is the same word 04 uses.

          C3's language rule cut both ways in one console: 04 refuses to head
          its list "Candidates" while a run is withheld, and 05 went on calling
          the open card a candidate with `unranked` printed beside it. The two
          panes are two halves of one constraint and have to speak with one
          voice about it.
        */}
        <Block
          label={halt ? "Hypothesis" : "Candidate"}
          right={halt ? "unranked" : `rank ${rank}`}
        >
          <p className="num text-[13px]" style={{ color: "var(--accent)" }}>
            {selected.label}
          </p>
          <p className="mt-1 text-[10.5px] leading-[1.55]" style={{ color: "var(--ink-dim)" }}>
            {selected.detail}
          </p>
          <div data-fields className="mt-2 grid grid-cols-3 gap-1.5">
            {/*
              The score keeps its value and loses its tone under halt. 04 prints
              these numbers too, deliberately, so suppressing the value here
              would put the two panes back out of step in the other direction --
              but `ok` on a total the console has just declined to rank anything
              by is the affirmative reading of a figure that supports nothing.
              04 already draws its bar `faint` for the same reason.
            */}
            <Field
              label="score"
              value={total.toFixed(3)}
              tone={halt ? "dim" : "ok"}
              title={
                halt
                  ? `Weighted sum ${rawSum.toFixed(3)}, scaled by a wind gate multiplier of ${gate.toFixed(2)}. Pane 04 withheld the ranking for this scene, so this total orders nothing; the terms below are the working it was built from.`
                  : undefined
              }
            />
            <Field label="kind" value={KIND_LABEL[selected.kind]} />
            <Field
              label="origin win"
              value={`${formatHour(Math.round(ow0))}..${formatHour(Math.round(ow1))}`}
              title={`${stamp(card.originWindow[0])} to ${stamp(card.originWindow[1])}`}
            />
          </div>
          {/*
            The rank strip and `goto T0` are two rows now, not one.

            They shared a `flex-wrap` row until 2026-09-05. The cost of that was
            positional: `goto T0` was whatever control the wrap happened to
            leave it -- the 38th, 26th, 10th, 33rd and 52nd across the five
            fixtures -- so it landed at a different offset on the last row in
            each, and an operator who had learned where it was on one scenario
            had learned nothing about the next. On its own row it is in the same
            place at every width and in every scene.

            What that costs is one row of height, about 27px, unconditionally --
            including on `kutch-dark`, where nine rank buttons never wrapped and
            the row was never a problem. Taken deliberately: the control is
            worth finding by muscle memory, and the strip below is worth reading
            as one block rather than as a strip with something else on the end
            of it.
          */}
          {rows.length > 1 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {/*
              Two digits on the face, in every scene including a halt.

              This row was briefly made to print each candidate's identity under
              halt, so that 05 would stop showing the ordering 04 refuses to
              give. It was built, measured and rejected by the person directing
              this work, and the measurement is why the decision is recorded
              rather than just reverted: a masked MMSI is 66-84px against a
              two-digit rank's 33.2px, so at the right dock's 300px floor the
              block went from seven buttons on eight rows to three on
              *seventeen*, 455px tall. (It also pushed `goto T0` off the last
              row; that is no longer one of the costs, because `goto T0` now has
              a row of its own by design -- see the note above.) The pane
              scrolls, so nothing was lost -- but the
              density is the design here, and it was traded away for a
              distinction a reader can also get by hovering.

              So the number stays, and the honesty moved into the `title`, which
              costs no width: under halt every button says outright that it is
              not ranked, and a candidate sharing a masked identity with another
              says which one it is. The contradiction with pane 04 is therefore
              narrowed rather than closed, knowingly. ISSUES.md 9.4.3 stays
              open with this as its answer.
            */}
              {rows.map((s) => {
                const tag = tags.get(s.id);
                return (
                  <Btn
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    active={s.id === selected.id}
                    title={
                      halt
                        ? `${s.label} — ${KIND_LABEL[s.kind]}, ${s.detail}. Not a rank: pane 04 withheld the ordering for this scene, and this number is only its position in the list.${sharedNote(tag)}`
                        : s.label
                    }
                  >
                    {String(ablated ? s.rankWithoutDrift : s.rank).padStart(2, "0")}
                  </Btn>
                );
              })}
            </div>
          )}
          <div className="mt-1 flex">
            {/*
              The origin window runs backward from the acquisition and the
              timeline runs forward from it, so the two meet at exactly one
              hour -- the pass itself -- and that hour is the window's close,
              not somewhere outside it. The previous note here had this wrong in
              a way worth recording: it said the window was entirely in negative
              hours and that there was "nowhere for this to jump to", and the
              tooltip said the window lay "before the timeline's range" in the
              same sentence that printed it ending at T0. The behaviour was
              right and the justification was false. What the control actually
              does is open the one hour of the window the ruler still covers.
              The rest of it is printed in the `origin win` field above, which
              is where that evidence lives now that the negative hours are off
              the scale.

              It lights when the clock is already there, the same idiom the rank
              strip above uses for the open card and the speed buttons use for
              the running speed. ("Beside it" until this control was moved onto
              its own row; the idiom is still shared, it is just no longer
              demonstrated by adjacency, which is part of what that move cost.)
              That matters more than it looks: T0 is the
              hour a fresh console opens on, so unlit this control's first press
              would be a visible no-op on a surface whose whole idiom is that
              every control reports. Lit, it is not a dead button -- it is the
              card saying the clock is standing inside this candidate's window,
              and it goes dark the moment a scrub leaves it.
            */}
            <Btn
              onClick={() => setHour(windowEnd)}
              active={atWindowEnd}
              title={`This candidate's origin window is ${formatHour(Math.round(ow0))} to ${formatHour(Math.round(ow1))}. It opens before the timeline and closes at the satellite pass, so ${formatHour(windowEnd)} is the one hour of it this clock can reach. Jumps there.`}
            >
              {`goto ${formatHour(windowEnd)}`}
            </Btn>
          </div>

          {/*
            The row needs a sentence under halt and does not need one otherwise.

            `01`…`51` explains itself beside a card headed `rank 3`. A strip of
            masked identities does not: its most likely misreading is that these
            are the only contacts worth looking at, when they are every one the
            gate admitted. The sentence also has to answer the case this design
            is really for -- a candidate with no identity at all -- and it only
            says that when there is one in the list to say it about.
          */}
          {halt && rows.length > 1 && (
            <p
              className="mt-1.5 text-[10px] leading-[1.5]"
              style={{ color: "var(--ink-faint)" }}
            >
              every hypothesis the gate admitted, by the identity it carries
              rather than by a position — pane 04 withheld the ordering for this
              scene, so there is no number to put on these.
              {rows.some((s) => s.kind === "dark_vessel") &&
                " an unlit contact carries no identity at all, so it is named by its radar designation and by nothing else."}
            </p>
          )}
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
            {/* Same reasoning as the `score` field above: the number stays, the
                affirmative tone does not, while the run is withheld. */}
            <Row
              label="total"
              value={selected.total.toFixed(3)}
              tone={halt ? "dim" : "ok"}
            />
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

export function Method({ state }: { state: SpillState }) {
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
