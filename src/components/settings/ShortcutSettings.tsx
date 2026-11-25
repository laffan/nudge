// Settings → Keyboard shortcuts: every binding, grouped as Hush groups
// them, each rebindable by pressing the new keys (Escape cancels,
// Backspace clears) and resettable to its default.
import { useEffect, useState } from "react";
import { SHORTCUTS, bindingOf, displayBinding, type ShortcutDef } from "../../editor/shortcuts";
import { shortcutKeyFromEvent } from "../../editor/shortcuts-core.js";
import { usePrefs } from "../../lib/store";

function record(e: KeyboardEvent): string | null {
  if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(shortcutKeyFromEvent(e));
  return parts.join("+");
}

function Row({ def }: { def: ShortcutDef }) {
  const overrides = usePrefs((s) => s.shortcuts);
  const setPref = usePrefs((s) => s.set);
  const [listening, setListening] = useState(false);
  const binding = bindingOf(def.id, overrides);
  const changed = def.id in overrides;
  const clash = SHORTCUTS.find((s) => s.id !== def.id && binding && bindingOf(s.id, overrides) === binding);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setListening(false);
      if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setPref("shortcuts", { ...overrides, [def.id]: "" });
        return setListening(false);
      }
      const combo = record(e);
      if (!combo) return;
      setPref("shortcuts", { ...overrides, [def.id]: combo });
      setListening(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, overrides, def.id, setPref]);

  return (
    <li className="shortcut-row">
      <span className="shortcut-label">
        {def.label}
        {clash && <span className="clash"> — also {clash.label}</span>}
      </span>
      <button className={`kbd${listening ? " listening" : ""}`} onClick={() => setListening(true)}>
        {listening ? "Press keys…" : displayBinding(binding)}
      </button>
      <button
        className="link reset"
        style={{ visibility: changed ? "visible" : "hidden" }}
        onClick={() => {
          const next = { ...overrides };
          delete next[def.id];
          setPref("shortcuts", next);
        }}
      >
        Reset
      </button>
    </li>
  );
}

export function ShortcutSettings() {
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return (
    <>
      <p className="hint">The document's shortcuts are Hush's. Press a binding to change it.</p>
      {groups.map((g) => (
        <section key={g}>
          <h3>{g}</h3>
          <ul className="shortcut-list">
            {SHORTCUTS.filter((s) => s.group === g).map((s) => (
              <Row key={s.id} def={s} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
