// Suggest placement: where in the document a message of the writer's
// would fit — the sentence it should follow — shown by scrolling there and
// briefly lighting that sentence up.
//
// It's worked out here, at once and offline, without a model: each sentence
// is scored by the words it shares with the message, rarer words counting
// for more (TF-IDF over the document's sentences, with light stemming), and
// helped by its neighbours' scores, so a sentence in the paragraph that's
// about the same thing wins over a stray match elsewhere. With nothing in
// common anywhere, the suggestion is the end of the document.
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export interface Placement {
  /** The sentence the text would follow. */
  from: number;
  to: number;
  /** Where the caret goes: just after that sentence. */
  insertAt: number;
}

const STOP = new Set(
  "the and for that with this from have are was were but not you your they their them what which when where who how why been has had will would could should can about into than then there these those also just more most some such very over only other its it's our out all any one two may might must being because while after before through between under again each both few own same so too here".split(" "),
);

function stem(w: string): string {
  return w.replace(/(?:ings?|edly|ed|es|ly|s)$/, "") || w;
}

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}']{3,}/gu) ?? []).filter((w) => !STOP.has(w)).map(stem);
}

interface Sentence {
  from: number;
  to: number;
  para: number;
  terms: string[];
}

/** The document's sentences, with where each is and which paragraph. */
function sentences(doc: string): Sentence[] {
  const out: Sentence[] = [];
  let para = 0;
  let pos = 0;
  for (const line of doc.split("\n")) {
    if (!line.trim()) {
      para++;
    } else {
      const re = /[^.!?]*(?:[.!?]+["'”’)\]]*|$)/g;
      for (let m = re.exec(line); m && m[0]; m = re.exec(line)) {
        const raw = m[0];
        const lead = raw.length - raw.trimStart().length;
        const text = raw.trim();
        if (text) out.push({ from: pos + m.index + lead, to: pos + m.index + lead + text.length, para, terms: terms(text) });
        if (re.lastIndex === m.index) re.lastIndex++;
      }
      // A heading is a paragraph of its own.
      if (/^\s{0,3}#/.test(line)) para++;
    }
    pos += line.length + 1;
  }
  return out;
}

export function findPlacement(doc: string, text: string): Placement | null {
  const list = sentences(doc);
  if (list.length === 0) return null;
  const want = terms(text);
  const df = new Map<string, number>();
  for (const s of list) for (const t of new Set(s.terms)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = list.length;
  const wantSet = new Set(want);
  const own = list.map((s) => {
    if (s.terms.length === 0) return 0;
    let score = 0;
    for (const t of s.terms) if (wantSet.has(t)) score += Math.log(1 + n / (df.get(t) ?? 1));
    return score / Math.sqrt(s.terms.length);
  });
  let best = -1;
  let bestScore = 0;
  list.forEach((s, i) => {
    const near = (j: number) => (list[j] && list[j].para === s.para ? own[j] : 0);
    const score = own[i] + 0.35 * (near(i - 1) + near(i + 1));
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  const pick = best >= 0 ? list[best] : list[list.length - 1];
  return { from: pick.from, to: pick.to, insertAt: pick.to };
}

// The sentence's brief light (it fades out by itself in CSS).
const setFlash = StateEffect.define<{ from: number; to: number } | null>();
const flashMark = Decoration.mark({ class: "cm-placement-flash" });

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setFlash)) deco = e.value ? Decoration.set([flashMark.range(e.value.from, e.value.to)]) : Decoration.none;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const placementFlash: Extension = flashField;

let clearTimer: ReturnType<typeof setTimeout> | null = null;

/** Scroll to `p` and light its sentence up; with `place`, also put the
 *  caret after it. */
export function showPlacement(view: EditorView, p: Placement, place: boolean): void {
  if (clearTimer) clearTimeout(clearTimer);
  view.dispatch({
    effects: [setFlash.of({ from: p.from, to: p.to }), EditorView.scrollIntoView(p.from, { y: "center" })],
    ...(place ? { selection: { anchor: p.insertAt } } : {}),
  });
  if (place) view.focus();
  clearTimer = setTimeout(() => {
    if (view.dom.isConnected) view.dispatch({ effects: setFlash.of(null) });
  }, 1800);
}
