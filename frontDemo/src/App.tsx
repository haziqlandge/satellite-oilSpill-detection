import { useEffect, useState } from "react";
import { LayoutSwitcher } from "./components/LayoutSwitcher";
import { DEFAULT_LAYOUT, LAYOUTS } from "./layouts/registry";
import type { LayoutKey } from "./layouts/registry";

/** Keeps the chosen direction across a reload, so comparing is not tedious. */
function useStoredLayout() {
  const [key, setKey] = useState<LayoutKey>(() => {
    try {
      const saved = localStorage.getItem("frontdemo:layout");
      if (saved && LAYOUTS.some((l) => l.key === saved)) {
        return saved as LayoutKey;
      }
    } catch {
      /* private mode, blocked storage: fall through to the default */
    }
    return DEFAULT_LAYOUT;
  });

  useEffect(() => {
    try {
      localStorage.setItem("frontdemo:layout", key);
    } catch {
      /* not important enough to surface */
    }
  }, [key]);

  return [key, setKey] as const;
}

export default function App() {
  const [key, setKey] = useStoredLayout();
  const layout = LAYOUTS.find((l) => l.key === key) ?? LAYOUTS[0];
  const { Component } = layout;

  // Scroll to top on switch, otherwise you land mid-page in a layout whose
  // sections are nothing like the one you just left.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [key]);

  return (
    <div data-layout={key} className="bg-base min-h-[100dvh]">
      {/* key forces a remount so each layout's anime scope builds cleanly */}
      <Component key={key} />
      <LayoutSwitcher active={key} onSelect={setKey} />
    </div>
  );
}
