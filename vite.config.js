import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
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
