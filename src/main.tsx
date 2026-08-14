import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import App from "./App";
import { applyThemePreference, readThemePreference } from "./lib/theme";
import "./index.css";
import "./styles/landing.css";
import "./styles/transitions.css";

applyThemePreference(readThemePreference());

// Paint landing chrome before React mounts — prevents theme/CSS flash on /.
const path = window.location.pathname;
if (path === "/" || path === "" || path === "/about") {
  document.documentElement.classList.add("on-landing");
  document.body.classList.add("on-landing");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
