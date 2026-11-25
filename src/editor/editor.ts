// The document editor: CodeMirror 6 with Hush's Markdown flavour (GFM plus
// ==highlights== and %%comments%%), Hush's keyboard shortcuts and writing
// modes, and one addition of Nudge's own — words dragged in from the
// conversation land where they are dropped, as a paragraph of their own
// when dropped between paragraphs.
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, dropCursor, EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { CommentExtension, HighlightExtension, commentMarkTag, commentTag, highlightMarkTag, highlightTag } from "./markdown-extensions.js";
import { moveLineKeymap } from "./move-line.js";
import { wrapOnSelection } from "./wrap-on-selection.js";
import { instanceHighlightField } from "./select-instance-highlight.js";
import { focusMode, typewriterMode } from "./modes";
import { placementFlash } from "./placement";
import { steadyClickFocus } from "./click-focus";
import { quickFind } from "./quick-find";
import { caretRest } from "./caret";
import { SHORTCUTS, bindingOf } from "./shortcuts";
import { toCodeMirrorKey } from "./shortcuts-core.js";

/** The drag type a conversation message carries (ChatMessage.tsx). */
export const SNIPPET_TYPE = "application/x-nudge-snippet";

// Hush's Markdown look (editor/markdown-highlight.js), with heading sizes
// at its default progression.
const HEADING = [1.8, 1.5, 1.3, 1.15, 1.05, 1.0];
const size = (n: number) => `calc(var(--doc-font-size) * ${HEADING[n - 1]})`;
const markdownStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: size(1), fontWeight: "700", lineHeight: "1.3" },
  { tag: tags.heading2, fontSize: size(2), fontWeight: "700", lineHeight: "1.3" },
  { tag: tags.heading3, fontSize: size(3), fontWeight: "600", lineHeight: "1.3" },
  { tag: tags.heading4, fontSize: size(4), fontWeight: "600" },
  { tag: tags.heading5, fontSize: size(5), fontWeight: "600" },
  { tag: tags.heading6, fontSize: size(6), fontWeight: "600" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.quote, fontStyle: "italic", opacity: "0.8" },
  { tag: tags.strikethrough, textDecoration: "line-through", opacity: "0.35" },
  { tag: tags.link, textDecoration: "underline", color: "var(--link)" },
  { tag: tags.url, textDecoration: "underline", opacity: "0.7", color: "var(--link)" },
  { tag: tags.monospace, fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: "0.9em" },
  { tag: commentTag, opacity: "0.45" },
  { tag: commentMarkTag, opacity: "0.2" },
  { tag: highlightTag, backgroundColor: "var(--doc-highlight)", borderRadius: "2px" },
  { tag: highlightMarkTag, opacity: "0.2" },
  { tag: tags.processingInstruction, opacity: "0.4" },
]);

// CodeMirror's default keymap with Hush's line moves in place of its own
// Alt-↑/↓ (editor/default-keymap.js there).
const DROPPED = new Set(["Alt-ArrowUp", "Alt-ArrowDown", "Shift-Alt-ArrowUp", "Shift-Alt-ArrowDown"]);
const baseKeymap = [...moveLineKeymap, ...defaultKeymap.filter((b) => !b.key || !DROPPED.has(b.key))];

export function shortcutKeymap(overrides: Record<string, string>): Extension {
  const bindings = SHORTCUTS.filter((s) => s.run).flatMap((s) => {
    const key = toCodeMirrorKey(bindingOf(s.id, overrides));
    return key ? [{ key, run: s.run!, preventDefault: true }] : [];
  });
  return keymap.of(bindings);
}

/** Put `text` into the document as a paragraph at `pos`, with blank lines
 *  around it unless it lands inside a line, where it reads inline. */
