/**
 * One objective, in both of its layouts at once.
 *
 * In the centred row it is icon above, heading, description; in the left
 * column it is icon beside a heading and description. Both text blocks are
 * rendered and cross-faded during the reflow, and the icon is tweened between
 * its two positions, so no layout is measured mid-animation.
 */
import { Boat, ClockCounterClockwise, Crosshair, Path, Ruler, type Icon } from "@phosphor-icons/react";
import { IconBadge } from "../parts/IconBadge";
import type { ObjectiveIcon } from "./copy";
import { ICON, rowRects } from "./layout";

const ICONS: Record<ObjectiveIcon, Icon> = { Crosshair, Ruler, ClockCounterClockwise, Path, Boat };

export function ObjectiveCard({
  index,
  icon,
  heading,
  body,
}: {
  index: number;
  icon: ObjectiveIcon;
  heading: string;
  body: string;
}) {
  const start = rowRects(1)[0];
  return (
    <div
      className="pt-card pt-obj"
      data-pt={`obj-${index}`}
      style={{ left: start.x, top: start.y, width: start.w, height: start.h }}
    >
      <div className="pt-obj-icon" style={{ left: ICON.row.left, top: ICON.row.top }}>
        <IconBadge icon={ICONS[icon]} size={ICON.size} data-pt="badge" />
      </div>
      <div className="pt-obj-stack">
        <div className="pt-obj-heading pt-head">{heading}</div>
        <div className="pt-obj-body">{body}</div>
      </div>
      <div className="pt-obj-side">
        <div className="pt-obj-heading pt-head">{heading}</div>
        <div className="pt-obj-body">{body}</div>
      </div>
    </div>
  );
}
