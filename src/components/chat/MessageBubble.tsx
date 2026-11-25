// One message of the conversation.
//
// The writer's own messages are the material of the document, so they can
// be carried into it: dragged whole by the grip (or as any selection of
// their text), or sent to the caret with the arrow button. Suggest
// placement shows where one fits (editor/placement.ts): hovering scrolls
// the document there and flashes the sentence it would follow; pressing
// also puts the caret after it, for Add to document. The guide's replies
// render as Markdown, their [[cite:S:P:quote]] citations as pills that open
// the source viewer at the page and mark the passage, and their questions
// underlined. Its words can be copied, but carry no drag affordance: the
// document is the writer's. A review (the document's Review button) shows
// as a card of its own, each point with Work on this, which puts the point
// in the composer for the writer to take up — or not.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CITE_SCHEME, citationLabel, linkifyCitations, parseCiteHref } from "../../lib/ai/citations";
import { localLabel } from "../../lib/ai/localModels";
import { rehypeQuestions } from "../../lib/ai/questions";
import { modelLabel } from "../../lib/ai/models";
import { useApp, usePrefs } from "../../lib/store";
import type { ChatMessage, Source } from "../../lib/types";
import { SNIPPET_TYPE } from "../../editor/editor";
import { isInDocument } from "../../editor/placement";
import { ArrowIntoIcon, CopyIcon, EyeIcon, GripIcon, TargetIcon } from "../Icons";

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

/** A hast node's text, for a review point's "Work on this". */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nodeText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return String(node.value ?? "");
  return (node.children ?? []).map(nodeText).join("");
}

/** A reply as Markdown: citations as pills, questions underlined (unless
 *  turned off in Settings → Chat), and for a review, each point with a way
 *  to take it up. */
function ReplyMarkdown({ content, sources, review }: { content: string; sources: Source[]; review?: boolean }) {
  const md = useMemo(() => linkifyCitations(content), [content]);
  const underline = usePrefs((s) => s.underlineQuestions);
  const prefill = useApp((s) => s.prefillComposer);
  return (
    <div className="msg-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={underline ? [rehypeQuestions] : []}
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
          ...(review
            ? {
                li: ({ children, node }) => (
                  <li>
                    {children}
                    <button
                      className="take-up"
                      title="Put this point in your reply, to edit and send"
                      onClick={() => {
                        const point = plain(nodeText(node)).replace(/\s+/g, " ").trim().slice(0, 400);
                        prefill(`I'd like to take up this point from the review: “${point}”`);
                      }}
                    >
                      Work on this
                    </button>
                  </li>
                ),
              }
            : {}),
        }}
      >
        {md}
      </Markdown>
    </div>
  );
}

/** Suggest placement: hover shows where the message would fit, a press
 *  puts the caret there. Not for a message that's already in the document:
 *  then a small tip says so instead. The document is read at the moment of
 *  asking, so the bubbles don't re-render as it's typed in. */
function SuggestButton({ text }: { text: string }) {
  const suggest = useApp((s) => s.suggestPlacement);
  const [already, setAlready] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = (mode: "preview" | "place") => {
    const doc = useApp.getState().current?.content ?? "";
    if (isInDocument(doc, text)) {
      setAlready(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setAlready(false), 2500);
      return;
    }
    setAlready(false);
    suggest(text, mode);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <span className="tip-anchor">
      <button
        title={already ? undefined : "Show where this would fit in the document (press to put the caret there)"}
        onMouseEnter={() => attempt("preview")}
        onMouseLeave={() => setAlready(false)}
        onFocus={() => attempt("preview")}
        onClick={() => attempt("place")}
      >
        <TargetIcon size={13} /> Suggest placement
      </button>
      {already && (
        <span className="tip" role="status">
          This is already in your document.
        </span>
      )}
    </span>
  );
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
          <SuggestButton text={message.content} />
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
  const review = message.kind === "review";
  return (
    <div className={`msg msg-guide${review ? " msg-review" : ""}`}>
      {review && <div className="review-head">Review</div>}
      <ReplyMarkdown content={message.content} sources={sources} review={review} />
      <div className="msg-tools">
        <span className="msg-model">{review ? `Reviewed by ${who}` : who}</span>
        <button title="Copy" onClick={() => copyText(plain(message.content))}>
          <CopyIcon size={13} />
        </button>
      </div>
    </div>
  );
});

/** The reply (or review) as it streams in. */
export function StreamingBubble({ text, status, sources, review }: { text: string; status: string; sources: Source[]; review?: boolean }) {
  return (
    <div className={`msg msg-guide streaming${review ? " msg-review" : ""}`}>
      {review && <div className="review-head">Review</div>}
      {text ? (
        <ReplyMarkdown content={text} sources={sources} />
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
