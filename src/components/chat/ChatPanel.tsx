// The conversation column. A new document opens on its goal screen: what
// the document is for, and the PDFs that bear on it. Once begun, the goal
// stays at the head (it can be edited), the sources sit under it, the
// conversation runs below, and the composer is at the foot.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { beginConversation, retryLast, sendMessage, stopReply } from "../../lib/ai/chat";
import { formatUsd } from "../../lib/ai/models";
import { updateCurrent } from "../../lib/documents";
import { providerLabel, providerReady } from "../../lib/settings";
import { useApp } from "../../lib/store";
import type { NudgeDoc } from "../../lib/types";
import { RetryIcon, SendIcon, StopIcon } from "../Icons";
import { MessageBubble, StreamingBubble } from "./MessageBubble";
import { AttachMenu, DropZone, SourceChip } from "./Sources";

function GoalSetup({ doc }: { doc: NudgeDoc }) {
  const [goal, setGoal] = useState(doc.goal);
  const settings = useApp((s) => s.settings);
  const ready = providerReady(settings);
  const openSettings = useApp((s) => s.openSettings);
  const reading = doc.sources.some((s) => s.status === "reading");
  const begin = () => void beginConversation(goal);
  return (
    <div className="goal-setup">
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
            <button className="link" onClick={() => openSettings(settings?.provider === "local" ? "offline" : "ai")}>
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

export function ChatPanel() {
  const doc = useApp((s) => s.current);
  const messages = useApp((s) => s.current?.messages);
  const sources = useApp((s) => s.current?.sources);
  const streaming = useApp((s) => (s.streaming && s.streaming.docId === s.current?.id ? s.streaming : null));
  const anyStreaming = useApp((s) => Boolean(s.streaming));
  const insert = useApp((s) => s.insertIntoDocument);
  const provider = useApp((s) => s.settings?.provider);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follow the conversation as it grows, unless the writer has scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages?.length, streaming?.text, streaming?.status]);

  if (!doc || !messages || !sources) return <section className="chat" />;
  const begun = messages.length > 0;
  if (!begun) {
    return (
      <section className="chat">
        <GoalSetup doc={doc} />
      </section>
    );
  }
  const last = messages[messages.length - 1];
  const awaiting = last.role === "user" && !streaming;
  return (
    <section className="chat">
      <header className="chat-head">
        <GoalCard doc={doc} />
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
        {streaming && <StreamingBubble text={streaming.text} status={streaming.status} sources={sources} />}
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
      <div className="chat-foot">
        {provider && <span>{providerLabel(provider)}</span>}
        {doc.costUsd > 0 && <span title="What this conversation has cost">{formatUsd(doc.costUsd)}</span>}
      </div>
    </section>
  );
}
