/**
 * A dashed line that draws itself.
 *
 * A dash pattern and a draw-on are both `stroke-dasharray`, so they cannot live
 * on one path: the dashed line is masked by a solid copy of itself, and it is
 * the copy (`.pt-connector-reveal`) that draws on.
 */
import { createTimeline, svg, type Timeline } from "animejs";
import { useId, type SVGAttributes } from "react";

export function Connector({
  d,
  width,
  height,
  ...rest
}: { d: string; width: number; height: number } & SVGAttributes<SVGSVGElement>) {
  const id = `pt-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className="pt-connector" width={width} height={height} viewBox={`0 0 ${width} ${height}`} {...rest}>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x={-20} y={-20} width={width + 40} height={height + 40}>
          <path d={d} className="pt-connector-reveal" />
        </mask>
      </defs>
      <path d={d} className="pt-connector-line" mask={`url(#${id})`} />
    </svg>
  );
}

export function drawConnector(el: SVGPathElement, duration = 600): Timeline {
  return createTimeline()
    .set(el.ownerSVGElement!, { opacity: 1 }, 0)
    .add(svg.createDrawable(el), { draw: ["0 0", "0 1"], duration, ease: "inOutQuad" }, 0);
}
