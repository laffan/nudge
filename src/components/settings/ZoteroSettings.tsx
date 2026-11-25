// Settings → Zotero: the API key, checked with Verify (which fills in the
// user's library ID), or a group library's ID. Read access is all Nudge
// needs: it fetches works, their PDFs, annotations and notes, and writes
// nothing back.
import { useState } from "react";
import { invoke } from "../../lib/tauri";
import { Spinner } from "../Icons";
import type { DraftProps } from "./SettingsDialog";

export function ZoteroSettings({ draft, set }: DraftProps) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const verify = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await invoke<{ userID?: number; username?: string }>("zotero_verify", { key: draft.zoteroApiKey });
      if (res.userID != null && draft.zoteroLibraryType === "user") set("zoteroLibraryId", String(res.userID));
      setMsg(`✓ Key valid — ${res.username ?? "user"} (ID ${res.userID ?? "?"})`);
    } catch (e) {
      setMsg(`✗ ${e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="hint">
        Create a key at <code>zotero.org › Settings › Security › API Keys</code> with read access to your library and its
        files (and to any group you want to use). Save after verifying.
      </p>
      <label className="field">
        <span>API key</span>
        <div className="field-with-btn">
          <input type="password" autoComplete="off" value={draft.zoteroApiKey} onChange={(e) => set("zoteroApiKey", e.target.value)} />
          <button className="btn small" disabled={!draft.zoteroApiKey.trim() || busy} onClick={() => void verify()}>
            {busy ? <Spinner size={12} /> : "Verify"}
          </button>
        </div>
      </label>
      {msg && <div className="verify-msg">{msg}</div>}
      <div className="field-row">
        <label className="field">
          <span>Library</span>
          <select value={draft.zoteroLibraryType} onChange={(e) => set("zoteroLibraryType", e.target.value as "user" | "group")}>
            <option value="user">My library</option>
            <option value="group">A group library</option>
          </select>
        </label>
        <label className="field">
          <span>{draft.zoteroLibraryType === "group" ? "Group ID" : "User ID"}</span>
          <input value={draft.zoteroLibraryId} onChange={(e) => set("zoteroLibraryId", e.target.value)} placeholder={draft.zoteroLibraryType === "group" ? "from the group's URL" : "filled by Verify"} />
        </label>
      </div>
      <p className="hint">
        Attached works bring their PDF (kept on this device, so they read offline), your highlights and comments on it,
        and your notes. The guide reads your annotations first: they are what you already found important.
      </p>
    </>
  );
}
