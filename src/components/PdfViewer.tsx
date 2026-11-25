// The source viewer: the fourth column, left of the conversation. It shows
// one source's PDF, its pages drawn as they come into view (and let go of
// again when far away — an iPad has little canvas memory), with the
// writer's Zotero highlights laid over them, and goes to whatever a
// citation points at: the page, and the quoted passage found on it and
// marked (lib/pdf/pdfQuote.ts finds it by its words, the cited page number
// being only where the search starts — the part a model most often gets
// wrong).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { openPdf, getPdfjs } from "../lib/pdf/pdfjs";
import { findQuote, type QuotePlace } from "../lib/pdf/pdfQuote";
import { sourceFile } from "../lib/sources";
import { useApp } from "../lib/store";
import type { Source, ZoteroAnnotation } from "../lib/types";
import { CloseIcon, MinusIcon, PlusIcon, Spinner } from "./Icons";

type Rect = { x: number; y: number; w: number; h: number };
interface PageInfo {
  width: number; // PDF points at scale 1
  height: number;
}

const GAP = 12;

/** Annotation boxes as fractions of their page. */
function annotationRects(page: PDFPageProxy, a: ZoteroAnnotation): Rect[] {
  const vp = page.getViewport({ scale: 1 });
  return (a.rects ?? []).map(([x1, y1, x2, y2]) => {
    const [ax, ay] = vp.convertToViewportPoint(x1, y1);
    const [bx, by] = vp.convertToViewportPoint(x2, y2);
    const x = Math.min(ax, bx);
    const y = Math.min(ay, by);
    return { x: x / vp.width, y: y / vp.height, w: Math.abs(bx - ax) / vp.width, h: Math.abs(by - ay) / vp.height };
  });
}

