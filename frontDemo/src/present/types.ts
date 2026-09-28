import type { BeatBuild } from "./engine";

export type SequenceId = "statement" | "technical";

export interface OverlayHandle {
  next(): void;
  close(): void;
}

/**
 * What a scene gets from the overlay. A scene renders its elements hidden,
 * then hands up one builder per beat name it owns, once its DOM exists. The
 * overlay owns "blackout" and "reveal" itself.
 */
export interface SceneProps {
  register(beats: Record<string, BeatBuild>): void;
  /** Whether the closing screen lists the team's names (K, from anywhere in the console). */
  showNames: boolean;
}
