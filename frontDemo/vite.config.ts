import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 5180 by default, but overridable from the environment so a second dev
  // server can run alongside the first without either of them moving.
  server: { port: Number(process.env.PORT) || 5180, open: false },
  build: {
    rollupOptions: {
      output: {
        /*
          maplibre-gl gets its own chunk, and the reason is caching rather than
          bytes.

          `MapCanvas.tsx` is imported by four modules across both shells, so
          Rollup hoists it into a shared chunk, and maplibre rides along inside
          it. Measured, before and after: one 1,199.39 kB chunk becomes
          1,055.26 kB of maplibre plus 138.93 kB of this project's map code, so
          the total falls slightly rather than rising. A reader still downloads
          the same library, because the map genuinely needs it. What changes is
          what a redeploy invalidates. `MapCanvas.tsx` is one of the most-edited
          files in this repo; before this split, editing one line of it changed
          the hash on all 1,199 kB and every returning reader fetched maplibre
          again. Split, an edit invalidates 138.93 kB and the library keeps its
          hash across releases.

          It also makes the size warning honest. It used to point at a chunk
          named `MapCanvas`, which reads as "your map component is 1.2 MB"; it
          now points at a chunk named `maplibre-gl`, which is the truth and is
          not something this project can fix by writing less code.
        */
        manualChunks(id) {
          if (id.includes("node_modules/maplibre-gl")) return "maplibre-gl";
        },
      },
    },
    // The maplibre chunk is a single third-party library that cannot be split
    // further and is already loaded lazily, behind `React.lazy` on both shells.
    // Warning about it on every build trains people to ignore the warning, so
    // the limit is raised to just above it -- high enough to stay quiet about
    // the one chunk that is legitimately large, low enough that a second one
    // appearing still gets flagged.
    chunkSizeWarningLimit: 1100,
  },
});
