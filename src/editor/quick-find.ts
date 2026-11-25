// Quick find (⌘F): Hush's minimal find for the document, with a replace
// that folds away.
//
// A small bar floats at the top of the document column. Typing marks every
// match and selects the first at or after the caret; ⌘G and ⌘⇧G (and
// ⇧↩) step through them, wrapping at the ends. Enter, or → at the end of
// the field, is the way out that keeps the place: the bar closes and the
// match stays selected in the document. Esc closes it too, and ⌘F again
// toggles it. Matching ignores case; there are no options for regular
// expressions, case or whole words, which a document this size doesn't
// need.
//
// The chevron at the head of the bar opens a second row, a replacement
// and Replace all. Replace all rewrites every match in one transaction,
// so a single undo takes it back, and then searches again, so the count
// shows what the replacement itself matches rather than looping over it.
// Whether that row is open outlives the bar, as in Hush: a writer who is
// replacing tends to keep replacing.
//
// Each editor owns its bar (a view plugin), so it goes when the document
// is closed. The commands below are function declarations because
// shortcuts.ts imports them and this module imports shortcuts.ts.
import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from "@codemirror/view";
import { usePrefs } from "../lib/store";
import { findMarks, setFindMarks, type FindRange } from "./find-highlight";
import { matchesDomEvent } from "./shortcuts-core.js";
import { bindingOf } from "./shortcuts";

let replaceOpen = false;
/** The last search, for ⌘G with the bar closed. */
let lastQuery = "";

const svg = (d: string, size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const CHEVRON = svg("m6 9 6 6 6-6", 13);
const CLOSE = svg("M6 6l12 12M18 6 6 18", 13);

/** Every match of `query` in `text`, ignoring case, none overlapping
 *  (which lets Replace all make them one change set). */
function findAll(text: string, query: string): FindRange[] {
  const out: FindRange[] = [];
  if (!query) return out;
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
    out.push({ from: i, to: i + needle.length });
  }
  return out;
}

const pressed = (e: KeyboardEvent, id: string) => matchesDomEvent(e, bindingOf(id, usePrefs.getState().shortcuts));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

class QuickFind {
  bar: HTMLDivElement | null = null;
  input!: HTMLInputElement;
  count!: HTMLSpanElement;
  twirl!: HTMLButtonElement;
  replaceRow!: HTMLDivElement;
  replaceInput!: HTMLInputElement;
  replaceBtn!: HTMLButtonElement;
  matches: FindRange[] = [];
  current = -1;
  /** "4 replaced", shown in the count's place for a moment. */
  note = "";
  noteTimer: ReturnType<typeof setTimeout> | undefined;
  rescanFrame = 0;

  constructor(readonly view: EditorView) {}

  get isOpen(): boolean {
    return this.bar !== null;
  }

  open(): void {
    const sel = this.view.state.selection.main;
    const picked = sel.empty ? "" : this.view.state.sliceDoc(sel.from, sel.to);
    if (!this.bar) this.build();
    // A selection on one line is what to find; otherwise start empty.
    this.input.value = picked && !picked.includes("\n") ? picked : "";
    this.search(true);
    this.input.focus();
    this.input.select();
  }

  /** Close the bar. The current match stays selected in the document. */
  close(focusEditor = true): void {
    if (!this.bar) return;
    this.teardown();
    this.view.dispatch({ effects: setFindMarks.of({ matches: [], current: -1 }) });
    if (focusEditor) this.view.focus();
  }

  step(by: 1 | -1): void {
    if (!this.matches.length) return;
    this.current = (this.current + by + this.matches.length) % this.matches.length;
    this.note = "";
    this.show(true);
  }

