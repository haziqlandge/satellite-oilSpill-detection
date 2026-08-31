/**
 * Application root.
 *
 * Four products, one scientific engine. This file is the seam between them and
 * it is deliberately almost empty: it owns which direction is active, it runs
 * the scenario state once so switching direction cannot lose the case you were
 * reading, and it hands both to whichever shell is mounted.
 *
 * Everything else -- navigation, routing, page composition, components,
 * typography, motion -- belongs to the shell. There is no shared header, no
 * shared page wrapper and no shared layout, because a shared wrapper is how
 * four products become one product with four palettes.
 */

import { Component, Suspense, useState, type ReactNode } from "react";
import { DesignSwitcher } from "./components/DesignSwitcher";
import { DesignProvider } from "./DesignContext";
import {
  designFor,
  readStoredDesign,
  writeStoredDesign,
  type DesignKey,
} from "./design";
import { SHELLS } from "./designs/registry";
import { useRun } from "./useRun";

export default function App() {
  const [design, setDesignRaw] = useState<DesignKey>(readStoredDesign);
  const state = useRun();

  const setDesign = (key: DesignKey) => {
    setDesignRaw(key);
    writeStoredDesign(key);
    // Each shell has its own vocabulary of sections and its own idea of where
    // the top of the document is. Landing at the previous shell's scroll offset
    // inside a different composition is disorienting.
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };

  const def = designFor(design);
  const Shell = SHELLS[design];

  return (
    <DesignProvider design={design}>
      <div
        data-design={design}
        className="bg-base text-ink min-h-[100dvh]"
        style={
          {
            "--font-display": def.fonts.display,
            "--font-body": def.fonts.body,
            "--font-mono": def.fonts.mono,
            fontFamily: def.fonts.body,
          } as React.CSSProperties
        }
      >
        {/* Keyed on the direction: switching mounts a different product, and
            unmounting is what reverts the outgoing one's anime.js scopes. The
            boundary and the fallback are both keyed too, so a direction that
            failed once does not stay failed after the reader switches away and
            back, and so a recovered chunk is not held behind a stale error. */}
        <DesignBoundary key={design} name={def.name}>
          <Suspense fallback={<Loading name={def.name} />}>
            <Shell state={state} />
          </Suspense>
        </DesignBoundary>
      </div>

      <DesignSwitcher active={design} onSelect={setDesign} />
    </DesignProvider>
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
 * Contains one direction's failure to that direction.
 *
 * Four independent products should fail independently. Without this, an error
 * thrown anywhere inside one shell unmounts the whole tree, the switcher goes
 * with it, and the only way back is a reload -- which lands on the same broken
 * direction, because the choice is persisted.
 */
class DesignBoundary extends Component<
  { name: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[design]", error);
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
          <p className="text-faint mt-4 text-[13px] leading-relaxed">
            The other three directions are unaffected. Pick one from the control
            on the right edge.
          </p>
        </div>
      </div>
    );
  }
}