export function PdfViewer({ source }: { source: Source }) {
  const target = useApp((s) => s.viewer);
  const close = useApp((s) => s.closeViewer);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(1);
  const [mark, setMark] = useState<QuotePlace | null>(null);
  const [annots, setAnnots] = useState<Map<number, { a: ZoteroAnnotation; rects: Rect[] }[]>>(new Map());
  const scroller = useRef<HTMLDivElement>(null);
  const wrappers = useRef<Map<number, HTMLDivElement>>(new Map());
  const rendered = useRef<Map<number, number>>(new Map()); // page → scale drawn at

  // Open the PDF.
  useEffect(() => {
    let live = true;
    let opened: PDFDocumentProxy | null = null;
    setDoc(null);
    setError(null);
    setPages([]);
    setMark(null);
    rendered.current.clear();
    (async () => {
      try {
        const d = await openPdf(await sourceFile(source.id));
        if (!live) return void d.loadingTask.destroy();
        opened = d;
        const first = (await d.getPage(1)).getViewport({ scale: 1 });
        setPages(Array.from({ length: d.numPages }, () => ({ width: first.width, height: first.height })));
        setDoc(d);
      } catch (e) {
        if (live) setError(String(e));
      }
    })();
    return () => {
      live = false;
      void opened?.loadingTask.destroy();
    };
  }, [source.id]);

  // The writer's Zotero highlights, placed on their pages.
  useEffect(() => {
    if (!doc || !source.annotations?.length) return setAnnots(new Map());
    let live = true;
    (async () => {
      const byPage = new Map<number, { a: ZoteroAnnotation; rects: Rect[] }[]>();
      for (const a of source.annotations ?? []) {
        if (a.pageIndex == null || !a.rects?.length || a.pageIndex >= doc.numPages) continue;
        const page = await doc.getPage(a.pageIndex + 1);
        const list = byPage.get(a.pageIndex + 1) ?? [];
        list.push({ a, rects: annotationRects(page, a) });
        byPage.set(a.pageIndex + 1, list);
      }
      if (live) setAnnots(byPage);
    })();
    return () => {
      live = false;
    };
  }, [doc, source.annotations]);

  // The column's width sets the fit scale.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const scale = useMemo(() => {
    const w = pages[0]?.width || 612;
    return Math.max(0.2, ((width - 2 * GAP) / w) * zoom);
  }, [pages, width, zoom]);

  const drawPage = useCallback(
    async (n: number) => {
      const wrap = wrappers.current.get(n);
      if (!doc || !wrap || rendered.current.get(n) === scale) return;
      rendered.current.set(n, scale);
      const page = await doc.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      // Pages of another size than the first get their own box.
      setPages((ps) =>
        ps[n - 1] && (ps[n - 1].width !== vp1.width || ps[n - 1].height !== vp1.height)
          ? ps.map((p, i) => (i === n - 1 ? { width: vp1.width, height: vp1.height } : p))
          : ps,
      );
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: scale * dpr });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.className = "pdf-canvas";
      try {
        await page.render({ canvas, viewport: vp }).promise;
      } catch {
        rendered.current.delete(n);
        return;
      }
      if (rendered.current.get(n) !== scale || !wrap.isConnected) return;
      wrap.querySelector(".pdf-canvas")?.remove();
      wrap.querySelector(".textLayer")?.remove();
      wrap.prepend(canvas);
      // Selectable text over the page.
      try {
        const { TextLayer } = await getPdfjs();
        const div = document.createElement("div");
        div.className = "textLayer";
        div.style.setProperty("--total-scale-factor", String(scale));
        div.style.setProperty("--scale-round-x", "1px");
        div.style.setProperty("--scale-round-y", "1px");
        wrap.appendChild(div);
        await new TextLayer({ textContentSource: page.streamTextContent(), container: div, viewport: page.getViewport({ scale }) }).render();
      } catch {
        // a page without text (a scan) just isn't selectable
      }
    },
    [doc, scale],
  );

  const release = useCallback((n: number) => {
    const wrap = wrappers.current.get(n);
    if (!wrap) return;
    const c = wrap.querySelector<HTMLCanvasElement>(".pdf-canvas");
    if (c) {
      c.width = c.height = 0; // hand WebKit its canvas memory back now
      c.remove();
    }
    wrap.querySelector(".textLayer")?.remove();
    rendered.current.delete(n);
  }, []);

  // Draw what's near the view; let go of what's far from it.
  useEffect(() => {
    const root = scroller.current;
    if (!doc || !root) return;
    const near = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page);
          if (e.isIntersecting) void drawPage(n);
        }
      },
      { root, rootMargin: "800px 0px" },
    );
    const far = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (!e.isIntersecting) release(Number((e.target as HTMLElement).dataset.page));
      },
      { root, rootMargin: "4000px 0px" },
    );
    for (const w of wrappers.current.values()) {
      near.observe(w);
      far.observe(w);
    }
    return () => {
      near.disconnect();
      far.disconnect();
    };
  }, [doc, drawPage, release, pages.length]);

  // Re-draw at a new scale.
  useEffect(() => {
    rendered.current.clear();
  }, [scale]);

  const tops = useMemo(() => {
    const out: number[] = [];
    let y = GAP;
    for (const p of pages) {
      out.push(y);
      y += p.height * scale + GAP;
    }
    return out;
  }, [pages, scale]);

  const scrollToPage = useCallback(
    (n: number, frac = 0) => {
      const el = scroller.current;
      if (!el || !pages.length) return;
      const i = Math.min(Math.max(n, 1), pages.length) - 1;
      const y = tops[i] + frac * pages[i].height * scale;
      el.scrollTo({ top: Math.max(0, y - (frac ? el.clientHeight / 3 : GAP)), behavior: "smooth" });
    },
    [pages, tops, scale],
  );

  // Go where the citation points — once per request (its nonce), not again
  // whenever the page layout shifts as pages of other sizes render.
  const scrollRef = useRef(scrollToPage);
  scrollRef.current = scrollToPage;
  useEffect(() => {
    if (!doc || !target || target.sourceId !== source.id) return;
    let live = true;
    setMark(null);
    (async () => {
      if (!target.quote) {
        scrollRef.current(target.page);
        return;
      }
      const { place } = await findQuote(doc, target.quote, target.page);
      if (!live) return;
      if (!place) {
        useApp.getState().toast("The quoted words weren't found on the page — showing the cited page");
        scrollRef.current(target.page);
        return;
      }
      setMark(place);
      scrollRef.current(place.page, place.rects[0]?.y ?? 0);
    })();
    return () => {
      live = false;
    };
  }, [doc, target?.nonce, source.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    let n = 1;
    for (let i = 0; i < tops.length; i++) if (tops[i] <= mid) n = i + 1;
    setCurrent(n);
  };

  return (
    <section className="viewer">
      <header className="viewer-head">
        <div className="viewer-title" title={source.title}>
          {source.title}
        </div>
        <div className="viewer-tools">
          {doc && (
            <span className="viewer-page">
              {current} / {doc.numPages}
            </span>
          )}
          <button className="icon-btn" title="Smaller" onClick={() => setZoom((z) => Math.max(0.5, z / 1.15))}>
            <MinusIcon size={14} />
          </button>
          <button className="icon-btn" title="Fit width" onClick={() => setZoom(1)}>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          </button>
          <button className="icon-btn" title="Larger" onClick={() => setZoom((z) => Math.min(4, z * 1.15))}>
            <PlusIcon size={14} />
          </button>
          <button className="icon-btn" title="Close the viewer" onClick={close}>
            <CloseIcon size={15} />
          </button>
        </div>
      </header>
      <div className="viewer-scroll" ref={scroller} onScroll={onScroll}>
        {error && <div className="viewer-error">{error}</div>}
        {!doc && !error && (
          <div className="viewer-loading">
            <Spinner /> Opening…
          </div>
        )}
        {doc &&
          pages.map((p, i) => {
            const n = i + 1;
            return (
              <div
                key={n}
                data-page={n}
                className="pdf-page"
                ref={(el) => {
                  if (el) wrappers.current.set(n, el);
                  else wrappers.current.delete(n);
                }}
                style={{ width: p.width * scale, height: p.height * scale, top: tops[i], left: Math.max(GAP, (width - p.width * scale) / 2) }}
              >
                <div className="pdf-marks">
                  {(annots.get(n) ?? []).flatMap(({ a, rects }) =>
                    rects.map((r, j) => (
                      <div
                        key={`${a.key}-${j}`}
                        className={`pdf-annot ${a.type}`}
                        title={[a.text, a.comment && `Comment: ${a.comment}`].filter(Boolean).join("\n\n")}
                        style={{
                          left: `${r.x * 100}%`,
                          top: `${r.y * 100}%`,
                          width: `${r.w * 100}%`,
                          height: `${r.h * 100}%`,
                          ["--annot" as string]: a.color,
                        }}
                      />
                    )),
                  )}
                  {mark?.page === n &&
                    mark.rects.map((r, j) => (
                      <div
                        key={`m${j}`}
                        className="pdf-cite-mark"
                        style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                      />
                    ))}
                </div>
              </div>
            );
          })}
        {doc && <div style={{ height: (tops[tops.length - 1] ?? 0) + (pages[pages.length - 1]?.height ?? 0) * scale + GAP }} />}
      </div>
    </section>
  );
}
