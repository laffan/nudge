// Settings, opened from the gear at the foot of the document list. The
// Offline model and Zotero sections edit a draft of the settings the Rust
// core keeps, saved with Save. AI applies as it changes (as Snorkle's
// does), and so do Appearance, Editor, Chat and Keyboard shortcuts, which
// are this device's preferences.
import { useEffect, useState } from "react";
import { saveSettings } from "../../lib/settings";
import { toast, useApp, type SettingsTab } from "../../lib/store";
import type { Settings } from "../../lib/types";
import { CloseIcon } from "../Icons";
import { AiSettings } from "./AiSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { ChatSettings } from "./ChatSettings";
import { EditorSettings } from "./EditorSettings";
import { OfflineSettings } from "./OfflineSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { ZoteroSettings } from "./ZoteroSettings";

export interface DraftProps {
  draft: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

const TABS: { id: SettingsTab; label: string; draft: boolean }[] = [
  { id: "ai", label: "AI", draft: false },
  { id: "offline", label: "Offline model", draft: true },
  { id: "zotero", label: "Zotero", draft: true },
  { id: "appearance", label: "Appearance", draft: false },
  { id: "editor", label: "Editor", draft: false },
  { id: "chat", label: "Chat", draft: false },
  { id: "shortcuts", label: "Keyboard shortcuts", draft: false },
];

/** The settings the AI tab saves as it goes: carried into the draft, so an
 *  unsaved edit elsewhere isn't lost (nor saved) when they change. */
const LIVE: (keyof Settings)[] = ["uses", "effort", "offlineFallback"];

export function SettingsDialog() {
  const tab = useApp((s) => s.settingsTab);
  const settings = useApp((s) => s.settings);
  const openSettings = useApp((s) => s.openSettings);
  const close = useApp((s) => s.closeSettings);
  const [draft, setDraft] = useState<Settings | null>(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft((d) => (d && settings ? { ...d, ...Object.fromEntries(LIVE.map((k) => [k, settings[k]])) } : settings));
  }, [settings]);
  if (!tab || !draft || !settings) return null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const set: DraftProps["set"] = (key, value) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const save = async () => {
    setSaving(true);
    try {
      await saveSettings(draft);
      toast("Settings saved");
    } catch (e) {
      toast(`Could not save settings: ${e}`, "error");
    } finally {
      setSaving(false);
    }
  };
  const isDraftTab = TABS.find((t) => t.id === tab)?.draft;

  return (
    <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && !dirty && close()}>
      <div className="dialog settings" role="dialog" aria-label="Settings">
        <header className="dialog-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={close} title="Close">
            <CloseIcon />
          </button>
        </header>
        <div className="settings-body">
          <nav className="settings-tabs">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => openSettings(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="settings-pane">
            {tab === "ai" && <AiSettings />}
            {tab === "offline" && <OfflineSettings draft={draft} set={set} />}
            {tab === "zotero" && <ZoteroSettings draft={draft} set={set} />}
            {tab === "appearance" && <AppearanceSettings />}
            {tab === "editor" && <EditorSettings />}
            {tab === "chat" && <ChatSettings />}
            {tab === "shortcuts" && <ShortcutSettings />}
          </div>
        </div>
        <footer className="dialog-foot">
          {isDraftTab ? (
            <>
              <span className="hint">{dirty ? "Unsaved changes" : ""}</span>
              <button className="btn" onClick={() => (dirty ? setDraft(settings) : close())}>
                {dirty ? "Revert" : "Close"}
              </button>
              <button className="btn primary" disabled={!dirty || saving} onClick={() => void save()}>
                Save
              </button>
            </>
          ) : (
            <>
              <span className="hint">{dirty ? "Unsaved changes in another section" : "These apply as you change them."}</span>
              <button className="btn primary" onClick={close}>
                Done
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
