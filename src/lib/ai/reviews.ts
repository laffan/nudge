// A review as the review bar shows it: the reviewer's overall sentences,
// its points of advice, and anything it wrote after them. The reviewer is
// asked for a numbered list, each point opening with a short title in
// bold (prompts.ts); a bulleted list is accepted when there is no numbered
// one. The points are what the writer works on (Work on this) and marks
// complete or ignores, so their positions in the list are what a review's
// `done` and `ignored` and the document's `working` refer to.
//
// The reviewer is given its earlier reviews, each point marked with what
// the writer did with it (`earlierReviewsBlock`), so a new review can say
// what has been addressed since.
import type { NudgeDoc, Review } from "../types";
import { plainDocRefs } from "./citations";

export interface ReviewPoint {
  /** The number the reviewer gave it (or its position, for bullets). */
  n: number;
  /** The point's Markdown, without its list marker. */
  text: string;
  /** A few words naming it: its bold title, else its opening words. */
  title: string;
}

export interface ParsedReview {
  intro: string;
  points: ReviewPoint[];
  outro: string;
}

const NUMBERED = /^ {0,3}(\d{1,2})[.)]\s+(.*)$/;
const BULLET = /^ {0,3}[-*+]\s+(.*)$/;

function parseWith(lines: string[], marker: RegExp, numbered: boolean): ParsedReview | null {
  const intro: string[] = [];
  const outro: string[] = [];
  const points: { n: number; lines: string[] }[] = [];
  let state: "intro" | "list" | "outro" = "intro";
  let blank = false;
  for (const line of lines) {
    const m = state !== "outro" ? marker.exec(line) : null;
    if (m) {
      state = "list";
      points.push({ n: numbered ? Number(m[1]) : points.length + 1, lines: [numbered ? m[2] : m[1]] });
      blank = false;
      continue;
    }
    if (state === "intro") {
      intro.push(line);
    } else if (state === "list") {
      const isBlank = !line.trim();
      // Unindented text after a blank line ends the list.
      if (!isBlank && blank && !/^\s{2,}/.test(line)) {
        state = "outro";
        outro.push(line);
      } else {
        points[points.length - 1].lines.push(line.replace(/^ {1,4}/, ""));
      }
      blank = isBlank;
    } else {
      outro.push(line);
    }
  }
  if (points.length === 0) return null;
  return {
    intro: intro.join("\n").trim(),
    points: points.map((p) => {
      const text = p.lines.join("\n").trim();
      return { n: p.n, text, title: titleOf(text) };
    }),
    outro: outro.join("\n").trim(),
  };
}

export function parseReview(content: string): ParsedReview {
  const lines = content.split("\n");
  return parseWith(lines, NUMBERED, true) ?? parseWith(lines, BULLET, false) ?? { intro: content.trim(), points: [], outro: "" };
}

/** Plain words of a point's Markdown: references as their words, page
 *  citations and emphasis dropped. */
export function plainPoint(md: string): string {
  return plainDocRefs(md)
    .replace(/\[\[(?:[^\]]|\](?!\]))*\]\]/g, "")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function titleOf(text: string): string {
  const bold = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)/.exec(text);
  if (bold) return plainPoint(bold[1]).replace(/[\s:.,;—–-]+$/, "");
  const words = plainPoint(text).split(" ");
  return words.length > 8 ? `${words.slice(0, 8).join(" ")}…` : words.join(" ");
}

/** When a review was made, as the bar shows it: "Today, 2:14 pm". */
export function reviewWhen(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = (t: number) => new Date(t).toDateString();
  if (day(ts) === day(now)) return `Today, ${time}`;
  if (day(ts) === day(now - 86_400_000)) return `Yesterday, ${time}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const date = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  return `${date}, ${time}`;
}

export function latestReview(doc: NudgeDoc): Review | null {
  return doc.reviews.length ? doc.reviews[doc.reviews.length - 1] : null;
}

/** The point the writer is working on, if any, and the review it's from. */
export function workingPoint(doc: NudgeDoc): { review: Review; point: ReviewPoint; index: number; of: number } | null {
  const w = doc.working;
  if (!w) return null;
  const review = doc.reviews.find((r) => r.id === w.reviewId);
  if (!review) return null;
  const { points } = parseReview(review.content);
  const point = points[w.item];
  return point ? { review, point, index: w.item, of: points.length } : null;
}

/** A point as the reviewer reads it back: what the writer did with it. */
function pointStatus(doc: NudgeDoc, r: Review, i: number): string {
  if (r.done.includes(i)) return "The writer marked this complete.";
  if (r.ignored?.includes(i)) return "The writer chose to ignore this.";
  if (doc.working?.reviewId === r.id && doc.working.item === i) return "The writer is working on this.";
  return "Not marked by the writer.";
}

function reviewForReviewer(doc: NudgeDoc, r: Review): string {
  const when = new Date(r.ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const { intro, points, outro } = parseReview(r.content);
  const body = points.length
    ? [intro, points.map((p, i) => `${p.n}. ${p.text}\n   [${pointStatus(doc, r, i)}]`).join("\n"), outro].filter(Boolean).join("\n\n")
    : r.content.trim();
  return `## Review of ${when}${r.withSources === false ? " (made without the sources)" : ""}\n\n${body}`;
}

/** The document's reviews so far, for the next review: the newest that fit
 *  in `maxChars`, oldest first. Empty when there are none. */
export function earlierReviewsBlock(doc: NudgeDoc, maxChars: number): string {
  const kept: string[] = [];
  let used = 0;
  for (const r of [...doc.reviews].reverse()) {
    const text = reviewForReviewer(doc, r);
    if (kept.length && used + text.length > maxChars) break;
    kept.unshift(text.length > maxChars ? `${text.slice(0, maxChars)}\n[…]` : text);
    used += text.length;
  }
  if (!kept.length) return "";
  const left = doc.reviews.length - kept.length;
  const note = left ? `\n\n(${left} older review${left === 1 ? "" : "s"} left out.)` : "";
  return `<earlier_reviews>\n${kept.join("\n\n---\n\n")}${note}\n</earlier_reviews>`;
}
