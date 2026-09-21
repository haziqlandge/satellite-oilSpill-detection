/**
 * Application root.
 *
 * Two surfaces, one engine. This file is the seam between them and it is
 * deliberately almost empty: it resolves which surface the hash asks for, sets
 * the surface's tokens and fonts on the root element, and mounts it.
 *
 * The previous version of this file owned a four-way design switcher and the
 * scenario state for the whole application. Both are gone. The switcher went
 * because there is one product now; the shared scenario went because the home
 * page shows four different cases at once and each block owns its own.
 *
 * The two shells are lazy, and that is an isolation decision before it is a
 * performance one. An error thrown inside the console must not take the home
 * page down with it, and vice versa -- with `lazy` plus a boundary, the reader
 * can always get back to the other surface.
 */

import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { readHash } from "./lib/hash";
import { PaletteProvider, tokenStyle, usePalette } from "./lib/palette";
import { SURFACES, type SurfaceDef, type SurfaceKey } from "./theme";

const SiteShell = lazy(() => import("./site/SiteShell"));
const ConsoleShell = lazy(() => import("./console/ConsoleShell"));

/**
 * Which surface the hash asks for.
 *
 * Only the first path segment decides. `#/console` and `#/console/evidence`
 * are both the console; everything else, including the bare `#/` and the
 * in-page anchors the home page uses for its sections, is the home page.
 */
function surfaceFromHash(): SurfaceKey {
  return readHash().section.split("/")[0] === "console" ? "console" : "site";
}

export default function App() {
  const [surface, setSurface] = useState<SurfaceKey>(surfaceFromHash);

  useEffect(() => {
    const onHash = () => {
      const next = surfaceFromHash();
      setSurface((prev) => {
        // Crossing between surfaces lands at the top. They have different
        // compositions and different ideas of where the top of the document is,
        // and arriving at the previous surface's scroll offset inside the other
        // one is disorienting. An in-page anchor within the home page is not a
        // surface change and must keep its scroll.
        if (next !== prev) {
          window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
        }
        return next;
      });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const def = SURFACES[surface];
  const Shell = surface === "console" ? ConsoleShell : SiteShell;

  // The colour overlay is keyed on the surface for the same reason the boundary
  // is: the two surfaces have different token ladders and different map paint,
  // and a palette dialled in on one is meaningless on the other.
  return (
    <PaletteProvider key={surface} surface={surface}>
      <SurfaceRoot surface={surface} def={def} shell={Shell} />
    </PaletteProvider>
  );
}

/**
 * The element every token hangs off.
 *
 * It carries `data-surface`, which is what `index.css` re-points the token
 * ladder under, the surface's font stack, and -- last, so it wins -- whatever
 * the colour panel has overridden. Inline custom properties beat a selector, so
 * a token set here reaches every descendant that reads `var(--…)`, which is
 * every figure, rule and label on the surface.
 */
function SurfaceRoot({
  surface,
  def,
  shell: Shell,
}: {
  surface: SurfaceKey;
  def: SurfaceDef;
  shell: React.ComponentType;
}) {
  const palette = usePalette();

  return (
    <div
      data-surface={surface}
      className="bg-base text-ink min-h-[100dvh]"
      style={
        {
          "--font-display": def.fonts.display,
          "--font-body": def.fonts.body,
          "--font-mono": def.fonts.mono,
          fontFamily: def.fonts.body,
          ...tokenStyle(palette.tokens),
        } as React.CSSProperties
      }
    >
      {/* Keyed on the surface: crossing between them mounts a different
          product, and unmounting is what reverts the outgoing one's anime.js
          scopes. The boundary and the fallback are keyed too, so a surface that
          failed once does not stay failed after the reader leaves and returns. */}
      <SurfaceBoundary key={surface} name={def.name}>
        <Suspense fallback={<Loading name={def.name} />}>
          <Shell />
        </Suspense>
      </SurfaceBoundary>
    </div>
  );
}

function Loading({ name }: { name: string }) {
  return (
    <div className="flex min-h-[100dvh] items-center px-8">
      <p className="text-faint font-mono text-[11px] tracking-[0.24em] uppercase">
        Loading {name}
      </p>
    </div>
  );
}

/**
 * Contains one surface's failure to that surface.
 *
 * Without this, an error thrown anywhere inside the console unmounts the whole
 * tree and the only way back is a reload -- which lands on the same broken
 * surface, because the hash still says `#/console`.
 */
class SurfaceBoundary extends Component<
  { name: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[surface]", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[100dvh] items-center px-8">
        <div className="max-w-[52ch]">
          <p className="text-accent font-mono text-[11px] tracking-[0.24em] uppercase">
            {this.props.name} failed to load
          </p>
          <p className="text-dim mt-4 text-[14px] leading-relaxed">
            {this.state.error.message}
          </p>
          <a
            href="#/"
            className="text-faint hover:text-ink mt-5 inline-block font-mono text-[11px] tracking-[0.2em] uppercase transition-colors"
          >
            ← Back to the home page
          </a>
        </div>
      </div>
    );
  }
}
