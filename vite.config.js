import { defineConfig } from "vite";
import { resolvePagesBase } from "./build/pagesBase.js";

export default defineConfig({
  base: resolvePagesBase(),
  server: { host: "0.0.0.0", port: 5173 },
  preview: { host: "0.0.0.0", port: 4173 },
  build: {
    rollupOptions: {
      output: { manualChunks: { three: ["three"] } },
    },
  },
});
