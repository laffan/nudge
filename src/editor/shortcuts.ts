// Every keyboard shortcut, with its default binding and what it does.
// The editor's set is Hush's (its state-defaults.js and editor/commands.js),
// bound to the same commands — sentence navigation, formatting, paragraph
// moves — so the document edits the way Hush does. The app's own few
// (panels, new document, settings) sit beside them. Bindings use Hush's
// syntax ("Mod+Shift+L"), parsed by shortcuts-core.js (Hush's own parser),
// and can be rebound in Settings → Keyboard shortcuts.
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { findNext, findPrevious, openSearchPanel } from "@codemirror/search";
import {
  deleteToSentenceEnd,
  insertBreakAfter,
  insertBreakBefore,
  jumpToNextParagraph,
  jumpToNextSentence,
  jumpToPrevParagraph,
  jumpToPrevSentence,
  moveSentenceBack,
  moveSentenceForward,
  reduceSentenceSelection,
  selectParagraph,
  selectToParagraphAbove,
  selectToParagraphBelow,
  shiftSelectionToNextSentence,
  shiftSelectionToPreviousSentence,
} from "./sentence-navigator.js";
import { deleteSentence, deleteToSentenceStart } from "./sentence-delete.js";
import { selectSentenceOrSpan } from "./sentence-parenthetical.js";
import {
  toggleBlockquote,
  toggleBold,
  toggleComment,
  toggleHighlight,
  toggleItalic,
  toggleStrikethrough,
} from "./formatting.js";
import { joinLines, joinLinesUp } from "./join-lines.js";
import { findAllOccurrences, setInstanceHighlightsEffect } from "./select-instance-highlight.js";
import type { StateEffectType } from "@codemirror/state";

// Hush's effect is untyped JavaScript; it carries the ranges to tint.
const setHighlights = setInstanceHighlightsEffect as unknown as StateEffectType<unknown>;
import { usePrefs } from "../lib/store";

export interface ShortcutDef {
  id: string;
  label: string;
  group: "Writing" | "Sentences & paragraphs" | "Formatting" | "Find" | "App";
  binding: string;
  /** Editor commands run inside CodeMirror; app ones anywhere. */
  run?: (view: EditorView) => boolean;
}

function selectNextInstance(view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (sel.empty) {
    const line = view.state.doc.lineAt(sel.head);
    const text = line.text;
    let start = sel.head - line.from;
    let end = start;
    while (start > 0 && /\w/.test(text[start - 1])) start--;
    while (end < text.length && /\w/.test(text[end])) end++;
    if (start !== end) {
      view.dispatch({
        selection: { anchor: line.from + start, head: line.from + end },
        effects: setHighlights.of(findAllOccurrences(view.state.doc.toString(), text.slice(start, end))),
      });
    }
    return true;
  }
  const selected = view.state.sliceDoc(sel.from, sel.to);
  const docText = view.state.doc.toString();
  let next = docText.indexOf(selected, sel.to);
  if (next === -1) next = docText.indexOf(selected, 0);
  if (next !== -1 && next !== sel.from) {
    view.dispatch({
      selection: EditorSelection.single(next, next + selected.length),
      effects: setHighlights.of(findAllOccurrences(docText, selected)),
      scrollIntoView: true,
    });
  }
  return true;
}

function selectPreviousInstance(view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (sel.empty) return false;
  const selected = view.state.sliceDoc(sel.from, sel.to);
  const docText = view.state.doc.toString();
  let prev = docText.lastIndexOf(selected, sel.from - 1);
  if (prev === -1) prev = docText.lastIndexOf(selected);
  if (prev !== -1 && prev !== sel.from) {
    view.dispatch({
      selection: EditorSelection.single(prev, prev + selected.length),
      effects: setHighlights.of(findAllOccurrences(docText, selected)),
      scrollIntoView: true,
    });
  }
  return true;
}

const togglePref = (key: "focusMode" | "typewriter" | "showWordCount") => () => {
  const p = usePrefs.getState();
  p.set(key, !p[key]);
  return true;
};

type Cmd = (view: EditorView) => boolean;
const c = (f: unknown) => f as Cmd;

