// Typewriter mode (⌘⇧T), after Hush's (editor/plugins/typewriter.js and
// its pane line): the line being written stays on a dashed line across
// the document column, and the text scrolls past it. The dashed line
// shows that the mode is on, and it can be dragged up or down to move the
// writing position; where it sits is kept as a fraction of the column's
// height (Prefs.typewriterPosition).
//
// The caret's line rests with its foot on the dashed line. Room above the
// first line and below the last (`--tw-top` and `--tw-runway`, document.css)
// lets the start and end of the document reach it too. The room below is
// padding on the content rather than on the scroller, because WebKit
// doesn't count a scroller's own bottom padding as scrollable, as Hush
// found; Nudge adds no blank lines to the document for it.
//
// A click puts its line on the dashed line only once the button is up.
// Scrolling while it's still down moves the text under the pointer, and
// CodeMirror reads the smallest movement after that as a drag, selecting
// from the click.
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { usePrefs } from "../lib/store";

/** How near the top or bottom of the column the line can be dragged. */
const MIN = 0.15;
const MAX = 0.85;

const clamp = (p: number) => Math.min(MAX, Math.max(MIN, p));

class Typewriter {
  line: HTMLDivElement;
  position = clamp(usePrefs.getState().typewriterPosition);
  resize: ResizeObserver;

  constructor(readonly view: EditorView) {
    this.line = document.createElement("div");
    this.line.className = "tw-line";
    this.line.title = "Typewriter mode: the line you write on. Drag it to move it.";
    this.line.setAttribute("role", "separator");
    this.line.setAttribute("aria-label", "Typewriter line");
    this.line.addEventListener("pointerdown", (e) => this.drag(e));
    // Turning the mode on brings the caret to the line; after that, a
    // change of size keeps it there only while the writer is in the text.
    this.resize = new ResizeObserver(() => this.layout(view.hasFocus));
    this.resize.observe(view.scrollDOM);
    this.layout(true);
  }

  /** Place the line and the room around the text for the column's
   *  height; then, with `align`, bring the caret's line to it. */
  layout(align: boolean): void {
    const { view } = this;
    // The editor is made before it's in the page; the line goes in beside
    // it once it is.
    const host = view.dom.parentElement;
    if (!host) return;
    if (this.line.parentElement !== host) host.appendChild(this.line);
    const h = view.scrollDOM.clientHeight;
    if (!h) return;
    const y = Math.round(this.position * h);
    this.line.style.top = `${view.scrollDOM.offsetTop + y}px`;
    // Above the text, room for the first line to sit on the dashed line;
    // below it, room for the last.
    const padTop = parseFloat(getComputedStyle(view.contentDOM).paddingTop) || 0;
    view.dom.style.setProperty("--tw-top", `${Math.max(0, y - padTop - view.defaultLineHeight)}px`);
    view.dom.style.setProperty("--tw-runway", `${h - y}px`);
    if (align) this.align();
  }

  /** Scroll so the foot of the caret's line sits on the dashed line. */
  align(): void {
    const view = this.view;
    view.requestMeasure({
      key: this,
      read: () => {
        const caret = view.coordsAtPos(view.state.selection.main.head);
        const box = view.scrollDOM.getBoundingClientRect();
        return caret ? caret.bottom - (box.top + this.position * view.scrollDOM.clientHeight) : 0;
      },
      write: (offset) => {
        if (Math.abs(offset) > 1) view.scrollDOM.scrollTop += offset;
      },
    });
  }

  drag(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const line = this.line;
    line.setPointerCapture(e.pointerId);
    line.classList.add("dragging");
    const move = (ev: PointerEvent) => {
      const box = this.view.scrollDOM.getBoundingClientRect();
      this.position = clamp((ev.clientY - box.top) / box.height);
      this.layout(true);
    };
    const up = () => {
      line.classList.remove("dragging");
      line.removeEventListener("pointermove", move);
      line.removeEventListener("pointerup", up);
      line.removeEventListener("pointercancel", up);
      usePrefs.getState().set("typewriterPosition", this.position);
    };
    line.addEventListener("pointermove", move);
    line.addEventListener("pointerup", up);
    line.addEventListener("pointercancel", up);
  }

  update(u: ViewUpdate): void {
    if (u.geometryChanged) this.layout(false);
    if (!(u.selectionSet || u.docChanged || u.focusChanged) || !u.view.hasFocus) return;
    if (u.transactions.some((tr) => tr.isUserEvent("select.pointer"))) {
      document.addEventListener("mouseup", () => this.align(), { once: true, capture: true });
      return;
    }
    this.align();
  }

  destroy(): void {
    this.resize.disconnect();
    this.line.remove();
    this.view.dom.style.removeProperty("--tw-top");
    this.view.dom.style.removeProperty("--tw-runway");
  }
}

export const typewriterMode: Extension = [EditorView.editorAttributes.of({ class: "cm-typewriter" }), ViewPlugin.fromClass(Typewriter)];
