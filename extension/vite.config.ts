import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [crx({ manifest })],
  // Expose LINKROWTH_* from .env to import.meta.env (in addition to VITE_*).
  envPrefix: ["VITE_", "LINKROWTH_"],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