export const SHORTCUTS: ShortcutDef[] = [
  // Writing modes (Hush)
  { id: "toggleFocus", label: "Focus mode (dim all but the sentence you're in)", group: "Writing", binding: "Mod+S", run: togglePref("focusMode") },
  { id: "typewriter", label: "Typewriter mode", group: "Writing", binding: "Mod+Shift+T", run: togglePref("typewriter") },
  { id: "wordCount", label: "Show word count", group: "Writing", binding: "Mod+Shift+W", run: togglePref("showWordCount") },
  { id: "insertBreakAfter", label: "New line below", group: "Writing", binding: "Mod+Enter", run: c(insertBreakAfter) },
  { id: "insertBreakBefore", label: "New line above", group: "Writing", binding: "Mod+Shift+Enter", run: c(insertBreakBefore) },
  { id: "joinLines", label: "Join with the line below", group: "Writing", binding: "Mod+J", run: c(joinLines) },
  { id: "joinLinesUp", label: "Join with the line above", group: "Writing", binding: "Mod+Shift+J", run: c(joinLinesUp) },

  // Sentences and paragraphs (Hush's sentence navigator)
  { id: "selectSentence", label: "Select sentence (again to grow)", group: "Sentences & paragraphs", binding: "Mod+L", run: c(selectSentenceOrSpan) },
  { id: "reduceSentence", label: "Shrink selection by a sentence", group: "Sentences & paragraphs", binding: "Mod+Shift+L", run: c(reduceSentenceSelection) },
  { id: "jumpNextSentence", label: "Next sentence", group: "Sentences & paragraphs", binding: "Mod+ArrowRight", run: c(jumpToNextSentence) },
  { id: "jumpPrevSentence", label: "Previous sentence", group: "Sentences & paragraphs", binding: "Mod+ArrowLeft", run: c(jumpToPrevSentence) },
  { id: "nextSentence", label: "Select next sentence", group: "Sentences & paragraphs", binding: "Mod+Shift+ArrowRight", run: c(shiftSelectionToNextSentence) },
  { id: "prevSentence", label: "Select previous sentence", group: "Sentences & paragraphs", binding: "Mod+Shift+ArrowLeft", run: c(shiftSelectionToPreviousSentence) },
  { id: "moveSentenceForward", label: "Move sentence forward", group: "Sentences & paragraphs", binding: "Alt+Mod+ArrowRight", run: c(moveSentenceForward) },
  { id: "moveSentenceBack", label: "Move sentence back", group: "Sentences & paragraphs", binding: "Alt+Mod+ArrowLeft", run: c(moveSentenceBack) },
  { id: "deleteSentence", label: "Delete sentence", group: "Sentences & paragraphs", binding: "Mod+Backspace", run: c(deleteSentence) },
  { id: "deleteToSentenceStart", label: "Delete to sentence start", group: "Sentences & paragraphs", binding: "Mod+Shift+Backspace", run: c(deleteToSentenceStart) },
  { id: "deleteToSentenceEnd", label: "Delete to sentence end", group: "Sentences & paragraphs", binding: "Alt+Shift+Backspace", run: c(deleteToSentenceEnd) },
  { id: "jumpNextParagraph", label: "Next paragraph", group: "Sentences & paragraphs", binding: "Mod+ArrowDown", run: c(jumpToNextParagraph) },
  { id: "jumpPrevParagraph", label: "Previous paragraph", group: "Sentences & paragraphs", binding: "Mod+ArrowUp", run: c(jumpToPrevParagraph) },
  { id: "selectParagraph", label: "Select paragraph", group: "Sentences & paragraphs", binding: "Alt+Shift+L", run: c(selectParagraph) },
  { id: "selectParagraphUp", label: "Extend selection a paragraph up", group: "Sentences & paragraphs", binding: "Mod+Shift+ArrowUp", run: c(selectToParagraphAbove) },
  { id: "selectParagraphDown", label: "Extend selection a paragraph down", group: "Sentences & paragraphs", binding: "Mod+Shift+ArrowDown", run: c(selectToParagraphBelow) },

  // Formatting (Hush)
  { id: "bold", label: "Bold", group: "Formatting", binding: "Mod+B", run: c(toggleBold) },
  { id: "italic", label: "Italic", group: "Formatting", binding: "Mod+I", run: c(toggleItalic) },
  { id: "highlight", label: "==Highlight==", group: "Formatting", binding: "Mod+=", run: c(toggleHighlight) },
  { id: "comment", label: "%%Comment%% (kept out of exports)", group: "Formatting", binding: "Mod+/", run: c(toggleComment) },
  { id: "strikethrough", label: "Strikethrough", group: "Formatting", binding: "Mod+-", run: c(toggleStrikethrough) },
  { id: "blockquote", label: "Blockquote", group: "Formatting", binding: "Mod+.", run: c(toggleBlockquote) },

  // Find
  { id: "find", label: "Find & replace", group: "Find", binding: "Mod+F", run: openSearchPanel },
  { id: "findNext", label: "Find next", group: "Find", binding: "Mod+G", run: findNext },
  { id: "findPrev", label: "Find previous", group: "Find", binding: "Mod+Shift+G", run: findPrevious },
  { id: "selectNext", label: "Select next instance", group: "Find", binding: "Mod+D", run: selectNextInstance },
  { id: "selectPrevious", label: "Select previous instance", group: "Find", binding: "Mod+Shift+D", run: selectPreviousInstance },

  // App (run by the window-level handler in App.tsx)
  { id: "newDoc", label: "New document", group: "App", binding: "Mod+N" },
  { id: "toggleSidebar", label: "Show / hide the document list", group: "App", binding: "Mod+\\" },
  { id: "toggleViewer", label: "Show / hide the source viewer", group: "App", binding: "Mod+Shift+\\" },
  { id: "focusChat", label: "Go to the conversation", group: "App", binding: "Mod+1" },
  { id: "focusDocument", label: "Go to the document", group: "App", binding: "Mod+2" },
  { id: "attachZotero", label: "Attach from Zotero", group: "App", binding: "Mod+Shift+I" },
  { id: "settings", label: "Settings", group: "App", binding: "Mod+," },
];

/** The binding in force for `id`: the reader's, else the default. */
export function bindingOf(id: string, overrides: Record<string, string>): string {
  return overrides[id] ?? SHORTCUTS.find((s) => s.id === id)?.binding ?? "";
}

/** "Mod+Shift+L" as the keys show it on this platform: ⌘⇧L. */
export function displayBinding(b: string): string {
  if (!b) return "—";
  const mac = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
  const map: Record<string, string> = mac
    ? { Mod: "⌘", CmdOrCtrl: "⌘", Cmd: "⌘", Ctrl: "⌃", Shift: "⇧", Alt: "⌥", Option: "⌥" }
    : { Mod: "Ctrl+", CmdOrCtrl: "Ctrl+", Cmd: "Win+", Ctrl: "Ctrl+", Shift: "Shift+", Alt: "Alt+", Option: "Alt+" };
  const keys: Record<string, string> = {
    ArrowRight: "→", ArrowLeft: "←", ArrowUp: "↑", ArrowDown: "↓", Backspace: "⌫", Enter: "↩",
  };
  return b
    .split("+")
    .map((p) => map[p] ?? keys[p] ?? (p.length === 1 ? p.toUpperCase() : p))
    .join("");
}
