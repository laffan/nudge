// The conversation column. A new document opens on its goal screen: what
// the document is for, and the PDFs that bear on it. Once begun, the goal
// stays at the head (it can be edited), with the review bar attached under
// it once the document has been reviewed (ReviewBar.tsx) and the sources
// under that; the conversation runs below, and the composer is at the
// foot, over what the document has cost with each service.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { beginConversation, retryLast, sendMessage, stopReply } from "../../lib/ai/chat";
import { formatUsd, modelLabel } from "../../lib/ai/models";
import { documentCosts } from "../../lib/ai/usage";
import { updateCurrent } from "../../lib/documents";
import { providerLabel, choiceFor, readyFor } from "../../lib/settings";
import { useApp, usePrefs } from "../../lib/store";
import type { NudgeDoc, Provider } from "../../lib/types";
import { RetryIcon, SendIcon, StopIcon } from "../Icons";
import { MessageBubble, StreamingBubble } from "./MessageBubble";
import { ReviewBar } from "./ReviewBar";
import { AttachMenu, DropZone, SourceChip } from "./Sources";

function GoalSetup({ doc }: { doc: NudgeDoc }) {
  const [goal, setGoal] = useState(doc.goal);
  const settings = useApp((s) => s.settings);
  const keys = useApp((s) => s.keys);
  const ready = readyFor(settings, keys, "chat");
  const openSettings = useApp((s) => s.openSettings);
  const reading = doc.sources.some((s) => s.status === "reading");
  const begin = () => void beginConversation(goal);
  return (
    <div className="goal-setup">
      <label className="name-field">
        <span>Name</span>
        <input
          value={doc.title === "Untitled" && !doc.titled ? "" : doc.title}
          placeholder="Untitled"
          onChange={(e) => updateCurrent((d) => ({ ...d, title: e.target.value || "Untitled", titled: Boolean(e.target.value.trim()) }))}
        />
      </label>
      <h1>What is this document for?</h1>
      <p className="goal-hint">
        Say what you want to write and who it's for. Nudge will ask the questions; the answers — and every word of the
        document — are yours.
      </p>
      <textarea
        className="goal-input"
        autoFocus
        rows={4}
        value={goal}
        placeholder="e.g. A 1,500-word reflection for my teaching portfolio on how I use peer review in first-year seminars."
        onChange={(e) => setGoal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) begin();
        }}
      />
      <h2>Supporting sources</h2>
      <DropZone />
      {doc.sources.length > 0 && (
        <div className="source-strip setup">
          {doc.sources.map((s, i) => (
            <SourceChip key={s.id} source={s} n={i + 1} />
          ))}
        </div>
      )}
      <div className="goal-actions">
        {!ready.ok && (
          <span className="goal-warn">
            {ready.why} —{" "}
            <button className="link" onClick={() => openSettings(settings && choiceFor(settings, "chat").provider === "local" ? "offline" : "ai")}>
              open Settings
            </button>
          </span>
        )}
        <button className="btn primary" disabled={!goal.trim() || !ready.ok || reading} onClick={begin}>
          {reading ? "Reading sources…" : "Begin"}
        </button>
      </div>
    </div>
  );
}

function GoalCard({ doc }: { doc: NudgeDoc }) {
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState(doc.goal);
  if (editing) {
    return (
      <div className="goal-card editing">
        <textarea
          autoFocus
          rows={3}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        />
        <div className="goal-card-actions">
          <button className="btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              updateCurrent((d) => ({ ...d, goal: goal.trim() || d.goal }));
              setEditing(false);
            }}
          >
            Save goal
          </button>
        </div>
      </div>
    );
  }
  return (
    <button className="goal-card" title="Edit the goal" onClick={() => { setGoal(doc.goal); setEditing(true); }}>
      <span className="goal-label">Goal</span>
      <span className="goal-text">{doc.goal}</span>
    </button>
  );
}

function Composer({ busy }: { busy: boolean }) {
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const send = () => {
    const t = draft.trim();
    if (!t || busy) return;
    setDraft("");
    void sendMessage(t);
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [draft]);
  return (
    <div className="composer">
      <AttachMenu />
      <textarea
        id="chat-composer"
        ref={ref}
        rows={1}
        value={draft}
        placeholder="Your answer…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      {busy ? (
        <button className="send-btn stop" title="Stop" onClick={stopReply}>
          <StopIcon />
        </button>
      ) : (
        <button className="send-btn" title="Send (↩)" disabled={!draft.trim()} onClick={send}>
          <SendIcon />
        </button>
      )}
    </div>
  );
}

/** Under the composer: the service answering the chat, and what this
 *  document has cost with each service used for it (its conversation and
 *  its reviews), with the detail by model on hover. */
function CostFoot({ doc, chat }: { doc: NudgeDoc; chat: Provider | null }) {
  const costs = documentCosts(doc);
  const use = { chat: "chat", review: "review" } as const;
  return (
    <div className="chat-foot">
      {chat && !costs.some((c) => c.provider === chat) && <span>{providerLabel(chat)}</span>}
      {costs.map((c) => (
        <span
          key={c.provider}
          className="cost"
          title={c.parts.map((p) => `${p.model ? modelLabel(p.model) : "Unknown model"} (${use[p.use]}): ${formatUsd(p.costUsd)}`).join("\n")}
        >
          {providerLabel(c.provider)} {formatUsd(c.costUsd)}
        </span>
      ))}
    </div>
  );
}

export function ChatPanel() {
  const doc = useApp((s) => s.current);
  const messages = useApp((s) => s.current?.messages);
  const sources = useApp((s) => s.current?.sources);
  const streaming = useApp((s) => (s.streaming && s.streaming.docId === s.current?.id ? s.streaming : null));
  const anyStreaming = useApp((s) => Boolean(s.streaming));
  const insert = useApp((s) => s.insertIntoDocument);
  const chatUse = useApp((s) => (s.settings ? choiceFor(s.settings, "chat").provider : null));
  const fontSize = usePrefs((s) => s.chatFontSize);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follow the conversation as it grows, unless the writer has scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages?.length, streaming?.text, streaming?.status]);

  const style = { "--chat-font-size": `${fontSize}px` } as React.CSSProperties;
  if (!doc || !messages || !sources) return <section className="chat" style={style} />;
  const begun = messages.length > 0;
  if (!begun) {
    return (
      <section className="chat" style={style}>
        <GoalSetup doc={doc} />
      </section>
    );
  }
  const last = messages[messages.length - 1];
  const awaiting = last.role === "user" && !streaming;
  return (
    <section className="chat" style={style}>
      <header className="chat-head">
        <GoalCard doc={doc} />
        <ReviewBar key={doc.id} doc={doc} sources={sources} />
        <div className="source-strip">
          {sources.map((s, i) => (
            <SourceChip key={s.id} source={s} n={i + 1} />
          ))}
        </div>
      </header>
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {messages.map((m) =>
          m.kind === "kickoff" ? null : <MessageBubble key={m.id} message={m} sources={sources} onInsert={insert} />,
        )}
        {streaming?.kind === "reply" && <StreamingBubble text={streaming.text} status={streaming.status} sources={sources} />}
        {awaiting && (
          <div className="msg-retry">
            No reply yet.{" "}
            <button className="link" disabled={anyStreaming} onClick={() => void retryLast()}>
              <RetryIcon size={12} /> Ask again
            </button>
          </div>
        )}
      </div>
      <Composer busy={Boolean(streaming)} />
      <CostFoot doc={doc} chat={chatUse} />
    </section>
  );
}
