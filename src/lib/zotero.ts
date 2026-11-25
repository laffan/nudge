// Zotero on the frontend: reading the raw items the Rust core fetches
// (src-tauri/src/zotero.rs) into what a conversation needs — a work's
// title, authors and year; its PDF attachment; the writer's annotations
// on that PDF; and their notes. The annotation reading follows Zotero
// Helper's (lib/highlights.ts there): an annotation is an ordinary item
// whose `annotationPosition` is JSON giving its page and boxes, and whose
// `annotationSortIndex` sorts into reading order as a plain string.
import { invoke } from "./tauri";
import type { ZoteroAnnotation } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ZItem {
  key: string;
  version?: number;
  data: Record<string, any>;
  meta?: Record<string, any>;
}

export interface ZCollection {
  key: string;
  data: { name: string; parentCollection: string | false };
}

export function itemTitle(item: ZItem): string {
  return String(item.data?.title ?? "").trim() || "Untitled";
}

export function itemCreators(item: ZItem): string {
  const creators = (item.data?.creators ?? []) as any[];
  const names = creators
    .filter((c) => !c.creatorType || c.creatorType === "author" || c.creatorType === "editor")
    .map((c) => (c.lastName ? String(c.lastName) : String(c.name ?? "")))
    .filter(Boolean);
  if (names.length === 0) return String(item.meta?.creatorSummary ?? "");
  if (names.length <= 2) return names.join(" & ");
  return `${names[0]} et al.`;
}

export function itemYear(item: ZItem): string {
  const parsed = String(item.meta?.parsedDate ?? "");
  const m = /\d{4}/.exec(parsed || String(item.data?.date ?? ""));
  return m ? m[0] : "";
}

/** PDF text puts a break at every line and splits hyphenated words;
 *  collapse both so a highlight reads as the sentence it was. */
export function tidyHighlightText(raw: string): string {
  return raw
    .replace(/[\r\n]+/g, " ")
    .replace(/(\p{L})- (\p{Ll})/gu, "$1$2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function readAnnotation(item: ZItem): ZoteroAnnotation {
  const d = item.data;
  let pageIndex: number | null = null;
  let rects: number[][] | undefined;
  try {
    const pos = JSON.parse(String(d.annotationPosition ?? "{}"));
    if (typeof pos.pageIndex === "number") pageIndex = pos.pageIndex;
    if (Array.isArray(pos.rects)) rects = pos.rects;
  } catch {
    // an unreadable position: the annotation keeps its text, without a place
  }
  return {
    key: item.key,
    type: String(d.annotationType ?? "highlight"),
    color: String(d.annotationColor ?? "#ffd400").toLowerCase(),
    text: tidyHighlightText(String(d.annotationText ?? "")),
    comment: String(d.annotationComment ?? "").trim(),
    pageLabel: String(d.annotationPageLabel ?? ""),
    pageIndex,
    rects,
    sortIndex: String(d.annotationSortIndex ?? ""),
  };
}

/** Notes are HTML; the model and the reader want their words. */
export function noteText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("p, div, li, h1, h2, h3, h4, br").forEach((el) => el.append("\n"));
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

export async function fetchCollections(): Promise<ZCollection[]> {
  return invoke<ZCollection[]>("zotero_collections");
}

export async function searchItems(q: string, collection?: string): Promise<ZItem[]> {
  return invoke<ZItem[]>("zotero_search", { q, collection: collection || null });
}

export interface ItemParts {
  pdfKey?: string;
  pdfName?: string;
  notes: string[];
}

/** An item's PDF attachment (the first one, if several) and its notes. */
export async function itemParts(key: string): Promise<ItemParts> {
  const children = await invoke<ZItem[]>("zotero_children", { key });
  const pdf = children.find(
    (c) => c.data?.itemType === "attachment" && String(c.data?.contentType ?? "") === "application/pdf",
  );
  const notes = children
    .filter((c) => c.data?.itemType === "note")
    .map((c) => noteText(String(c.data?.note ?? "")))
    .filter(Boolean);
  return { pdfKey: pdf?.key, pdfName: pdf ? String(pdf.data?.filename ?? pdf.data?.title ?? "") : undefined, notes };
}

export async function fetchAnnotations(attKey: string): Promise<ZoteroAnnotation[]> {
  const raw = await invoke<ZItem[]>("zotero_annotations", { attKey });
  return raw
    .filter((i) => i.data?.itemType === "annotation")
    .map(readAnnotation)
    .sort((a, b) => (a.sortIndex < b.sortIndex ? -1 : a.sortIndex > b.sortIndex ? 1 : 0));
}

export async function downloadAttachment(attKey: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("zotero_download", { attKey });
}

/** Collections as a flat list in tree order, each with its depth. */
export function collectionTree(list: ZCollection[]): { c: ZCollection; depth: number }[] {
  const byParent = new Map<string, ZCollection[]>();
  for (const c of list) {
    const p = c.data.parentCollection || "";
    byParent.set(p, [...(byParent.get(p) ?? []), c]);
  }
  for (const kids of byParent.values()) kids.sort((a, b) => a.data.name.localeCompare(b.data.name));
  const out: { c: ZCollection; depth: number }[] = [];
  const walk = (parent: string, depth: number) => {
    for (const c of byParent.get(parent) ?? []) {
      out.push({ c, depth });
      walk(c.key, depth + 1);
    }
  };
  walk("", 0);
  return out;
}
