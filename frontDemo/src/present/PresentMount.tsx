/**
 * The console's presentation keys, always listening, and nothing else.
 *
 * Tiny and eager on purpose: the overlay itself (scenes, images, anime.js
 * timelines) is a lazy chunk fetched on the first T or X, so the console opens
 * exactly as fast as it did before the overlay existed.
 *
 * While the overlay is open this listener swallows every key in the window's
 * capture phase, before any of the console's own window listeners run: Space
 * must not start the timeline and 1 to 6 must not front a panel behind the
 * audience's back.
 */
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { presentKeyOf } from "./keys";
import type { OverlayHandle, SequenceId } from "./types";

const NAMES_KEY = "present.showNames";
function storedNames(): boolean {
  try {
    return window.localStorage.getItem(NAMES_KEY) !== "0";
  } catch {
    return true;
  }
}

const PresentOverlay = lazy(() => import("./PresentOverlay"));

export function PresentMount() {
  const [run, setRun] = useState<{ sequence: SequenceId; n: number } | null>(null);
  // K flips this from anywhere in the console, overlay open or not; remembered per browser.
  const [showNames, setShowNames] = useState(storedNames);
  const handle = useRef<OverlayHandle>(null);
  const open = useRef(false);
  open.current = run !== null;

  useEffect(() => {
    const start = (sequence: SequenceId) => setRun((r) => ({ sequence, n: (r?.n ?? 0) + 1 }));
    const flipNames = () =>
      setShowNames((v) => {
        try {
          window.localStorage.setItem(NAMES_KEY, v ? "0" : "1");
        } catch {
          /* a blocked store only loses the memory, not the switch */
        }
        return !v;
      });
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const base = { key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey };
      if (!open.current) {
        const k = presentKeyOf({ ...base, targetTag: tag });
        if (k === "K") {
          if (!e.repeat) flipNames();
          return;
        }
        if (k !== "T" && k !== "X") return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) start(k === "T" ? "statement" : "technical");
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      // Open, the overlay covers every field, so focus left in one must not eat Q.
      const k = presentKeyOf(base);
      if (k === "T") start("statement");
      else if (k === "X") start("technical");
      else if (k === "Q") handle.current?.next();
      else if (k === "Z") handle.current?.close();
      else if (k === "K") flipNames();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  if (!run) return null;
  return (
    <Suspense fallback={null}>
      <PresentOverlay key={run.n} ref={handle} sequence={run.sequence} showNames={showNames} onClosed={() => setRun(null)} />
    </Suspense>
  );
}
