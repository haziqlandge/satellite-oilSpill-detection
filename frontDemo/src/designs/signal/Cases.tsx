/**
 * The index of open cases.
 *
 * A publication's contents page, not a scenario dropdown. The case currently
 * being investigated leads the page at full width; the rest are ruled entries
 * beneath it. Choosing one changes the scenario the whole application is
 * running and returns the reader to the investigation, which is the only place
 * in Signal where a control changes state.
 */

import {
  revealOnScroll,
  useAnimeScope,
} from "../../lib/motion";
import { dateline } from "../../lib/format";
import { SCENARIOS, scenarioListing } from "../../sim/scenarios";
import type { RunState } from "../../useRun";
import { BackwardPlate } from "./figures";
import {
  Body,
  Gutter,
  Head,
  Kicker,
  Margin,
  Measure,
  Note,
  Page,
  SectionMark,
  Spread,
  Tag,
} from "./components";

export default function Cases({
  state,
  onOpen,
}: {
  state: RunState;
  onOpen: () => void;
}) {
  const { run } = state;
  const current = scenarioListing(state.scenario);
  const others = SCENARIOS.filter((s) => s.id !== state.scenario);

  const root = useAnimeScope(() => {
    return revealOnScroll(".case-reveal", { y: 24, delay: 80 });
  }, [state.scenario]);

  const open = (id: typeof state.scenario) => {
    state.setScenario(id);
    onOpen();
  };

  return (
    <div ref={root}>
      <Page>
        <section className="pt-14 pb-12 lg:pt-20">
          <Kicker>Open cases</Kicker>
          <Head level={1} className="mt-5 max-w-[17ch]">
            Five scenes. Five different things to get wrong.
          </Head>
        </section>

        {/* The lead case, at full width. */}
        <article
          className="border-y py-10"
          style={{ borderColor: "var(--ink-faint)" }}
        >
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div>
              <div className="flex items-center gap-4">
                <Tag tone="accent">Currently open</Tag>
                <span className="text-faint font-mono text-[10px] tracking-[0.2em] uppercase">
                  {run ? dateline(run.meta.acquiredAt) : ""}
                </span>
              </div>
              <Head level={2} className="mt-5">
                {current.name}
              </Head>
              <Body className="mt-5">{run?.meta.summary ?? current.short}</Body>
              <Body size="small" className="mt-4">
                <span className="text-accent">What it tests. </span>
                {current.tests}
              </Body>
              <p className="text-faint mt-6 font-mono text-[10px] tracking-[0.2em] uppercase">
                {current.region === "gulf-of-mexico"
                  ? "Gulf of Mexico · published ground truth"
                  : "Indian waters · authored ground truth"}
              </p>
            </div>

            <figure className="case-reveal">
              {run && <BackwardPlate run={run} />}
              <figcaption
                className="text-faint mt-3 border-t pt-2.5 font-mono text-[10px] tracking-[0.14em] uppercase"
                style={{ borderColor: "var(--line)" }}
              >
                Origin field, this case
              </figcaption>
            </figure>
          </div>
        </article>
      </Page>

      <Page>
        <div className="pt-16">
          <SectionMark index={1} kicker="Also in the file" title="The other four" />
        </div>

        <Spread className="pb-20">
          <Gutter />
          <Measure className="lg:col-span-2 lg:col-start-2">
            <div className="flex flex-col">
              {others.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => open(s.id)}
                  className="case-reveal group grid grid-cols-1 gap-x-8 gap-y-2 border-t py-7 text-left transition-colors sm:grid-cols-[3rem_minmax(0,22ch)_minmax(0,1fr)]"
                  style={{ borderColor: "var(--line)" }}
                >
                  <span className="num text-faint text-[13px]">
                    {String(i + 2).padStart(2, "0")}
                  </span>
                  <span>
                    <span
                      className="text-ink group-hover:text-accent block text-[19px] leading-tight transition-colors"
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {s.name}
                    </span>
                    <span className="text-faint mt-1.5 block font-mono text-[9.5px] tracking-[0.18em] uppercase">
                      {s.region === "gulf-of-mexico"
                        ? "Gulf of Mexico"
                        : "Indian waters"}
                    </span>
                  </span>
                  <span>
                    <span
                      className="text-dim block text-[15px] leading-[1.55]"
                      style={{ fontFamily: "var(--font-body)" }}
                    >
                      {s.short}
                    </span>
                    <span
                      className="text-faint mt-2 block text-[13.5px] leading-[1.5]"
                      style={{ fontFamily: "var(--font-body)" }}
                    >
                      {s.tests}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </Measure>
        </Spread>
      </Page>

      <Page>
        <Spread className="pb-24">
          <Gutter />
          <Measure>
            <Note label="Why five">
              Three are shaped on published Port of South Louisiana cases whose
              ground truth is peer-reviewed and coincides with free real AIS,
              which is the entire reason this project works two regions at once.
              Two are Indian-waters scenarios with authored ground truth, because
              free real AIS covers United States waters only. The look-alike case
              exists so the system has to name nobody: a pipeline that always
              produces a suspect is useless.
            </Note>
          </Measure>
          <Margin />
        </Spread>
      </Page>
    </div>
  );
}
