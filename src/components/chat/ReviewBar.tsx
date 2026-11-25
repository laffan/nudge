// The review bar, attached under the goal: the latest review of the
// document (the Review button), and the way into the earlier ones.
//
// It folds in two tiers. The review as a whole opens and closes. Work on
// this on one of its points narrows the bar to that point alone, with Item
// complete and Stop working, and the point folds on its own to a single
// line, "Working on: …", so the conversation gets the room back while the
// writer works on it. Item complete marks the point done (greyed in the
// list) and Stop working leaves it as it was; either way the bar returns
// to the whole review. The point being worked on is kept in the document
// (NudgeDoc.working) and goes to the guide with each message
// (lib/ai/context.ts). Earlier reviews can be read, each with its time,
// but only the latest is worked from: a new review supersedes the last.
import { useEffect, useRef, useState } from "react";
import { localLabel } from "../../lib/ai/localModels";
import { modelLabel } from "../../lib/ai/models";
import { latestReview, parseReview, reviewWhen, workingPoint } from "../../lib/ai/reviews";
import { updateCurrent } from "../../lib/documents";
import { useApp } from "../../lib/store";
import type { NudgeDoc, Review, Source } from "../../lib/types";
import { CheckIcon, ChevronIcon, ClockIcon, CopyIcon } from "../Icons";
import { copyText, plain, ReplyMarkdown, Thinking } from "./MessageBubble";

function reviewer(r: Review): string {
  if (r.provider === "local") return localLabel(r.model ?? "");
  return r.model ? modelLabel(r.model) : "";
}

/** Said of a review made without the attached PDFs (the Review menu). */
const WITHOUT = "without the attached PDFs";

function setDone(reviewId: string, item: number, done: boolean): void {
  updateCurrent((d) => ({
    ...d,
    reviews: d.reviews.map((r) =>
      r.id !== reviewId ? r : { ...r, done: done ? [...new Set([...r.done, item])].sort((a, b) => a - b) : r.done.filter((i) => i !== item) },
    ),
  }));
}

/** A review's overall sentences, its points (each with what can be done
 *  with it) and anything after them. */
