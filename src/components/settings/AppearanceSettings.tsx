// Settings → Appearance: the theme, the document's look and its caret,
// kept on this device.
import { usePrefs, type Theme } from "../../lib/store";
import { CaretSettings } from "./CaretSettings";

const FONTS = ["iA Writer Quattro", "Georgia", "Charter", "Iowan Old Style", "Palatino", "Helvetica Neue", "Avenir Next"];

export function AppearanceSettings() {
  const p = usePrefs();
  return (
    <>
      <label className="field">
        <span>Theme</span>
        <select value={p.theme} onChange={(e) => p.set("theme", e.target.value as Theme)}>
          <option value="system">Follow the system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <h3>Document</h3>
      <label className="field">
        <span>Font</span>
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
      <h3>Caret</h3>
      <CaretSettings />
    </>
  );
}
