// The document column: the writer's text in Hush's editor, under its
// title, with the word count, the ways out (copy, as Markdown or as a
// Google Doc; export a .md file) and, last, Review. The editor is made afresh for each document, so
// undo never reaches into another one. It answers the conversation's
// requests: Add to document, Suggest placement, and the words a reply or
// review points to ([[doc:…]]).
import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { countWords, createEditor, exportMarkdown, insertSnippet, type EditorHandles } from "../editor/editor";
import { updateCurrent } from "../lib/documents";
import { toast, useApp, usePrefs } from "../lib/store";
import { invoke, isTauri } from "../lib/tauri";
import { findInDocument, findPlacement, showPlacement } from "../editor/placement";
import { caretClasses, caretColor } from "../editor/caret";
import { copyText } from "./chat/MessageBubble";
import { CopyButton } from "./CopyButton";
import { ExportIcon } from "./Icons";
import { ReviewButton } from "./ReviewButton";

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
  const docFocusRequest = useApp((s) => s.docFocusRequest);
  const prefs = usePrefs();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorHandles | null>(null);
  // Whether the writer has placed the caret in this document. Until then
  // Add to document goes to the end, and the caret isn't shown at rest
  // (editor/caret.ts).
  const focusedOnce = useRef(false);
  const placed = () => {
    focusedOnce.current = true;
    host.current?.setAttribute("data-placed", "");
  };
  const [words, setWords] = useState(0);

  // One editor per document.
  useEffect(() => {
    if (!host.current || !docId) return;
    const initial = useApp.getState().current?.content ?? "";
    setWords(countWords(initial));
    focusedOnce.current = false;
    host.current.removeAttribute("data-placed");
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
    ed.view.contentDOM.addEventListener("focus", placed);
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
    if (placementRequest.mode === "place") placed();
  }, [placementRequest]);

  // A [[doc:…]] reference pressed in a reply or a review: scroll to those
  // words and light them.
  useEffect(() => {
    const ed = editor.current;
    if (!docFocusRequest || !ed) return;
    const found = findInDocument(ed.view.state.doc.toString(), docFocusRequest.text);
    if (!found) {
      toast("Those words aren't in the document any more");
      return;
    }
    showPlacement(ed.view, { ...found, insertAt: found.to }, false);
  }, [docFocusRequest]);

  // "Add to document" from the conversation: at the caret if the writer has
  // been in the document, else at its end.
  useEffect(() => {
    const ed = editor.current;
    if (!insertRequest || !ed) return;
    const v = ed.view;
    const pos = focusedOnce.current ? v.state.selection.main.head : v.state.doc.length;
    insertSnippet(v, insertRequest.text, pos);
    placed();
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
          <CopyButton />
          <button className="icon-btn" title="Export as a Markdown file" onClick={() => void exportFile(title, content)}>
            <ExportIcon size={15} />
          </button>
          <ReviewButton />
        </div>
      </header>
      <div
        className={`doc-editor ${caretClasses(prefs.caretShape, prefs.caretAnimation)}${prefs.focusMode ? " focus" : ""}`}
        style={{ "--caret": caretColor(prefs.caretColor) } as React.CSSProperties}
        ref={host}
      />
    </section>
  );
}
