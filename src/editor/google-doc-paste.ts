// A paste from Google Docs arrives as Markdown. Hush's paste conversion
// (editor/google-docs/html-to-markdown.js and paste-extension.js), in
// TypeScript and less what Hush needs for its two-way sync (comment
// markers, tab markers).
//
// Only a paste Google Docs made is converted, known by the
// `docs-internal-guid-…` id Google Docs puts on everything it copies. Any
// other paste — from the conversation, a web page, Word — goes in as plain
// text, as before. (Hush converts every rich paste.)
//
// Google Docs marks bold and italics with inline styles on spans
// (`font-weight:700`, `font-style:italic`) rather than <b> and <i>,
// highlights with a span's background colour, block quotes as paragraphs
// indented one level (it has no quote style), and list depth with
// `aria-level`, writing each item as a list of its own. All of that is
// read here, as well as the ordinary tags.
import { EditorView } from "@codemirror/view";

const GOOGLE_DOCS = /id="docs-internal-guid-/;
const STYLE_BOLD = /font-weight\s*:\s*(?:bold|[6-9]\d{2})/i;
const STYLE_ITALIC = /font-style\s*:\s*italic/i;
const STYLE_STRIKE = /text-decoration[^;]*line-through/i;
const STYLE_BG = /background(?:-color)?\s*:\s*([^;]+)/gi;
// Half a Google Docs indent level (36 pt): enough to count a paragraph as
// indented, allowing for rounding, while ignoring small hanging indents.
const QUOTE_INDENT_PT = 18;

interface Ctx {
  inPre: boolean;
  inHeading?: boolean;
}

/** `html` as Markdown when Google Docs made it, else null. */
export function googleDocToMarkdown(html: string): string | null {
  if (!html || !GOOGLE_DOCS.test(html)) return null;
  let root: HTMLElement | null;
  try {
    root = new DOMParser().parseFromString(html, "text/html").body;
  } catch {
    return null;
  }
  if (!root) return null;
  root.querySelectorAll("style, script, meta").forEach((n) => n.remove());
  // The whole copy is wrapped in <b id="docs-internal-guid-…">, which
  // would otherwise make everything bold.
  const wrap = root.querySelector('b[id^="docs-internal-guid-"]');
  if (wrap) {
    while (wrap.firstChild) wrap.parentNode!.insertBefore(wrap.firstChild, wrap);
    wrap.remove();
  }
  // Comment markers ([a], [b]…) that come along with commented text.
  root.querySelectorAll('a[href^="#cmnt"]').forEach((a) => (a.closest("sup") ?? a).remove());
  const out = renderChildren(root, { inPre: false });
  // Trailing spaces first, then blank-line runs; the other way round leaves
  // phantom blank lines.
  const md = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return md || null;
}

function renderChildren(node: Node, ctx: Ctx): string {
  let out = "";
  node.childNodes.forEach((child) => (out += renderNode(child, ctx)));
  return out;
}

function renderNode(node: Node, ctx: Ctx): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.nodeValue ?? "";
    // Google Docs keeps the whitespace between elements; runs of it,
    // non-breaking spaces included, read as one space.
    return ctx.inPre ? t : t.replace(/ /g, " ").replace(/\s+/g, " ");
  }
  if (!(node instanceof HTMLElement)) return "";
  const tag = node.tagName;
  switch (tag) {
    case "BR":
      return ctx.inPre ? "\n" : "  \n";
    case "HR":
      return "\n\n---\n\n";
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      return heading(node, Number(tag[1]), ctx);
    case "P":
    case "DIV":
      return paragraph(node, ctx);
    case "UL":
    case "OL":
      return listGroup(node, ctx);
    case "LI":
      return `- ${renderChildren(node, ctx).trim()}\n`;
    case "BLOCKQUOTE": {
      const inner = renderChildren(node, ctx).trim();
      return inner ? `\n\n${quoteLines(inner)}\n\n` : "";
    }
    case "PRE":
      return `\n\n\`\`\`\n${(node.textContent ?? "").replace(/\n+$/, "")}\n\`\`\`\n\n`;
    case "TABLE":
    case "THEAD":
    case "TBODY":
    case "TR":
    case "TD":
    case "TH":
      // Tables flatten to their cells' text.
      return renderChildren(node, ctx) + (tag === "TR" ? "\n" : tag === "TD" || tag === "TH" ? " | " : "");
    default:
      return inline(node, ctx);
  }
}

