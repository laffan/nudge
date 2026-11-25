// One message of the conversation.
//
// The writer's own messages are the material of the document, so they can
// be carried into it: dragged whole by the grip (or as any selection of
// their text), or sent to the caret with the arrow button. The guide's
// replies render as Markdown, their [[cite:S:P:quote]] citations as pills
// that open the source viewer at the page and mark the passage. Its words
// can be copied, but carry no drag affordance: the document is the
// writer's.
import { memo, useMemo, useState } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CITE_SCHEME, citationLabel, linkifyCitations, parseCiteHref } from "../../lib/ai/citations";
import { localLabel } from "../../lib/ai/localModels";
import { modelLabel } from "../../lib/ai/models";
import { useApp } from "../../lib/store";
import type { ChatMessage, Source } from "../../lib/types";
import { SNIPPET_TYPE } from "../../editor/editor";
import { ArrowIntoIcon, CopyIcon, EyeIcon, GripIcon } from "../Icons";

export function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  });
}

function CitePill({ href, sources }: { href: string; sources: Source[] }) {
  const openViewer = useApp((s) => s.openViewer);
  const cite = parseCiteHref(href);
  if (!cite) return null;
  const index = cite.work ?? (sources.length === 1 ? 1 : 0);
  const source = sources[index - 1];
  const label = citationLabel(cite);
  if (!source || !source.hasFile) {
    return (
      <span className="cite-pill dead" title={source?.title}>
        {sources.length > 1 && source ? `${shortName(source)} ` : ""}
        {label}
      </span>
    );
  }
  return (
    <button
      className="cite-pill"
      onClick={() => openViewer(source.id, cite.page, cite.quote || undefined)}
      title={cite.quote ? `${source.title}, p. ${cite.page}:\n“${cite.quote}”` : `${source.title}, p. ${cite.page}`}
    >
      <EyeIcon size={11} />
      {sources.length > 1 && <span className="cite-who">{shortName(source)}</span>}
      {label}
    </button>
  );
}

function shortName(s: Source): string {
  const who = (s.authors ?? "").split(/[,&;]| and | et al/)[0].trim();
  return who || s.title.split(/\s+/).slice(0, 2).join(" ");
}

/** Plain text of a reply, citations written out, for copying. */
function plain(content: string): string {
  return content.replace(/\[\[\s*(?:cite|p)\s*:\s*\d+\s*:\s*(\d+)(?:-\d+)?(?:\s*:[^\]]*)?\]\]/gi, "(p. $1)");
}

export const MessageBubble = memo(function MessageBubble({
  message,
  sources,
  onInsert,
}: {
  message: ChatMessage;
  sources: Source[];
  onInsert: (text: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const md = useMemo(() => (message.role === "assistant" ? linkifyCitations(message.content) : ""), [message]);

  if (message.role === "user") {
    return (
      <div
        className={`msg msg-user${dragging ? " dragging" : ""}`}
        onDragStart={(e) => {
          // A selection inside the message drags just itself; the grip
          // drags the whole message.
          const sel = window.getSelection();
          const inside = sel && !sel.isCollapsed && sel.anchorNode && e.currentTarget.contains(sel.anchorNode);
          const fromGrip = (e.target as HTMLElement).closest?.(".msg-grip");
          const text = !fromGrip && inside ? sel.toString().trim() : message.content;
          e.dataTransfer.setData(SNIPPET_TYPE, text);
          e.dataTransfer.setData("text/plain", text);
          e.dataTransfer.effectAllowed = "copy";
          setDragging(true);
        }}
        onDragEnd={() => setDragging(false)}
      >
        <div className="msg-user-body">
          <span className="msg-grip" draggable title="Drag into your document">
            <GripIcon size={14} />
          </span>
          <div className="msg-text">{message.content}</div>
        </div>
        <div className="msg-tools">
          <button title="Put into the document at the caret" onClick={() => onInsert(message.content)}>
            <ArrowIntoIcon size={13} /> Add to document
          </button>
          <button title="Copy" onClick={() => copyText(message.content)}>
            <CopyIcon size={13} />
          </button>
        </div>
      </div>
    );
  }

  const who = message.provider === "local" ? localLabel(message.model ?? "") : message.model ? modelLabel(message.model) : "";
  return (
    <div className="msg msg-guide">
      <div className="msg-md">
        <Markdown
          remarkPlugins={[remarkGfm]}
          urlTransform={(url) => (url.startsWith(CITE_SCHEME) ? url : defaultUrlTransform(url))}
          components={{
            a: ({ href, children }) =>
              parseCiteHref(String(href ?? "")) ? (
                <CitePill href={String(href)} sources={sources} />
              ) : (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
            table: ({ children }) => (
              <div className="md-table">
                <table>{children}</table>
              </div>
            ),
          }}
        >
          {md}
        </Markdown>
      </div>
      <div className="msg-tools">
        <span className="msg-model">{who}</span>
        <button title="Copy" onClick={() => copyText(plain(message.content))}>
          <CopyIcon size={13} />
        </button>
      </div>
    </div>
  );
});

/** The reply as it streams in. */
export function StreamingBubble({ text, status, sources }: { text: string; status: string; sources: Source[] }) {
  const md = useMemo(() => linkifyCitations(text), [text]);
  return (
    <div className="msg msg-guide streaming">
      {text ? (
        <div className="msg-md">
          <Markdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(url) => (url.startsWith(CITE_SCHEME) ? url : defaultUrlTransform(url))}
            components={{
              a: ({ href, children }) =>
                parseCiteHref(String(href ?? "")) ? <CitePill href={String(href)} sources={sources} /> : <a href={href}>{children}</a>,
            }}
          >
            {md}
          </Markdown>
        </div>
      ) : (
        <div className="msg-status">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          {status || "Thinking…"}
        </div>
      )}
    </div>
  );
}
