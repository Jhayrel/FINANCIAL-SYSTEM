import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Self-hosted: no CDN, so the PWA keeps its typography offline.
import "@fontsource-variable/inter";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";

import App from "./App";
import { AppBoundary } from "./components/AppBoundary";
import { initInputModality } from "./inputModality";
import { initTheme } from "./theme";

initTheme();
initInputModality();

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <AppBoundary>
      <App />
    </AppBoundary>
  </StrictMode>,
);
