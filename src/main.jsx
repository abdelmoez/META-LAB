// serverStorage must be imported first — it sets window.storage before React
// renders any component, ensuring the monolith can access it on mount.
import "./frontend/storage/serverStorage.js";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
// 65.md UX-1 — app-level crash net. Sits ABOVE the router/providers so any
// route without a closer boundary recovers instead of white-screening.
import AppErrorBoundary from "./frontend/components/AppErrorBoundary.jsx";
// 77.md §9 — global observability + a guarded once-only reload for stale dynamic-import
// (content-hashed chunk) failures after a deploy, the most likely "Something went wrong".
import { installGlobalErrorHandlers } from "./frontend/components/errorReporting.js";

// 86.md P3.34 — surface the compile-time release id as window.__APP_VERSION__ so the
// manuscript version stamps (which read the window global) also carry the real
// version, not null. Guarded so it is a no-op where the Vite define isn't applied.
try { if (typeof __APP_VERSION__ !== "undefined") window.__APP_VERSION__ = __APP_VERSION__; } catch { /* no define → leave unset */ }

installGlobalErrorHandlers();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>
);
