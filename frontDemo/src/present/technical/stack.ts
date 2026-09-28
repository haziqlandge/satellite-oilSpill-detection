/**
 * The tech stack, as the repository's md files name it (README, DATA,
 * ISSUES, FUTURE_WORK) -- nothing from general knowledge. No "planned" tags
 * (the user, 2026-09-27): the GFS wind fallback sits with the data and
 * Cloudflare R2 with the backend.
 */
import type { ImageLogoKey, LogoKey } from "./logos";

export interface Tool {
  name: string;
  note?: string;
  logo?: LogoKey;
  image?: ImageLogoKey;
}

export const LAYERS: readonly { name: "DATA" | "ML" | "PHYSICS" | "BACKEND" | "FRONTEND"; tools: readonly Tool[] }[] = [
  {
    name: "DATA",
    tools: [
      { name: "Sentinel-1", note: "Copernicus Data Space", image: "sentinel1" },
      { name: "Zenodo SAR datasets", note: "Parts I to III", logo: "zenodo" },
      { name: "ERA5", note: "Copernicus CDS, Open-Meteo" },
      { name: "CMEMS", note: "Copernicus Marine" },
      { name: "MarineCadastre AIS", note: "US Coast Guard NAIS" },
      { name: "GFS", note: "wind fallback" },
    ],
  },
  {
    name: "ML",
    tools: [
      { name: "PyTorch", logo: "pytorch" },
      { name: "Ultralytics YOLO11", note: "instance segmentation", logo: "ultralytics" },
      { name: "LSK attention", note: "large selective kernel" },
      { name: "SAHI", note: "sliced inference" },
      { name: "ONNX Runtime Web", note: "on WebGPU", logo: "onnx" },
    ],
  },
  {
    name: "PHYSICS",
    tools: [
      { name: "ESA SNAP", note: "calibration, speckle, terrain" },
      { name: "OpenDrift OpenOil", note: "ensemble drift", image: "opendrift" },
      { name: "CFAR", note: "ship detection" },
    ],
  },
  {
    name: "BACKEND",
    tools: [
      { name: "Python", logo: "python" },
      { name: "FastAPI", note: "live pipeline events", logo: "fastapi" },
      { name: "SQLAlchemy", logo: "sqlalchemy" },
      { name: "Supabase", note: "Postgres, PostGIS", logo: "supabase" },
      { name: "Cloudflare R2", note: "imagery storage", logo: "cloudflare" },
    ],
  },
  {
    name: "FRONTEND",
    tools: [
      { name: "React 19", logo: "react" },
      { name: "TypeScript", logo: "typescript" },
      { name: "Vite", logo: "vite" },
      { name: "Tailwind v4", logo: "tailwindcss" },
      { name: "MapLibre GL", logo: "maplibre" },
      { name: "anime.js" },
      { name: "geotiff.js" },
      { name: "Vercel", logo: "vercel" },
    ],
  },
];

/** Column geometry in stage pixels: layer pills at `pillY`, cards from `top`, one per `pitch`. */
export const STACK = { pillY: 250, top: 300, pitch: 84, h: 72, w: 320, x0: 192, dx: 384 } as const;
