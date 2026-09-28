/**
 * The presentation overlay's keys, read off a keydown.
 *
 * T and X start the two sequences, Q moves one beat on, Z leaves, K shows or
 * hides the team's names on the closing screen. Nothing
 * fires while a form field has focus or a modifier is held: the console has a
 * position picker and an upload name, and a presenter typing a Q into either
 * must get a letter, not a slide.
 */

export type PresentKey = "T" | "X" | "Q" | "Z" | "K";

const KEYS: Record<string, PresentKey> = { t: "T", x: "X", q: "Q", z: "Z", k: "K" };

export function presentKeyOf(e: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  targetTag?: string;
}): PresentKey | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.targetTag && /^(INPUT|SELECT|TEXTAREA)$/.test(e.targetTag)) return null;
  return KEYS[e.key.toLowerCase()] ?? null;
}
