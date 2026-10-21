import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "katex/dist/katex.min.css";
import "./styles.css";
import "./taskPanel.css";
import "./workbench.css";
import "./design-tokens.css";
import "./ui-polish.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
