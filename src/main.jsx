// serverStorage must be imported first — it sets window.storage before React
// renders any component, ensuring the monolith can access it on mount.
import "./frontend/storage/serverStorage.js";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
