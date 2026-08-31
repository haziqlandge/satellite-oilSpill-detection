/**
 * ORBIT -- M5, the mission brief.
 *
 * Every direction has to publish its method and its limits somewhere. An
 * editorial publication runs them as a standards note; a case file binds them as
 * an appendix. A mission-control system issues a brief: a numbered document,
 * read on the same surface as the mission, with the chart still visible behind
 * it because you are not meant to leave the console to read it.
 *
 * The provenance section is the one that carries the most weight, and it is set
 * as a telemetry channel listing rather than as a disclaimer. That is Orbit's
 * assigned idiom for it, and it is the more honest form anyway: a disclaimer is
 * something a reader skips, whereas a channel table reading MODEL: NONE TRAINED
 * beside the values that channel produced is a statement about the data itself.
 */

import type { ReactNode } from "react";
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
import { TERM_LABEL, TERM_ORDER } from "../../lib/format";
import { PROXIMITY_LAMBDA_KM, WEIGHTS, WEIGHTS_VERSION } from "../../sim/scoring";
import { useDesign } from "../../DesignContext";
import { alpha } from "./instruments";

export default function Brief() {
  const def = useDesign();

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex justify-center overflow-hidden px-3 pt-[52px] pb-[124px] lg:px-8">
      <article
        className="orbit-scroll pointer-events-auto relative w-full max-w-[1040px] overflow-y-auto rounded-[14px]"
        style={{
          border: `1px solid ${alpha("var(--line)", 100)}`,
          background: alpha("var(--base-2)", 88),
          backdropFilter: "blur(20px) saturate(1.2)",
          WebkitBackdropFilter: "blur(20px) saturate(1.2)",
          boxShadow: `0 40px 90px -50px ${alpha("var(--base)", 100)}`,
        }}
      >
        <header
          className="sticky top-0 z-10 flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4 sm:px-8"
          style={{
            borderBottom: `1px solid ${alpha("var(--line)", 100)}`,
            background: alpha("var(--base-2)", 94),
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          <h2
            className="text-[19px] tracking-[0.16em] uppercase sm:text-[23px]"
            style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--ink)" }}
          >
            Mission brief
          </h2>
          <span className="num text-[9.5px] tracking-[0.18em]" style={{ color: "var(--ink-faint)" }}>
            M5 · METHOD · LIMITS · PROVENANCE
          </span>
          <span
            className="num ml-auto text-[9.5px] tracking-[0.18em]"
            style={{ color: def.map.infrastructure }}
          >
            {PROVENANCE.flag}
          </span>
        </header>

        <div className="px-5 pb-8 sm:px-8">
          {/* --- 01 sequence ----------------------------------------- */}
          <Part n="01" title="Sequence">
            <Lede>
              Six stages, each of which hands the next one something it can check.
              The one that does not exist in the reviewed literature is the fourth.
            </Lede>
            <ol className="mt-4 flex flex-col">
              {STAGES.map((s, i) => (
                <li
                  key={s.key}
                  className="grid grid-cols-[2.2rem_1fr] gap-x-3 py-3 sm:grid-cols-[2.2rem_9rem_1fr] sm:gap-x-5"
                  style={{ borderTop: i ? `1px solid ${alpha("var(--line)", 70)}` : undefined }}
                >
                  <span className="num pt-[3px] text-[10px]" style={{ color: "var(--accent)" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h4
                      className="text-[12px] tracking-[0.16em] uppercase"
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 600,
                        color: "var(--ink)",
                      }}
                    >
                      {s.name}
                    </h4>
                    <p className="num mt-0.5 text-[9px]" style={{ color: "var(--ink-faint)" }}>
                      {s.proc}
                    </p>
                  </div>
                  <p
                    className="col-span-2 mt-2 text-[12.5px] leading-[1.55] sm:col-span-1 sm:mt-0"
                    style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}
                  >
                    {s.body}
                  </p>
                </li>
              ))}
            </ol>
          </Part>

          {/* --- 02 terms -------------------------------------------- */}
          <Part n="02" title="Scoring terms">
            <Lede>
              Six weighted terms, hand-set rather than learned, because there is no
              corpus to learn them from and a fitted weight nobody can defend is
              worse than a stated one. Weight set {WEIGHTS_VERSION}; proximity
              decays with a {PROXIMITY_LAMBDA_KM.toFixed(1)} km constant.
            </Lede>
            <div className="mt-4 flex flex-col">
              {TERM_ORDER.map((k, i) => {
                const ours = TERM_ORIGIN[k] === "This project";
                return (
                  <div
                    key={k}
                    className="grid grid-cols-[1fr_auto] gap-x-4 py-3 sm:grid-cols-[11rem_1fr_4rem]"
                    style={{ borderTop: i ? `1px solid ${alpha("var(--line)", 70)}` : undefined }}
                  >
                    <h4
                      className="text-[12px] tracking-[0.14em] uppercase"
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 600,
                        color: ours ? "var(--accent)" : "var(--ink)",
                      }}
                    >
                      {TERM_LABEL[k]}
                    </h4>
                    <span
                      className="num text-right text-[11px] sm:order-3"
                      style={{ color: "var(--ink-dim)" }}
                    >
                      {WEIGHTS[k].toFixed(2)}
                    </span>
                    <p
                      className="col-span-2 mt-2 text-[12.5px] leading-[1.55] sm:order-2 sm:col-span-1 sm:mt-0"
                      style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}
                    >
                      {TERM_NOTE[k]}
                      <span className="num ml-2 text-[9px]" style={{ color: "var(--ink-faint)" }}>
                        {TERM_ORIGIN[k].toUpperCase()}
                      </span>
                    </p>
                  </div>
                );
              })}
            </div>
          </Part>

          {/* --- 03 limits ------------------------------------------- */}
          <Part n="03" title="Where it stops">
            <Lede>
              Carried in the same weight of type as the claims. A system that names
              vessels as suspected polluters and does not publish where it stops
              being certain is not a usable system, it is a confident one.
            </Lede>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {LIMITS.map((l) => (
                <section
                  key={l.key}
                  className="rounded-[9px] p-3.5"
                  style={{
                    border: `1px solid ${alpha("var(--line)", 100)}`,
                    background: alpha("var(--base-3)", 45),
                  }}
                >
                  <h4
                    className="text-[11.5px] tracking-[0.12em] uppercase"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}
                  >
                    {l.title}
                  </h4>
                  <p
                    className="num mt-1 text-[9px] tracking-[0.1em] uppercase"
                    style={{ color: def.map.infrastructure }}
                  >
                    {l.short}
                  </p>
                  <p
                    className="mt-2 text-[12px] leading-[1.55]"
                    style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}
                  >
                    {l.body}
                  </p>
                </section>
              ))}
            </div>
          </Part>

          {/* --- 04 prior art ---------------------------------------- */}
          <Part n="04" title="Against the prior art">
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse">
                <thead>
                  <tr>
                    {["System", "Detection", "Drift", "AIS", "Explainable"].map((h) => (
                      <th
                        key={h}
                        className="px-2 py-2 text-left text-[9.5px] tracking-[0.18em] uppercase"
                        style={{
                          fontFamily: "var(--font-display)",
                          fontWeight: 600,
                          color: "var(--ink-faint)",
                          borderBottom: `1px solid ${alpha("var(--line)", 100)}`,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((c) => (
                    <tr
                      key={c.system}
                      style={{ background: c.ours ? alpha("var(--accent)", 7) : undefined }}
                    >
                      {[c.system, c.detect, c.drift, c.ais, c.explain].map((cell, j) => (
                        <td
                          key={j}
                          className="px-2 py-2.5 text-[11.5px] leading-snug"
                          style={{
                            fontFamily: "var(--font-body)",
                            color: c.ours && j === 0 ? "var(--accent)" : "var(--ink-dim)",
                            fontWeight: j === 0 ? 600 : 400,
                            borderBottom: `1px solid ${alpha("var(--line)", 55)}`,
                          }}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Part>

          {/* --- 05 provenance --------------------------------------- */}
          <Part n="05" title="Telemetry provenance">
            <Lede>{PROVENANCE.full}</Lede>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Channel label="Source" value="SIM" tone={def.map.infrastructure} />
              <Channel label="Model" value="NONE TRAINED" tone={def.map.infrastructure} />
              <Channel label="Identities" value="MASKED" tone={def.map.infrastructure} />
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <ChannelList tag="PUB" title="Published" items={PUBLISHED} tone="var(--ink-dim)" />
              <ChannelList
                tag="SIM"
                title="Generated on this page"
                items={SIMULATED}
                tone={def.map.infrastructure}
              />
            </div>

            <p
              className="mt-5 max-w-[74ch] text-[12.5px] leading-[1.6]"
              style={{ fontFamily: "var(--font-body)", color: "var(--ink)" }}
            >
              Every instrument on this panel carries its own channel tag on the
              fascia. A viewer who never opens this brief still cannot mistake a
              generated field for a measurement, because the module that produced
              it says which it is.
            </p>
          </Part>
        </div>
      </article>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Brief furniture
 * ------------------------------------------------------------------ */

function Part({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="pt-7">
      <header className="flex items-baseline gap-3">
        <span className="num text-[10px] tracking-[0.2em]" style={{ color: "var(--accent)" }}>
          {n}
        </span>
        <h3
          className="text-[14px] tracking-[0.2em] uppercase"
          style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--ink)" }}
        >
          {title}
        </h3>
        <span
          aria-hidden
          className="h-px flex-1 translate-y-[-4px]"
          style={{ background: alpha("var(--line)", 100) }}
        />
      </header>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Lede({ children }: { children: ReactNode }) {
  return (
    <p
      className="max-w-[74ch] text-[13.5px] leading-[1.6]"
      style={{ fontFamily: "var(--font-body)", color: "var(--ink)" }}
    >
      {children}
    </p>
  );
}

function Channel({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div
      className="rounded-[9px] px-3.5 py-3"
      style={{ border: `1px solid ${alpha(tone, 32)}`, background: alpha(tone, 6) }}
    >
      <p
        className="text-[9px] tracking-[0.2em] uppercase"
        style={{ fontFamily: "var(--font-display)", fontWeight: 600, color: "var(--ink-faint)" }}
      >
        {label}
      </p>
      <p className="num mt-1 text-[13px]" style={{ color: tone }}>
        {value}
      </p>
    </div>
  );
}

function ChannelList({
  tag,
  title,
  items,
  tone,
}: {
  tag: string;
  title: string;
  items: string[];
  tone: string;
}) {
  return (
    <section>
      <header className="flex items-baseline gap-2">
        <span
          className="num rounded-[3px] px-1 py-[1px] text-[8.5px] tracking-[0.14em]"
          style={{ color: tone, border: `1px solid ${alpha(tone, 45)}` }}
        >
          {tag}
        </span>
        <h4
          className="text-[11px] tracking-[0.16em] uppercase"
          style={{ fontFamily: "var(--font-display)", fontWeight: 600, color: "var(--ink)" }}
        >
          {title}
        </h4>
      </header>
      <ul className="mt-2 flex flex-col gap-2">
        {items.map((s) => (
          <li
            key={s}
            className="flex gap-2 text-[12px] leading-[1.5]"
            style={{ fontFamily: "var(--font-body)", color: "var(--ink-dim)" }}
          >
            <span aria-hidden className="num shrink-0" style={{ color: alpha(tone, 70) }}>
              ·
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
