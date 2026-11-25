// The window: the document list on the left; then, for the open document,
// the source viewer (when a source is open), the conversation, and the
// document itself — each edge draggable. The app's own shortcuts are
// handled here; the document's live in its editor.
import { useEffect } from "react";
import { ChatPanel } from "./components/chat/ChatPanel";
import { DocumentPane, activeEditor } from "./components/DocumentPane";
import { PdfViewer } from "./components/PdfViewer";
import { Resizer } from "./components/Resizer";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { ZoteroPicker } from "./components/ZoteroPicker";
import { PlusIcon, SidebarIcon } from "./components/Icons";
import { SHORTCUTS, bindingOf } from "./editor/shortcuts";
import { matchesDomEvent } from "./editor/shortcuts-core.js";
import { createDocument, lastDocId, openDocument, refreshDocList } from "./lib/documents";
import { loadSettings } from "./lib/settings";
import { useApp, usePrefs } from "./lib/store";

function runAppShortcut(id: string): void {
  const app = useApp.getState();
  const prefs = usePrefs.getState();
  switch (id) {
    case "newDoc":
      void createDocument();
      break;
    case "toggleSidebar":
      prefs.set("sidebarOpen", !prefs.sidebarOpen);
      break;
    case "toggleViewer": {
      if (app.viewer) app.closeViewer();
      else {
        const first = app.current?.sources.find((s) => s.hasFile);
        if (first) app.openViewer(first.id, 1);
      }
      break;
    }
    case "focusChat":
      document.getElementById("chat-composer")?.focus();
      break;
    case "focusDocument":
      activeEditor?.view.focus();
      break;
    case "attachZotero":
      if (app.current) app.setZoteroPicker(true);
      break;
    case "settings":
      app.openSettings("ai");
      break;
  }
}

function useAppShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useApp.getState().settingsTab === "shortcuts") return; // recording a binding
      const overrides = usePrefs.getState().shortcuts;
      for (const s of SHORTCUTS) {
        if (s.group !== "App") continue;
        const b = bindingOf(s.id, overrides);
        if (b && matchesDomEvent(e, b)) {
          e.preventDefault();
          runAppShortcut(s.id);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function useTheme(): void {
  const theme = usePrefs((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Welcome() {
  return (
    <div className="welcome">
      <h1>Nudge</h1>
      <p>
        A conversation that draws your document out of you. Say what you want to write; Nudge asks the questions; you
        keep the answers worth keeping.
      </p>
      <button className="btn primary" onClick={() => void createDocument()}>
        <PlusIcon size={15} /> New document
      </button>
    </div>
  );
}

export default function App() {
  const current = useApp((s) => Boolean(s.current));
  const viewerSource = useApp((s) => (s.viewer ? s.current?.sources.find((x) => x.id === s.viewer?.sourceId) : undefined));
  const settingsOpen = useApp((s) => Boolean(s.settingsTab));
  const picker = useApp((s) => s.zoteroPicker);
  const prefs = usePrefs();
  useAppShortcuts();
  useTheme();

  useEffect(() => {
    void (async () => {
      await loadSettings();
      await refreshDocList();
      const docs = useApp.getState().docs;
      const last = lastDocId();
      const pick = docs.find((d) => d.id === last) ?? docs[0];
      if (pick) await openDocument(pick.id);
    })();
  }, []);

  const clampWidth = (w: number, min: number, max: number) => Math.min(max, Math.max(min, w));

  return (
    <div className="app">
      {prefs.sidebarOpen && (
        <>
          <div className="sidebar-wrap" style={{ width: prefs.sidebarWidth }}>
            <Sidebar />
          </div>
          <Resizer onDrag={(dx) => prefs.set("sidebarWidth", clampWidth(usePrefs.getState().sidebarWidth + dx, 180, 420))} />
          <div className="sidebar-scrim" onClick={() => prefs.set("sidebarOpen", false)} />
        </>
      )}
      <main className="main">
        {!prefs.sidebarOpen && (
          <button className="icon-btn sidebar-reopen" title="Show the document list (⌘\)" onClick={() => prefs.set("sidebarOpen", true)}>
            <SidebarIcon />
          </button>
        )}
        {!current ? (
          <Welcome />
        ) : (
          <div className="columns">
            {viewerSource && (
              <>
                <div className="col-viewer" style={{ width: prefs.viewerWidth }}>
                  <PdfViewer source={viewerSource} />
                </div>
                <Resizer onDrag={(dx) => prefs.set("viewerWidth", clampWidth(usePrefs.getState().viewerWidth + dx, 280, 1000))} />
              </>
            )}
            <div className="split">
              <div className="col-chat" style={{ flexBasis: `${prefs.chatShare * 100}%` }}>
                <ChatPanel />
              </div>
              <Resizer
                onDrag={(dx) => {
                  const total = (document.querySelector(".split") as HTMLElement | null)?.clientWidth ?? 1000;
                  prefs.set("chatShare", clampWidth(usePrefs.getState().chatShare + dx / total, 0.25, 0.75));
                }}
              />
              <div className="col-doc">
                <DocumentPane />
              </div>
            </div>
          </div>
        )}
      </main>
      {settingsOpen && <SettingsDialog />}
      {picker && <ZoteroPicker />}
      <Toasts />
    </div>
  );
}
