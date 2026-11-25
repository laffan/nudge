// The document column: the writer's text in Hush's editor, under its
// title, with the word count and the ways out (copy as Markdown, export a
// .md file). The editor is made afresh for each document, so undo never
// reaches into another one.
import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { countWords, createEditor, exportMarkdown, insertSnippet, type EditorHandles } from "../editor/editor";
import { updateCurrent } from "../lib/documents";
import { toast, useApp, usePrefs } from "../lib/store";
import { invoke, isTauri } from "../lib/tauri";
import { findPlacement, showPlacement } from "../editor/placement";
import { reviewDocument } from "../lib/ai/chat";
import { readyFor } from "../lib/settings";
import { copyText } from "./chat/MessageBubble";
import { CopyIcon, ExportIcon, ReviewIcon } from "./Icons";

export let activeEditor: EditorHandles | null = null;

async function exportFile(title: string, content: string): Promise<void> {
  const text = `# ${title}\n\n${exportMarkdown(content)}`;
  const name = `${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Untitled"}.md`;
  if (!isTauri) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }
  try {
    const path = await save({ defaultPath: name, filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (!path) return;
    await invoke("write_text_file", { path, contents: text });
    toast("Exported");
  } catch {
    // Where there is no save dialog (iPad), the clipboard will do.
    copyText(text);
    toast("Copied the document as Markdown");
  }
}

export function DocumentPane() {
  const docId = useApp((s) => s.current?.id);
  const title = useApp((s) => s.current?.title ?? "");
  const content = useApp((s) => s.current?.content ?? "");
  const insertRequest = useApp((s) => s.insertRequest);
  const placementRequest = useApp((s) => s.placementRequest);
  const goal = useApp((s) => s.current?.goal ?? "");
  const busy = useApp((s) => Boolean(s.streaming));
  const prefs = usePrefs();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorHandles | null>(null);
  const focusedOnce = useRef(false);
  const [words, setWords] = useState(0);

  // One editor per document.
  useEffect(() => {
    if (!host.current || !docId) return;
    const initial = useApp.getState().current?.content ?? "";
    setWords(countWords(initial));
    focusedOnce.current = false;
    let wordTimer: ReturnType<typeof setTimeout> | null = null;
    const ed = createEditor(
      host.current,
      initial,
      (text) => {
        updateCurrent((d) => ({ ...d, content: text }));
        if (wordTimer) clearTimeout(wordTimer);
        wordTimer = setTimeout(() => setWords(countWords(text)), 250);
      },
      {
        shortcuts: usePrefs.getState().shortcuts,
        focus: usePrefs.getState().focusMode,
        typewriter: usePrefs.getState().typewriter,
        spellcheck: usePrefs.getState().spellcheck,
      },
    );
    ed.view.contentDOM.addEventListener("focus", () => (focusedOnce.current = true));
    editor.current = ed;
    activeEditor = ed;
    return () => {
      if (wordTimer) clearTimeout(wordTimer);
      ed.view.destroy();
      if (activeEditor === ed) activeEditor = null;
      editor.current = null;
    };
  }, [docId]);

  useEffect(() => editor.current?.setShortcuts(prefs.shortcuts), [prefs.shortcuts]);
  useEffect(() => editor.current?.setModes(prefs.focusMode, prefs.typewriter), [prefs.focusMode, prefs.typewriter]);
  useEffect(() => editor.current?.setSpellcheck(prefs.spellcheck), [prefs.spellcheck]);

  // Suggest placement from the conversation (editor/placement.ts).
  useEffect(() => {
    const ed = editor.current;
    if (!placementRequest || !ed) return;
    const p = findPlacement(ed.view.state.doc.toString(), placementRequest.text);
    if (!p) {
      if (placementRequest.mode === "place") toast("The document is empty — Add to document will start it");
      return;
    }
    showPlacement(ed.view, p, placementRequest.mode === "place");
    if (placementRequest.mode === "place") focusedOnce.current = true;
  }, [placementRequest]);

  const review = () => {
    const app = useApp.getState();
    const ready = readyFor(app.settings, app.keys, "review");
    if (!ready.ok) {
      toast(ready.why ?? "The Review model isn't set up", "error");
      app.openSettings("ai");
      return;
    }
    void reviewDocument();
  };

  // "Add to document" from the conversation: at the caret if the writer has
  // been in the document, else at its end.
  useEffect(() => {
    const ed = editor.current;
    if (!insertRequest || !ed) return;
    const v = ed.view;
    const pos = focusedOnce.current ? v.state.selection.main.head : v.state.doc.length;
    insertSnippet(v, insertRequest.text, pos);
    focusedOnce.current = true;
  }, [insertRequest]);

  if (!docId) return <section className="document" />;
  return (
    <section
      className="document"
      style={
        {
          "--doc-font-size": `${prefs.fontSize}px`,
          "--doc-line-height": prefs.lineHeight,
          "--doc-font": `"${prefs.editorFont}", "iA Writer Quattro", Georgia, serif`,
          "--doc-column": `${prefs.columnWidth}px`,
        } as React.CSSProperties
      }
    >
      <header className="doc-head">
        <input
          className="doc-title-input"
          value={title}
          placeholder="Untitled"
          onChange={(e) => updateCurrent((d) => ({ ...d, title: e.target.value, titled: true }))}
        />
        <div className="doc-head-tools">
          {prefs.showWordCount && <span className="word-count">{words.toLocaleString()} words</span>}
          <button
            className="btn small review-btn"
            disabled={busy || !content.trim() || !goal.trim()}
            title={
              !goal.trim()
                ? "Set the document's goal first"
                : !content.trim()
                  ? "Write something to review first"
                  : "Assess the document against its goal; the advice goes into the conversation"
            }
            onClick={review}
          >
            <ReviewIcon size={14} /> Review
          </button>
          <button className="icon-btn" title="Copy as Markdown" onClick={() => { copyText(exportMarkdown(content)); toast("Copied as Markdown"); }}>
            <CopyIcon size={15} />
          </button>
          <button className="icon-btn" title="Export as a Markdown file" onClick={() => void exportFile(title, content)}>
            <ExportIcon size={15} />
          </button>
        </div>
      </header>
      <div className={`doc-editor${prefs.focusMode ? " focus" : ""}`} ref={host} />
    </section>
  );
}
