// Settings → Offline model: download, choose and remove on-device models,
// and set how much context the chosen one gets. Downloads stream to disk
// in the Rust core (src-tauri/src/downloads.rs) and resume where they
// stopped.
import { useCallback, useEffect, useState } from "react";
import { customModels, LOCAL_MODELS, saveCustomModels, type CustomModel } from "../../lib/ai/localModels";
import { toast } from "../../lib/store";
import { invoke, invokeStreaming, isTauri } from "../../lib/tauri";
import { Spinner } from "../Icons";
import type { DraftProps } from "./SettingsDialog";

interface Status {
  available: boolean;
  installed: { file: string; bytes: number }[];
  partial: [string, number][];
}

interface Progress {
  received: number;
  total: number;
}

const gb = (n: number) => `${(n / 1e9).toFixed(2)} GB`;

export function OfflineSettings({ draft, set }: DraftProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [customs, setCustoms] = useState<CustomModel[]>(customModels());
  const [url, setUrl] = useState("");

  const all = [
    ...LOCAL_MODELS.map((m) => ({ file: m.file, url: m.url, label: m.label, blurb: m.blurb, size: m.sizeGB, recommended: m.recommended })),
    ...customs.map((c) => ({ file: c.file, url: c.url, label: c.file.replace(/\.gguf$/i, ""), blurb: "Added by URL", size: 0, recommended: false })),
  ];

  const refresh = useCallback(async () => {
    try {
      setStatus(await invoke<Status>("local_status", { files: all.map((m) => m.file) }));
    } catch (e) {
      toast(String(e), "error");
    }
  }, [customs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const installed = (file: string) => status?.installed.find((i) => i.file === file);
  const partial = (file: string) => status?.partial.find(([f]) => f === file)?.[1] ?? 0;

  const download = async (file: string, from: string) => {
    setProgress((p) => ({ ...p, [file]: { received: partial(file), total: 0 } }));
    try {
      await invokeStreaming<Progress>("local_download", { id: `dl-${file}`, url: from, file }, "onProgress", (e) =>
        setProgress((p) => ({ ...p, [file]: e })),
      );
      toast(`${file} is ready`);
      if (!draft.localModel) set("localModel", file);
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("paused")) toast(`Download failed: ${msg}`, "error");
    } finally {
      setProgress((p) => {
        const next = { ...p };
        delete next[file];
        return next;
      });
      void refresh();
    }
  };

  const remove = async (file: string) => {
    await invoke("local_delete", { file });
    if (draft.localModel === file) set("localModel", "");
    void refresh();
  };

  const addCustom = () => {
    const u = url.trim();
    const file = decodeURIComponent(u.split("?")[0].split("/").pop() ?? "");
    if (!u.startsWith("https://") || !file.toLowerCase().endsWith(".gguf")) {
      toast("Give the https link to a .gguf file (Hugging Face: the file's “download” link)", "error");
      return;
    }
    const format = /gemma-?4/i.test(file) ? "gemma4" : /qwen3\.5/i.test(file) ? "chatml-nothink" : "chatml";
    const next = [...customs.filter((c) => c.file !== file), { file, url: u.replace("/blob/", "/resolve/"), format } as CustomModel];
    saveCustomModels(next);
    setCustoms(next);
    setUrl("");
  };

  if (status && !status.available) {
    return (
      <p className="warn">
        {isTauri
          ? "This build of Nudge was made without the on-device engine (the local-llm feature). Rebuild with default features to use offline models."
          : "The on-device model runs in the Nudge app, not in a browser preview."}
      </p>
    );
  }

  return (
    <>
      <p className="hint">
        An on-device model lets the conversation go on with no network. Models run through llama.cpp (on the GPU of an
        Apple-silicon Mac or iPad). Downloads are large; use Wi-Fi.
      </p>
      <ul className="model-list">
        {all.map((m) => {
          const inst = installed(m.file);
          const prog = progress[m.file];
          const part = partial(m.file);
          const chosen = draft.localModel === m.file;
          return (
            <li key={m.file} className={chosen ? "chosen" : ""}>
              <div className="model-info">
                <div className="model-name">
                  {m.label}
                  {m.recommended && <span className="badge">Recommended</span>}
                  {chosen && <span className="badge on">In use</span>}
                </div>
                <div className="model-blurb">
                  {m.blurb}
                  {m.size ? ` · ${m.size} GB` : ""}
                </div>
                {prog && (
                  <div className="progress">
                    <div style={{ width: prog.total ? `${(100 * prog.received) / prog.total}%` : "2%" }} />
                    <span>
                      {gb(prog.received)}
                      {prog.total ? ` of ${gb(prog.total)}` : ""}
                    </span>
                  </div>
                )}
              </div>
              <div className="model-actions">
                {inst ? (
                  <>
                    {!chosen && (
                      <button className="btn small primary" onClick={() => set("localModel", m.file)}>
                        Use
                      </button>
                    )}
                    <button className="btn small" onClick={() => void remove(m.file)}>
                      Remove
                    </button>
                  </>
                ) : prog ? (
                  <button className="btn small" onClick={() => void invoke("ai_cancel", { id: `dl-${m.file}` })}>
                    <Spinner size={11} /> Pause
                  </button>
                ) : (
                  <button className="btn small primary" onClick={() => void download(m.file, m.url)}>
                    {part ? `Resume (${gb(part)})` : "Download"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <label className="field">
        <span>Add a model by URL</span>
        <div className="field-with-btn">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://huggingface.co/…/resolve/main/model-Q4_K_M.gguf" />
          <button className="btn small" onClick={addCustom} disabled={!url.trim()}>
            Add
          </button>
        </div>
      </label>

      <h3>Context</h3>
      <label className="field">
        <span>Context window (tokens)</span>
        <select value={draft.localContext} onChange={(e) => set("localContext", Number(e.target.value))}>
          <option value={4096}>4,096 — least memory</option>
          <option value={8192}>8,192 — suits an 8 GB iPad</option>
          <option value={16384}>16,384 — 16 GB Macs and iPads</option>
          <option value={32768}>32,768 — 24 GB or more</option>
        </select>
      </label>
      <p className="hint">
        The context holds the instructions, your goal, your Zotero annotations, your document, the source passages chosen
        for the turn and as much of the conversation as fits. More context needs more memory.
      </p>
    </>
  );
}
