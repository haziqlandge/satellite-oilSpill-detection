/**
 * How the thing actually works, and where it stops.
 *
 * The closing section, and the only one with no figure and no spill control:
 * none of it is about a particular case. It is the method, the comparison
 * against what already exists, and the provenance statement.
 *
 * The comparison table is the argument of the whole project in six rows. The
 * column that matters is the drift one -- no system in the reviewed literature
 * conditions AIS attribution on a physical backward-drift field, and that gap
 * is what this exists to close.
 */

import { COMPARISON, METHOD, PROVENANCE, PUBLISHED, SIMULATED, STAGES } from "../../content";
import {
  Body,
  Head,
  Ledger,
  Margin,
  Measure,
  Note,
  Page,
  SectionMark,
  Spread,
  Tag,
} from "../components";
import { ConsoleKey } from "../Nav";
import { StageChain } from "../scenery";

export function Method() {
  return (
    <section id="method" className="scroll-mt-[70px] py-14">
      <Page>
        <SectionMark
          index={5}
          kicker="Method"
          title="How it is trained, and how it decides"
        />

        {/* --- the pipeline ------------------------------------------ */}
        <div className="mt-8 max-w-[62ch]">
          <Body>
            Six stages, each of which hands the next one something it can check.
            Nothing in the chain is a black box that emits a name.
          </Body>
        </div>

        <ol className="mt-8 grid grid-cols-1 gap-x-10 gap-y-7 md:grid-cols-2 xl:grid-cols-3">
          {STAGES.map((s, i) => (
            <li key={s.key}>
              <div className="flex items-baseline gap-2.5">
                <span className="text-accent font-mono text-[11px]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3
                  className="text-ink text-[17px]"
                  style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
                >
                  {s.name}
                </h3>
                <span className="text-faint ml-auto font-mono text-[9.5px] tracking-[0.14em]">
                  {s.proc}
                </span>
              </div>
              <Body className="mt-2" size="small">
                {s.body}
              </Body>
            </li>
          ))}
        </ol>

        {/* --- training ---------------------------------------------- */}
        <div
          className="mt-14 border-t pt-10"
          style={{ borderColor: "var(--line)" }}
        >
          <Spread>
            <Measure>
              <Head level={3}>Training the detector</Head>
              <div className="mt-5 space-y-6">
                {METHOD.map((m) => (
                  <div key={m.key}>
                    <h4 className="text-ink text-[15px]">{m.title}</h4>
                    <Body className="mt-1.5" size="small">
                      {m.body}
                    </Body>
                  </div>
                ))}
              </div>
            </Measure>
            <Margin>
              <Note label="Look-alikes are the whole problem">
                A dark patch is not oil-specific. Low wind, biogenic films, sea
                ice and ship wakes all flatten the surface the same way, and a
                ship wake is the most dangerous of them — it is dark, linear and
                sits directly behind a vessel, so mistaking one accuses the ship
                that made it.
              </Note>
              {/* The stages listed above the fold, drawn as the chain they
                  are. Same source, so the two cannot disagree. */}
              <StageChain />
            </Margin>
          </Spread>
        </div>

        {/* --- against the prior art --------------------------------- */}
        <div
          className="mt-14 border-t pt-10"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="max-w-[62ch]">
              <Head level={3}>What is new here</Head>
              <Body className="mt-3">
                Detection from radar is well established and vessel correlation
                has been done before. What has not been done is conditioning the
                traffic filter on a physical backward-drift field: the closest
                published work names reverse-trajectory simulation as future
                work, and the operational reference system substitutes slick
                geometry as a proxy for it.
              </Body>
          </div>

          <div className="mt-6 overflow-x-auto">
            <Ledger
              head={["System", "Detection", "Backward drift", "AIS", "Explainable"]}
              rows={COMPARISON.map((c) => [
                c.ours ? (
                  <span className="text-accent">{c.system}</span>
                ) : (
                  c.system
                ),
                c.detect,
                c.drift,
                c.ais,
                c.explain,
              ])}
            />
          </div>
        </div>

        {/* --- provenance -------------------------------------------- */}
        {/* `data-ship-end` is where the gutter tanker moors. The provenance
            block is the end of the argument, and it is the right place for the
            page's one ornament to stop. */}
        <div
          data-ship-end
          className="mt-14 border-t pt-10"
          style={{ borderColor: "var(--line)" }}
        >
          {/* The flag sits with the heading it qualifies. It used to be alone
              in the margin column, where it read as a label that had come
              adrift from whatever it was labelling. */}
          <div className="max-w-[62ch]">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <Head level={3}>What is real on this page</Head>
              <Tag tone="accent">{PROVENANCE.flag}</Tag>
            </div>
            <Body className="mt-3" size="small">
              {PROVENANCE.full}
            </Body>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
            <div>
              <p className="text-faint font-mono text-[9.5px] tracking-[0.24em] uppercase">
                Taken from published work
              </p>
              <ul className="mt-3 space-y-2">
                {PUBLISHED.map((p, i) => (
                  <li
                    key={i}
                    className="text-dim border-l pl-3 text-[13.5px] leading-[1.55]"
                    style={{ borderColor: "var(--accent)" }}
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-faint font-mono text-[9.5px] tracking-[0.24em] uppercase">
                Generated by the simulation
              </p>
              <ul className="mt-3 space-y-2">
                {SIMULATED.map((p, i) => (
                  <li
                    key={i}
                    className="text-dim border-l pl-3 text-[13.5px] leading-[1.55]"
                    style={{ borderColor: "var(--line)" }}
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* --- out ---------------------------------------------------- */}
        <div
          className="mt-14 flex flex-wrap items-center gap-5 border-t pt-10"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="min-w-0 flex-1">
            <Head level={3}>Work the case yourself</Head>
            <Body className="mt-2" size="small">
              The console is the same engine with the reading removed: every
              pane, the layer switches, the timeline and the score decomposition
              in one workspace you can rearrange.
            </Body>
          </div>
          <ConsoleKey large />
        </div>
      </Page>
    </section>
  );
}
