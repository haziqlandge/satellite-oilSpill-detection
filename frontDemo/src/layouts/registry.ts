import type { ComponentType } from "react";
import Signal from "./Signal";
import Terminal from "./Terminal";
import Orbit from "./Orbit";
import Dossier from "./Dossier";
import Deepwater from "./Deepwater";

export type LayoutKey =
  | "signal"
  | "terminal"
  | "orbit"
  | "dossier"
  | "deepwater";

export interface LayoutDef {
  key: LayoutKey;
  name: string;
  blurb: string;
  accent: string;
  Component: ComponentType;
}

export const LAYOUTS: LayoutDef[] = [
  {
    key: "signal",
    name: "Signal",
    blurb: "Halftone print, sodium orange, asymmetric editorial",
    accent: "#ff8a3d",
    Component: Signal,
  },
  {
    key: "terminal",
    name: "Terminal",
    blurb: "CRT console, phosphor green, monospace throughout",
    accent: "#5df2a0",
    Component: Terminal,
  },
  {
    key: "orbit",
    name: "Orbit",
    blurb: "Mission control, ice cyan, radial instrumentation",
    accent: "#43d9e8",
    Component: Orbit,
  },
  {
    key: "dossier",
    name: "Dossier",
    blurb: "Forensic case file, signal red, hairline rules",
    accent: "#e5484d",
    Component: Dossier,
  },
  {
    key: "deepwater",
    name: "Deepwater",
    blurb: "Atmospheric, iridescent magenta, quiet and large",
    accent: "#ff4fa3",
    Component: Deepwater,
  },
];

export const DEFAULT_LAYOUT: LayoutKey = "signal";
