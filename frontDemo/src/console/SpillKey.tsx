/**
 * The case selector, as a key on the console.
 *
 * It used to be a bare `<select>` in the header strip, styled to disappear into
 * the chrome around it. That is the wrong weight for what it does: switching
 * the spill rebuilds every number on screen, and it was the least visible
 * control in the room.
 *
 * So it is a filled key in the console's own accent -- the only filled control
 * in the header -- and it opens a list that says what each case is *for*,
 * because "gom-berthed" is an identifier and not a description. The adversarial
 * case and the null case are both marked, since those are the two a
 * demonstration actually wants to reach.
 */

import { SCENARIOS, type ScenarioId } from "../sim/scenarios";
import { Flag } from "./components";
import { Popover, usePopover } from "./Popover";

export function SpillKey({
  scenario,
  setScenario,
  busy = false,
}: {
  scenario: ScenarioId;
  setScenario: (id: ScenarioId) => void;
  busy?: boolean;
}) {
  const pop = usePopover();
  const current = SCENARIOS.find((s) => s.id === scenario) ?? SCENARIOS[0];

  return (
    <>
      <button
        type="button"
        {...pop.triggerProps}
        title="Change which spill this console is analysing"
        className="flex cursor-pointer items-center gap-2 border px-2 py-[3px] text-[10px] tracking-[0.16em] whitespace-nowrap uppercase transition-[filter]"
        style={{
          borderColor: "var(--accent)",
          background: "var(--accent)",
          color: "var(--accent-ink)",
          filter: pop.open ? "brightness(1.12)" : undefined,
        }}
      >
        <span
          className="text-[8.5px] tracking-[0.2em] opacity-70"
          aria-hidden
        >
          spill
        </span>
        {current.name}
        <span className="text-[8px] leading-none" aria-hidden>
          {pop.open ? "▲" : "▼"}
        </span>
      </button>

      <Popover anchor={pop} width={300} label="Spill">
        <ul role="listbox" aria-label="Spill" className="py-1">
          {SCENARIOS.map((s) => {
            const on = s.id === scenario;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => {
                    setScenario(s.id);
                    pop.close();
                  }}
                  className="w-full cursor-pointer px-2.5 py-1.5 text-left transition-colors"
                  style={{
                    background: on
                      ? "color-mix(in oklab, var(--accent) 14%, transparent)"
                      : "transparent",
                    boxShadow: on ? "inset 2px 0 0 var(--accent)" : undefined,
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="text-[10.5px] tracking-[0.1em] uppercase"
                      style={{ color: on ? "var(--accent)" : "var(--ink)" }}
                    >
                      {s.name}
                    </span>
                    {s.id === "gom-berthed" && <Flag tone="ok">adversarial</Flag>}
                    {s.id === "mumbai-null" && <Flag tone="alarm">null</Flag>}
                  </span>
                  <span
                    className="mt-0.5 block text-[9.5px] leading-[1.5]"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    {s.short}
                  </span>
                </button>
              </li>
            );
          })}
          <li
            className="mt-1 border-t px-2.5 pt-1.5 text-[9px] leading-[1.5]"
            style={{ borderColor: "var(--line)", color: "var(--ink-faint)" }}
          >
            {busy ? "building run…" : "every readout on this console follows this key"}
          </li>
        </ul>
      </Popover>
    </>
  );
}
