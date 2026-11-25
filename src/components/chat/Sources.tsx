// The sources attached to a document: chips under the conversation's head
// (a press opens the viewer; × detaches), the attach menu (a PDF from
// Files, or works from Zotero), and the drop zone the goal screen uses.
import { useRef, useState } from "react";
import { addPdfFiles, removeSource } from "../../lib/sources";
import { useApp } from "../../lib/store";
import type { Source } from "../../lib/types";
import { BookIcon, CloseIcon, PaperclipIcon, PdfIcon, Spinner } from "../Icons";

export function SourceChip({ source, n }: { source: Source; n: number }) {
  const openViewer = useApp((s) => s.openViewer);
  const viewing = useApp((s) => s.viewer?.sourceId === source.id);
  const notes = source.annotations?.length ?? 0;
  const detail = [
    source.authors,
    source.year,
    source.pageCount ? `${source.pageCount} pages` : "",
    notes ? `${notes} Zotero annotation${notes === 1 ? "" : "s"}` : "",
    source.status === "error" ? source.error : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className={`source-chip ${source.status}${viewing ? " viewing" : ""}`} title={`${source.title}\n${detail}`}>
      <button
        className="source-open"
        disabled={!source.hasFile}
        onClick={() => openViewer(source.id, 1)}
        title={source.hasFile ? "Open beside the conversation" : "No PDF to show"}
      >
        <span className="source-n">{n}</span>
        {source.status === "reading" ? <Spinner size={11} /> : source.kind === "zotero" ? <BookIcon size={13} /> : <PdfIcon size={13} />}
        <span className="source-title">{source.title}</span>
        {notes > 0 && <span className="source-notes">{notes}</span>}
      </button>
      <button className="source-x" title="Detach" onClick={() => void removeSource(source.id)}>
        <CloseIcon size={11} />
      </button>
    </span>
  );
}

/** A hidden file input, opened from a button: the Files picker on iPad. */
export function usePdfPicker(): [JSX.Element, () => void] {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept="application/pdf,.pdf"
      multiple
      hidden
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length) void addPdfFiles(files);
      }}
    />
  );
  return [input, () => ref.current?.click()];
}

export function AttachMenu() {
  const [open, setOpen] = useState(false);
  const [input, pick] = usePdfPicker();
  const zoteroReady = useApp((s) => Boolean(s.settings?.zoteroApiKey && s.settings?.zoteroLibraryId));
  const setPicker = useApp((s) => s.setZoteroPicker);
  const openSettings = useApp((s) => s.openSettings);
  return (
    <div className="attach-menu">
      {input}
      <button className="icon-btn" title="Attach a source" onClick={() => setOpen((o) => !o)}>
        <PaperclipIcon />
      </button>
      {open && (
        <>
          <div className="menu-scrim" onClick={() => setOpen(false)} />
          <div className="menu">
            <button
              onClick={() => {
                setOpen(false);
                pick();
              }}
            >
              <PdfIcon size={15} /> PDF from Files…
            </button>
            <button
              onClick={() => {
                setOpen(false);
                if (zoteroReady) setPicker(true);
                else openSettings("zotero");
              }}
            >
              <BookIcon size={15} /> From Zotero…{!zoteroReady && <span className="menu-note">set up first</span>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function DropZone() {
  const [over, setOver] = useState(false);
  const [input, pick] = usePdfPicker();
  const zoteroReady = useApp((s) => Boolean(s.settings?.zoteroApiKey && s.settings?.zoteroLibraryId));
  const setPicker = useApp((s) => s.setZoteroPicker);
  const openSettings = useApp((s) => s.openSettings);
  return (
    <div
      className={`drop-zone${over ? " over" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) void addPdfFiles(files);
      }}
    >
      {input}
      <PdfIcon size={22} />
      <div>
        Drop PDFs here, <button className="link" onClick={pick}>choose from Files</button>, or{" "}
        <button className="link" onClick={() => (zoteroReady ? setPicker(true) : openSettings("zotero"))}>
          add from Zotero
        </button>
        .
      </div>
    </div>
  );
}
