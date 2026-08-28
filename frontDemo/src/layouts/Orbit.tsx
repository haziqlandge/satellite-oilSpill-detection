import { animate, createTimeline, stagger, svg, utils } from "animejs";
import { Broadcast, Path, Target } from "@phosphor-icons/react";
import { Grain, Halftone, ScopeRings } from "../components/Texture";
import { primeReveal, revealOnScroll, useAnimeScope } from "../lib/motion";
import {
  CANDIDATES,
  CAPABILITIES,
  EVIDENCE,
  IMAGES,
  LIMITS,
  PRODUCT,
} from "../content";

/**
 * ORBIT - mission control direction.
 *
 * Instrumentation language: a radar scope anchors the hero, panels are soft
 * rounded surfaces, ice cyan on deep navy. The scope's rings stroke-draw on
 * load and a sweep line rotates, which is motivated: it is the one element
 * that has to read as "actively looking" rather than decorative.
 */
export default function Orbit() {
  const root = useAnimeScope(() => {
    const tl = createTimeline({ defaults: { ease: "out(3)" } });

    tl.add(".orb-eyebrow", { opacity: [0, 1], translateY: [8, 0], duration: 500 })
      .add(
        ".orb-headline",
        { opacity: [0, 1], translateY: [26, 0], duration: 900 },
        "-=260",
      )
      .add(
        ".orb-lede",
        { opacity: [0, 1], translateY: [16, 0], duration: 700 },
        "-=620",
      )
      .add(
        ".orb-cta",
        { opacity: [0, 1], translateY: [12, 0], duration: 600, delay: stagger(90) },
        "-=480",
      );

    // Rings draw themselves in. createDrawable is anime v4's line-drawing path.
    const rings = svg.createDrawable(".scope-ring");
    utils.set(rings, { draw: "0 0" });
    animate(rings, {
      draw: "0 1",
      duration: 1500,
      delay: stagger(130),
      ease: "inOut(3)",
    });

    // Sweep. Slow, continuous, and the only infinite loop on the page.
    animate(".orb-sweep", {
      rotate: [0, 360],
      duration: 9000,
      ease: "linear",
      loop: true,
    });

    // Contact blips fade up as the sweep passes, staggered to feel acquired.
    animate(".orb-blip", {
      opacity: [0.15, 1],
      scale: [0.7, 1],
      duration: 1400,
      delay: stagger(420),
      ease: "inOut(2)",
      loop: true,
      alternate: true,
    });

    primeReveal(".orb-reveal", 28);
    revealOnScroll(".orb-reveal");
  });

  return (
    <div ref={root} className="font-tech text-ink relative">
      <Grain opacity={0.13} />

      {/* NAV */}
      <header className="border-line bg-base/80 sticky top-0 z-30 border-b backdrop-blur-xl">
        <nav className="mx-auto flex h-[72px] max-w-[1360px] items-center justify-between px-6 lg:px-10">
          <div className="flex items-center gap-2.5">
            <Target size={22} weight="duotone" className="text-accent" />
            <span className="text-[15px] font-semibold tracking-[0.14em] uppercase">
              {PRODUCT.name}
            </span>
          </div>
          <div className="text-dim hidden items-center gap-8 font-mono text-[12px] md:flex">
            <a href="#stages" className="hover:text-accent transition-colors">Stages</a>
            <a href="#track" className="hover:text-accent transition-colors">Tracking</a>
            <a href="#bounds" className="hover:text-accent transition-colors">Bounds</a>
          </div>
          <a
            href="#access"
            className="bg-accent rad px-5 py-2.5 font-mono text-[12px] font-medium transition-transform active:scale-[0.98]"
            style={{ color: "var(--accent-ink)" }}
          >
            Request access
          </a>
        </nav>
      </header>

      {/* HERO - scope on the left, message on the right (reverse of Signal) */}
      <section className="mx-auto grid min-h-[calc(100dvh-72px)] max-w-[1360px] grid-cols-1 items-center gap-14 px-6 py-16 lg:grid-cols-12 lg:px-10">
        <div className="relative order-2 lg:order-1 lg:col-span-5">
          <div className="relative mx-auto aspect-square w-full max-w-[440px]">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--accent) 12%, transparent), transparent 68%)",
              }}
            />
            <ScopeRings className="text-accent absolute inset-0 h-full w-full" />

            {/* sweep */}
            <div className="orb-sweep absolute inset-0 origin-center">
              <div
                className="absolute top-1/2 left-1/2 h-px w-1/2 origin-left"
                style={{
                  background:
                    "linear-gradient(to right, color-mix(in oklab, var(--accent) 90%, transparent), transparent)",
                }}
              />
            </div>

            {/* contacts */}
            {[
              { top: "34%", left: "58%" },
              { top: "62%", left: "40%" },
              { top: "47%", left: "70%" },
            ].map((pos) => (
              <span
                key={`${pos.top}-${pos.left}`}
                className="orb-blip bg-accent absolute h-2 w-2 rounded-full"
                style={{ ...pos, boxShadow: "0 0 0 4px color-mix(in oklab, var(--accent) 22%, transparent)" }}
              />
            ))}
          </div>
        </div>

        <div className="order-1 lg:order-2 lg:col-span-7">
          <p className="orb-eyebrow text-accent mb-5 font-mono text-[11px] tracking-[0.3em] uppercase">
            Wide-area maritime surveillance
          </p>
          <h1 className="orb-headline text-[clamp(2.4rem,5.6vw,4.6rem)] leading-[1.02] font-bold tracking-tight">
            Every pass is 250 kilometres of ocean, checked.
          </h1>
          <p className="orb-lede text-dim mt-6 max-w-[54ch] text-lg leading-relaxed">
            {PRODUCT.summary}
          </p>
          <div className="mt-9 flex flex-wrap gap-4">
            <a
              href="#stages"
              className="orb-cta bg-accent rad inline-flex items-center gap-2 px-6 py-3.5 font-mono text-[13px] font-medium transition-transform active:translate-y-px"
              style={{ color: "var(--accent-ink)" }}
            >
              <Path size={16} weight="bold" />
              See the method
            </a>
            <a
              href="#bounds"
              className="orb-cta border-line rad hover:border-accent inline-flex items-center border px-6 py-3.5 font-mono text-[13px] transition-colors"
            >
              What it cannot do
            </a>
          </div>
        </div>
      </section>

      {/* STAGES - bento with genuine variation: 4 items, 4 cells, mixed sizes */}
      <section id="stages" className="mx-auto max-w-[1360px] px-6 py-24 lg:px-10">
        <h2 className="orb-reveal max-w-[18ch] text-[clamp(1.9rem,3.8vw,3.1rem)] leading-[1.06] font-bold tracking-tight">
          Four stages, running unattended.
        </h2>

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-6">
          {/* wide cell with imagery */}
          <article className="orb-reveal rad border-line relative overflow-hidden border md:col-span-4 md:row-span-2">
            <Halftone
              src={IMAGES.slickWide}
              alt="Placeholder standing in for a wide radar swath"
              dot={6}
              className="absolute inset-0 h-full w-full opacity-45"
            />
            <div className="relative p-8 lg:p-10">
              <p className="text-accent font-mono text-[11px] tracking-[0.2em] uppercase">
                {CAPABILITIES[0].label}
              </p>
              <h3 className="mt-4 max-w-[18ch] text-[1.75rem] leading-tight font-semibold">
                {CAPABILITIES[0].title}
              </h3>
              <p className="text-dim mt-4 max-w-[44ch] leading-relaxed">
                {CAPABILITIES[0].body}
              </p>
            </div>
          </article>

          {/* two stacked narrow cells */}
          {CAPABILITIES.slice(1, 3).map((c) => (
            <article
              key={c.id}
              className="orb-reveal rad border-line bg-base-2 border p-7 md:col-span-2"
            >
              <p className="text-accent font-mono text-[11px] tracking-[0.2em] uppercase">
                {c.label}
              </p>
              <h3 className="mt-3 text-[1.2rem] leading-snug font-semibold">
                {c.title}
              </h3>
              <p className="text-dim mt-3 text-sm leading-relaxed">{c.body}</p>
            </article>
          ))}

          {/* full width closer, tinted rather than plain */}
          <article
            className="orb-reveal rad border-line border p-8 md:col-span-6"
            style={{
              background:
                "linear-gradient(120deg, color-mix(in oklab, var(--accent) 9%, var(--base-2)), var(--base-2) 60%)",
            }}
          >
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-accent font-mono text-[11px] tracking-[0.2em] uppercase">
                  {CAPABILITIES[3].label}
                </p>
                <h3 className="mt-3 text-[1.4rem] leading-snug font-semibold">
                  {CAPABILITIES[3].title}
                </h3>
              </div>
              <p className="text-dim max-w-[52ch] leading-relaxed">
                {CAPABILITIES[3].body}
              </p>
            </div>
          </article>
        </div>
      </section>

      {/* TRACKING - readout panel, ranked contacts as instrument rows */}
      <section id="track" className="border-line border-y" style={{ background: "var(--base-2)" }}>
        <div className="mx-auto max-w-[1360px] px-6 py-24 lg:px-10">
          <div className="flex items-center gap-3">
            <Broadcast size={20} weight="duotone" className="text-accent" />
            <p className="font-mono text-[11px] tracking-[0.24em] uppercase">
              Contact ranking
            </p>
          </div>

          <div className="mt-10 space-y-3">
            {CANDIDATES.map((c) => (
              <div
                key={c.rank}
                className="orb-reveal rad border-line flex flex-col gap-4 border px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
                style={{
                  background: c.rank === 1 ? "color-mix(in oklab, var(--accent) 8%, transparent)" : "transparent",
                  borderColor: c.rank === 1 ? "color-mix(in oklab, var(--accent) 40%, var(--line))" : "var(--line)",
                }}
              >
                <div className="flex items-center gap-5">
                  <span className="text-faint font-mono text-[13px] tabular-nums">
                    {String(c.rank).padStart(2, "0")}
                  </span>
                  <div>
                    <p className="font-mono text-[14px]">{c.id}</p>
                    <p className="text-dim mt-0.5 text-[13px]">{c.kind}</p>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <span className="text-dim text-[13px]">{c.verdict}</span>
                  <span
                    className="font-mono text-[1.4rem] tabular-nums"
                    style={{ color: c.rank === 1 ? "var(--accent)" : "var(--ink-dim)" }}
                  >
                    {c.score.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-faint mt-8 max-w-[64ch] font-mono text-[11.5px] leading-relaxed">
            Illustrative values. Identities masked. Contacts without a transponder
            are ranked but never named.
          </p>
        </div>
      </section>

      {/* NUMBERS - inline stat row, different family again */}
      <section className="mx-auto max-w-[1360px] px-6 py-20 lg:px-10">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-3">
          {EVIDENCE.map((e) => (
            <div key={e.unit} className="orb-reveal">
              <p className="text-accent font-mono text-[2.4rem] leading-none tabular-nums">
                {e.value}
              </p>
              <p className="mt-2 font-mono text-[11px] tracking-[0.18em] uppercase">
                {e.unit}
              </p>
              <p className="text-dim mt-3 max-w-[36ch] text-sm leading-relaxed">
                {e.note}
              </p>
              <p className="text-faint mt-2 font-mono text-[10.5px]">{e.source}</p>
            </div>
          ))}
        </div>
      </section>

      {/* BOUNDS */}
      <section id="bounds" className="border-line border-t">
        <div className="mx-auto max-w-[1360px] px-6 py-24 lg:px-10">
          <h2 className="orb-reveal max-w-[20ch] text-[clamp(1.8rem,3.4vw,2.8rem)] leading-[1.06] font-bold tracking-tight">
            The bounds we publish alongside the answer.
          </h2>
          <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
            {LIMITS.map((l) => (
              <div key={l.title} className="orb-reveal rad border-line border p-7">
                <h3 className="text-[1.05rem] leading-snug font-semibold">{l.title}</h3>
                <p className="text-dim mt-3 text-sm leading-relaxed">{l.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer id="access" className="border-line border-t">
        <div className="mx-auto flex max-w-[1360px] flex-col items-start justify-between gap-8 px-6 py-16 md:flex-row md:items-center lg:px-10">
          <h2 className="max-w-[22ch] text-[clamp(1.6rem,3vw,2.4rem)] leading-tight font-bold tracking-tight">
            Bring it to your waters.
          </h2>
          <a
            href="#access"
            className="bg-accent rad px-7 py-4 font-mono text-[13px] font-medium transition-transform active:translate-y-px"
            style={{ color: "var(--accent-ink)" }}
          >
            Request access
          </a>
        </div>
        <p className="text-faint mx-auto max-w-[1360px] px-6 pb-12 font-mono text-[11px] lg:px-10">
          Layout study. Imagery is placeholder, not radar.
        </p>
      </footer>
    </div>
  );
}
