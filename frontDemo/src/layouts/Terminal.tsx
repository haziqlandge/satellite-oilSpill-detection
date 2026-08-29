import { useEffect, useState } from "react";
import { animate, createTimeline, stagger, text, utils } from "animejs";
import { Terminal as TerminalIcon } from "@phosphor-icons/react";
import { Grain } from "../components/Texture";
import { primeReveal, revealOnScroll, useAnimeScope, useReducedMotion } from "../lib/motion";
import {
  CANDIDATES,
  CAPABILITIES,
  LIMITS,
  PIPELINE,
  PRODUCT,
  SCORE_TERMS,
} from "../content";

const BOOT = [
  "slickline --scene S1A_IW_GRDH --backward 48h",
  "reading  sentinel-1 vv .......... ok",
  "masking  land + speckle ......... ok",
  "segment  2 instances ............ ok",
  "drift    256 particles x 12 members",
  "gate     1841 tracks -> 4 candidates",
];

/**
 * TERMINAL - CRT console direction.
 *
 * Monospace everywhere, phosphor green on near-black, scanlines over the whole
 * page. The hero is a working console transcript rather than a headline block,
 * so the product explains itself by running.
 *
 * This is the one layout where a typed sequence is motivated: the content IS a
 * process, and showing it execute communicates the pipeline faster than prose.
 */
