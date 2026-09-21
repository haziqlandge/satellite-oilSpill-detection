/**
 * The spill control that sits under every figure.
 *
 * The rule this exists to enforce: each figure on the page carries its own
 * case, and changing one must not reach across the page and change another. A
 * single global selector in a header would be less code and would quietly make
 * the whole page one exhibit -- which is exactly the thing the page is not.
 *
 * Two affordances rather than one, because they answer different questions.
 * The arrows are for *comparing*: step to the next case and watch this figure
 * change while everything around it holds still. The list is for *reaching*: it
 * names what each case tests, which the identifiers do not.
 *
 * It is a control under an exhibit, so it is typographic rather than chromed --
 * small caps, an underline and a caret. It carried a "changes this figure only"
 * note and a "building…" state beside it; both were removed. The isolation is
 * something a reader discovers by using the control, and a caption asserting it
 * on every figure was six copies of the same sentence down one page.
 *
 * `center` is for a control sitting directly beneath the figure it governs,
 * where a full-width rule would cut the figure off from its own caption.
 */

import { useEffect, useRef, useState } from "react";
import { SCENARIOS } from "../sim/scenarios";
import type { SpillState } from "../lib/spill";

export function SpillSelect({
  spill,
  label,
  center = false,
}: {
  spill: SpillState;
  /**
   * What this control governs.
   *
   * Optional, and usually omitted. A control sitting directly under the figure
   * it governs does not need to be told what it points at, and the word was
   * competing with the case name beside it -- which is the part a reader
   * actually has to read.
   */
  label?: string;
  /** Centred under a figure rather than ruled off across the block. */
  center?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = spill.listing;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const i = SCENARIOS.findIndex((s) => s.id === spill.scenario);

  return (
    <div
      ref={box}
      className={
        center
          ? "relative inline-flex flex-col items-center"
          : "relative mt-3 border-t pt-2.5"
      }
      style={center ? undefined : { borderColor: "var(--line)" }}
    >
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${center ? "justify-center" : ""}`}
      >
        {label && (
          <span
            className="text-faint font-mono text-[9.5px] tracking-[0.26em] uppercase"
            style={{ minWidth: "5ch" }}
          >
            {label}
          </span>
        )}

        <div className="flex items-center gap-1">
          <Arrow
            dir="prev"
            onClick={spill.prev}
            title={`Previous case (${SCENARIOS[(i - 1 + SCENARIOS.length) % SCENARIOS.length].name})`}
          />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="listbox"
            className="text-ink cursor-pointer border-b px-1 pb-px font-mono text-[11px] tracking-[0.14em] whitespace-nowrap uppercase transition-colors"
            style={{ borderColor: "var(--accent)" }}
          >
            {current.name}
            <span className="text-accent ml-1.5 text-[8px]" aria-hidden>
              {open ? "▲" : "▼"}
            </span>
          </button>
          <Arrow
            dir="next"
            onClick={spill.next}
            title={`Next case (${SCENARIOS[(i + 1) % SCENARIOS.length].name})`}
          />
        </div>

        <span className="text-faint font-mono text-[9.5px] tracking-[0.1em]">
          {i + 1}/{SCENARIOS.length}
        </span>

      </div>

      {open && (
        <ul
          role="listbox"
          aria-label={label ? `${label} case` : "Spill"}
          className={`absolute bottom-[calc(100%+6px)] z-40 w-[320px] border py-1 ${center ? "left-1/2 -translate-x-1/2" : "left-0"}`}
          style={{
            borderColor: "var(--line)",
            background: "var(--base-2)",
            boxShadow:
              "0 10px 34px -12px color-mix(in oklab, #000 80%, transparent)",
          }}
        >
          {SCENARIOS.map((s) => {
            const on = s.id === spill.scenario;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => {
                    spill.setScenario(s.id);
                    setOpen(false);
                  }}
                  className="w-full cursor-pointer px-3 py-2 text-left transition-colors"
                  style={{
                    background: on
                      ? "color-mix(in oklab, var(--accent) 10%, transparent)"
                      : "transparent",
                    boxShadow: on ? "inset 2px 0 0 var(--accent)" : undefined,
                  }}
                >
                  <span
                    className="block font-mono text-[10.5px] tracking-[0.14em] uppercase"
                    style={{ color: on ? "var(--accent)" : "var(--ink)" }}
                  >
                    {s.name}
                  </span>
                  <span className="text-dim mt-0.5 block text-[13px] leading-[1.45]">
                    {s.short}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Arrow({
  dir,
  onClick,
  title,
}: {
  dir: "prev" | "next";
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="text-dim hover:text-accent hover:border-accent cursor-pointer border px-1.5 py-px font-mono text-[11px] leading-[1.3] transition-colors"
      style={{ borderColor: "var(--line)" }}
    >
      {dir === "prev" ? "‹" : "›"}
    </button>
  );
}
