/**
 * A candidate's evidence, set editorially.
 *
 * Shared between the investigation and the candidates section -- within Signal
 * only. Sharing inside one design is how a design system works; sharing across
 * the four is how four products become one product with four palettes, which is
 * why nothing in this file is exported beyond this directory.
 *
 * The rule the layout enforces: a total never appears without its six terms
 * reachable in the same glance, and the case against the candidate is set at the
 * same width and in the same face as the case for it. Putting counter-evidence
 * in smaller type below a fold would be an editorial decision about how much it
 * matters.
 */

import { TERM_LABEL, TERM_ORDER, KIND_LABEL, stamp } from "../../lib/format";
import type { Suspect } from "../../sim/types";
import { Body, Head, Note, Tag, ValueRule } from "./components";

export interface Weighted {
  key: (typeof TERM_ORDER)[number];
  value: number;
  weight: number;
  detail: string;
}

export function weightedTerms(suspect: Suspect): Weighted[] {
  return TERM_ORDER.map((k) => {
    const t = suspect.evidence.terms.find((x) => x.key === k);
    return {
      key: k,
      value: suspect.terms[k],
      weight: suspect.weights[k],
      detail: t?.detail ?? "",
    };
  });
}

export function EvidenceSheet({
  suspect,
  showWindow = true,
}: {
  suspect: Suspect;
  showWindow?: boolean;
}) {
  const terms = weightedTerms(suspect);
  const strong = [...terms].sort((a, b) => b.value - a.value).slice(0, 3);
  const weak = [...terms].sort((a, b) => a.value - b.value).slice(0, 2);
  const total = terms.reduce((s, t) => s + t.value * t.weight, 0);
  const [lo, hi] = suspect.evidence.originWindow;

  return (
    <div>
      <header
        className="flex flex-wrap items-baseline justify-between gap-4 border-t pt-5"
        style={{ borderColor: "var(--ink-faint)", borderTopWidth: 2 }}
      >
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-4">
            <Tag tone={suspect.rank === 1 ? "accent" : "dim"}>
              Rank {suspect.rank}
            </Tag>
            <Tag>{KIND_LABEL[suspect.kind]}</Tag>
            {suspect.isTruth && <Tag>Authored source</Tag>}
          </div>
          <Head level={3}>{suspect.label}</Head>
          <p
            className="text-dim mt-1 text-[14px]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            {suspect.detail}
          </p>
        </div>
        <div className="text-right">
          <p className="num text-accent text-[34px] leading-none">
            {total.toFixed(3)}
          </p>
          <p className="text-faint mt-1 font-mono text-[9.5px] tracking-[0.2em] uppercase">
            Collated score
          </p>
        </div>
      </header>

      {suspect.kind === "dark_vessel" && (
        <p
          className="text-dim mt-5 border-l py-1 pl-4 text-[14px] leading-[1.55]"
          style={{ borderColor: "var(--accent)", fontFamily: "var(--font-body)" }}
        >
          This candidate has no identity and is not resolvable to a vessel. It is
          ranked as a hypothesis and will never be named.
        </p>
      )}

      <div className="mt-7 space-y-4">
        {terms.map((t) => (
          <ValueRule
            key={t.key}
            label={TERM_LABEL[t.key]}
            value={t.value}
            weight={t.weight}
            detail={t.detail}
            emphasis={t.key === "drift"}
          />
        ))}
      </div>

      {showWindow && (
        <p className="num text-faint mt-6 text-[11.5px]">
          Origin window {stamp(lo)} to {stamp(hi)}
        </p>
      )}

      <div className="mt-9 grid grid-cols-1 gap-8 sm:grid-cols-2">
        <div>
          <p className="text-accent font-mono text-[9.5px] tracking-[0.22em] uppercase">
            Why this candidate
          </p>
          <ul className="mt-3 space-y-3">
            {strong.map((t) => (
              <li
                key={t.key}
                className="text-dim border-l pl-3 text-[13.5px] leading-[1.5]"
                style={{
                  borderColor: "var(--accent)",
                  fontFamily: "var(--font-body)",
                }}
              >
                {t.detail || `${TERM_LABEL[t.key]} scores ${t.value.toFixed(2)}.`}
              </li>
            ))}
            {suspect.evidence.anomalies.map((a) => (
              <li
                key={a.code}
                className="text-dim border-l pl-3 text-[13.5px] leading-[1.5]"
                style={{
                  borderColor: "var(--accent)",
                  fontFamily: "var(--font-body)",
                }}
              >
                <span className="text-ink">{a.label}.</span> {a.detail}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-faint font-mono text-[9.5px] tracking-[0.22em] uppercase">
            Counter-evidence
          </p>
          <ul className="mt-3 space-y-3">
            {weak.map((t) => (
              <li
                key={t.key}
                className="text-dim border-l pl-3 text-[13.5px] leading-[1.5]"
                style={{
                  borderColor: "var(--line)",
                  fontFamily: "var(--font-body)",
                }}
              >
                <span className="text-ink">
                  {TERM_LABEL[t.key]} is weak at {t.value.toFixed(2)}.
                </span>{" "}
                {t.detail}
              </li>
            ))}
            {suspect.evidence.caveats.map((cv) => (
              <li
                key={cv}
                className="text-dim border-l pl-3 text-[13.5px] leading-[1.5]"
                style={{
                  borderColor: "var(--line)",
                  fontFamily: "var(--font-body)",
                }}
              >
                {cv}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** The ablation note that always travels with a score. */
export function AblationNote({ suspect }: { suspect: Suspect }) {
  return (
    <Note label="Without the drift term">
      {suspect.rankWithoutDrift === suspect.rank
        ? "This candidate holds its rank without S_drift on this case. The other terms carried it, and that is reported rather than hidden."
        : `Remove S_drift and this candidate moves to #${suspect.rankWithoutDrift}. That difference is the contribution the project claims.`}
    </Note>
  );
}

/** The standing caveat about weights. */
export function WeightsNote() {
  return (
    <Note label="Not a determination">
      A candidate is not a finding. Weights are hand-set and version stamped,
      never fitted — three published cases cannot support fitting six weights, so
      sensitivity is reported instead of an accuracy figure.
    </Note>
  );
}

/** Used where the section needs the plain statement rather than a note. */
export function NotADetermination() {
  return (
    <Body size="small">
      The language here is candidate, suspected and score. It is never
      responsible, confirmed or guilty, and the alternative hypotheses stay on
      the page beside the top-ranked one.
    </Body>
  );
}
