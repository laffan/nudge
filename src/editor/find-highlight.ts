// The marks quick find (quick-find.ts) puts on its matches: every match
// tinted, the current one stronger. Kept in a StateField so the marks map
// through edits until the next search replaces them. Hush's
// find-decorations.js, typed.
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export interface FindRange {
  from: number;
  to: number;
}

export const setFindMarks = StateEffect.define<{ matches: FindRange[]; current: number }>();

const match = Decoration.mark({ class: "cm-find-match" });
const current = Decoration.mark({ class: "cm-find-match cm-find-current" });

export const findMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setFindMarks)) {
        // Matches are found in document order, so they're already sorted.
        next = Decoration.set(e.value.matches.map((m, i) => (i === e.value.current ? current : match).range(m.from, m.to)));
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});
