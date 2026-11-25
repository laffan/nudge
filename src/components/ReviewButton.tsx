// The document's Review button, last in its header, with a menu beside it
// for what the reviewer is given: the attached PDFs or not. The choice is
// the document's own (NudgeDoc.reviewSources), as its sources are, and a
// review made without them says so (ReviewBar.tsx).
import { useEffect, useState } from "react";
import { reviewDocument } from "../lib/ai/chat";
import { updateCurrent } from "../lib/documents";
import { readyFor } from "../lib/settings";
import { toast, useApp } from "../lib/store";
import { ChevronIcon, ReviewIcon } from "./Icons";

export function ReviewButton() {
  const busy = useApp((s) => Boolean(s.streaming));
  const hasContent = useApp((s) => Boolean(s.current?.content.trim()));
  const hasGoal = useApp((s) => Boolean(s.current?.goal.trim()));
  const sourceCount = useApp((s) => s.current?.sources.length ?? 0);
  const include = useApp((s) => s.current?.reviewSources !== false);
  const [menu, setMenu] = useState(false);
  const withPdfs = include && sourceCount > 0;

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const review = () => {
    const app = useApp.getState();
    const ready = readyFor(app.settings, app.keys, "review");
    if (!ready.ok) {
      toast(ready.why ?? "The Review model isn't set up", "error");
      app.openSettings("ai");
      return;
    }
    void reviewDocument();
  };

  const what = sourceCount === 0 ? "" : withPdfs ? ", with the attached PDFs" : ", without the attached PDFs";
  return (
    <div className="review-split">
      <button
        className="btn small review-btn"
        disabled={busy || !hasContent || !hasGoal}
        title={
          !hasGoal
            ? "Set the document's goal first"
            : !hasContent
              ? "Write something to review first"
              : `Assess the document against its goal${what}; the advice appears under the goal`
        }
        onClick={review}
      >
        <ReviewIcon size={14} /> Review
      </button>
      <button className="btn small review-more" title="Review options" aria-label="Review options" aria-expanded={menu} onClick={() => setMenu(!menu)}>
        <ChevronIcon size={13} />
      </button>
      {menu && (
        <>
          <div className="menu-scrim" onClick={() => setMenu(false)} />
          <div className="menu review-menu">
            <label className={`menu-check${sourceCount === 0 ? " disabled" : ""}`}>
              <input
                type="checkbox"
                checked={withPdfs}
                disabled={sourceCount === 0}
                onChange={(e) => {
                  const on = e.target.checked;
                  updateCurrent((d) => ({ ...d, reviewSources: on }));
                }}
              />
              <span>
                Include attached PDFs
                <small>
                  {sourceCount === 0
                    ? "None attached"
                    : withPdfs
                      ? `The reviewer reads ${sourceCount === 1 ? "it" : `all ${sourceCount}`} with the draft`
                      : "The draft is reviewed on its own"}
                </small>
              </span>
            </label>
          </div>
        </>
      )}
    </div>
  );
}
