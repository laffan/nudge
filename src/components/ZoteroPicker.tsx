// Attaching works from Zotero: the library's collections down the left, a
// search across the library (or within the chosen collection) on the
// right, works ticked and attached together. Each brings its PDF (copied
// in, to read offline), the writer's annotations on it, and their notes.
import { useEffect, useMemo, useState } from "react";
import { addZoteroItems } from "../lib/sources";
import { useApp } from "../lib/store";
import {
  collectionTree,
  fetchCollections,
  itemCreators,
  itemTitle,
  itemYear,
  searchItems,
  type ZCollection,
  type ZItem,
} from "../lib/zotero";
import { CloseIcon, SearchIcon, Spinner } from "./Icons";

export function ZoteroPicker() {
  const close = () => useApp.getState().setZoteroPicker(false);
  const [collections, setCollections] = useState<ZCollection[]>([]);
  const [collection, setCollection] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ZItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Map<string, ZItem>>(new Map());
  const tree = useMemo(() => collectionTree(collections), [collections]);

  useEffect(() => {
    fetchCollections().then(setCollections).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const found = await searchItems(q, collection || undefined);
        if (live) setItems(found);
      } catch (e) {
        if (live) setError(String(e));
      } finally {
        if (live) setBusy(false);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, collection]);

  const toggle = (item: ZItem) =>
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(item.key)) next.delete(item.key);
      else next.set(item.key, item);
      return next;
    });

  const attach = () => {
    const list = [...picked.values()];
    close();
    void addZoteroItems(list);
  };

  return (
    <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog zotero-picker" role="dialog" aria-label="Attach from Zotero">
        <header className="dialog-head">
          <h2>Attach from Zotero</h2>
          <button className="icon-btn" onClick={close} title="Close">
            <CloseIcon />
          </button>
        </header>
        <div className="zp-body">
          <nav className="zp-collections">
            <button className={collection === "" ? "active" : ""} onClick={() => setCollection("")}>
              My Library
            </button>
            {tree.map(({ c, depth }) => (
              <button
                key={c.key}
                className={collection === c.key ? "active" : ""}
                style={{ paddingLeft: 12 + depth * 14 }}
                onClick={() => setCollection(c.key)}
              >
                {c.data.name}
              </button>
            ))}
          </nav>
          <div className="zp-main">
            <label className="zp-search">
              <SearchIcon size={15} />
              <input autoFocus placeholder="Title, author or year" value={q} onChange={(e) => setQ(e.target.value)} />
              {busy && <Spinner size={13} />}
            </label>
            {error && <div className="error-msg">{error}</div>}
            <ul className="zp-items">
              {items.map((it) => (
                <li key={it.key} className={picked.has(it.key) ? "picked" : ""} onClick={() => toggle(it)}>
                  <input type="checkbox" readOnly checked={picked.has(it.key)} />
                  <div>
                    <div className="zp-title">{itemTitle(it)}</div>
                    <div className="zp-meta">
                      {[itemCreators(it), itemYear(it), String(it.data?.publicationTitle ?? "")].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </li>
              ))}
              {!busy && !error && items.length === 0 && <li className="zp-empty">Nothing found.</li>}
            </ul>
          </div>
        </div>
        <footer className="dialog-foot">
          <span className="hint">The PDF, your annotations on it and your notes come with each work.</span>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={picked.size === 0} onClick={attach}>
            Attach {picked.size || ""}
          </button>
        </footer>
      </div>
    </div>
  );
}
