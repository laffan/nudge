// The document's copy button, in its header: a menu of the two ways to
// copy the whole document. Markdown is the text as written; as a Google
// Doc it's formatted, to paste into Google Docs, Word or Pages
// (lib/googleDoc.ts). Both leave out the writer's %%comments%%.
import { useEffect, useState } from "react";
import { exportMarkdown } from "../editor/editor";
import { copyAsGoogleDoc } from "../lib/googleDoc";
import { toast, useApp } from "../lib/store";
import { copyText } from "./chat/MessageBubble";
import { CopyIcon } from "./Icons";

export function CopyButton() {
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  // Read the document when pressed, so the copy is of what's there now.
  const markdown = () => exportMarkdown(useApp.getState().current?.content ?? "");
  const copyMarkdown = () => {
    setMenu(false);
    copyText(markdown());
    toast("Copied as Markdown");
  };
  const copyGoogleDoc = () => {
    setMenu(false);
    void copyAsGoogleDoc(markdown()).then((ok) =>
      ok ? toast("Copied as a Google Doc — paste it into Google Docs") : toast("Couldn't copy the document", "error"),
    );
  };

  return (
    <div className="copy-split">
      <button className="icon-btn" title="Copy the document" aria-label="Copy the document" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
        <CopyIcon size={15} />
      </button>
      {menu && (
        <>
          <div className="menu-scrim" onClick={() => setMenu(false)} />
          <div className="menu copy-menu" role="menu">
            <button role="menuitem" onClick={copyMarkdown}>
              <span>
                Copy Markdown
                <small>The text as you wrote it, marks and all</small>
              </span>
            </button>
            <button role="menuitem" onClick={copyGoogleDoc}>
              <span>
                Copy as Google Doc
                <small>Formatted, for Google Docs or Word</small>
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