function ReviewContent({ review, sources, workable }: { review: Review; sources: Source[]; workable: boolean }) {
  const { intro, points, outro } = parseReview(review.content);
  if (points.length === 0) return <ReplyMarkdown content={review.content} sources={sources} />;
  return (
    <>
      {intro && <ReplyMarkdown content={intro} sources={sources} />}
      <ol className="review-points">
        {points.map((p, i) => {
          const done = review.done.includes(i);
          return (
            <li key={i} value={p.n} className={done ? "done" : undefined}>
              <ReplyMarkdown content={p.text} sources={sources} />
              {workable && (
                <div className="point-tools">
                  {done ? (
                    <>
                      <span className="point-done">
                        <CheckIcon size={12} /> Complete
                      </span>
                      <button className="link" onClick={() => setDone(review.id, i, false)}>
                        Reopen
                      </button>
                    </>
                  ) : (
                    <button className="take-up" onClick={() => updateCurrent((d) => ({ ...d, working: { reviewId: review.id, item: i } }))}>
                      Work on this
                    </button>
                  )}
                </div>
              )}
              {!workable && done && (
                <div className="point-tools">
                  <span className="point-done">
                    <CheckIcon size={12} /> Complete
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {outro && <ReplyMarkdown content={outro} sources={sources} />}
    </>
  );
}

function Toggle({ open, onClick, children, title }: { open: boolean; onClick: () => void; children: React.ReactNode; title: string }) {
  return (
    <button className="review-toggle" aria-expanded={open} title={title} onClick={onClick}>
      <span className={`chev${open ? " open" : ""}`}>
        <ChevronIcon size={14} />
      </span>
      {children}
    </button>
  );
}

/** The earlier reviews, newest first, each opening to be read. */
function EarlierReviews({ reviews, sources }: { reviews: Review[]; sources: Source[] }) {
  const [shown, setShown] = useState<string | null>(null);
  return (
    <ul className="earlier-reviews">
      {[...reviews].reverse().map((r) => {
        const open = shown === r.id;
        const total = parseReview(r.content).points.length;
        return (
          <li key={r.id} className={open ? "open" : undefined}>
            <Toggle open={open} title={open ? "Close this review" : "Read this review"} onClick={() => setShown(open ? null : r.id)}>
              <span className="review-when">{reviewWhen(r.ts)}</span>
              <span className="review-meta">
                {reviewer(r)}
                {r.withSources === false && ` · ${WITHOUT}`}
                {total > 0 && r.done.length > 0 && ` · ${r.done.length} of ${total} complete`}
              </span>
            </Toggle>
            {open && (
              <div className="earlier-body">
                <ReviewContent review={r} sources={sources} workable={false} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ReviewBar({ doc, sources }: { doc: NudgeDoc; sources: Source[] }) {
  const streaming = useApp((s) => (s.streaming && s.streaming.docId === doc.id && s.streaming.kind === "review" ? s.streaming : null));
  const latest = latestReview(doc);
  const working = workingPoint(doc);
  // Tier one, the review; tier two, the point being worked on.
  const [open, setOpen] = useState(false);
  const [pointOpen, setPointOpen] = useState(true);
  const [history, setHistory] = useState(false);

  // A review as it arrives opens the bar, on the latest.
  const seen = useRef(latest?.id);
  useEffect(() => {
    if (latest && latest.id !== seen.current) {
      setOpen(true);
      setHistory(false);
    }
    seen.current = latest?.id;
  }, [latest?.id]);
  useEffect(() => {
    if (streaming) {
      setOpen(true);
      setHistory(false);
    }
  }, [Boolean(streaming)]);
  // Starting on a point shows it whole.
  useEffect(() => {
    if (working) setPointOpen(true);
  }, [working?.review.id, working?.index]);

  if (streaming) {
    return (
      <div className="review-bar">
        <div className="review-bar-head">
          <span className="review-toggle static">
            <span className="review-label">Review</span>
            <span className="review-meta">Reviewing the document…</span>
          </span>
        </div>
        <div className="review-body">{streaming.text ? <ReplyMarkdown content={streaming.text} sources={sources} /> : <Thinking status={streaming.status} />}</div>
      </div>
    );
  }
  if (!latest) return null;

  if (working) {
    const { review, point, index, of } = working;
    const finish = (complete: boolean) => {
      if (complete) setDone(review.id, index, true);
      updateCurrent((d) => ({ ...d, working: null }));
      setOpen(true);
      setHistory(false);
    };
    return (
      <div className="review-bar working">
        <div className="review-bar-head">
          <Toggle open={pointOpen} title={pointOpen ? "Fold this point" : "Show this point"} onClick={() => setPointOpen(!pointOpen)}>
            <span className="review-label">Working on</span>
            {pointOpen ? (
              <span className="review-meta">
                point {point.n} of {of} · {reviewWhen(review.ts)}
              </span>
            ) : (
              <span className="working-title">{point.title}</span>
            )}
          </Toggle>
        </div>
        {pointOpen && (
          <div className="review-body">
            <ReplyMarkdown content={point.text} sources={sources} />
            <div className="working-actions">
              <button className="btn small primary" onClick={() => finish(true)}>
                <CheckIcon size={13} /> Item complete
              </button>
              <button className="btn small" onClick={() => finish(false)}>
                Stop working
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const total = parseReview(latest.content).points.length;
  const earlier = doc.reviews.slice(0, -1);
  return (
    <div className="review-bar">
      <div className="review-bar-head">
        <Toggle open={open} title={open ? "Fold the review" : "Show the review"} onClick={() => setOpen(!open)}>
          <span className="review-label">Review</span>
          <span className="review-when">{history && open ? "Earlier reviews" : reviewWhen(latest.ts)}</span>
          {!history && total > 0 && latest.done.length > 0 && (
            <span className="review-meta">
              {latest.done.length} of {total} complete
            </span>
          )}
        </Toggle>
        {earlier.length > 0 && (
          <button
            className="link earlier-link"
            onClick={() => {
              setHistory(!(history && open));
              setOpen(true);
            }}
          >
            {history && open ? (
              "Latest review"
            ) : (
              <>
                <ClockIcon size={12} /> Earlier ({earlier.length})
              </>
            )}
          </button>
        )}
      </div>
      {open && (
        <div className="review-body">
          {history ? (
            <EarlierReviews reviews={earlier} sources={sources} />
          ) : (
            <>
              <ReviewContent review={latest} sources={sources} workable />
              <div className="review-foot">
                <span>
                  Reviewed by {reviewer(latest)}
                  {latest.withSources === false && `, ${WITHOUT}`}
                </span>
                <button className="icon-btn" title="Copy the review" onClick={() => copyText(plain(latest.content))}>
                  <CopyIcon size={13} />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
