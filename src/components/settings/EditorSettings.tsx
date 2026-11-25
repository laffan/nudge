// Settings → Editor: how the document editor behaves — Hush's writing
// modes, the word count, spelling — kept on this device. (Its look is
// under Appearance, its keys under Keyboard shortcuts.)
import { usePrefs } from "../../lib/store";

export function EditorSettings() {
  const p = usePrefs();
  return (
    <>
      <h3>Writing modes</h3>
      <label className="check">
        <input type="checkbox" checked={p.focusMode} onChange={(e) => p.set("focusMode", e.target.checked)} />
        Focus mode — dim everything but the sentence you're in (⌘S)
      </label>
      <label className="check">
        <input type="checkbox" checked={p.typewriter} onChange={(e) => p.set("typewriter", e.target.checked)} />
        Typewriter mode — the line you're on stays on a dashed line, which you can drag (⌘⇧T)
      </label>
      <h3>While writing</h3>
      <label className="check">
        <input type="checkbox" checked={p.showWordCount} onChange={(e) => p.set("showWordCount", e.target.checked)} />
        Show the word count (⌘⇧W)
      </label>
      <label className="check">
        <input type="checkbox" checked={p.spellcheck} onChange={(e) => p.set("spellcheck", e.target.checked)} />
        Check spelling and correct as you type
      </label>
    </>
  );
}
