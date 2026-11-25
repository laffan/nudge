// A click back into the editor puts the caret where it lands, and selects
// nothing.
//
// The bug this fixes: with focus elsewhere (the conversation, the list),
// scrolling the document and clicking into it selected everything between
// the old caret and the click. CodeMirror reads the click's position in
// the document, then focuses the editor, then reads the position under the
// pointer again; when the two differ it selects between them, as for a
// drag. Safari 26's WebKit scrolls the editor on focus even when asked not
// to, back towards the selection it restores, so the second reading lands
// somewhere else. CodeMirror works around this for Safari 26, but it
// recognises Safari by the `Version/26` in its user agent, which the
// app's web view (WKWebView, on the Mac and the iPad) doesn't carry.
//
// So the editor is focused here first, before CodeMirror handles the
// press, and the scroll it had is put back: CodeMirror then finds an
// editor that already has focus, and reads both positions from the same
// layout. WebKit can also scroll a moment after the focus, so for the rest
// of the press (at most a quarter of a second) any scroll of the editor is
// undone too. A drag that runs past the edge still scrolls once the press
// has lasted longer than that.
import { EditorView } from "@codemirror/view";

const HOLD_MS = 250;

function hold(view: EditorView, top: number, left: number): void {
  const el = view.scrollDOM;
  const until = performance.now() + HOLD_MS;
  const keep = () => {
    if (performance.now() > until) return release();
    if (el.scrollTop !== top) el.scrollTop = top;
    if (el.scrollLeft !== left) el.scrollLeft = left;
  };
  const release = () => {
    el.removeEventListener("scroll", keep);
    document.removeEventListener("mouseup", release, true);
    clearTimeout(timer);
  };
  el.addEventListener("scroll", keep);
  document.addEventListener("mouseup", release, true);
  const timer = setTimeout(release, HOLD_MS);
}

export const steadyClickFocus = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (view.hasFocus || e.button !== 0) return false;
    const { scrollTop, scrollLeft } = view.scrollDOM;
    view.contentDOM.focus({ preventScroll: true });
    if (view.scrollDOM.scrollTop !== scrollTop) view.scrollDOM.scrollTop = scrollTop;
    if (view.scrollDOM.scrollLeft !== scrollLeft) view.scrollDOM.scrollLeft = scrollLeft;
    hold(view, scrollTop, scrollLeft);
    // CodeMirror goes on to place the caret.
    return false;
  },
});
