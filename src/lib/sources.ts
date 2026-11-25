// Sources: the PDFs and Zotero works attached to a document. Each PDF is
// copied into the app (so it reads, and is cited, offline) and its text
// read out once, page by page. A Zotero work also brings the writer's own
// annotations on its PDF and their notes — the part of their thinking
// that already exists — which the guide is given ahead of the text.
import { browserSaveFile } from "./browserBackend";
import { newId, updateCurrent } from "./documents";
import { extractPdf } from "./pdf/text";
import { toast, useApp } from "./store";
import { invoke, isTauri } from "./tauri";
import type { Source } from "./types";
import { downloadAttachment, fetchAnnotations, itemCreators, itemParts, itemTitle, itemYear, type ZItem } from "./zotero";

const textCache = new Map<string, string[]>();

/** A source's pages of text (from memory, else from disk). */
export async function sourcePages(id: string): Promise<string[]> {
  const hit = textCache.get(id);
  if (hit) return hit;
  try {
    const pages = await invoke<string[] | null>("load_source_text", { id });
    if (pages) {
      textCache.set(id, pages);
      return pages;
    }
  } catch {
    // no text kept: treated as none
  }
  return [];
}

async function storeFile(id: string, bytes: ArrayBuffer): Promise<void> {
  if (!isTauri) {
    browserSaveFile(id, bytes.slice(0));
    return;
  }
  await invoke("save_source_file", new Uint8Array(bytes), { headers: { "x-source-id": id } });
}

function patchSource(id: string, fn: (s: Source) => Source): void {
  updateCurrent((d) => ({ ...d, sources: d.sources.map((s) => (s.id === id ? fn(s) : s)) }));
}

function addSource(s: Source): void {
  updateCurrent((d) => ({ ...d, sources: [...d.sources, s] }));
}

/** Read a PDF's text and keep it; fills in pages and characters. */
async function readPdf(id: string, bytes: ArrayBuffer, fallbackTitle: string): Promise<Partial<Source>> {
  const { pages, title, author } = await extractPdf(bytes);
  textCache.set(id, pages);
  await invoke("save_source_text", { id, pages });
  const chars = pages.reduce((n, p) => n + p.length, 0);
  return {
    pageCount: pages.length,
    chars,
    ...(title && title.length > 3 && !/^untitled|\.docx?$|^microsoft word/i.test(title) ? { title } : { title: fallbackTitle }),
    ...(author ? { authors: author } : {}),
  };
}

export async function addPdfFiles(files: File[]): Promise<void> {
  const pdfs = files.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (pdfs.length < files.length) toast("Only PDFs can be attached");
  for (const file of pdfs) {
    const id = newId("src");
    const name = file.name.replace(/\.pdf$/i, "");
    addSource({ id, kind: "pdf", title: name, hasFile: true, fileName: file.name, addedMs: Date.now(), status: "reading" });
    try {
      const bytes = await file.arrayBuffer();
      await storeFile(id, bytes);
      const read = await readPdf(id, bytes, name);
      patchSource(id, (s) => ({ ...s, ...read, status: "ready" }));
      if (!read.chars) toast(`“${name}” has no text layer (probably a scan) — it can be viewed but not read by the guide`);
    } catch (e) {
      patchSource(id, (s) => ({ ...s, status: "error", error: String(e) }));
      toast(`Could not read “${name}”: ${e}`, "error");
    }
  }
}

export async function addZoteroItems(items: ZItem[]): Promise<void> {
  for (const item of items) {
    const id = newId("src");
    const title = itemTitle(item);
    addSource({
      id,
      kind: "zotero",
      title,
      authors: itemCreators(item),
      year: itemYear(item),
      abstract: String(item.data?.abstractNote ?? "").trim() || undefined,
      hasFile: false,
      zotero: { itemKey: item.key },
      addedMs: Date.now(),
      status: "reading",
    });
    try {
      const parts = await itemParts(item.key);
      if (!parts.pdfKey) {
        patchSource(id, (s) => ({ ...s, notes: parts.notes, status: "ready" }));
        toast(`“${title}” has no PDF in Zotero — its abstract and notes are attached`);
        continue;
      }
      const [bytes, annotations] = await Promise.all([
        downloadAttachment(parts.pdfKey),
        fetchAnnotations(parts.pdfKey).catch(() => []),
      ]);
      await storeFile(id, bytes);
      const read = await readPdf(id, bytes, title);
      patchSource(id, (s) => ({
        ...s,
        hasFile: true,
        fileName: parts.pdfName,
        pageCount: read.pageCount,
        chars: read.chars,
        zotero: { itemKey: item.key, attachmentKey: parts.pdfKey },
        annotations,
        notes: parts.notes,
        status: "ready",
      }));
    } catch (e) {
      patchSource(id, (s) => ({ ...s, status: "error", error: String(e) }));
      toast(`Could not attach “${title}”: ${e}`, "error");
    }
  }
}

export async function removeSource(id: string): Promise<void> {
  updateCurrent((d) => ({ ...d, sources: d.sources.filter((s) => s.id !== id) }));
  textCache.delete(id);
  if (useApp.getState().viewer?.sourceId === id) useApp.getState().closeViewer();
  try {
    await invoke("delete_source", { id });
  } catch {
    // the file may already be gone
  }
}

/** The bytes of a source's PDF, for the viewer. */
export async function sourceFile(id: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("read_source_file", { id });
}
