/**
 * The technical sequence (X): the approach as one real scene's journey, then
 * the tech stack. Each half hands its beats up once its DOM exists; the
 * overlay gets them together, and only once both halves have.
 */
import { useCallback, useRef } from "react";
import type { BeatBuild } from "../engine";
import type { SceneProps } from "../types";
import { TECH_BEATS } from "./copy";
import { JourneyScene } from "./JourneyScene";
import { StackScene } from "./StackScene";
import { ThanksScene } from "./ThanksScene";

export { TECH_BEATS };

export function TechnicalScene({ register, showNames }: SceneProps) {
  const parts = useRef<{ journey?: Record<string, BeatBuild>; stack?: Record<string, BeatBuild>; thanks?: Record<string, BeatBuild> }>({});

  const ready = useCallback(() => {
    const { journey, stack, thanks } = parts.current;
    if (journey && stack && thanks) register({ ...journey, ...stack, ...thanks });
  }, [register]);

  const onJourney = useCallback(
    (b: Record<string, BeatBuild>) => {
      parts.current.journey = b;
      ready();
    },
    [ready],
  );
  const onStack = useCallback(
    (b: Record<string, BeatBuild>) => {
      parts.current.stack = b;
      ready();
    },
    [ready],
  );

  const onThanks = useCallback(
    (b: Record<string, BeatBuild>) => {
      parts.current.thanks = b;
      ready();
    },
    [ready],
  );

  return (
    <>
      <JourneyScene onBeats={onJourney} />
      <StackScene onBeats={onStack} />
      <ThanksScene onBeats={onThanks} showNames={showNames} />
    </>
  );
}