function heading(node: HTMLElement, level: number, ctx: Ctx): string {
  // A heading is bold already; Google Docs' own bold on its runs would
  // wrap every heading in **.
  const inner = renderChildren(node, { ...ctx, inHeading: true }).trim().replace(/\s*\n\s*/g, " ");
  return inner ? `\n\n${"#".repeat(level)} ${inner}\n\n` : "";
}

function paragraph(node: HTMLElement, ctx: Ctx): string {
  const inner = renderChildren(node, ctx);
  // Empty paragraphs (<p></p>, <p>&nbsp;</p>) between blocks add nothing.
  if (!inner.replace(/[\s ]+/g, "")) return "";
  const body = inner.trim();
  return indentPt(node) >= QUOTE_INDENT_PT ? `\n\n${quoteLines(body)}\n\n` : `\n\n${body}\n\n`;
}

/** A paragraph's left indent in points, from its inline style. */
function indentPt(node: HTMLElement): number {
  const style = node.getAttribute("style") ?? "";
  const m = /margin-left\s*:\s*([\d.]+)pt/i.exec(style) ?? /padding-left\s*:\s*([\d.]+)pt/i.exec(style);
  return m ? parseFloat(m[1]) : 0;
}

/** `> ` on each line. Google Docs' quote styling often makes a whole
 *  quoted line bold or italic: that's the style, not the writer's
 *  emphasis, so it's dropped. */
function quoteLines(body: string): string {
  return body
    .split("\n")
    .map((l) => {
      const t = stripWholeLineEmphasis(l);
      return t ? `> ${t}` : ">";
    })
    .join("\n");
}

function stripWholeLineEmphasis(line: string): string {
  const s = line.trim();
  if (!s.includes("*")) return s;
  const outside = s.replace(/\*\*[^*]+\*\*/g, "").replace(/\*[^*\s][^*]*\*/g, "");
  return /[A-Za-z0-9]/.test(outside) ? s : s.replace(/\*+/g, "");
}

interface Item {
  depth: number;
  ordered: boolean;
  content: string;
}

/** A run of lists as one list. Google Docs writes each item as a list of
 *  its own, its depth in `aria-level`; ordinary nested lists work too. */
function listGroup(first: HTMLElement, ctx: Ctx): string {
  if (first.dataset.nudgeConsumed) return "";
  const roots = [first];
  for (let next = nextElement(first); next && (next.tagName === "UL" || next.tagName === "OL"); next = nextElement(next)) {
    roots.push(next);
    next.dataset.nudgeConsumed = "1";
  }
  const items: Item[] = [];
  for (const r of roots) collectItems(r, items, 0, ctx);
  if (!items.length) return "";
  // Close up skipped levels (aria-level 1 then 3).
  const depths = [...new Set(items.map((it) => it.depth))].sort((a, b) => a - b);
  const counters: number[] = [];
  let out = "\n\n";
  for (const it of items) {
    const depth = depths.indexOf(it.depth);
    while (counters.length <= depth) counters.push(1);
    while (counters.length > depth + 1) counters.pop();
    const content = it.content.replace(/\s*\n\s*/g, " ").trim();
    if (!content) continue;
    out += `${"  ".repeat(depth)}${it.ordered ? `${counters[depth]++}.` : "-"} ${content}\n`;
  }
  return `${out}\n`;
}

function nextElement(el: Element): HTMLElement | null {
  let n = el.nextSibling;
  while (n && n.nodeType === Node.TEXT_NODE && !(n.nodeValue ?? "").trim()) n = n.nextSibling;
  return n instanceof HTMLElement ? n : null;
}

