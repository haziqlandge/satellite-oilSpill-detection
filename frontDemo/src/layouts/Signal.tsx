import { animate, createTimeline, stagger, text } from "animejs";
import { ArrowUpRight, Waves } from "@phosphor-icons/react";
import { Grain, Halftone } from "../components/Texture";
import { primeReveal, revealOnScroll, useAnimeScope } from "../lib/motion";
import {
  CAPABILITIES,
  EVIDENCE,
  IMAGES,
  LIMITS,
  PRODUCT,
  SCORE_TERMS,
} from "../content";

/**
 * SIGNAL - halftone print direction.
 *
 * Newsprint logic: heavy duotone imagery broken by a dot lattice, one sodium
 * accent, hard 0px corners, generous asymmetry. Motion is restrained because
 * the aesthetic is print; the only real animation is the headline setting
 * itself and content arriving on scroll.
 */
export default function Signal() {
  const root = useAnimeScope(() => {
    // Headline sets word by word, like type dropping into a forme.
    const { words } = text.split(".sig-headline", { words: true, chars: false });

    const tl = createTimeline({ defaults: { ease: "out(3)" } });
    tl.add(words, {
      opacity: [0, 1],
      translateY: [40, 0],
      duration: 900,
      delay: stagger(70),
    })
      .add(
        ".sig-lede",
        { opacity: [0, 1], translateY: [16, 0], duration: 700 },
        "-=520",
      )
      .add(
        ".sig-cta",
        { opacity: [0, 1], translateY: [12, 0], duration: 600, delay: stagger(80) },
        "-=460",
      )
      .add(
        ".sig-plate",
        { opacity: [0, 1], scale: [1.04, 1], duration: 1100 },
        "-=900",
      );

    // The dot lattice breathes very slightly, which keeps the print from
    // looking like a flat screenshot without drawing attention to itself.
    animate(".sig-plate .halftone", {
      "--dot": ["4.4px", "5.6px"],
      duration: 7000,
      ease: "inOut(2)",
      loop: true,
      alternate: true,
    });

    primeReveal(".sig-reveal", 30);
    revealOnScroll(".sig-reveal");
  });

  return (
    <div ref={root} className="font-display text-ink relative">
      <Grain opacity={0.2} />

      {/* NAV - single line, 68px */}
      <header className="border-line bg-base/85 sticky top-0 z-30 border-b backdrop-blur-md">
        <nav className="mx-auto flex h-[68px] max-w-[1400px] items-center justify-between px-6 lg:px-10">
          <div className="flex items-center gap-2.5">
            <Waves size={20} weight="duotone" className="text-accent" />
            <span className="font-mono text-[13px] tracking-[0.2em] uppercase">
              {PRODUCT.name}
            </span>
          </div>
          <div className="text-dim hidden items-center gap-8 font-mono text-[12px] tracking-wide md:flex">
            <a href="#method" className="hover:text-ink transition-colors">Method</a>
            <a href="#scoring" className="hover:text-ink transition-colors">Scoring</a>
            <a href="#limits" className="hover:text-ink transition-colors">Limits</a>
          </div>
          <a
            href="#brief"
            className="bg-accent px-4 py-2 font-mono text-[12px] tracking-wide transition-transform active:scale-[0.98]"
            style={{ color: "var(--accent-ink)" }}
          >
            Request access
          </a>
        </nav>
      </header>

      {/* HERO - asymmetric split, 7/5 */}
      <section className="mx-auto grid min-h-[calc(100dvh-68px)] max-w-[1400px] grid-cols-1 items-center gap-10 px-6 pt-16 pb-20 lg:grid-cols-12 lg:px-10 lg:pt-24">
        <div className="lg:col-span-7">
          <p className="text-accent mb-6 font-mono text-[11px] tracking-[0.28em] uppercase">
            Radar to responsibility
          </p>
          <h1 className="sig-headline text-[clamp(2.6rem,6.4vw,5.4rem)] leading-[0.95] font-semibold tracking-tight">
            Find the slick. Trace it home. Name the ship.
          </h1>
          <p className="sig-lede text-dim mt-7 max-w-[52ch] text-lg leading-relaxed">
            {PRODUCT.summary}
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a
              href="#method"
              className="sig-cta bg-accent inline-flex items-center gap-2 px-6 py-3.5 font-mono text-[13px] tracking-wide transition-transform active:translate-y-px"
              style={{ color: "var(--accent-ink)" }}
            >
              See the method
              <ArrowUpRight size={16} weight="bold" />
            </a>
            <a
              href="#limits"
              className="sig-cta border-line text-ink hover:border-accent inline-flex items-center border px-6 py-3.5 font-mono text-[13px] tracking-wide transition-colors"
            >
              What it cannot do
            </a>
          </div>
        </div>

        <div className="sig-plate lg:col-span-5">
          <Halftone
            src={IMAGES.slickTall}
            alt="Placeholder standing in for a Sentinel-1 radar scene containing a slick"
            dot={5}
            className="aspect-[4/5] w-full"
          />
          <p className="text-faint mt-3 font-mono text-[10.5px] tracking-wide">
            Placeholder image. Replace with a Sentinel-1 VV tile.
          </p>
        </div>
      </section>

      {/* EVIDENCE - hairline row, no cards */}
      <section className="border-line border-y">
        <div className="divide-line mx-auto grid max-w-[1400px] grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {EVIDENCE.map((e) => (
            <div key={e.unit} className="sig-reveal px-6 py-10 lg:px-10">
              <p className="font-mono text-[2.75rem] leading-none tabular-nums">
                {e.value}
              </p>
              <p className="text-accent mt-2 font-mono text-[11px] tracking-[0.18em] uppercase">
                {e.unit}
              </p>
              <p className="text-dim mt-4 max-w-[34ch] text-sm leading-relaxed">
                {e.note}
              </p>
              <p className="text-faint mt-3 font-mono text-[10.5px]">{e.source}</p>
            </div>
          ))}
        </div>
      </section>

      {/* METHOD - stacked numbered spreads, alternating emphasis */}
      <section id="method" className="mx-auto max-w-[1400px] px-6 py-28 lg:px-10">
        <h2 className="sig-reveal max-w-[16ch] text-[clamp(2rem,4vw,3.4rem)] leading-[1.02] font-semibold tracking-tight">
          Four steps between a dark patch and a name.
        </h2>

        <div className="mt-20 flex flex-col gap-px">
          {CAPABILITIES.map((c, i) => (
            <article
              key={c.id}
              className="sig-reveal border-line grid grid-cols-1 gap-6 border-t py-12 lg:grid-cols-12 lg:gap-10"
            >
              <div className="lg:col-span-2">
                <span className="text-accent font-mono text-[13px] tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="text-faint mt-1 font-mono text-[11px] tracking-[0.18em] uppercase">
                  {c.label}
                </p>
              </div>
              <h3 className="text-[1.6rem] leading-tight font-medium tracking-tight lg:col-span-5">
                {c.title}
              </h3>
              <p className="text-dim max-w-[46ch] leading-relaxed lg:col-span-5">
                {c.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* SCORING - full-bleed image with the term list laid over it */}
      <section id="scoring" className="relative">
        <Halftone
          src={IMAGES.sea}
          alt="Placeholder standing in for open water observed by radar"
          dot={7}
          className="absolute inset-0 h-full w-full"
        />
        <div className="relative mx-auto max-w-[1400px] px-6 py-28 lg:px-10">
          <div className="max-w-[62ch]">
            <h2 className="sig-reveal text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.05] font-semibold tracking-tight">
              Six terms, all of them visible.
            </h2>
            <p className="sig-reveal text-dim mt-5 leading-relaxed">
              The output of this system accuses a ship of an environmental crime.
              A single confidence number would not be good enough, so every score
              breaks apart into the terms that produced it.
            </p>
          </div>

          <ul className="mt-14 grid grid-cols-1 gap-x-12 gap-y-px md:grid-cols-2">
            {SCORE_TERMS.map((t) => (
              <li
                key={t.key}
                className="sig-reveal border-line flex items-baseline gap-5 border-b py-5"
              >
                <span className="text-accent w-12 shrink-0 font-mono text-[13px] tabular-nums">
                  {t.weight.toFixed(2)}
                </span>
                <div>
                  <p className="font-medium">{t.label}</p>
                  <p className="text-dim mt-1 text-sm leading-relaxed">{t.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* LIMITS - two column prose, deliberately plain */}
      <section id="limits" className="mx-auto max-w-[1400px] px-6 py-28 lg:px-10">
        <h2 className="sig-reveal max-w-[18ch] text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.05] font-semibold tracking-tight">
          Where it stops being certain.
        </h2>
        <div className="mt-14 grid grid-cols-1 gap-12 md:grid-cols-3">
          {LIMITS.map((l) => (
            <div key={l.title} className="sig-reveal">
              <div className="bg-accent mb-5 h-px w-10" />
              <h3 className="text-lg leading-snug font-medium">{l.title}</h3>
              <p className="text-dim mt-3 text-sm leading-relaxed">{l.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA + FOOTER */}
      <footer id="brief" className="border-line border-t">
        <div className="mx-auto max-w-[1400px] px-6 py-20 lg:px-10">
          <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
            <h2 className="max-w-[20ch] text-[clamp(1.8rem,3.4vw,2.8rem)] leading-[1.05] font-semibold tracking-tight">
              Bring it to your waters.
            </h2>
            <a
              href="#brief"
              className="bg-accent inline-flex items-center gap-2 px-7 py-4 font-mono text-[13px] tracking-wide transition-transform active:translate-y-px"
              style={{ color: "var(--accent-ink)" }}
            >
              Request access
              <ArrowUpRight size={16} weight="bold" />
            </a>
          </div>
          <p className="text-faint mt-16 font-mono text-[11px]">
            Layout study. Detection figures from Zhao et al. 2025. Imagery is
            placeholder, not radar.
          </p>
        </div>
      </footer>
    </div>
  );
}
