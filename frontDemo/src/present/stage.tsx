/**
 * One fixed 1920 x 1080 stage, scaled uniformly to the window.
 *
 * Every scene is authored in stage pixels, so the overlay looks the same on a
 * projector and on a laptop; whatever the window's shape, the stage letterboxes
 * on the overlay's ground rather than cropping or stretching.
 */
import { useEffect, useState, type ReactNode } from "react";

export const STAGE = { w: 1920, h: 1080 } as const;

export function stageFit(vw: number, vh: number): { scale: number; x: number; y: number } {
  const scale = Math.min(vw / STAGE.w, vh / STAGE.h);
  return { scale, x: (vw - STAGE.w * scale) / 2, y: (vh - STAGE.h * scale) / 2 };
}

export function Stage({ children }: { children: ReactNode }) {
  const [fit, setFit] = useState(() => stageFit(window.innerWidth, window.innerHeight));

  useEffect(() => {
    const onResize = () => setFit(stageFit(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div
      className="pt-stage"
      style={{
        width: STAGE.w,
        height: STAGE.h,
        transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
      }}
    >
      {children}
    </div>
  );
}
