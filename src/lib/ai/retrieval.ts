// Passages for the on-device model. Its context is a few thousand tokens,
// not a few hundred thousand, so it can't be handed whole PDFs as the
// online models are. Instead each source is cut into passages (with the
// page each came from), and each turn the passages that best match what
// is being talked about — the goal, the writer's latest words, the last
// reply — are picked by BM25 (MiniSearch) until the budget is spent.
import MiniSearch from "minisearch";
import type { Source } from "../types";
import { sourcePages } from "../sources";

export interface Passage {
  id: string;
  sourceIndex: number; // 1-based, as the prompt numbers sources
  page: number;
  text: string;
}

const PASSAGE_CHARS = 900;

function cut(pages: string[], sourceIndex: number): Passage[] {
  const out: Passage[] = [];
  pages.forEach((page, i) => {
    const paras = page.split(/\n{2,}|(?<=[.!?])\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
    let buf = "";
    const flush = () => {
      if (buf.trim().length > 40) out.push({ id: `${sourceIndex}-${i + 1}-${out.length}`, sourceIndex, page: i + 1, text: buf.trim() });
      buf = "";
    };
    for (const p of paras) {
      if (buf.length + p.length > PASSAGE_CHARS && buf) flush();
      buf += (buf ? " " : "") + p;
      while (buf.length > PASSAGE_CHARS * 1.5) {
        const at = buf.lastIndexOf(". ", PASSAGE_CHARS) + 1 || PASSAGE_CHARS;
        const head = buf.slice(0, at);
        buf = buf.slice(at).trim();
        out.push({ id: `${sourceIndex}-${i + 1}-${out.length}`, sourceIndex, page: i + 1, text: head.trim() });
      }
    }
    flush();
  });
  return out;
}

let cache: { key: string; index: MiniSearch<Passage>; passages: Passage[] } | null = null;

async function indexFor(sources: Source[]): Promise<{ index: MiniSearch<Passage>; passages: Passage[] }> {
  const key = sources.map((s) => `${s.id}:${s.chars ?? 0}`).join("|");
  if (cache?.key === key) return cache;
  const passages: Passage[] = [];
  for (const [i, s] of sources.entries()) {
    if (!s.hasFile) continue;
    passages.push(...cut(await sourcePages(s.id), i + 1));
  }
  const index = new MiniSearch<Passage>({
    fields: ["text"],
    storeFields: ["id"],
    searchOptions: { prefix: true, fuzzy: 0.15 },
  });
  index.addAll(passages);
  cache = { key, index, passages };
  return cache;
}

/** The passages most relevant to `query`, best first, within `maxChars`. */
export async function retrieve(sources: Source[], query: string, maxChars: number): Promise<Passage[]> {
  if (maxChars <= 0) return [];
  const { index, passages } = await indexFor(sources);
  if (passages.length === 0) return [];
  const byId = new Map(passages.map((p) => [p.id, p]));
  const hits = index.search(query, { combineWith: "OR" });
  const picked: Passage[] = [];
  let used = 0;
  for (const h of hits) {
    const p = byId.get(String(h.id));
    if (!p) continue;
    if (used + p.text.length > maxChars) continue;
    picked.push(p);
    used += p.text.length;
    if (used > maxChars * 0.95) break;
  }
  // With nothing matched yet (an opening turn), the start of each source.
  if (picked.length === 0) {
    for (const p of passages) {
      if (used + p.text.length > maxChars) break;
      if (picked.some((q) => q.sourceIndex === p.sourceIndex && q.page === p.page)) continue;
      picked.push(p);
      used += p.text.length;
    }
  }
  return picked;
}
