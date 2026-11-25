// A PDF's text, page by page, read once when it is attached and kept beside
// it (sources/<id>.text.json). The model is given it with a page marker
// before each page — [[page 7]] — so it can cite the page a point rests
// on, and the citation can open the viewer there (lib/ai/citations.ts).
// Pages are PDF pages, not printed folios: that is what the viewer can
// show.
import { textItems } from "./pdfQuote";
import { openPdf } from "./pdfjs";

export interface ExtractedPdf {
  pages: string[];
  title: string;
  author: string;
}

/** Join a page's text items into lines and paragraphs, mending the words
 *  a line break hyphenated. */
function pageText(items: { str?: string; hasEOL?: boolean }[]): string {
  let out = "";
  for (const it of items) {
    if (typeof it.str !== "string") continue;
    out += it.str;
    if (it.hasEOL) out += "\n";
    else if (it.str && !it.str.endsWith(" ")) out += " ";
  }
  return out
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdf(bytes: ArrayBuffer): Promise<ExtractedPdf> {
  const doc = await openPdf(bytes);
  try {
    let title = "";
    let author = "";
    try {
      const meta = await doc.getMetadata();
      const info = (meta.info ?? {}) as Record<string, unknown>;
      title = String(info.Title ?? "").trim();
      author = String(info.Author ?? "").trim();
    } catch {
      // no metadata: the file name stands in
    }
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      try {
        pages.push(pageText(await textItems(page)));
      } catch {
        pages.push("");
      }
      page.cleanup();
    }
    return { pages, title, author };
  } finally {
    void doc.loadingTask.destroy();
  }
}

export function pageMarker(page: number): string {
  return `[[page ${page}]]`;
}

/** Pages as the model reads them, each after its marker, up to `maxChars`. */
export function markedText(pages: string[], maxChars: number): { text: string; truncated: boolean } {
  let text = "";
  for (let i = 0; i < pages.length; i++) {
    if (!pages[i].trim()) continue;
    const part = `${pageMarker(i + 1)}\n${pages[i]}\n\n`;
    if (text.length + part.length > maxChars) {
      return { text: text.trim(), truncated: true };
    }
    text += part;
  }
  return { text: text.trim(), truncated: false };
}
