// The caret's look (Settings → Appearance → Caret), after Hush's cursor
// options: its shape (the usual line, a thicker line, a block or an
// underline), its colour, and what it does while the writer pauses (blink,
// a slow pulse, or nothing). caret.css draws them from classes on the
// editor's column and its `--caret` colour, which `caretClasses` and
// `caretColor` give.
//
// Also Hush's caret at rest (its caret-rest.js): when the keyboard is
// elsewhere — in the conversation, say — the caret stays where it was,
// faded, grey and still, instead of vanishing. Here that's where Add to
// document will put a message, so it shows only once the writer has
// placed the caret in this document (`data-placed` on the column, set by
// DocumentPane); before that, Add to document goes to the end. The plugin
// marks the editor `data-caret="rest"`, an attribute because CodeMirror
// rewrites the editor's classes as focus changes. It listens to the
// window's focus as well as the editor's, since CodeMirror's `cm-focused`
// can outlive the app being switched away from.
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";

export type CaretShape = "line" | "thick" | "block" | "underline";
export type CaretAnimation = "blink" | "pulse" | "none";

export const CARET_SHAPES: { value: CaretShape; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "thick", label: "Thick line" },
  { value: "block", label: "Block" },
  { value: "underline", label: "Underline" },
];

export const CARET_ANIMATIONS: { value: CaretAnimation; label: string }[] = [
  { value: "blink", label: "Blink" },
  { value: "pulse", label: "Pulse" },
  { value: "none", label: "None" },
];

/** The preset colours, each a token in tokens.css with a light and a
 *  dark value. A caret colour is one of these names, or a #hex of the
 *  writer's own. */
export const CARET_COLORS: { value: string; label: string }[] = [
  { value: "accent", label: "Accent" },
  { value: "ink", label: "Ink" },
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "violet", label: "Violet" },
  { value: "gold", label: "Gold" },
];

export function caretColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : `var(--caret-${CARET_COLORS.some((c) => c.value === value) ? value : "accent"})`;
}

export function caretClasses(shape: CaretShape, animation: CaretAnimation): string {
  return `caret-${shape} caret-anim-${animation}`;
}

export const caretRest = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    win: Window;
    schedule: () => void;

    constructor(readonly view: EditorView) {
      // Read once the focus has settled: mid-blur, the element gaining it
      // isn't active yet.
      this.schedule = () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.apply(), 0);
      };
      this.win = view.dom.ownerDocument.defaultView ?? window;
      this.win.addEventListener("focus", this.schedule);
      this.win.addEventListener("blur", this.schedule);
      view.dom.addEventListener("focusin", this.schedule);
      view.dom.addEventListener("focusout", this.schedule);
      this.apply();
    }

    update(u: ViewUpdate) {
      if (u.focusChanged) this.schedule();
    }

    apply() {
      if (this.view.hasFocus) this.view.dom.removeAttribute("data-caret");
      else this.view.dom.setAttribute("data-caret", "rest");
    }

    destroy() {
      clearTimeout(this.timer);
      this.win.removeEventListener("focus", this.schedule);
      this.win.removeEventListener("blur", this.schedule);
      this.view.dom.removeEventListener("focusin", this.schedule);
      this.view.dom.removeEventListener("focusout", this.schedule);
    }
  },
);
