import React from "react";
import ReactDOM from "react-dom/client";
import { MobileApp } from "./features/mobile/MobileApp";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>,
);