export function insertSnippet(view: EditorView, text: string, pos: number): void {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const clean = text.trim();
  let insert = clean;
  let from = pos;
  if (line.text.trim() === "" || pos === line.to || pos === line.from) {
    // A paragraph of its own.
    if (pos === line.to && line.text.trim() !== "") from = line.to;
    const before = doc.sliceString(Math.max(0, from - 2), from);
    const after = doc.sliceString(from, Math.min(doc.length, from + 2));
    const lead = from === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const trail = from >= doc.length ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    insert = lead + clean + trail;
  } else {
    // Mid-line: a phrase into a sentence.
    const prev = doc.sliceString(pos - 1, pos);
    const next = doc.sliceString(pos, pos + 1);
    insert = (prev && !/\s/.test(prev) ? " " : "") + clean + (next && !/[\s.,;:!?)]/.test(next) ? " " : "");
  }
  view.dispatch({
    changes: { from, insert },
    selection: { anchor: from + insert.trimEnd().length },
    scrollIntoView: true,
    userEvent: "input.drop",
  });
  view.focus();
}

const snippetDrop = EditorView.domEventHandlers({
  dragover(e) {
    if (e.dataTransfer?.types.includes(SNIPPET_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
    return false;
  },
  drop(e, view) {
    const text = e.dataTransfer?.getData(SNIPPET_TYPE);
    if (!text) return false;
    e.preventDefault();
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.doc.length;
    insertSnippet(view, text, pos);
    return true;
  },
});

export interface EditorHandles {
  view: EditorView;
  setShortcuts: (o: Record<string, string>) => void;
  setModes: (focus: boolean, typewriter: boolean) => void;
  setSpellcheck: (on: boolean) => void;
}

const textAttributes = (spellcheck: boolean) =>
  EditorView.contentAttributes.of({
    spellcheck: spellcheck ? "true" : "false",
    autocorrect: spellcheck ? "on" : "off",
    autocapitalize: "sentences",
  });

export function createEditor(
  parent: HTMLElement,
  content: string,
  onChange: (text: string) => void,
  opts: { shortcuts: Record<string, string>; focus: boolean; typewriter: boolean; spellcheck: boolean },
): EditorHandles {
  const keys = new Compartment();
  const spelling = new Compartment();
  const focus = new Compartment();
  const typewriter = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: content,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        EditorView.lineWrapping,
        EditorState.allowMultipleSelections.of(true),
        markdown({ base: markdownLanguage, extensions: [CommentExtension, HighlightExtension] }),
        syntaxHighlighting(markdownStyle),
        quickFind(),
        instanceHighlightField,
        wrapOnSelection,
        snippetDrop,
        steadyClickFocus,
        caretRest,
        placeholder("Your document. Write here, or drag your own words across from the conversation."),
        // Hush's shortcuts first, so they win over CodeMirror's defaults
        // where both claim a key (⌘←, ⌘→, ⌘⌫…).
        keys.of(shortcutKeymap(opts.shortcuts)),
        keymap.of([...baseKeymap, ...historyKeymap, indentWithTab]),
        focus.of(opts.focus ? focusMode : []),
        typewriter.of(opts.typewriter ? typewriterMode : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
        spelling.of(textAttributes(opts.spellcheck)),
        placementFlash,
      ],
    }),
  });
  return {
    view,
    setShortcuts: (o) => view.dispatch({ effects: keys.reconfigure(shortcutKeymap(o)) }),
    setModes: (f, t) =>
      view.dispatch({
        effects: [focus.reconfigure(f ? focusMode : []), typewriter.reconfigure(t ? typewriterMode : [])],
      }),
    setSpellcheck: (on) => view.dispatch({ effects: spelling.reconfigure(textAttributes(on)) }),
  };
}

/** Words in Markdown text, leaving out its markup and %%comments%%. */
export function countWords(md: string): number {
  const text = md
    .replace(/%%[\s\S]*?%%/g, " ")
    .replace(/`{3}[\s\S]*?`{3}/g, " ")
    .replace(/[#>*_=~`[\]()-]/g, " ");
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu) ?? []).length;
}

/** Markdown for export: %%comments%% are the writer's private notes. */
export function exportMarkdown(md: string): string {
  return md.replace(/%%[\s\S]*?%%/g, "").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
