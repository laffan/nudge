import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";

// iPadOS reports a desktop ("Macintosh") user agent; multitouch is the tell.
if (navigator.maxTouchPoints > 1 && /Mac|iPad/.test(navigator.userAgent)) {
  document.documentElement.classList.add("ipados");
}
// The app never zooms as a whole (the PDF viewer has its own zoom).
document.addEventListener("gesturestart", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