function collectItems(list: HTMLElement, items: Item[], fallbackDepth: number, ctx: Ctx): void {
  const ordered = list.tagName === "OL";
  for (const child of Array.from(list.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.tagName === "LI") {
      const aria = parseInt(child.getAttribute("aria-level") ?? "", 10);
      const depth = aria > 0 ? aria - 1 : fallbackDepth;
      let content = "";
      const nested: HTMLElement[] = [];
      child.childNodes.forEach((sub) => {
        if (sub instanceof HTMLElement && (sub.tagName === "UL" || sub.tagName === "OL")) nested.push(sub);
        else content += renderNode(sub, ctx);
      });
      items.push({ depth, ordered, content });
      for (const sub of nested) collectItems(sub, items, depth + 1, ctx);
    } else if (child.tagName === "UL" || child.tagName === "OL") {
      // Google Docs sometimes puts a list straight inside a list, with no
      // item between: one level deeper.
      collectItems(child, items, fallbackDepth + 1, ctx);
    }
  }
}

/** Emphasis from the element and its inline style, around its children. */
function inline(node: HTMLElement, ctx: Ctx): string {
  const tag = node.tagName;
  if (tag === "A" && node.hasAttribute("href")) {
    const href = realHref(node.getAttribute("href") ?? "");
    const text = renderChildren(node, ctx).replace(/\s*\n\s*/g, " ").trim();
    if (!text) return href ? `[${href}](${href})` : "";
    return !href || href === text ? text : `[${text}](${href})`;
  }
  if (tag === "CODE" && node.parentElement?.tagName !== "PRE") {
    const t = (node.textContent ?? "").replace(/`/g, "");
    return t ? `\`${t}\`` : "";
  }
  const style = node.getAttribute("style") ?? "";
  // The last background declared is the one that shows.
  const bg = [...style.matchAll(STYLE_BG)].pop();
  const marks = {
    bold: (tag === "B" || tag === "STRONG" || STYLE_BOLD.test(style)) && !ctx.inHeading,
    italic: tag === "I" || tag === "EM" || STYLE_ITALIC.test(style),
    strike: tag === "S" || tag === "STRIKE" || tag === "DEL" || STYLE_STRIKE.test(style),
    highlight: tag === "MARK" || Boolean(bg && !plainBackground(bg[1])),
  };
  const inner = renderChildren(node, ctx);
  if (!inner || !Object.values(marks).some(Boolean)) return inner;
  // The marks go round the words, with the run's spaces outside them.
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  if (!core) return inner;
  let s = core;
  if (marks.highlight) s = `==${s}==`;
  if (marks.strike) s = `~~${s}~~`;
  if (marks.bold) s = `**${s}**`;
  if (marks.italic) s = `*${s}*`;
  return lead + s + trail;
}

function plainBackground(c: string): boolean {
  const x = c.toLowerCase().replace(/!important\s*$/, "").trim();
  return (
    !x ||
    ["transparent", "none", "inherit", "#fff", "#ffffff", "white"].includes(x) ||
    /^rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(x) ||
    /^rgba\([^)]*,\s*0\s*\)$/.test(x)
  );
}

/** Links that come through Google's redirect (google.com/url?q=…), as
 *  where they go. */
function realHref(href: string): string {
  try {
    const u = new URL(href);
    if (u.hostname === "www.google.com" && u.pathname === "/url") return u.searchParams.get("q") ?? href;
  } catch {
    // not a full URL
  }
  return href;
}

export const googleDocPaste = EditorView.domEventHandlers({
  paste(event, view) {
    const md = googleDocToMarkdown(event.clipboardData?.getData("text/html") ?? "");
    // Not from Google Docs, or nothing came of it (an image alone): the
    // ordinary paste.
    if (!md) return false;
    event.preventDefault();
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: md },
      selection: { anchor: from + md.length },
      scrollIntoView: true,
      userEvent: "input.paste",
    });
    return true;
  },
});
