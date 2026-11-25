import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { invoke, isTauri } from "./lib/tauri";
import "./styles/index.css";

// iPadOS reports a desktop ("Macintosh") user agent; multitouch is the tell.
if (navigator.maxTouchPoints > 1 && /Mac|iPad/.test(navigator.userAgent)) {
  document.documentElement.classList.add("ipados");
  // A trackpad click doesn't give the page the hardware keyboard on iPad
  // (WebKit only does that for a finger tap, or a click into editable text),
  // so after one elsewhere the native side is asked to (src-tauri/src/ios.rs).
  // Without it, ⌘\ and the other shortcuts did nothing until text was tapped.
  if (isTauri) {
    document.addEventListener(
      "pointerdown",
      (e) => {
        const target = e.target as HTMLElement | null;
        if (e.pointerType !== "mouse") return;
        if (target?.closest("input, textarea, select, [contenteditable='true'], .cm-content")) return;
        void invoke("claim_keyboard").catch(() => {});
      },
      true,
    );
  }
}
// The app never zooms as a whole (the PDF viewer has its own zoom).
document.addEventListener("gesturestart", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