export default function Terminal() {
  const reduced = useReducedMotion();
  const [visibleLines, setVisibleLines] = useState(reduced ? BOOT.length : 0);

  // Boot transcript prints line by line. Interval rather than an anime timeline
  // because the unit of animation is a whole line appearing, not a tween.
  useEffect(() => {
    if (reduced) {
      setVisibleLines(BOOT.length);
      return;
    }
    setVisibleLines(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setVisibleLines(i);
      if (i >= BOOT.length) window.clearInterval(id);
    }, 380);
    return () => window.clearInterval(id);
  }, [reduced]);

  const root = useAnimeScope(() => {
    // Headline decodes rather than fades. Scramble is native to anime v4 text.
    const { chars } = text.split(".term-headline", { chars: true, words: false });
    utils.set(chars, { opacity: 0 });

    createTimeline({ defaults: { ease: "out(2)" } })
      .add(chars, {
        opacity: [0, 1],
        duration: 40,
        delay: stagger(18),
      })
      .add(
        ".term-sub",
        { opacity: [0, 1], translateY: [10, 0], duration: 600 },
        "-=200",
      );

    // Cursor block. A hard step ease keeps it feeling like a real terminal
    // rather than a soft pulsing dot.
    animate(".term-cursor", {
      opacity: [1, 0],
      duration: 1000,
      ease: "steps(2)",
      loop: true,
    });

    primeReveal(".term-reveal", 20);
    revealOnScroll(".term-reveal", { y: 20, delay: 45 });
  }, [reduced]);

  return (
    <div
      ref={root}
      className="font-mono text-ink scanlines relative text-[15px] leading-relaxed"
    >
      <Grain opacity={0.12} />

      {/* NAV */}
      <header className="border-line bg-base/90 sticky top-0 z-30 border-b backdrop-blur-sm">
        <nav className="mx-auto flex h-[64px] max-w-[1240px] items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <TerminalIcon size={18} weight="bold" className="text-accent" />
            <span className="text-[13px] tracking-[0.16em] lowercase">
              {PRODUCT.name.toLowerCase()}
            </span>
            <span className="term-cursor bg-accent ml-0.5 inline-block h-[14px] w-[7px] align-middle" />
          </div>
          <div className="text-dim hidden gap-7 text-[12.5px] sm:flex">
            <a href="#run" className="hover:text-accent transition-colors">./run</a>
            <a href="#score" className="hover:text-accent transition-colors">./score</a>
            <a href="#caveats" className="hover:text-accent transition-colors">./caveats</a>
          </div>
        </nav>
      </header>

      {/* HERO - console transcript, centered narrow column (the message is the design) */}
      <section className="mx-auto max-w-[1240px] px-6 pt-20 pb-24 lg:pt-24">
        <h1 className="term-headline max-w-[24ch] text-[clamp(2rem,5vw,3.6rem)] leading-[1.06] font-semibold tracking-tight">
          {PRODUCT.tagline}
        </h1>
        <p className="term-sub text-dim mt-6 max-w-[62ch] text-[15px] leading-relaxed">
          {PRODUCT.summary}
        </p>

        <div className="term-sub mt-8 flex flex-wrap gap-3">
          <a
            href="#run"
            className="bg-accent px-6 py-3 text-[13px] tracking-wide transition-transform active:translate-y-px"
            style={{ color: "var(--accent-ink)" }}
          >
            Request access
          </a>
          <a
            href="#caveats"
            className="border-line text-ink hover:border-accent border px-6 py-3 text-[13px] tracking-wide transition-colors"
          >
            What it cannot do
          </a>
        </div>

        <div
          className="border-line mt-12 border"
          style={{ background: "var(--base-2)" }}
        >
          <div className="border-line flex items-center gap-2 border-b px-4 py-2.5">
            <span className="bg-accent inline-block h-2 w-2 rounded-full" />
            <span className="text-faint text-[11.5px] tracking-wide">
              slickline / run
            </span>
          </div>

          <div className="space-y-1.5 px-4 py-5 text-[13.5px] sm:px-6 sm:py-6">
            {BOOT.slice(0, visibleLines).map((line, i) => (
              <div key={line} className="flex gap-3">
                <span className="text-faint shrink-0 select-none">
                  {i === 0 ? "$" : " "}
                </span>
                <span className={i === 0 ? "text-ink" : "text-dim"}>
                  {i === 0 ? line : line}
                </span>
              </div>
            ))}
            {visibleLines >= BOOT.length && (
              <div className="mt-4 flex gap-3">
                <span className="text-faint shrink-0 select-none">$</span>
                <span className="text-accent">
                  ranked 4 candidates
                  <span className="term-cursor bg-accent ml-1.5 inline-block h-[13px] w-[7px] align-middle" />
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* PIPELINE - two column key/value manifest, no cards */}
      <section id="run" className="border-line border-t">
        <div className="mx-auto max-w-[1240px] px-6 py-20">
          <p className="text-accent mb-8 text-[12px] tracking-[0.22em] uppercase">
            Pipeline
          </p>
          <dl className="divide-line divide-y">
            {PIPELINE.map((p, i) => (
              <div
                key={p.step}
                className="term-reveal grid grid-cols-1 gap-2 py-4 sm:grid-cols-12 sm:gap-6"
              >
                <dt className="flex items-baseline gap-4 sm:col-span-4">
                  <span className="text-faint text-[12px] tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-ink">{p.step}</span>
                </dt>
                <dd className="text-dim text-[14px] sm:col-span-8">{p.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* CAPABILITIES - 2x2 quadrant grid with hairline dividers */}
      <section className="border-line border-t">
        <div className="mx-auto max-w-[1240px] px-6 py-20">
          <div className="grid grid-cols-1 md:grid-cols-2">
            {CAPABILITIES.map((c, i) => (
              <article
                key={c.id}
                className={`term-reveal p-8 ${
                  i % 2 === 0 ? "md:border-r" : ""
                } ${i < 2 ? "md:border-b" : ""} border-line`}
              >
                <p className="text-accent text-[12px] tracking-[0.2em] uppercase">
                  {c.label}
                </p>
                <h3 className="mt-4 text-[1.15rem] leading-snug">{c.title}</h3>
                <p className="text-dim mt-3 text-[14px] leading-relaxed">{c.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* SCORING - output table, the natural form for a terminal */}
      <section id="score" className="border-line border-t">
        <div className="mx-auto max-w-[1240px] px-6 py-20">
          <p className="text-accent mb-3 text-[12px] tracking-[0.22em] uppercase">
            Ranked output
          </p>
          <p className="text-dim mb-10 max-w-[62ch] text-[14px] leading-relaxed">
            Identities are masked here. Vessels with no transponder are ranked but
            never named, because a radar contact is not an identification.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13.5px]">
              <thead>
                <tr className="text-faint border-line border-b text-[11.5px] tracking-[0.16em] uppercase">
                  <th className="py-3 pr-4 font-normal">#</th>
                  <th className="py-3 pr-4 font-normal">Contact</th>
                  <th className="py-3 pr-4 font-normal">Class</th>
                  <th className="py-3 pr-4 font-normal">Score</th>
                  <th className="py-3 font-normal">Assessment</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {CANDIDATES.map((c) => (
                  <tr key={c.rank} className="term-reveal">
                    <td className="text-faint py-4 pr-4 tabular-nums">{c.rank}</td>
                    <td className="text-ink py-4 pr-4">{c.id}</td>
                    <td className="text-dim py-4 pr-4">{c.kind}</td>
                    <td
                      className="py-4 pr-4 tabular-nums"
                      style={{ color: c.rank === 1 ? "var(--accent)" : "var(--ink-dim)" }}
                    >
                      {c.score.toFixed(2)}
                    </td>
                    <td className="text-dim py-4">{c.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-10 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
            {SCORE_TERMS.map((t) => (
              <div key={t.key} className="term-reveal flex items-baseline gap-3">
                <span className="text-accent text-[12px] tabular-nums">
                  {t.weight.toFixed(2)}
                </span>
                <span className="text-dim text-[13px]">{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CAVEATS - full width warning block, distinct from every other section */}
      <section id="caveats" className="border-line border-t">
        <div className="mx-auto max-w-[1240px] px-6 py-20">
          <p className="text-accent mb-8 text-[12px] tracking-[0.22em] uppercase">
            Known limits
          </p>
          <div className="space-y-px">
            {LIMITS.map((l) => (
              <div
                key={l.title}
                className="term-reveal border-line border-l-2 py-4 pl-6"
                style={{ borderLeftColor: "var(--accent)" }}
              >
                <p className="text-ink text-[14.5px]">{l.title}</p>
                <p className="text-dim mt-2 max-w-[70ch] text-[13.5px] leading-relaxed">
                  {l.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-line border-t">
        <div className="mx-auto max-w-[1240px] px-6 py-14">
          <a
            href="#run"
            className="bg-accent inline-block px-6 py-3 text-[13px] tracking-wide transition-transform active:translate-y-px"
            style={{ color: "var(--accent-ink)" }}
          >
            Request access
          </a>
          <p className="text-faint mt-10 text-[11.5px]">
            Layout study. Transcript is illustrative, not a real run.
          </p>
        </div>
      </footer>
    </div>
  );
}
