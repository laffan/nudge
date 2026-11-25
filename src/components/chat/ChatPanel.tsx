// The conversation column. A new document opens on its goal screen: what
// the document is for, and the PDFs that bear on it. Once begun, the goal
// stays at the head (it can be edited), with the review bar attached under
// it once the document has been reviewed (ReviewBar.tsx) and the sources
// under that; the conversation runs below, and the composer is at the
// foot, over what the document has cost with each service and the switch
// between the online services and the on-device model.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { beginConversation, retryLast, sendMessage, stopReply } from "../../lib/ai/chat";
import { localLabel } from "../../lib/ai/localModels";
import { formatUsd, modelLabel } from "../../lib/ai/models";
import { documentCosts } from "../../lib/ai/usage";
import { updateCurrent } from "../../lib/documents";
import { chatChoice, choiceFor, modelOf, onlineChoice, providerLabel, readyFor } from "../../lib/settings";
import { toast, useApp, usePrefs } from "../../lib/store";
import type { NudgeDoc } from "../../lib/types";
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

/** Under the composer: what this document has cost with each service used
 *  for it (its conversation and its reviews), with the detail by model on
 *  hover, and to its right Use Local, which moves the conversation to the
 *  on-device model. There the costs give way to Use APIs, which moves it
 *  back. The move is this document's own (NudgeDoc.chatService); the
 *  sources go with it, as the on-device model reads them (context.ts). */
function CostFoot({ doc }: { doc: NudgeDoc }) {
  const settings = useApp((s) => s.settings);
  const keys = useApp((s) => s.keys);
  const openSettings = useApp((s) => s.openSettings);
  if (!settings) return <div className="chat-foot" />;
  const chat = chatChoice(settings, keys, doc).provider;
  const online = onlineChoice(settings, keys);
  const move = (to: "local" | "online") => {
    if (to === "local" && !settings.localModel) {
      toast("Download an on-device model first");
      openSettings("offline");
    } else if (to === "online" && !online) {
      toast("Add an API key first");
      openSettings("ai");
    } else updateCurrent((d) => ({ ...d, chatService: to }));
  };
  if (chat === "local") {
    return (
      <div className="chat-foot">
        <button
          className="foot-switch"
          title={online ? `Continue this conversation with ${modelLabel(modelOf(settings, online))}` : "Add an API key in Settings → AI"}
          onClick={() => move("online")}
        >
          Use APIs
        </button>
      </div>
    );
  }
  const costs = documentCosts(doc);
  const use = { chat: "chat", review: "review" } as const;
  return (
    <div className="chat-foot">
      {!costs.some((c) => c.provider === chat) && <span>{providerLabel(chat)}</span>}
      {costs.map((c) => (
        <span
          key={c.provider}
          className="cost"
          title={c.parts.map((p) => `${p.model ? modelLabel(p.model) : "Unknown model"} (${use[p.use]}): ${formatUsd(p.costUsd)}`).join("\n")}
        >
          {providerLabel(c.provider)} {formatUsd(c.costUsd)}
        </span>
      ))}
      <button
        className="foot-switch"
        title={settings.localModel ? `Continue this conversation with ${localLabel(settings.localModel)}, on this device` : "Download an on-device model in Settings → Offline model"}
        onClick={() => move("local")}
      >
        Use Local
      </button>
    </div>
  );
}

/** Words selected inside one of the writer's messages, and which message:
 *  its Add button then adds just those ("Add selection to document"). */
function useMessageSelection(): { id: string; text: string } | null {
  const [sel, setSel] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    const textOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>(".msg-user .msg-text") ?? null;
    const onChange = () => {
      const s = window.getSelection();
      let next: { id: string; text: string } | null = null;
      if (s && !s.isCollapsed) {
        const at = textOf(s.anchorNode);
        const id = at?.closest<HTMLElement>("[data-msg]")?.dataset.msg;
        const text = s.toString().trim();
        // Within one message only.
        if (at && at === textOf(s.focusNode) && id && text) next = { id, text };
      }
      setSel((prev) => (prev?.id === next?.id && prev?.text === next?.text ? prev : next));
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);
  return sel;
}

export function ChatPanel() {
  const doc = useApp((s) => s.current);
  const messages = useApp((s) => s.current?.messages);
  const sources = useApp((s) => s.current?.sources);
  const streaming = useApp((s) => (s.streaming && s.streaming.docId === s.current?.id ? s.streaming : null));
  const anyStreaming = useApp((s) => Boolean(s.streaming));
  const insert = useApp((s) => s.insertIntoDocument);
  const fontSize = usePrefs((s) => s.chatFontSize);
  const selected = useMessageSelection();
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
          m.kind === "kickoff" ? null : (
            <MessageBubble key={m.id} message={m} sources={sources} onInsert={insert} selection={selected?.id === m.id ? selected.text : undefined} />
          ),
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
      <CostFoot doc={doc} />
    </section>
  );
}
