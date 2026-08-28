import { animate, createTimeline, stagger } from "animejs";
import { FileText } from "@phosphor-icons/react";
import { Grain, Halftone } from "../components/Texture";
import { primeReveal, revealOnScroll, useAnimeScope } from "../lib/motion";
import {
  CANDIDATES,
  CAPABILITIES,
  IMAGES,
  LIMITS,
  PRODUCT,
  SCORE_TERMS,
} from "../content";

/**
 * DOSSIER - forensic case file direction.
 *
 * The framing is evidence, not marketing: hairline rules, a redaction bar that
 * wipes back to reveal the headline, signal red used only where something is
 * being asserted. Sharp corners, tight measure, archival feel.
 *
 * Motion is minimal and all of it is meaningful: the redaction wipe is the
 * page's one theatrical moment and it says "this was withheld, now it is not".
 */
export default function Dossier() {
  const root = useAnimeScope(() => {
    const tl = createTimeline({ defaults: { ease: "inOut(3)" } });

    // Redaction bars retract left to right, uncovering the headline lines.
    tl.add(".dos-redact", {
      scaleX: [1, 0],
      duration: 780,
      delay: stagger(150),
      ease: "inOut(4)",
    })
      .add(
        ".dos-line",
        { opacity: [0, 1], duration: 400, delay: stagger(150) },
        "<<+=180",
      )
      .add(
        ".dos-meta",
        { opacity: [0, 1], translateY: [10, 0], duration: 600, delay: stagger(70) },
        "-=300",
      );

    // Case stamp settles into place, slightly rotated, once.
    animate(".dos-stamp", {
      opacity: [0, 1],
      scale: [1.25, 1],
      rotate: [-9, -4],
      duration: 700,
      delay: 900,
      ease: "out(4)",
    });

    primeReveal(".dos-reveal", 22);
    revealOnScroll(".dos-reveal", { y: 22, delay: 50 });
  });

  return (
    <div ref={root} className="font-archivo text-ink relative">
      <Grain opacity={0.22} />

      {/* NAV */}
      <header className="border-line bg-base/90 sticky top-0 z-30 border-b backdrop-blur-md">
        <nav className="mx-auto flex h-[66px] max-w-[1180px] items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <FileText size={19} weight="duotone" className="text-accent" />
            <span className="font-mono text-[12.5px] tracking-[0.22em] uppercase">
              {PRODUCT.name}
            </span>
          </div>
          <div className="text-dim hidden gap-8 font-mono text-[11.5px] tracking-wide sm:flex">
            <a href="#findings" className="hover:text-ink transition-colors">Findings</a>
            <a href="#weighting" className="hover:text-ink transition-colors">Weighting</a>
            <a href="#caveat" className="hover:text-ink transition-colors">Caveat</a>
          </div>
          <a
            href="#file"
            className="border-accent text-accent hover:bg-accent border px-4 py-2 font-mono text-[11.5px] tracking-wide transition-colors hover:text-[color:var(--accent-ink)]"
          >
            Request access
          </a>
        </nav>
      </header>

      {/* HERO - case-file masthead. Centered is right here: the file IS the message. */}
      <section className="border-line relative border-b">
        <div className="mx-auto max-w-[1180px] px-6 pt-20 pb-16 lg:pt-24">
          <div className="dos-meta text-faint mb-10 flex flex-wrap gap-x-8 gap-y-2 font-mono text-[11px] tracking-[0.16em] uppercase">
            <span>Case file</span>
            <span>Marine pollution</span>
            <span>Source attribution</span>
          </div>

          <h1 className="max-w-[20ch] text-[clamp(2.4rem,6vw,4.8rem)] leading-[0.98] font-semibold tracking-tight">
            {["Find the slick.", "Trace it home.", "Name the ship."].map((line) => (
              <span key={line} className="relative block overflow-hidden py-0.5">
                <span className="dos-line block">{line}</span>
                <span
                  className="dos-redact absolute inset-0 origin-left"
                  style={{ background: "var(--accent)" }}
                />
              </span>
            ))}
          </h1>

          <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-12">
            <p className="dos-meta text-dim lg:col-span-6 lg:col-start-1 leading-relaxed">
              {PRODUCT.summary}
            </p>
            <div className="dos-meta flex items-start gap-4 lg:col-span-4 lg:col-start-9">
              <a
                href="#findings"
                className="bg-accent px-6 py-3.5 font-mono text-[12.5px] tracking-wide transition-transform active:translate-y-px"
                style={{ color: "var(--accent-ink)" }}
              >
                Open the file
              </a>
            </div>
          </div>
        </div>

        {/* stamp */}
        <span
          className="dos-stamp pointer-events-none absolute top-24 right-8 hidden border-2 px-4 py-2 font-mono text-[12px] tracking-[0.2em] uppercase opacity-0 lg:block"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          Under review
        </span>
      </section>

      {/* EXHIBIT - single wide plate with a caption, unlike any other section */}
      <section className="border-line border-b">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <Halftone
            src={IMAGES.coast}
            alt="Placeholder standing in for a coastal radar scene under examination"
            dot={4}
            className="dos-reveal aspect-[21/9] w-full"
          />
          <p className="dos-reveal text-faint mt-4 font-mono text-[11px] leading-relaxed">
            Placeholder image, not radar. Replace with a Sentinel-1 VV tile before
            this is shown to anyone.
          </p>
        </div>
      </section>

      {/* FINDINGS - numbered legal-style clauses, single column, tight measure */}
      <section id="findings" className="border-line border-b">
        <div className="mx-auto max-w-[1180px] px-6 py-20">
          <h2 className="dos-reveal mb-14 max-w-[20ch] text-[clamp(1.8rem,3.6vw,2.9rem)] leading-[1.06] font-semibold tracking-tight">
            What the system establishes, and how.
          </h2>

          <ol className="space-y-px">
            {CAPABILITIES.map((c, i) => (
              <li
                key={c.id}
                className="dos-reveal border-line grid grid-cols-1 gap-4 border-t py-8 md:grid-cols-12 md:gap-8"
              >
                <div className="md:col-span-3">
                  <span className="text-accent font-mono text-[12px] tracking-[0.16em]">
                    {String(i + 1).padStart(2, "0")} / {c.label}
                  </span>
                </div>
                <div className="md:col-span-9">
                  <h3 className="text-[1.3rem] leading-snug font-medium">{c.title}</h3>
                  <p className="text-dim mt-2.5 max-w-[62ch] leading-relaxed">
                    {c.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* WEIGHTING - ranked contact sheet + weights, side by side */}
      <section id="weighting" className="border-line border-b">
        <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-14 px-6 py-20 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="text-accent mb-6 font-mono text-[11px] tracking-[0.22em] uppercase">
              Ranked candidates
            </p>
            <div className="divide-line divide-y">
              {CANDIDATES.map((c) => (
                <div
                  key={c.rank}
                  className="dos-reveal flex items-center justify-between gap-6 py-5"
                >
                  <div className="flex items-baseline gap-5">
                    <span className="text-faint font-mono text-[12px] tabular-nums">
                      {String(c.rank).padStart(2, "0")}
                    </span>
                    <div>
                      <p className="font-mono text-[14px]">{c.id}</p>
                      <p className="text-dim mt-0.5 text-[13px]">{c.kind}</p>
                    </div>
                  </div>
                  <span
                    className="font-mono text-[1.35rem] tabular-nums"
                    style={{ color: c.rank === 1 ? "var(--accent)" : "var(--ink-faint)" }}
                  >
                    {c.score.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-faint mt-6 max-w-[56ch] font-mono text-[11px] leading-relaxed">
              Illustrative. Identities masked. Ranking is not a determination.
            </p>
          </div>

          <div className="lg:col-span-5">
            <p className="text-accent mb-6 font-mono text-[11px] tracking-[0.22em] uppercase">
              Term weighting
            </p>
            <div className="space-y-4">
              {SCORE_TERMS.map((t) => (
                <div key={t.key} className="dos-reveal">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-[14px]">{t.label}</span>
                    <span className="text-dim font-mono text-[12px] tabular-nums">
                      {t.weight.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-faint mt-1 text-[12.5px] leading-relaxed">
                    {t.note}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CAVEAT - full-bleed statement, the emphatic close */}
      <section id="caveat" style={{ background: "var(--base-2)" }}>
        <div className="mx-auto max-w-[1180px] px-6 py-20">
          <h2 className="dos-reveal max-w-[24ch] text-[clamp(1.7rem,3.2vw,2.5rem)] leading-[1.1] font-semibold tracking-tight">
            A ranking is a lead, not a verdict.
          </h2>
          <div className="mt-12 grid grid-cols-1 gap-10 md:grid-cols-3">
            {LIMITS.map((l) => (
              <div key={l.title} className="dos-reveal">
                <div className="bg-accent mb-4 h-[3px] w-8" />
                <h3 className="text-[1.02rem] leading-snug font-medium">{l.title}</h3>
                <p className="text-dim mt-2.5 text-sm leading-relaxed">{l.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer id="file" className="border-line border-t">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-8 px-6 py-16 md:flex-row md:items-center md:justify-between">
          <h2 className="max-w-[20ch] text-[clamp(1.5rem,2.8vw,2.2rem)] leading-tight font-semibold tracking-tight">
            Bring it to your waters.
          </h2>
          <a
            href="#file"
            className="bg-accent self-start px-7 py-4 font-mono text-[12.5px] tracking-wide transition-transform active:translate-y-px"
            style={{ color: "var(--accent-ink)" }}
          >
            Request access
          </a>
        </div>
        <p className="text-faint mx-auto max-w-[1180px] px-6 pb-12 font-mono text-[11px]">
          Layout study. Case material is illustrative.
        </p>
      </footer>
    </div>
  );
}
