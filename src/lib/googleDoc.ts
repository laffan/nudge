// Copy as Google Doc (the document's copy menu): the document as the small
// HTML subset Google Docs (and Word, Pages) read faithfully on paste, put
// on the clipboard as text/html beside the Markdown as text/plain, for
// places that take only text. Ported from Hush (editor/google-docs/
// markdown-to-html.js and copy-command.js), less Hush's tab markers and
// Google-comment syntax, which Nudge doesn't have.
//
// It handles the Markdown Nudge's editor writes, not Markdown at large:
// headings, paragraphs, lists (nested), block quotes, fenced code, rules,
// and inline bold, italics, strikethrough, code, links and ==highlights==.
// %%Comments%% are the writer's private notes and are left out, as in
// every export.

// Google Docs keeps CSS margins, so a space after each block reproduces
// the blank line between paragraphs; without it they paste flush together.
const BLOCK_SPACE = "10pt";
// Google Docs has no block-quote style: a paragraph indented one level
// (0.5 in) stands in for one.
const QUOTE_INDENT = "36pt";
// The pasted highlight's colour: Google Docs' own yellow, so it reads as
// one of its highlights. It belongs to the pasted document, not the app's
// look, so it isn't one of the tokens.
const HIGHLIGHT = "#fff475";

const LIST_RE = /^(\s*)(?:[-*+]|(\d+)[.)])\s+(.*)$/;
const HR_RE = /^\s*(?:---|\*\*\*|___)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const FENCE_RE = /^\s*```(\w*)\s*$/;

interface ListTree {
  ordered: boolean;
  items: { text: string; children: ListTree[] }[];
}

type Block =
  | { type: "hr" }
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph" | "blockquote" | "code"; text: string }
  | { type: "list"; list: ListTree };

export function markdownToHtml(md: string): string {
  if (!md) return "";
  const lines = md.replace(/%%[\s\S]*?%%/g, "").split(/\r?\n/);
  return parseBlocks(lines).map(renderBlock).join("");
}

function isBlockBoundary(line: string): boolean {
  return LIST_RE.test(line) || QUOTE_RE.test(line) || HEADING_RE.test(line) || FENCE_RE.test(line) || HR_RE.test(line);
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (HR_RE.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    if (FENCE_RE.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ type: "code", text: buf.join("\n") });
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (QUOTE_RE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) buf.push(QUOTE_RE.exec(lines[i++])![1]);
      blocks.push({ type: "blockquote", text: buf.join("\n") });
      continue;
    }
    if (LIST_RE.test(line)) {
      const { list, consumed } = parseList(lines, i);
      blocks.push({ type: "list", list });
      i += consumed;
      continue;
    }
    // A paragraph runs to a blank line or the start of another block.
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !isBlockBoundary(lines[i])) buf.push(lines[i++]);
    blocks.push({ type: "paragraph", text: buf.join("\n") });
  }
  return blocks;
}

function parseList(lines: string[], start: number): { list: ListTree; consumed: number } {
  const flat: { indent: number; ordered: boolean; text: string }[] = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST_RE.exec(lines[i]);
    if (m) {
      const indent = m[1].length;
      const ordered = Boolean(m[2]);
      // A numbered list straight after a bulleted one (or the reverse) is
      // a list of its own.
      if (flat.length && indent <= flat[0].indent && ordered !== flat[0].ordered) break;
      flat.push({ indent, ordered, text: m[3] });
      i++;
    } else if (lines[i].trim() === "") {
      // One blank line carries the list on when another item follows.
      if (i + 1 < lines.length && LIST_RE.test(lines[i + 1])) i++;
      else break;
    } else if (flat.length && /^\s+\S/.test(lines[i])) {
      // An item's wrapped continuation.
      flat[flat.length - 1].text += ` ${lines[i].trim()}`;
      i++;
    } else break;
  }
  return { list: nestList(flat), consumed: i - start };
}

function nestList(flat: { indent: number; ordered: boolean; text: string }[]): ListTree {
  const root: ListTree = { ordered: flat[0]?.ordered ?? false, items: [] };
  const stack = [{ list: root, indent: flat[0]?.indent ?? 0 }];
  for (const entry of flat) {
    while (stack.length > 1 && entry.indent < stack[stack.length - 1].indent) stack.pop();
    let top = stack[stack.length - 1];
    if (entry.indent > top.indent) {
      const last = top.list.items[top.list.items.length - 1];
      if (last) {
        const sub: ListTree = { ordered: entry.ordered, items: [] };
        last.children.push(sub);
        stack.push({ list: sub, indent: entry.indent });
        top = stack[stack.length - 1];
      }
    }
    top.list.items.push({ text: entry.text, children: [] });
  }
  return root;
}

const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ");

function renderBlock(block: Block): string {
  switch (block.type) {
    case "hr":
      return "<hr>";
    case "heading":
      // No top margin, so the browser's own heading margin doesn't stack on
      // the space after the block before.
      return `<h${block.level} style="margin:0 0 ${BLOCK_SPACE} 0">${renderInline(block.text)}</h${block.level}>`;
    case "paragraph":
      return `<p style="margin:0 0 ${BLOCK_SPACE} 0">${renderInline(oneLine(block.text))}</p>`;
    case "blockquote":
      return `<p style="margin:0 0 ${BLOCK_SPACE} 0;margin-left:${QUOTE_INDENT}">${renderInline(oneLine(block.text))}</p>`;
    case "code":
      return `<pre style="margin:0 0 ${BLOCK_SPACE} 0"><code>${escapeHtml(block.text)}</code></pre>`;
    case "list":
      return renderList(block.list);
  }
}

function renderList(list: ListTree): string {
  const tag = list.ordered ? "ol" : "ul";
  const items = list.items.map((item) => `<li>${renderInline(item.text)}${item.children.map(renderList).join("")}</li>`).join("");
  return `<${tag}>${items}</${tag}>`;
}

function renderInline(text: string): string {
  let s = escapeHtml(text);
  // Code first, so emphasis doesn't reach inside it.
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // Links, leaving image references alone.
  s = s.replace(/(^|[^!])\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, lead, t, u) => `${lead}<a href="${escapeAttr(stripQuotes(u))}">${t}</a>`);
  s = s.replace(/==([^=\n][^=\n]*?)==/g, (_, t) => `<mark style="background-color:${HIGHLIGHT}">${t}</mark>`);
  s = s.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_\n]+?)__/g, "<strong>$1</strong>");
  // Italics after bold, anchored so a bold run isn't partly taken.
  s = s.replace(/(^|[^*])\*([^*\n][^*\n]*?)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_\w])_([^_\n][^_\n]*?)_(?![_\w])/g, "$1<em>$2</em>");
  return s;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}

function stripQuotes(u: string): string {
  const t = u.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

/** Put `md` on the clipboard as formatted text (and as Markdown, for
 *  places that take only text). Must run inside the press that asked for
 *  it, which the clipboard requires. */
export async function copyAsGoogleDoc(md: string): Promise<boolean> {
  // A container element keeps some platforms' clipboard parsers from
  // dropping bare top-level elements.
  const html = `<meta charset="utf-8"><div>${markdownToHtml(md)}</div>`;
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([md], { type: "text/plain" }),
        }),
      ]);
      return true;
    } catch {
      // fall through to the older way
    }
  }
  return copyRichByCommand(html);
}

/** Without ClipboardItem (older web views): select the formatted text in
 *  a hidden editable element and copy that. */
function copyRichByCommand(html: string): boolean {
  const host = document.createElement("div");
  host.contentEditable = "true";
  host.innerHTML = html;
  Object.assign(host.style, { position: "fixed", top: "-10000px", left: "-10000px", opacity: "0", pointerEvents: "none" });
  document.body.appendChild(host);
  try {
    const range = document.createRange();
    range.selectNodeContents(host);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = document.execCommand("copy");
    sel?.removeAllRanges();
    return ok;
  } catch {
    return false;
  } finally {
    host.remove();
  }
}
