import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 5180 by default, but overridable from the environment so a second dev
  // server can run alongside the first without either of them moving.
  server: { port: Number(process.env.PORT) || 5180, open: false },
});
