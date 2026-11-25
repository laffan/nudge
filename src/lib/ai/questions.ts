// The guide's questions, underlined in its replies, so what the writer is
// being asked stands out from the rest of the turn (a note on their last
// answer, a passage from a source).
//
// A question is a sentence ending in "?". `questionRanges` finds them in a
// run of text; `rehypeQuestions` applies that to each paragraph, list item
// and table cell of a rendered reply, across the bold, italics and links
// inside it, and wraps the question's text in <span class="ask"> — one span
// per piece of text, so the underline runs on unbroken. Citation pills and
// references to the document are left out of the sentence's text and
// never wrapped.
import type { Element, ElementContent, Root, Text } from "hast";

// Not a sentence's end: "e.g.", "p. 4", "Dr.", an initial.
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|pp?|dr|mrs?|ms|prof|st|no|vol|eds?|fig|al|ch|[A-Z])$/i;

/** [start, end) of each sentence in `text` that asks something. */
export function questionRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  const end = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
  let start = 0;
  for (let m = end.exec(text); m; m = end.exec(text)) {
    const stop = m.index + m[0].length;
    if (m[0][0] === "." && m[0].length === 1 && ABBREVIATION.test(text.slice(start, m.index))) continue;
    // Running on in lower case, it didn't end: 'You said "why bother?" earlier.'
    if (/^\s+\p{Ll}/u.test(text.slice(stop, stop + 4))) continue;
    if (m[0].includes("?")) {
      let from = start;
      // A lead-in ("Before anything else: who…?") isn't the question.
      const colon = text.slice(from, m.index).lastIndexOf(": ");
      if (colon >= 0 && text.slice(from + colon + 2, m.index).trim().split(/\s+/).length >= 3) from += colon + 2;
      // Nor what joins it to the lead-in: space, a dash, a citation pill.
      while (from < stop && /[\s⁠—–-]/.test(text[from])) from++;
      if (from < stop) out.push([from, stop]);
    }
    start = stop;
  }
  return out;
}

const BLOCKS = new Set(["p", "li", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "dd", "dt"]);
const NESTED_BLOCKS = new Set(["p", "ul", "ol", "blockquote", "pre", "table", "div", ...BLOCKS]);

/** A citation pill or a reference to the document (lib/ai/citations.ts
 *  makes them links of their own schemes). A reference's quoted words
 *  carry their own punctuation, which mustn't end the sentence around it;
 *  it has its own underline. */
function isCitation(el: Element): boolean {
  const href = String(el.properties?.href ?? "");
  return el.tagName === "a" && (href.startsWith("nudge-cite:") || href.startsWith("nudge-doc:"));
}

interface Piece {
  node: Text;
  parent: Element;
  at: number; // where its text starts in the block's text
}

/** The block's own text, in order, with where each piece of it came from.
 *  Blocks nested inside (a list in a list item) are left to themselves. */
function collect(block: Element): { text: string; pieces: Piece[] } {
  let text = "";
  const pieces: Piece[] = [];
  const walk = (el: Element) => {
    for (const child of el.children) {
      if (child.type === "text") {
        pieces.push({ node: child, parent: el, at: text.length });
        text += child.value;
      } else if (child.type === "element") {
        if (NESTED_BLOCKS.has(child.tagName)) continue;
        if (isCitation(child)) {
          text += "⁠"; // stands in for the pill: no letters, no full stop
          continue;
        }
        walk(child);
      }
    }
  };
  walk(block);
  return { text, pieces };
}

function wrap(block: Element): void {
  const { text, pieces } = collect(block);
  const ranges = questionRanges(text);
  if (ranges.length === 0) return;
  // Rebuild each touched parent's children with the question parts wrapped.
  const replaced = new Map<Text, ElementContent[]>();
  for (const p of pieces) {
    const from = p.at;
    const to = p.at + p.node.value.length;
    const cuts: ElementContent[] = [];
    let pos = from;
    for (const [a, b] of ranges) {
      const s = Math.max(a, from);
      const e = Math.min(b, to);
      if (s >= e) continue;
      if (s > pos) cuts.push({ type: "text", value: text.slice(pos, s) });
      cuts.push({
        type: "element",
        tagName: "span",
        properties: { className: ["ask"] },
        children: [{ type: "text", value: text.slice(s, e) }],
      });
      pos = e;
    }
    if (cuts.length === 0) continue;
    if (pos < to) cuts.push({ type: "text", value: text.slice(pos, to) });
    replaced.set(p.node, cuts);
  }
  const parents = new Set(pieces.filter((p) => replaced.has(p.node)).map((p) => p.parent));
  for (const parent of parents) {
    parent.children = parent.children.flatMap((c) => (c.type === "text" && replaced.has(c) ? replaced.get(c)! : [c]));
  }
}

export function rehypeQuestions() {
  return (tree: Root) => {
    const visit = (node: Root | Element) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        if (BLOCKS.has(child.tagName)) wrap(child);
        visit(child);
      }
    };
    visit(tree);
  };
}
