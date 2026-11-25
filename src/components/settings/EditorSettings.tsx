// Settings → Editor: the document's look and Hush's writing modes, kept on
// this device.
import { usePrefs, type Theme } from "../../lib/store";

const FONTS = ["iA Writer Quattro", "Georgia", "Charter", "Iowan Old Style", "Palatino", "Helvetica Neue", "Avenir Next"];

export function EditorSettings() {
  const p = usePrefs();
  return (
    <>
      <h3>Appearance</h3>
      <label className="field">
        <span>Theme</span>
        <select value={p.theme} onChange={(e) => p.set("theme", e.target.value as Theme)}>
          <option value="system">Follow the system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label className="field">
        <span>Document font</span>
        <select value={p.editorFont} onChange={(e) => p.set("editorFont", e.target.value)}>
          {FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Font size — {p.fontSize}px</span>
        <input type="range" min={13} max={28} value={p.fontSize} onChange={(e) => p.set("fontSize", Number(e.target.value))} />
      </label>
      <label className="field">
        <span>Line height — {p.lineHeight.toFixed(2)}</span>
        <input type="range" min={1.2} max={2.2} step={0.05} value={p.lineHeight} onChange={(e) => p.set("lineHeight", Number(e.target.value))} />
      </label>
      <label className="field">
        <span>Text column — {p.columnWidth}px wide at most</span>
        <input type="range" min={480} max={1100} step={20} value={p.columnWidth} onChange={(e) => p.set("columnWidth", Number(e.target.value))} />
      </label>
      <h3>Writing modes</h3>
      <label className="check">
        <input type="checkbox" checked={p.focusMode} onChange={(e) => p.set("focusMode", e.target.checked)} />
        Focus mode — dim everything but the sentence you're in (⌘S)
      </label>
      <label className="check">
        <input type="checkbox" checked={p.typewriter} onChange={(e) => p.set("typewriter", e.target.checked)} />
        Typewriter mode — keep the line you're on mid-column (⌘⇧T)
      </label>
      <label className="check">
        <input type="checkbox" checked={p.showWordCount} onChange={(e) => p.set("showWordCount", e.target.checked)} />
        Show the word count (⌘⇧W)
      </label>
    </>
  );
}
