// The document list, after Hush's files panel: newest first, each with its
// date; a filter at the top; rename and delete on each row (rename
// inline, delete on a second press); and Settings at the foot.
import { useMemo, useState } from "react";
import { createDocument, deleteDocument, openDocument, renameDocument } from "../lib/documents";
import { useApp, usePrefs } from "../lib/store";
import type { DocSummary } from "../lib/types";
import { GearIcon, PencilIcon, PlusIcon, SearchIcon, SidebarIcon, TrashIcon } from "./Icons";

function when(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = (now.getTime() - ms) / 86_400_000;
  if (days < 6) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function Row({ doc, active }: { doc: DocSummary; active: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(doc.title);
  const [confirm, setConfirm] = useState(false);
  const current = useApp((s) => (s.current?.id === doc.id ? s.current : null));
  const title = current?.title ?? doc.title;

  if (editing) {
    return (
      <li className="doc-row active">
        <input
          className="doc-rename"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (name.trim() && name !== title) void renameDocument(doc.id, name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setName(title);
              setEditing(false);
            }
          }}
        />
      </li>
    );
  }
  return (
    <li className={`doc-row${active ? " active" : ""}`} onClick={() => void openDocument(doc.id)} title={doc.goal || undefined}>
      <span className="doc-title">{title || "Untitled"}</span>
      <span className="doc-date">
        {when(current?.updatedMs ?? doc.updatedMs)}
        {doc.words ? ` · ${doc.words.toLocaleString()} words` : ""}
      </span>
      <span className="doc-actions" onClick={(e) => e.stopPropagation()}>
        <button
          title="Rename"
          onClick={() => {
            setName(title);
            setEditing(true);
          }}
        >
          <PencilIcon size={14} />
        </button>
        <button
          className={confirm ? "danger" : ""}
          title={confirm ? "Press again to delete this document and its conversation" : "Delete"}
          onClick={() => {
            if (!confirm) {
              setConfirm(true);
              setTimeout(() => setConfirm(false), 2500);
              return;
            }
            void deleteDocument(doc.id);
          }}
        >
          <TrashIcon size={14} />
        </button>
      </span>
    </li>
  );
}

export function Sidebar() {
  const docs = useApp((s) => s.docs);
  const currentId = useApp((s) => s.current?.id);
  const openSettings = useApp((s) => s.openSettings);
  const setPref = usePrefs((s) => s.set);
  const [filter, setFilter] = useState("");

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => d.title.toLowerCase().includes(q) || d.goal.toLowerCase().includes(q));
  }, [docs, filter]);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <button className="icon-btn" title="Hide the document list (⌘\)" onClick={() => setPref("sidebarOpen", false)}>
          <SidebarIcon />
        </button>
        <span className="sidebar-name">Nudge</span>
        <button className="icon-btn" title="New document (⌘N)" onClick={() => void createDocument()}>
          <PlusIcon />
        </button>
      </div>
      <label className="sidebar-filter">
        <SearchIcon size={14} />
        <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      <ul className="doc-list">
        {shown.map((d) => (
          <Row key={d.id} doc={d} active={d.id === currentId} />
        ))}
        {docs.length === 0 && <li className="doc-empty">No documents yet.</li>}
      </ul>
      <div className="sidebar-foot">
        <button className="icon-btn" title="Settings (⌘,)" onClick={() => openSettings("ai")}>
          <GearIcon size={18} />
        </button>
      </div>
    </aside>
  );
}