  private build(): void {
    const bar = el("div", "quick-find", { role: "search" });
    const row = el("div", "qf-row");
    this.twirl = el("button", "qf-twirl", { type: "button", title: "Replace" });
    this.twirl.innerHTML = CHEVRON;
    this.input = el("input", "qf-input", { type: "text", placeholder: "Find", spellcheck: "false", autocomplete: "off", "aria-label": "Find in the document" });
    this.count = el("span", "qf-count", { "aria-live": "polite" });
    const close = el("button", "qf-close", { type: "button", title: "Close (esc)", "aria-label": "Close find" });
    close.innerHTML = CLOSE;
    row.append(this.twirl, this.input, this.count, close);

    this.replaceRow = el("div", "qf-row qf-replace");
    this.replaceInput = el("input", "qf-input", { type: "text", placeholder: "Replace with", spellcheck: "false", autocomplete: "off", "aria-label": "Replace with" });
    this.replaceBtn = el("button", "qf-replace-all", { type: "button", title: "Replace every match in this document" });
    this.replaceBtn.textContent = "Replace all";
    this.replaceRow.append(this.replaceInput, this.replaceBtn);
    bar.append(row, this.replaceRow);

    // Clicks on the bar's buttons leave the focus where it was.
    bar.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("button")) e.preventDefault();
    });
    this.twirl.addEventListener("click", () => {
      this.setReplaceOpen(!replaceOpen);
      (replaceOpen ? this.replaceInput : this.input).focus();
    });
    close.addEventListener("click", () => this.close());
    this.replaceBtn.addEventListener("click", () => this.replaceAll());
    this.input.addEventListener("input", () => {
      this.note = "";
      this.search(true);
    });
    this.input.addEventListener("keydown", (e) => this.onFindKey(e));
    this.replaceInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        this.replaceAll();
      } else this.onStepKey(e);
    });

    const host = this.view.dom.parentElement ?? this.view.dom;
    host.appendChild(bar);
    this.bar = bar;
    this.setReplaceOpen(replaceOpen);
    this.makeRoom(host, true);
  }

  /** While the bar is up, the text starts below it (find.css,
   *  `data-finding`), so the document's first line isn't hidden under it.
   *  Further down, the scroll moves with the text, so nothing on screen
   *  shifts. */
  private makeRoom(host: HTMLElement, on: boolean): void {
    const scroller = this.view.scrollDOM;
    // The padding moves what's inside the content element, not the
    // element itself.
    const first = this.view.contentDOM.firstElementChild;
    const before = first?.getBoundingClientRect().top ?? 0;
    host.toggleAttribute("data-finding", on);
    const moved = (first?.getBoundingClientRect().top ?? 0) - before;
    if (moved && (scroller.scrollTop > 0 || !on)) scroller.scrollTop += moved;
  }

  private onFindKey(e: KeyboardEvent): void {
    if (e.isComposing) return;
    const plain = !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) this.step(-1);
      else this.close();
    } else if (e.key === "ArrowRight" && plain) {
      // → at the end of the field leaves for the match; anywhere else it
      // moves through the field as usual.
      const end = this.input.value.length;
      if (this.input.selectionStart === end && this.input.selectionEnd === end) {
        e.preventDefault();
        this.close();
      }
    } else if (pressed(e, "find")) {
      e.preventDefault();
      this.close();
    } else this.onStepKey(e);
  }

  /** ⌘G and ⌘⇧G from inside the bar, where the editor's keymap can't
   *  hear them. */
  private onStepKey(e: KeyboardEvent): void {
    if (pressed(e, "findNext")) {
      e.preventDefault();
      this.step(1);
    } else if (pressed(e, "findPrev")) {
      e.preventDefault();
      this.step(-1);
    }
  }

  private setReplaceOpen(open: boolean): void {
    replaceOpen = open;
    this.replaceRow.hidden = !open;
    this.twirl.setAttribute("aria-expanded", String(open));
    this.twirl.setAttribute("aria-label", open ? "Hide replace" : "Show replace");
    this.bar?.classList.toggle("replacing", open);
  }

  /** Search again for what's in the field. `fromCaret` picks the first
   *  match at or after the selection; otherwise the current one is kept
   *  in range. */
  private search(fromCaret: boolean): void {
    const query = this.input.value;
    lastQuery = query;
    this.matches = findAll(this.view.state.doc.toString(), query);
    if (!this.matches.length) {
      this.current = -1;
      this.show(false);
      return;
    }
    if (fromCaret) {
      const at = this.view.state.selection.main.from;
      const i = this.matches.findIndex((m) => m.from >= at);
      this.current = i === -1 ? 0 : i;
    } else {
      this.current = Math.min(Math.max(this.current, 0), this.matches.length - 1);
    }
    this.show(true);
  }

  /** Mark the matches and, with `select`, select the current one and
   *  bring it to the middle of the column. */
  private show(select: boolean): void {
    const marks = setFindMarks.of({ matches: this.matches, current: this.current });
    const m = this.matches[this.current];
    if (select && m) {
      this.view.dispatch({
        selection: EditorSelection.single(m.from, m.to),
        effects: [marks, EditorView.scrollIntoView(m.from, { y: "center" })],
      });
    } else {
      this.view.dispatch({ effects: marks });
    }
    this.updateCount();
  }

  private updateCount(): void {
    const q = this.input.value;
    const none = Boolean(q) && !this.matches.length;
    this.count.textContent = this.note || (!q ? "" : none ? "0/0" : `${this.current + 1}/${this.matches.length}`);
    this.count.classList.toggle("none", none && !this.note);
    this.replaceBtn.disabled = !this.matches.length;
  }

  private replaceAll(): void {
    if (!this.matches.length) return;
    const n = this.matches.length;
    const insert = this.replaceInput.value;
    this.view.dispatch({
      changes: this.matches.map((m) => ({ from: m.from, to: m.to, insert })),
      userEvent: "input.replace.all",
    });
    cancelAnimationFrame(this.rescanFrame);
    this.note = `${n} replaced`;
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => {
      this.note = "";
      if (this.bar) this.updateCount();
    }, 1800);
    this.search(true);
  }

  update(u: ViewUpdate): void {
    // Edits made in the document while the bar is up: find again, without
    // moving the writer's caret.
    if (u.docChanged && this.bar && !u.transactions.some((tr) => tr.isUserEvent("input.replace.all"))) {
      cancelAnimationFrame(this.rescanFrame);
      this.rescanFrame = requestAnimationFrame(() => {
        if (!this.bar) return;
        const at = this.view.state.selection.main.from;
        this.matches = findAll(this.view.state.doc.toString(), this.input.value);
        const i = this.matches.findIndex((m) => m.to >= at);
        this.current = this.matches.length ? (i === -1 ? 0 : i) : -1;
        this.show(false);
      });
    }
  }

  private teardown(): void {
    cancelAnimationFrame(this.rescanFrame);
    clearTimeout(this.noteTimer);
    if (this.bar?.parentElement) this.makeRoom(this.bar.parentElement, false);
    this.bar?.remove();
    this.bar = null;
    this.matches = [];
    this.current = -1;
    this.note = "";
  }

  destroy(): void {
    this.teardown();
  }
}

