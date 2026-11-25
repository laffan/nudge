// Documents: making, opening, saving and deleting them. Edits land in the
// store at once and reach disk shortly after (coalesced: a typing burst
// or a streamed reply is many store updates and one write), and any
// pending write is flushed before another document opens or the app is
// put away.
import { invoke } from "./tauri";
import { toast, useApp } from "./store";
import type { DocSummary, NudgeDoc } from "./types";

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function refreshDocList(): Promise<void> {
  try {
    useApp.getState().setDocs(await invoke<DocSummary[]>("list_documents"));
  } catch (e) {
    toast(`Could not list documents: ${e}`, "error");
  }
}

/** A title from the goal, until the writer names the document. */
export function titleFromGoal(goal: string): string {
  const words = goal.replace(/\s+/g, " ").trim().split(" ");
  const t = words.slice(0, 8).join(" ");
  return words.length > 8 ? `${t}…` : t || "Untitled";
}

export function blankDoc(): NudgeDoc {
  const now = Date.now();
  return {
    id: newId("doc"),
    title: "Untitled",
    titled: false,
    goal: "",
    createdMs: now,
    updatedMs: now,
    content: "",
    messages: [],
    sources: [],
    costUsd: 0,
  };
}

export async function createDocument(): Promise<void> {
  await flushSave();
  const doc = blankDoc();
  const app = useApp.getState();
  app.setCurrent(doc);
  app.closeViewer();
  await writeDoc(doc);
  rememberLastDoc(doc.id);
}

export async function openDocument(id: string): Promise<void> {
  const app = useApp.getState();
  if (app.current?.id === id) return;
  await flushSave();
  app.setLoadingDoc(true);
  try {
    const doc = await invoke<NudgeDoc>("load_document", { id });
    // Documents written before a field existed get its default.
    useApp.getState().setCurrent({ ...blankDoc(), ...doc });
    useApp.getState().closeViewer();
    rememberLastDoc(id);
  } catch (e) {
    toast(`Could not open the document: ${e}`, "error");
  } finally {
    useApp.getState().setLoadingDoc(false);
  }
}

export async function deleteDocument(id: string): Promise<void> {
  const app = useApp.getState();
  if (app.current?.id === id) {
    cancelPendingSave();
    app.setCurrent(null);
    app.closeViewer();
  }
  try {
    await invoke("delete_document", { id });
  } catch (e) {
    toast(`Could not delete: ${e}`, "error");
  }
  await refreshDocList();
}

export async function renameDocument(id: string, title: string): Promise<void> {
  const t = title.trim() || "Untitled";
  const app = useApp.getState();
  if (app.current?.id === id) {
    updateCurrent((d) => ({ ...d, title: t, titled: true }));
    return;
  }
  try {
    const doc = await invoke<NudgeDoc>("load_document", { id });
    await writeDoc({ ...doc, title: t, titled: true, updatedMs: Date.now() });
  } catch (e) {
    toast(`Could not rename: ${e}`, "error");
  }
}

/** Change the open document and schedule its save. */
export function updateCurrent(fn: (d: NudgeDoc) => NudgeDoc): void {
  const app = useApp.getState();
  const cur = app.current;
  if (!cur) return;
  const next = { ...fn(cur), updatedMs: Date.now() };
  app.setCurrent(next);
  scheduleSave();
}

let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const doc = useApp.getState().current;
    if (doc) void writeDoc(doc);
  }, 700);
}

function cancelPendingSave(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

export async function flushSave(): Promise<void> {
  if (!timer) return;
  cancelPendingSave();
  const doc = useApp.getState().current;
  if (doc) await writeDoc(doc);
}

async function writeDoc(doc: NudgeDoc): Promise<void> {
  try {
    const row = await invoke<DocSummary>("save_document", { doc });
    const app = useApp.getState();
    const others = app.docs.filter((d) => d.id !== row.id);
    app.setDocs([row, ...others].sort((a, b) => b.updatedMs - a.updatedMs));
  } catch (e) {
    toast(`Could not save: ${e}`, "error");
  }
}

const LAST = "nudge-last-doc";

function rememberLastDoc(id: string): void {
  try {
    localStorage.setItem(LAST, id);
  } catch {
    // not remembered; the app opens on the first document instead
  }
}

export function lastDocId(): string | null {
  try {
    return localStorage.getItem(LAST);
  } catch {
    return null;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushSave();
  });
  window.addEventListener("beforeunload", () => void flushSave());
}
