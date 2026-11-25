// Turning a document into a request: what the guide is told once (the
// instructions, the goal, the sources — the stable head of every request,
// which the providers cache) and what changes each turn (the document as
// it now stands, and for the on-device model the source passages that
// bear on the moment), which rides with the writer's latest message.
//
// Online, each source goes in whole (up to a generous cap). On the device
// the whole request has to fit a few thousand tokens, so the budget is
// shared out: instructions and goal first, then the writer's annotations,
// the document, the passages retrieved for this turn, and as much of the
// conversation as is left, newest first.
import type { ChatMessage, NudgeDoc, Source, ZoteroAnnotation } from "../types";
import { sourcePages } from "../sources";
import { markedText } from "../pdf/text";
import { CITATIONS, GUIDE, REVIEW_SHARED, REVIEWER } from "./prompts";
import { retrieve } from "./retrieval";

/** Rough characters per token for English prose. */
const CPT = 3.6;

export interface Built {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
}

function annotationLines(list: ZoteroAnnotation[], maxChars: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const a of list) {
    if (!a.text && !a.comment) continue;
    const where = a.pageLabel ? `p. ${a.pageLabel}` : a.pageIndex != null ? `p. ${a.pageIndex + 1}` : "";
    const quoted = a.text ? `“${a.text}”` : "";
    const comment = a.comment ? `${quoted ? " — " : ""}their comment: ${a.comment}` : "";
    const line = `  - ${where ? `${where}: ` : ""}${quoted}${comment}`;
    if (used + line.length > maxChars) {
      lines.push("  - (more annotations omitted)");
      break;
    }
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}

function sourceHead(s: Source, n: number, annotationChars: number): string {
  const bits = [`## Source ${n}. ${s.title}`];
  if (s.authors) bits.push(`- Authors: ${s.authors}`);
  if (s.year) bits.push(`- Year: ${s.year}`);
  if (s.pageCount) bits.push(`- Pages: ${s.pageCount}`);
  if (s.annotations?.length) {
    bits.push("- The writer's annotations in Zotero (what they highlighted, and what they said about it):");
    bits.push(annotationLines(s.annotations, annotationChars));
  }
  if (s.notes?.length) bits.push(`- The writer's notes on this work:\n${s.notes.map((t) => `  > ${t.replace(/\n/g, "\n  > ")}`).join("\n")}`);
  if (s.abstract) bits.push(`- Abstract: ${s.abstract}`);
  if (!s.hasFile) bits.push("- (No PDF: only the details above are available.)");
  return bits.join("\n");
}

/** The document as the guide sees it, cut to `maxChars` (keeping its
 *  start and its end, where the writer is working). */
function documentBlock(content: string, maxChars: number): string {
  let text = content.trim();
  if (!text) text = "(Nothing written yet.)";
  else if (text.length > maxChars) {
    const head = Math.floor(maxChars * 0.3);
    text = `${text.slice(0, head)}\n\n[… middle of the document omitted …]\n\n${text.slice(text.length - (maxChars - head))}`;
  }
  return `<document>\n${text}\n</document>`;
}

function withContext(message: string, context: string): string {
  return `${context}\n\n${message}`;
}

/** The conversation as the guide reads it. A review is the reviewer's,
 *  not the guide's: it is passed on as something the writer shared. */
function asTurns(messages: ChatMessage[]): Built["messages"] {
  return messages.map((m) =>
    m.kind === "review" ? { role: "user", content: `${REVIEW_SHARED}\n\n${m.content}` } : { role: m.role, content: m.content },
  );
}

/** A review of the document against the goal. Online, the sources go in
 *  whole; on the device, the passages that bear on the document. */
export async function buildReview(doc: NudgeDoc, local: { nCtx: number; replyTokens: number } | null): Promise<Built> {
  const ready = doc.sources.filter((s) => s.status === "ready");
  const anyText = ready.some((s) => s.hasFile && (s.chars ?? 0) > 0);
  const parts: string[] = [];
  let docChars = 60_000;
  let passageBlock = "";
  if (!local) {
    const budget = Math.max(60_000, Math.floor(400_000 / Math.max(1, ready.length)));
    for (const s of ready) {
      let body = "";
      if (s.hasFile) {
        const { text, truncated } = markedText(await sourcePages(s.id), Math.min(150_000, budget));
        body = text ? `\n\n${text}${truncated ? "\n\n[… the rest of this source is not included …]" : ""}` : "";
      }
      parts.push(sourceHead(s, doc.sources.indexOf(s) + 1, 20_000) + body);
    }
  } else {
    const budget = Math.max(2000, (local.nCtx - local.replyTokens - 200) * CPT);
    for (const s of ready) parts.push(sourceHead(s, doc.sources.indexOf(s) + 1, Math.floor((budget * 0.1) / Math.max(1, ready.length))));
    docChars = Math.floor(budget * 0.45);
    const passages = anyText ? await retrieve(ready, `${doc.goal} ${doc.content}`.slice(0, 4000), Math.floor(budget * 0.25)) : [];
    if (passages.length) {
      passageBlock =
        "\n\n<passages>\nPassages from the sources that may bear on the draft:\n" +
        passages.map((p) => `Source ${p.sourceIndex}, [[page ${p.page}]]\n${p.text}`).join("\n\n") +
        "\n</passages>";
    }
  }
  const system = [
    REVIEWER,
    anyText ? CITATIONS : "",
    `# The writer's goal\n\n${doc.goal.trim() || "(not stated)"}`,
    parts.length ? `# Sources\n\n${parts.join("\n\n---\n\n")}` : "# Sources\n\nNo sources are attached.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    system,
    messages: [{ role: "user", content: `${documentBlock(doc.content, docChars)}${passageBlock}\n\nReview this draft against the goal.` }],
  };
}

