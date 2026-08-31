/**
 * Hash routing, hand-rolled and design-agnostic.
 *
 * Each direction defines its own vocabulary of sections -- an editorial
 * publication has cases and a method statement, a workstation has numbered
 * operational panes, a case file has ruled parts -- so this does not know what
 * the routes are. It reads a section name out of the hash, hands it back, and
 * lets the shell decide what that means.
 *
 * The scenario stays in the query string rather than in component state, which
 * is what makes switching direction preserve the case you were looking at:
 * three of the four shells unmount entirely when you switch, and anything held
 * in their state would go with them.
 */

import { useCallback, useEffect, useState } from "react";

export interface HashLocation {
  section: string;
  params: URLSearchParams;
}

export function readHash(): HashLocation {
  if (typeof window === "undefined") {
    return { section: "", params: new URLSearchParams() };
  }
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  return { section: path, params: new URLSearchParams(query) };
}

/**
 * The active section, restricted to what this direction offers.
 *
 * A direction that does not have the section named in the URL falls back to its
 * own home rather than rendering nothing, so a link into Terminal's `evidence`
 * pane still lands somewhere sensible when the reader is in Signal.
 */
export function useSection(sections: readonly string[], home: string) {
  const resolve = useCallback(() => {
    const { section } = readHash();
    return sections.includes(section) ? section : home;
  }, [sections, home]);

  const [section, setSection] = useState(resolve);

  useEffect(() => {
    const onHash = () => setSection(resolve());
    window.addEventListener("hashchange", onHash);
    // Re-resolve on mount too: switching direction remounts the shell without
    // changing the hash, and the new direction may not have the old section.
    setSection(resolve());
    return () => window.removeEventListener("hashchange", onHash);
  }, [resolve]);

  const navigate = useCallback((next: string) => {
    const { params } = readHash();
    const query = params.toString();
    const target = `#/${next}${query ? `?${query}` : ""}`;
    if (window.location.hash !== target) window.location.hash = target;
  }, []);

  return [section, navigate] as const;
}

/** Href for a section, preserving whichever scenario is open. */
export function hrefFor(section: string): string {
  const { params } = readHash();
  const query = params.toString();
  return `#/${section}${query ? `?${query}` : ""}`;
}
