// Settings → Chat: how the conversation reads, kept on this device.
import { usePrefs } from "../../lib/store";

export function ChatSettings() {
  const p = usePrefs();
  return (
    <>
      <label className="field">
        <span>Font size — {p.chatFontSize}px</span>
        <input type="range" min={12} max={22} value={p.chatFontSize} onChange={(e) => p.set("chatFontSize", Number(e.target.value))} />
      </label>
      <div className="chat-sample" style={{ "--chat-font-size": `${p.chatFontSize}px` } as React.CSSProperties}>
        <div className="msg-md">
          That gives me a clear starting point. <span className={p.underlineQuestions ? "ask" : ""}>Who is this for?</span>
        </div>
        <div className="msg-text">It's for the hiring committee.</div>
      </div>
      <h3>The guide's replies</h3>
      <label className="check">
        <input type="checkbox" checked={p.underlineQuestions} onChange={(e) => p.set("underlineQuestions", e.target.checked)} />
        Underline what the guide asks you
      </label>
    </>
  );
}
