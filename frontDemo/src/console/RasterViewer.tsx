/**
 * An uploaded raster at its own resolution: zoom, pan, and the model's mask
 * on top, pixel for pixel.
 *
 * The upload panel shows each image in a box 160-224 px tall. A 2048-pixel
 * Sentinel-1 window shrunk into that is a grey square: a slick a few pixels
 * wide is gone, and "the model says oil here and I cannot see any" is the
 * question an operator is left with. This opens the same images at full size.
 *
 * Nothing here is resampled for show. Above 1:1 pixels are drawn as blocks
 * (`image-rendering: pixelated`), so what looks like one pixel is one pixel of
 * the raster the segmenter read; the mask layer is the model's own per-pixel
 * output at the raster's size, not the downscaled thumbnail's.
 *
 * It renders through a portal for the reason `Popover` does, and restates the
 * console surface for the same reason: outside the surface root every token
 * resolves against `:root`, which is the home page's orange.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { tokenStyle, usePalette } from "../lib/palette";
import { SURFACES } from "../theme";
import { POPOVER_Z } from "./Popover";

export interface ViewerLayer {
  key: string;
  label: string;
  url: string;
}

const MAX_SCALE = 16;
const WHEEL_RATE = 0.0015;

interface View {
  k: number;
  x: number;
  y: number;
}

export function RasterViewer({
  title,
  width,
  height,
  layers,
  initial,
  maskUrl,
  maskInitially = false,
  onClose,
}: {
  title: string;
  width: number;
  height: number;
  layers: ViewerLayer[];
  initial: string;
  /** The model's mask at the raster's size, transparent where it marked nothing. */
  maskUrl: string | null;
  maskInitially?: boolean;
  onClose: () => void;
}) {
  const palette = usePalette();
  const fonts = SURFACES[palette.surface].fonts;
  const stage = useRef<HTMLDivElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const [layer, setLayer] = useState(initial);
  const [showMask, setShowMask] = useState(maskInitially && !!maskUrl);
  const [view, setView] = useState<View | null>(null);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  const fit = useCallback((): View | null => {
    const el = stage.current;
    if (!el) return null;
    const { clientWidth: w, clientHeight: h } = el;
    const k = Math.min(w / width, h / height) * 0.96;
    return { k, x: (w - width * k) / 2, y: (h - height * k) / 2 };
  }, [width, height]);

  const minScale = useCallback(() => (fit()?.k ?? 1) * 0.5, [fit]);

  // Zoom about a point on the stage, so what is under the cursor stays there.
  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      setView((v) => {
        if (!v) return v;
        const k = Math.min(MAX_SCALE, Math.max(minScale(), v.k * factor));
        const r = k / v.k;
        return { k, x: px - (px - v.x) * r, y: py - (py - v.y) * r };
      });
    },
    [minScale],
  );

  const zoomCentre = useCallback(
    (factor: number) => {
      const el = stage.current;
      if (el) zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2);
    },
    [zoomAt],
  );

  const actual = useCallback(() => {
    const el = stage.current;
    if (!el) return;
    setView((v) => {
      const cx = el.clientWidth / 2;
      const cy = el.clientHeight / 2;
      // Keep the raster point at the centre of the stage where it is.
      const rx = v ? (cx - v.x) / v.k : width / 2;
      const ry = v ? (cy - v.y) / v.k : height / 2;
      return { k: 1, x: cx - rx, y: cy - ry };
    });
  }, [width, height]);

  useLayoutEffect(() => {
    setView(fit());
  }, [fit]);

  // Focus in, focus back out, and keep the page behind from scrolling.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);

  // Wheel has to be non-passive to stop the page scrolling under the zoom,
  // and React registers wheel listeners as passive.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * WHEEL_RATE), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const onResize = () => setView(fit());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit]);

  const onKey = (e: KeyboardEvent) => {
    const pan = (dx: number, dy: number) => setView((v) => (v ? { ...v, x: v.x + dx, y: v.y + dy } : v));
    const keys: Record<string, () => void> = {
      Escape: onClose,
      "+": () => zoomCentre(1.5),
      "=": () => zoomCentre(1.5),
      "-": () => zoomCentre(1 / 1.5),
      "0": () => setView(fit()),
      "1": actual,
      m: () => maskUrl && setShowMask((s) => !s),
      ArrowLeft: () => pan(60, 0),
      ArrowRight: () => pan(-60, 0),
      ArrowUp: () => pan(0, 60),
      ArrowDown: () => pan(0, -60),
    };
    const act = keys[e.key];
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    act();
  };

  const base = layers.find((l) => l.key === layer) ?? layers[0];
  const k = view?.k ?? 1;
  const button = "cursor-pointer border px-2 py-1 text-[10px] uppercase tracking-[0.14em]";

  return createPortal(
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={`${title}, full resolution`}
      tabIndex={-1}
      onKeyDown={onKey}
      data-surface={palette.surface}
      data-raster-viewer
      className="fixed inset-0 flex flex-col outline-none"
      style={
        {
          zIndex: POPOVER_Z + 10,
          "--font-display": fonts.display,
          "--font-body": fonts.body,
          "--font-mono": fonts.mono,
          fontFamily: fonts.body,
          ...tokenStyle(palette.tokens),
          background: "color-mix(in oklab, var(--base) 94%, transparent)",
          color: "var(--ink)",
        } as CSSProperties
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--line)" }}>
        <span className="mr-2 text-[11px] uppercase tracking-[0.18em]" style={{ color: "var(--accent)" }}>{title}</span>
        <div role="group" aria-label="Image" className="flex gap-1">
          {layers.map((l) => (
            <button
              key={l.key}
              type="button"
              aria-pressed={l.key === base.key}
              onClick={() => setLayer(l.key)}
              className={button}
              style={{
                borderColor: l.key === base.key ? "var(--accent)" : "var(--line)",
                color: l.key === base.key ? "var(--accent)" : "var(--ink-dim)",
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
        {maskUrl && (
          <button
            type="button"
            aria-pressed={showMask}
            onClick={() => setShowMask((s) => !s)}
            className={button}
            style={{ borderColor: showMask ? "var(--accent)" : "var(--line)", color: showMask ? "var(--accent)" : "var(--ink-dim)" }}
            title="Toggle the model's mask (M)"
          >
            {showMask ? "[x]" : "[ ]"} model mask
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <span className="num mr-2 text-[10px]" style={{ color: "var(--ink-dim)" }} data-viewer-scale>
            {k >= 1 ? `${k.toFixed(k >= 10 ? 0 : 1)}×` : `${Math.round(k * 100)}%`}
          </span>
          <button type="button" className={button} style={{ borderColor: "var(--line)" }} onClick={() => zoomCentre(1 / 1.5)} aria-label="Zoom out">−</button>
          <button type="button" className={button} style={{ borderColor: "var(--line)" }} onClick={() => zoomCentre(1.5)} aria-label="Zoom in">+</button>
          <button type="button" className={button} style={{ borderColor: "var(--line)" }} onClick={() => setView(fit())}>fit</button>
          <button type="button" className={button} style={{ borderColor: "var(--line)" }} onClick={actual} title="One screen pixel per raster pixel (1)">1:1</button>
          <button type="button" className={button} style={{ borderColor: "var(--accent)", color: "var(--accent)" }} onClick={onClose} aria-label="Close (Esc)">close</button>
        </div>
      </div>

      <div
        ref={stage}
        className="relative flex-1 overflow-hidden"
        style={{ cursor: drag.current ? "grabbing" : "grab", touchAction: "none", background: "var(--base)" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (view) {
            const px = Math.floor((e.clientX - r.left - view.x) / view.k);
            const py = Math.floor((e.clientY - r.top - view.y) / view.k);
            setCursor(px >= 0 && py >= 0 && px < width && py < height ? [px, py] : null);
          }
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          drag.current = { id: d.id, x: e.clientX, y: e.clientY };
          setView((v) => (v ? { ...v, x: v.x + dx, y: v.y + dy } : v));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          zoomAt(2, e.clientX - r.left, e.clientY - r.top);
        }}
      >
        {view && (
          <div
            className="absolute left-0 top-0"
            style={{
              width,
              height,
              transformOrigin: "0 0",
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
              // True pixels once they are bigger than screen pixels; smooth
              // below, where a block filter would alias the speckle.
              imageRendering: view.k >= 1 ? "pixelated" : "auto",
            }}
          >
            <img src={base.url} alt={base.label} draggable={false} width={width} height={height} className="absolute inset-0 block max-w-none select-none" />
            {maskUrl && showMask && (
              <img src={maskUrl} alt="model mask" draggable={false} width={width} height={height} className="absolute inset-0 block max-w-none select-none" data-viewer-mask />
            )}
          </div>
        )}
      </div>

      <div className="num flex flex-wrap gap-x-4 gap-y-1 border-t px-3 py-1.5 text-[10px]" style={{ borderColor: "var(--line)", color: "var(--ink-faint)" }}>
        <span>{width} × {height} px</span>
        <span data-viewer-cursor>{cursor ? `x ${cursor[0]} · y ${cursor[1]}` : "x -- · y --"}</span>
        {maskUrl && <span>mask: blue = every pixel the model marked · yellow = the outline the run drifts</span>}
        <span className="ml-auto">wheel or double-click to zoom · drag to pan · 0 fit · 1 actual size · M mask · Esc close</span>
      </div>
    </div>,
    document.body,
  );
}
