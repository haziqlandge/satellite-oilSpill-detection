/**
 * The two sequences: their beat names, in order, and the scene that animates
 * them. The overlay supplies "blackout" and "reveal"; the scene the rest.
 */
import type { ComponentType } from "react";
import { STATEMENT_BEATS, StatementScene } from "./statement/StatementScene";
import { TECH_BEATS, TechnicalScene } from "./technical/TechnicalScene";
import type { SceneProps, SequenceId } from "./types";

export const SEQUENCES: Record<SequenceId, { beats: readonly string[]; Scene: ComponentType<SceneProps> }> = {
  statement: { beats: STATEMENT_BEATS, Scene: StatementScene },
  technical: { beats: TECH_BEATS, Scene: TechnicalScene },
};