const quickFindPlugin = ViewPlugin.fromClass(QuickFind);

/** ⌘F: open the bar, or close it if it's open. */
export function openQuickFind(view: EditorView): boolean {
  const qf = view.plugin(quickFindPlugin);
  if (!qf) return false;
  if (qf.isOpen) qf.close();
  else qf.open();
  return true;
}

/** ⌘G / ⌘⇧G. With the bar closed, the last search is stepped through
 *  all the same, selecting each match in turn. */
function stepFind(view: EditorView, by: 1 | -1): boolean {
  const qf = view.plugin(quickFindPlugin);
  if (qf?.isOpen) {
    qf.step(by);
    return true;
  }
  const matches = findAll(view.state.doc.toString(), lastQuery);
  if (!matches.length) return false;
  const sel = view.state.selection.main;
  const m =
    by === 1
      ? (matches.find((r) => r.from >= sel.to) ?? matches[0])
      : ([...matches].reverse().find((r) => r.to <= sel.from) ?? matches[matches.length - 1]);
  view.dispatch({ selection: EditorSelection.single(m.from, m.to), effects: EditorView.scrollIntoView(m.from, { y: "center" }) });
  return true;
}

export function quickFindNext(view: EditorView): boolean {
  return stepFind(view, 1);
}

export function quickFindPrevious(view: EditorView): boolean {
  return stepFind(view, -1);
}

/** The bar and its marks, for the editor's extensions. Esc in the
 *  document closes the bar as well. */
export function quickFind(): Extension {
  return [
    findMarks,
    quickFindPlugin,
    Prec.high(
      keymap.of([
        {
          key: "Escape",
          run: (view) => {
            const qf = view.plugin(quickFindPlugin);
            if (!qf?.isOpen) return false;
            qf.close();
            return true;
          },
        },
      ]),
    ),
  ];
}
