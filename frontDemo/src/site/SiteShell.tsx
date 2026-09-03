/**
 * The home page.
 *
 * One document, five sections, read by scrolling. The masthead links move
 * within it rather than routing away, because this is a piece of writing with
 * figures in it and not an application with screens.
 *
 * The load-bearing detail is that **each data block owns its own scenario**.
 * There is no page-level run and no page-level clock. `Spills`, `Drift`,
 * `Damage` and `Cause` each call `useSpill` for themselves, so the control
 * under one figure moves that figure and nothing else -- and each builds its
 * run only as the reader approaches it, which is what keeps four half-second
 * builds from landing on top of each other at load.
 *
 * `Drift` deliberately takes two sections' worth of the page: the playback and
 * the environment charts under it share one control, because those charts are
 * the forcing that drift ran through.
 */

import { useEffect, useState } from "react";
import { useSpill } from "../lib/spill";
import { revealOnScroll } from "../lib/motion";
import { PROVENANCE } from "../content";
import { REPO_URL } from "../theme";
import { Nav, type NavSection } from "./Nav";
import { Page } from "./components";
import { ShipTrail } from "./ShipTrail";
import { FloatShell } from "../components/FloatShell";
import { PalettePanel } from "../components/PalettePanel";
import { Opening, Spills } from "./sections/Ocean";
import { Drift } from "./sections/Drift";
import { Damage } from "./sections/Damage";
import { Cause } from "./sections/Cause";
import { Method } from "./sections/Method";

const SECTIONS: NavSection[] = [
  { id: "spills", label: "Detection" },
  { id: "drift", label: "Drift" },
  { id: "environment", label: "Environment" },
  { id: "damage", label: "Forecast" },
  { id: "cause", label: "Attribution" },
  { id: "method", label: "Method" },
];

export default function SiteShell() {
  // Four independent blocks. Each opens on a different case on purpose: the
  // page is more honest about the range of what the system handles if the
  // reader meets a moving discharge, a berthed one and a platform without
  // having to go looking for them.
  const spills = useSpill("gom-moving");
  const drift = useSpill("gom-berthed", { syncUrl: true });
  const damage = useSpill("gom-moving");
  const cause = useSpill("gom-berthed");

  const active = useScrollSpy(SECTIONS.map((s) => s.id));

  // The reveal is the browser's own IntersectionObserver, with a sweep for
  // elements a fast scroll jumps clean over and a timed backstop for anything
  // the observer never reaches. Priming an element to `opacity: 0` is a bet
  // that something will set it back, and that bet losing must not produce a
  // blank page.
  useEffect(() => revealOnScroll("[data-reveal]"), []);

  // The one floating window on the home page. It is a tool for looking at the
  // document rather than a part of it, so it starts closed and leaves no trace
  // in the layout until it is asked for.
  const [palette, setPalette] = useState(false);
  const [paletteBox, setPaletteBox] = useState({ x: 0, y: 0, w: 300, h: 430 });

  return (
    <div className="relative min-h-[100dvh]">
      <ShipTrail />
      <Newsprint />
      <Nav
        sections={SECTIONS}
        active={active}
        onPalette={() => {
          // Placed on first open rather than at mount: the viewport size is
          // not knowable while this is rendering on the server or before
          // layout, and a window that opens off-screen has no handle.
          setPaletteBox((b) =>
            b.x || b.y
              ? b
              : {
                  ...b,
                  x: Math.max(16, window.innerWidth - b.w - 32),
                  y: 84,
                },
          );
          setPalette(true);
        }}
      />

      <main>
        <Opening />
        <Spills spill={spills} />
        <Drift spill={drift} />
        <Damage spill={damage} />
        <Cause spill={cause} />
        <Method />
      </main>

      <footer
        className="border-t py-8"
        style={{ borderColor: "var(--line)" }}
      >
        <Page>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <span
              className="text-ink"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                letterSpacing: "-0.03em",
                fontSize: 17,
              }}
            >
              SlickTrace
            </span>
            <span className="text-faint font-mono text-[10px] tracking-[0.2em] uppercase">
              {PROVENANCE.short}
            </span>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="text-faint hover:text-ink ml-auto font-mono text-[10px] tracking-[0.2em] uppercase transition-colors"
            >
              Source
            </a>
          </div>
        </Page>
      </footer>

      {/*
        The colour panel, and the only floating thing on the home page.

        It sits above the grain overlay rather than under it: the grain is
        `mix-blend-soft-light` across the whole viewport, and a window drawn
        beneath it has its swatches quietly desaturated by the very layer the
        panel exists to see past.
      */}
      {palette && (
        <div style={{ position: "relative", zIndex: 50 }}>
          <FloatShell
            title="colour"
            x={paletteBox.x}
            y={paletteBox.y}
            w={paletteBox.w}
            h={paletteBox.h}
            z={50}
            minW={276}
            minH={280}
            onMove={(x, y) => setPaletteBox((b) => ({ ...b, x, y }))}
            onSize={(w, h) => setPaletteBox((b) => ({ ...b, w, h }))}
            onClose={() => setPalette(false)}
          >
            <PalettePanel />
          </FloatShell>
        </div>
      )}
    </div>
  );
}

/**
 * Which section the reader is in.
 *
 * Resolved from the topmost section whose start has passed the masthead rather
 * than from whichever is most visible: on a page whose blocks are several
 * screens tall, "most visible" flickers between two neighbours for the whole
 * length of the boundary between them.
 */
function useScrollSpy(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      let current: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= 90) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids]);

  return active;
}

/**
 * Paper grain.
 *
 * Fixed and pointer-events-none, so it never repaints on scroll. Texture over a
 * scrolling container forces a GPU repaint every frame, which is the usual way
 * a page with grain on it becomes a page that stutters.
 */
function Newsprint() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 mix-blend-soft-light"
      style={{ opacity: 0.15 }}
    >
      <svg className="h-full w-full">
        <filter id="site-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves={3}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#site-grain)" />
      </svg>
    </div>
  );
}
