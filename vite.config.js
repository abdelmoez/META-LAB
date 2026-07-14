import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// 86.md P3.34 — inject the build/release id at compile time so crash telemetry
// (errorReporting.releaseId reads the bare __APP_VERSION__) and manuscript version
// stamps carry the real version instead of always 'dev'/null. Sourced from the
// package version; a CI/build step may override via APP_VERSION for a commit-based id.
let APP_VERSION = "dev";
try { APP_VERSION = process.env.APP_VERSION || JSON.parse(readFileSync("./package.json", "utf8")).version || "dev"; } catch { /* keep 'dev' */ }

export default defineConfig({
  plugins: [react()],
  root: ".",
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        // 127.0.0.1 (not "localhost"): on Windows + Node 20, "localhost" resolves
        // to ::1 first and the connect to the dual-stack backend hangs, which would
        // make every browser API call time out. 127.0.0.1 connects reliably.
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
