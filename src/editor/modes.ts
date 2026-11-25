// Hush's two writing modes, for the document column.
//
// Focus mode dims everything but the sentence the caret is in (sentence
// boundaries from Hush's sentence-core, so ⌘L and the dimming agree on
// what a sentence is). Typewriter mode keeps the caret's line at the
// middle of the column, the text scrolling past it.
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { findSentenceEnd, findSentenceStart, offsetToPos, posToOffset } from "./sentence-core.js";

const dim = Decoration.mark({ class: "cm-unfocused" });

function focusDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const head = state.selection.main.head;
  const pos = offsetToPos(doc, head);
  let from = posToOffset(doc, findSentenceStart(doc, pos));
  let to = posToOffset(doc, findSentenceEnd(doc, pos));
  if (!state.selection.main.empty) {
    from = Math.min(from, state.selection.main.from);
    to = Math.max(to, state.selection.main.to);
  }
  const b = new RangeSetBuilder<Decoration>();
  if (from > 0) b.add(0, from, dim);
  if (to < doc.length) b.add(to, doc.length, dim);
  return b.finish();
}

export const focusMode: Extension = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = focusDecorations(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet) this.decorations = focusDecorations(u.view);
      }
    },
    { decorations: (p) => p.decorations },
  ),
  EditorView.editorAttributes.of({ class: "cm-focus-mode" }),
];

export const typewriterMode: Extension = [
  EditorView.editorAttributes.of({ class: "cm-typewriter" }),
  EditorView.updateListener.of((u) => {
    if (!(u.selectionSet || u.docChanged) || !u.view.hasFocus) return;
    const head = u.state.selection.main.head;
    // Not inside the update cycle: scroll on the next frame.
    requestAnimationFrame(() => {
      if (u.view.state.selection.main.head !== head) return;
      u.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
    });
  }),
];
