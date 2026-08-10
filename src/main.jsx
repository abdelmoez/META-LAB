// serverStorage must be imported first — it sets window.storage before React
// renders any component, ensuring the monolith can access it on mount.
import "./frontend/storage/serverStorage.js";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App, { preloadPublicRoute } from "./App.jsx";
// 65.md UX-1 — app-level crash net. Sits ABOVE the router/providers so any
// route without a closer boundary recovers instead of white-screening.
import AppErrorBoundary from "./frontend/components/AppErrorBoundary.jsx";
// 77.md §9 — global observability + a guarded once-only reload for stale dynamic-import
// (content-hashed chunk) failures after a deploy, the most likely "Something went wrong".
import { installGlobalErrorHandlers } from "./frontend/components/errorReporting.js";
// 93.md §5.1 — DSN-gated Sentry: a no-op (zero bytes downloaded) unless
// VITE_SENTRY_DSN is configured at build time.
import { initSentryClient } from "./frontend/monitoring/sentryClient.js";

// 86.md P3.34 — surface the compile-time release id as window.__APP_VERSION__ so the
// manuscript version stamps (which read the window global) also carry the real
// version, not null. Guarded so it is a no-op where the Vite define isn't applied.
try { if (typeof __APP_VERSION__ !== "undefined") window.__APP_VERSION__ = __APP_VERSION__; } catch { /* no define → leave unset */ }

installGlobalErrorHandlers();
initSentryClient(); // async, fire-and-forget; no-op without a DSN

const container = document.getElementById("root");

function mount() {
  createRoot(container).render(
    <StrictMode>
      <AppErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppErrorBoundary>
    </StrictMode>
  );
}

// 111.md §3 — PRERENDERED DOCUMENTS.
//
// server/middleware/publicPages.js serves dist/__prerender/<path>/index.html to
// every client (there is no user-agent sniffing), so a visitor arriving from a
// search result sees the real article painted before this script even runs. The
// shell ships `<div id="root"></div>`; a prerendered document ships the article
// inside it, which is the discriminator used here.
//
// This app mounts with createRoot, not hydrateRoot — the client tree (App's four
// providers + router + Suspense) is not the tree the prerenderer renders, so React
// could not hydrate it without a rewrite of both (recorded in
// docs/seo-overhaul-111.md §5). createRoot therefore CLEARS #root on its first
// commit and re-renders. That is acceptable — the markup is identical and the
// re-render is cheap — but only if the first render does not SUSPEND: a suspended
// lazy route would make that same commit paint a full-viewport spinner where the
// article was, i.e. content → spinner → content on every prerendered page.
//
// Resolving the route's chunk first costs nothing the page was not already going to
// pay (it is the same request React would make a moment later) and the prerendered
// content stays on screen throughout.
if (container && container.firstElementChild) {
  preloadPublicRoute(window.location.pathname).then(mount, mount);
} else {
  mount();
}
