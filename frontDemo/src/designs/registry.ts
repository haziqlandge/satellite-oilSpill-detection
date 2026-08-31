/**
 * The four shells.
 *
 * This is the only module that knows all four exist. Nothing inside
 * `designs/signal` imports anything from `designs/terminal`, and there is no
 * `designs/shared` -- the moment one appears, the four start converging on it.
 * What they legitimately share lives a level up, in `sim`, `map` and `lib`, and
 * is either science or arithmetic.
 *
 * They are loaded lazily, and that is a design decision rather than a
 * performance one. Four independent products should fail independently: a
 * static import graph means a syntax error anywhere in Dossier takes Signal
 * down with it and the whole application renders as a build overlay. With
 * `lazy` the failure is contained to the direction that caused it, and the
 * reader can still switch away from it. Code-splitting the four bundles is the
 * side benefit -- nobody loads three products they are not looking at.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { DesignKey } from "../design";
import type { RunState } from "../useRun";

export interface ShellProps {
  state: RunState;
}

export const SHELLS: Record<
  DesignKey,
  LazyExoticComponent<ComponentType<ShellProps>>
> = {
  signal: lazy(() => import("./signal/SignalShell")),
  terminal: lazy(() => import("./terminal/TerminalShell")),
  orbit: lazy(() => import("./orbit/OrbitShell")),
  dossier: lazy(() => import("./dossier/DossierShell")),
};
