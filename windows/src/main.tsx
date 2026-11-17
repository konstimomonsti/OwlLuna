import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Audience from "./present/Audience";
import "./design/tokens.css";
import "./design/app.css";

// The second window, opened while presenting, shows only the page.
const audience = location.hash === "#audience";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {audience ? <Audience /> : <App />}
  </React.StrictMode>,
);
