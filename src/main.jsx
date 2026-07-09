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