/** For Anthropic and OpenAI: whole sources, cached between turns. */
export async function buildOnline(doc: NudgeDoc): Promise<Built> {
  const sourceBudget = Math.max(60_000, Math.floor(400_000 / Math.max(1, doc.sources.length)));
  const parts: string[] = [];
  for (const [i, s] of doc.sources.entries()) {
    if (s.status !== "ready") continue;
    let body = "";
    if (s.hasFile) {
      const { text, truncated } = markedText(await sourcePages(s.id), Math.min(150_000, sourceBudget));
      body = text ? `\n\n${text}${truncated ? "\n\n[… the rest of this source is not included …]" : ""}` : "\n\n(This PDF has no text layer.)";
    }
    parts.push(sourceHead(s, i + 1, 20_000) + body);
  }
  const system = [
    GUIDE,
    parts.length ? CITATIONS : "",
    `# The writer's goal\n\n${doc.goal.trim() || "(not stated)"}`,
    parts.length ? `# Sources\n\n${parts.join("\n\n---\n\n")}` : "# Sources\n\nNo sources are attached.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const messages = asTurns(doc.messages);
  const last = messages[messages.length - 1];
  if (last?.role === "user") last.content = withContext(last.content, documentBlock(doc.content, 60_000));
  return { system, messages };
}

/** For the on-device model: everything within `nCtx` tokens, leaving room
 *  for the reply. */
export async function buildLocal(doc: NudgeDoc, nCtx: number, replyTokens: number): Promise<Built> {
  const budget = Math.max(2000, (nCtx - replyTokens - 200) * CPT);
  const ready = doc.sources.filter((s) => s.status === "ready");
  const heads = ready.map((s) => sourceHead(s, doc.sources.indexOf(s) + 1, Math.floor((budget * 0.15) / Math.max(1, ready.length))));
  const anyText = ready.some((s) => s.hasFile && (s.chars ?? 0) > 0);
  const system = [
    GUIDE,
    anyText ? CITATIONS : "",
    `# The writer's goal\n\n${doc.goal.trim() || "(not stated)"}`,
    heads.length ? `# Sources\n\n${heads.join("\n\n")}` : "# Sources\n\nNo sources are attached.",
  ]
    .filter(Boolean)
    .join("\n\n");

  let left = budget - system.length;
  const docBlock = documentBlock(doc.content, Math.max(800, Math.floor(budget * 0.22)));
  left -= docBlock.length;

  // Passages that bear on the moment: the goal and the latest exchange.
  const recent = doc.messages.slice(-3).map((m) => m.content).join(" ");
  const passages = anyText
    ? await retrieve(ready, `${doc.goal} ${recent}`.slice(0, 2000), Math.max(0, Math.floor(Math.min(left * 0.5, budget * 0.3))))
    : [];
  let passageBlock = "";
  if (passages.length) {
    const sorted = [...passages].sort((a, b) => a.sourceIndex - b.sourceIndex || a.page - b.page);
    passageBlock =
      "<passages>\nPassages from the sources that may bear on this turn:\n" +
      sorted.map((p) => `Source ${p.sourceIndex}, [[page ${p.page}]]\n${p.text}`).join("\n\n") +
      "\n</passages>";
    left -= passageBlock.length;
  }

  // The conversation, newest first, while it fits (the goal itself is
  // already in the system prompt).
  const turns = asTurns(doc.messages);
  const kept: Built["messages"] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (i > 0 && left - t.content.length < 0 && kept.length >= 2) break;
    kept.unshift(t);
    left -= t.content.length;
  }
  // Start on a user turn, as chat formats expect.
  while (kept.length > 1 && kept[0].role !== "user") kept.shift();
  const last = kept[kept.length - 1];
  if (last?.role === "user") last.content = withContext(last.content, [docBlock, passageBlock].filter(Boolean).join("\n\n"));
  return { system, messages: kept };
}
