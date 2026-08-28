import { animate, createTimeline, onScroll, stagger, text, utils } from "animejs";
import { ArrowRight } from "@phosphor-icons/react";
import { Grain, Halftone } from "../components/Texture";
import { primeReveal, revealOnScroll, useAnimeScope } from "../lib/motion";
import { CAPABILITIES, EVIDENCE, IMAGES, LIMITS, PRODUCT } from "../content";

/**
 * DEEPWATER - atmospheric direction.
 *
 * The quiet one. Very large light type, deep petrol black, enormous vertical
 * space, and iridescence borrowed from the subject itself: oil on water. The
 * magenta accent appears perhaps four times on the whole page, which is what
 * makes it land when it does.
 *
 * Motion is slow and scroll-linked rather than eventful. The one scrubbed
 * animation is the hero image drifting, which is thematically the point.
 */
export default function Deepwater() {
  const root = useAnimeScope(() => {
    const { lines } = text.split(".dw-headline", { lines: true, words: false, chars: false });

    createTimeline({ defaults: { ease: "out(4)" } })
      .add(lines, {
        opacity: [0, 1],
        translateY: [56, 0],
        duration: 1400,
        delay: stagger(160),
      })
      .add(
        ".dw-lede",
        { opacity: [0, 1], translateY: [20, 0], duration: 1000 },
        "-=900",
      )
      .add(
        ".dw-cta",
        { opacity: [0, 1], duration: 900 },
        "-=700",
      );

    // Hero plate drifts as you scroll past it. Scrubbed, not triggered, so it
    // tracks the scrollbar exactly and reads as parallax depth.
    animate(".dw-plate", {
      translateY: ["0%", "-9%"],
      scale: [1.05, 1],
      ease: "linear",
      autoplay: onScroll({ sync: 0.7, enter: "bottom top", leave: "top bottom" }),
    });

    // Iridescent sheen creeps across the plate. Very slow: it should be
    // noticed on the second look, not the first.
    animate(".dw-sheen", {
      backgroundPositionX: ["0%", "220%"],
      duration: 14000,
      ease: "inOut(1)",
      loop: true,
      alternate: true,
    });

    utils.set(".dw-rule", { scaleX: 0 });
    animate(".dw-rule", {
      scaleX: [0, 1],
      duration: 1200,
      ease: "inOut(3)",
      autoplay: onScroll({ enter: "bottom-=100 top", repeat: false }),
    });

    primeReveal(".dw-reveal", 36);
    revealOnScroll(".dw-reveal", { y: 36, delay: 110, duration: 1100 });
  });

  return (
    <div ref={root} className="font-display text-ink relative">
      <Grain opacity={0.15} />

      {/* NAV - minimal, no CTA button; the page is quiet */}
      <header className="absolute top-0 right-0 left-0 z-30">
        <nav className="mx-auto flex h-[76px] max-w-[1320px] items-center justify-between px-6 lg:px-12">
          <span className="text-[15px] font-medium tracking-[0.2em] uppercase">
            {PRODUCT.name}
          </span>
          <div className="text-dim hidden items-center gap-10 font-mono text-[11.5px] tracking-wide md:flex">
            <a href="#work" className="hover:text-ink transition-colors">Method</a>
            <a href="#edges" className="hover:text-ink transition-colors">Edges</a>
            <a href="#contact" className="hover:text-ink transition-colors">Contact</a>
          </div>
        </nav>
      </header>

      {/* HERO - full-bleed plate, type sitting low. Editorial manifesto family. */}
      <section className="relative flex min-h-[100dvh] flex-col justify-end overflow-hidden">
        <div className="absolute inset-0">
          <Halftone
            src={IMAGES.sea}
            alt="Placeholder standing in for open water observed from orbit"
            dot={9}
            className="dw-plate h-[112%] w-full"
            tint="var(--accent)"
          />
          {/* iridescence: oil on water, borrowed literally from the subject */}
          <div
            className="dw-sheen pointer-events-none absolute inset-0 opacity-[0.28] mix-blend-color-dodge"
            style={{
              background:
                "linear-gradient(100deg, transparent 8%, color-mix(in oklab, var(--accent) 55%, transparent) 26%, color-mix(in oklab, #43d9e8 48%, transparent) 44%, transparent 62%)",
              backgroundSize: "220% 100%",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, var(--base) 6%, color-mix(in oklab, var(--base) 55%, transparent) 42%, transparent 78%)",
            }}
          />
        </div>

        <div className="relative mx-auto w-full max-w-[1320px] px-6 pb-20 lg:px-12 lg:pb-28">
          <h1 className="dw-headline max-w-[15ch] text-[clamp(2.8rem,8vw,7rem)] leading-[0.94] font-light tracking-[-0.03em]">
            Oil leaves a trail. So does the ship.
          </h1>
          <div className="mt-10 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <p className="dw-lede text-dim max-w-[46ch] text-lg leading-relaxed">
              {PRODUCT.summary}
            </p>
            <a
              href="#work"
              className="dw-cta group text-ink inline-flex items-center gap-3 font-mono text-[13px] tracking-wide"
            >
              <span className="border-b pb-1" style={{ borderColor: "var(--accent)" }}>
                See the method
              </span>
              <ArrowRight
                size={16}
                className="text-accent transition-transform group-hover:translate-x-1"
              />
            </a>
          </div>
        </div>
      </section>

      {/* STATEMENT - single sentence, enormous space. Nothing else on screen. */}
      <section className="mx-auto max-w-[1320px] px-6 py-40 lg:px-12">
        <p className="dw-reveal max-w-[22ch] text-[clamp(1.8rem,4.4vw,3.6rem)] leading-[1.12] font-light tracking-[-0.02em]">
          Most spills at sea are never traced to anyone. Not because the evidence
          is missing, but because nobody joins it up.
        </p>
        <div
          className="dw-rule mt-20 h-px origin-left"
          style={{ background: "var(--accent)" }}
        />
      </section>

      {/* METHOD - vertical stack of large numbered blocks, generous rhythm */}
      <section id="work" className="mx-auto max-w-[1320px] px-6 pb-32 lg:px-12">
        {CAPABILITIES.map((c, i) => (
          <article
            key={c.id}
            className="dw-reveal grid grid-cols-1 gap-6 py-16 lg:grid-cols-12 lg:gap-12"
          >
            <div className="lg:col-span-3">
              <span className="text-faint font-mono text-[12px] tracking-[0.2em] tabular-nums">
                {String(i + 1).padStart(2, "0")} / {c.label}
              </span>
            </div>
            <h2 className="text-[clamp(1.5rem,2.6vw,2.2rem)] leading-[1.15] font-light tracking-[-0.015em] lg:col-span-5">
              {c.title}
            </h2>
            <p className="text-dim max-w-[42ch] leading-relaxed lg:col-span-4">
              {c.body}
            </p>
          </article>
        ))}
      </section>

      {/* PLATE + FIGURES - image left, figures right, only once on this page */}
      <section className="border-line border-t">
        <div className="mx-auto grid max-w-[1320px] grid-cols-1 gap-14 px-6 py-28 lg:grid-cols-12 lg:px-12">
          <div className="lg:col-span-6">
            <Halftone
              src={IMAGES.vessel}
              alt="Placeholder standing in for a vessel and its wake"
              dot={6}
              className="dw-reveal aspect-[5/4] w-full"
            />
          </div>
          <div className="flex flex-col justify-center gap-12 lg:col-span-5 lg:col-start-8">
            {EVIDENCE.map((e) => (
              <div key={e.unit} className="dw-reveal">
                <p className="text-[2.6rem] leading-none font-light tabular-nums">
                  {e.value}
                </p>
                <p className="text-faint mt-2 font-mono text-[11px] tracking-[0.2em] uppercase">
                  {e.unit}
                </p>
                <p className="text-dim mt-3 max-w-[38ch] text-sm leading-relaxed">
                  {e.note}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* EDGES - prose list, deliberately unadorned */}
      <section id="edges" className="border-line border-t">
        <div className="mx-auto max-w-[1320px] px-6 py-28 lg:px-12">
          <h2 className="dw-reveal mb-16 max-w-[20ch] text-[clamp(1.7rem,3.4vw,2.8rem)] leading-[1.1] font-light tracking-[-0.02em]">
            Where the method runs out.
          </h2>
          <div className="divide-line divide-y">
            {LIMITS.map((l) => (
              <div
                key={l.title}
                className="dw-reveal grid grid-cols-1 gap-4 py-10 md:grid-cols-12 md:gap-10"
              >
                <h3 className="text-[1.15rem] leading-snug font-normal md:col-span-5">
                  {l.title}
                </h3>
                <p className="text-dim max-w-[58ch] leading-relaxed md:col-span-7">
                  {l.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <footer id="contact" className="border-line border-t">
        <div className="mx-auto max-w-[1320px] px-6 py-28 lg:px-12">
          <h2 className="dw-reveal max-w-[16ch] text-[clamp(2rem,5vw,4rem)] leading-[1.02] font-light tracking-[-0.03em]">
            Bring it to your waters.
          </h2>
          <a
            href="#contact"
            className="dw-reveal group mt-10 inline-flex items-center gap-3 rounded-full px-8 py-4 font-mono text-[13px] tracking-wide transition-transform active:translate-y-px"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
          >
            Request access
            <ArrowRight size={16} weight="bold" className="transition-transform group-hover:translate-x-1" />
          </a>
          <p className="text-faint mt-24 font-mono text-[11px]">
            Layout study. Imagery is placeholder, not radar.
          </p>
        </div>
      </footer>
    </div>
  );
}
