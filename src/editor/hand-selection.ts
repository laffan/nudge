// Whether a change of selection was made by hand (the pointer or a finger:
// a click, a double-click, a drag, a long press, or a right-click, which
// on the Mac and iPad selects the word under it) or with the keys.
// CodeMirror labels both "select", so the two are told apart by which came
// last in the editor, a key press or a press of the pointer.
//
// The writing modes use it to leave a selection made by hand where it is.
// Typewriter mode would scroll it to its line, and on iPad focus mode would
// redraw the text around it; either moves the words out from under the
// menu macOS or iPadOS opens beside them (spelling, Look Up, Copy).
import { EditorView, type ViewUpdate } from "@codemirror/view";

interface Clock {
  key: number;
  hand: number;
}

const clocks = new WeakMap<EditorView, Clock>();

function clock(view: EditorView): Clock {
  let c = clocks.get(view);
  if (!c) clocks.set(view, (c = { key: 0, hand: 0 }));
  return c;
}

// Whether a button or finger is still down. A context menu takes the
// button's release for itself, so its opening counts as the release.
let held = false;
const release = () => {
  held = false;
};
for (const type of ["mouseup", "touchend", "touchcancel", "contextmenu"]) document.addEventListener(type, release, true);
window.addEventListener("blur", release);

/** Observers, not handlers, so they hear keys the keymaps take. */
export const handClock = EditorView.domEventObservers({
  keydown(_e, view) {
    clock(view).key = performance.now();
  },
  mousedown(_e, view) {
    clock(view).hand = performance.now();
    held = true;
  },
  touchstart(_e, view) {
    clock(view).hand = performance.now();
    held = true;
  },
});

export const pointerHeld = (): boolean => held;

/** The update moves the selection, and the writer did it by hand. */
export function byHand(u: ViewUpdate): boolean {
  if (u.docChanged || !u.transactions.some((tr) => tr.isUserEvent("select"))) return false;
  const c = clock(u.view);
  return c.hand > c.key;
}
