import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { PERMANENT_REDIRECTS, normalizePath } from "./src/frontend/website/publicPages.js";

// 86.md P3.34 — inject the build/release id at compile time so crash telemetry
// (errorReporting.releaseId reads the bare __APP_VERSION__) and manuscript version
// stamps carry the real version instead of always 'dev'/null. Sourced from the
// package version; a CI/build step may override via APP_VERSION for a commit-based id.
let APP_VERSION = "dev";
try { APP_VERSION = process.env.APP_VERSION || JSON.parse(readFileSync("./package.json", "utf8")).version || "dev"; } catch { /* keep 'dev' */ }

/**
 * 111.md §5 — mirror the production permanent redirects in the Vite dev server.
 *
 * In production, server/middleware/publicPages.js issues these 301s. Vite serves
 * the SPA directly in `npm run dev` (and therefore in the Playwright suite), so
 * without this the redirects would only exist in production and dev/e2e would see
 * a bare 404 for /privacy. One table (PERMANENT_REDIRECTS), two servers.
 */
function permanentRedirectsPlugin() {
  return {
    name: "pecanrev-permanent-redirects",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const url = req.url || "/";
        const pathname = normalizePath(url.split("?")[0].split("#")[0]);
        const rule = PERMANENT_REDIRECTS.find((r) => r.from === pathname);
        if (!rule) return next();
        res.statusCode = rule.status || 301;
        res.setHeader("Location", rule.to);
        res.setHeader("Cache-Control", "no-cache");
        res.end();
        return undefined;
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), permanentRedirectsPlugin()],
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
