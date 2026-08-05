import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import App from "./App";
import { applyThemePreference, readThemePreference } from "./lib/theme";
import "./index.css";

applyThemePreference(readThemePreference());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
