/**
 * Which direction is active.
 *
 * Deliberately thin. The previous version of this module also handed out panel
 * chrome, heading styles, label styles and button chrome, which meant every
 * component in the application was one component wearing four costumes. Each
 * design now owns its own components outright, so all this has to carry is the
 * definition itself -- mostly for the map paint, which is the one thing the
 * four genuinely share.
 */

import { createContext, useContext } from "react";
import { DESIGNS, designFor, type DesignDef, type DesignKey } from "./design";

const DesignContext = createContext<DesignDef | null>(null);

export function DesignProvider({
  design,
  children,
}: {
  design: DesignKey;
  children: React.ReactNode;
}) {
  return (
    <DesignContext.Provider value={designFor(design)}>
      {children}
    </DesignContext.Provider>
  );
}

export function useDesign(): DesignDef {
  return useContext(DesignContext) ?? DESIGNS[0];
}
