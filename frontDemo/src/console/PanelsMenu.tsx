/**
 * The panels menu.
 *
 * This is the one control that has to be findable no matter what state the
 * layout is in, because it is the only route back from a closed panel. The
 * first version failed that test: it was a bordered text button the same weight
 * as everything else in the header, and its rows were cramped enough that with
 * several panels closed the way back was genuinely hard to see.
 *
 * So it is now a filled green key, sized and coloured like the spill key beside
 * it -- the two controls that change what the console is showing look like each
 * other and like nothing else.
 *
 * Three behaviours the previous version got wrong:
 *
 *  - the whole row is the toggle. Open and closed are the states an operator
 *    cares about, so that is what clicking a row does, and the switch box shows
 *    which it is at a glance
 *  - toggling never dismisses the menu. Opening four panels should be four
 *    clicks, not four round trips through the button
 *  - it closes only on a click outside it, on `Escape`, or on the button again.
 *    Nothing else takes it away
 */

import { PANELS, type Dock } from "./dock/useDock";
import { Popover, usePopover } from "./Popover";

export function PanelsMenu({ dock }: { dock: Dock }) {
  const pop = usePopover();

  const openCount = PANELS.filter(
    (p) => dock.layout[p.id].kind !== "closed",
  ).length;

  return (
    <>
      <button
        type="button"
        {...pop.triggerProps}
        title="Show, hide and restore panels"
        className="flex cursor-pointer items-center gap-1.5 border px-2 py-[3px] text-[10px] tracking-[0.16em] whitespace-nowrap uppercase transition-[filter]"
        style={{
          borderColor: "var(--accent)",
          background: "var(--accent)",
          color: "var(--accent-ink)",
          filter: pop.open ? "brightness(1.12)" : undefined,
        }}
      >
        panels
        <span className="text-[9px] opacity-70">
          {openCount}/{PANELS.length}
        </span>
        <span className="text-[8px] leading-none" aria-hidden>
          {pop.open ? "▲" : "▼"}
        </span>
      </button>

      <Popover anchor={pop} width={300} align="right" label="Panels">
        <div>
          <p
            className="px-2.5 py-1.5 text-[9px] tracking-[0.26em] uppercase"
            style={{ background: "var(--group)", color: "var(--group-ink)" }}
          >
            panels · click to open or close
          </p>

          <ul className="py-1">
            {PANELS.map((p) => {
              const place = dock.layout[p.id];
              const isOpen = place.kind !== "closed";
              return (
                <li key={p.id} className="flex items-stretch">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isOpen}
                    onClick={() =>
                      isOpen ? dock.close(p.id) : dock.reopen(p.id)
                    }
                    className="flex flex-1 cursor-pointer items-baseline gap-2 px-2.5 py-[6px] text-left transition-colors"
                    style={{ color: isOpen ? "var(--ink)" : "var(--ink-faint)" }}
                  >
                    <span
                      className="num shrink-0 text-[11px]"
                      style={{
                        color: isOpen ? "var(--accent)" : "var(--ink-faint)",
                      }}
                    >
                      [{isOpen ? "x" : " "}]
                    </span>
                    <span className="num shrink-0 text-[9px] opacity-70">
                      {p.index}
                    </span>
                    <span className="flex-1 truncate text-[10.5px] tracking-[0.1em] uppercase">
                      {p.title}
                    </span>
                  </button>

                  {/* Float and dock stay available but secondary: they change
                      where a panel is, not whether it exists, and conflating
                      the two is what made the previous menu hard to read. */}
                  {isOpen && (
                    <button
                      type="button"
                      onClick={() =>
                        place.kind === "float"
                          ? dock.dock(p.id)
                          : dock.float(p.id)
                      }
                      title={
                        place.kind === "float"
                          ? `Send ${p.title} back to its dock`
                          : `Undock ${p.title} into a window`
                      }
                      className="my-[3px] mr-2 shrink-0 cursor-pointer border px-1.5 text-[8.5px] tracking-[0.14em] uppercase transition-colors"
                      style={{
                        borderColor: "var(--line)",
                        color: "var(--ink-dim)",
                      }}
                    >
                      {place.kind === "float" ? "dock" : "float"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <div
            className="flex items-stretch border-t"
            style={{ borderColor: "var(--line)" }}
          >
            <button
              type="button"
              onClick={() => PANELS.forEach((p) => dock.reopen(p.id))}
              disabled={openCount === PANELS.length}
              className="flex-1 cursor-pointer px-2.5 py-1.5 text-left text-[9.5px] tracking-[0.18em] uppercase transition-colors disabled:opacity-40"
              style={{ color: "var(--ink-dim)" }}
            >
              open all
            </button>
            <button
              type="button"
              onClick={() => dock.reset()}
              disabled={!dock.dirty}
              className="cursor-pointer border-l px-2.5 py-1.5 text-[9.5px] tracking-[0.18em] uppercase transition-colors disabled:opacity-40"
              style={{ borderColor: "var(--line)", color: "var(--warn)" }}
            >
              reset layout
            </button>
          </div>
        </div>
      </Popover>
    </>
  );
}
