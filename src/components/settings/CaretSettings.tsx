// Settings → Appearance → Caret: the document caret's shape, colour and
// animation (editor/caret.ts), after Hush's cursor options, with a sample
// drawn by the same rules as the editor's caret (caret.css).
import { CARET_ANIMATIONS, CARET_COLORS, CARET_SHAPES, caretClasses, caretColor, type CaretAnimation, type CaretShape } from "../../editor/caret";
import { usePrefs } from "../../lib/store";

export function CaretSettings() {
  const p = usePrefs();
  const custom = p.caretColor.startsWith("#");
  return (
    <>
      <div
        className={`caret-sample ${caretClasses(p.caretShape, p.caretAnimation)}`}
        style={{ "--caret": caretColor(p.caretColor), "--doc-font": `"${p.editorFont}", "iA Writer Quattro", Georgia, serif` } as React.CSSProperties}
        aria-hidden
      >
        Every word of it is yours<span className="caret-demo" />
      </div>
      <div className="field-row">
        <label className="field">
          <span>Shape</span>
          <select value={p.caretShape} onChange={(e) => p.set("caretShape", e.target.value as CaretShape)}>
            {CARET_SHAPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>While you pause</span>
          <select value={p.caretAnimation} onChange={(e) => p.set("caretAnimation", e.target.value as CaretAnimation)}>
            {CARET_ANIMATIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field">
        <span>Colour</span>
        <div className="swatches" role="radiogroup" aria-label="Caret colour">
          {CARET_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={p.caretColor === c.value}
              aria-label={c.label}
              title={c.label}
              className={`swatch${p.caretColor === c.value ? " chosen" : ""}`}
              style={{ "--swatch": caretColor(c.value) } as React.CSSProperties}
              onClick={() => p.set("caretColor", c.value)}
            />
          ))}
          <label
            className={`swatch custom${custom ? " chosen" : ""}`}
            title="A colour of your own"
            style={custom ? ({ "--swatch": p.caretColor } as React.CSSProperties) : undefined}
          >
            <input
              type="color"
              aria-label="A colour of your own"
              value={custom ? p.caretColor : "#c8553d"}
              onChange={(e) => p.set("caretColor", e.target.value)}
            />
          </label>
        </div>
      </div>
    </>
  );
}
