/**
 * One proposed solution, rendered at its resting slot on the right. The beat
 * that lands it starts it large at the centre of the right side and settles it
 * here; image cards carry a picture, the last three an icon.
 */
import { Broadcast, ChartBar, GraphicsCard, type Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { SolutionIcon, SolutionId } from "../copy";
import type { Rect } from "../layout";
import { CaptureVisual, MosaicVisual, SliceMaskVisual, TerminalVisual } from "./visuals";

const ICONS: Record<SolutionIcon, Icon> = { GraphicsCard, Broadcast, ChartBar };
const PICTURES: Partial<Record<SolutionId, () => ReactNode>> = {
  model: () => <MosaicVisual />,
  slice: () => <SliceMaskVisual />,
  weather: () => <TerminalVisual />,
  drift: () => <CaptureVisual />,
};

export function SolutionCard({
  index,
  id,
  title,
  caption,
  kind,
  icon,
  slot,
}: {
  index: number;
  id: SolutionId;
  title: string;
  caption: string;
  kind: "image" | "icon";
  icon?: SolutionIcon;
  slot: Rect;
}) {
  const IconComponent = icon ? ICONS[icon] : null;
  return (
    <div
      className={`pt-card pt-sol pt-sol--${kind}`}
      data-pt={`sol-${index}`}
      style={{ left: slot.x, top: slot.y, width: slot.w, height: slot.h }}
    >
      {kind === "image" ? (
        <>
          <div className="pt-sol-picture">{PICTURES[id]?.()}</div>
          <div className="pt-sol-title pt-head">{title}</div>
          <div className="pt-sol-caption">{caption}</div>
        </>
      ) : (
        <>
          <div className="pt-sol-iconrow">
            <span className="pt-sol-icon">{IconComponent && <IconComponent size={24} weight="bold" />}</span>
            <span className="pt-sol-title pt-head">{title}</span>
          </div>
          <div className="pt-sol-caption">{caption}</div>
        </>
      )}
    </div>
  );
}
