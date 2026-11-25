// A stand-in for the Rust core when the interface runs in a plain browser:
// documents and settings in localStorage, PDFs in memory, and a scripted
// guide in place of a model. It exists so the UI can be developed and
// tested without the native shell; inside the app it is never called.
import type { DocSummary, KeyStatus, Settings, StreamEvent } from "./types";

const LS = "nudge-browser-";
const files = new Map<string, ArrayBuffer>();

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(LS + key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(LS + key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the stand-in just forgets
  }
}

const DEFAULT_SETTINGS: Settings = {
  zoteroApiKey: "",
  zoteroLibraryId: "",
  zoteroLibraryType: "user",
  uses: {},
  provider: "local",
  anthropicApiKey: "",
  openaiApiKey: "",
  anthropicModel: "claude-opus-5-5",
  openaiModel: "gpt-6.2-sol",
  localModel: "",
  effort: "medium",
  offlineFallback: true,
  localContext: 8192,
};

function summary(doc: Record<string, unknown>): DocSummary {
  const content = String(doc.content ?? "");
  return {
    id: String(doc.id),
    title: String(doc.title ?? ""),
    goal: String(doc.goal ?? "").slice(0, 200),
    createdMs: Number(doc.createdMs ?? 0),
    updatedMs: Number(doc.updatedMs ?? 0),
    words: content.split(/\s+/).filter(Boolean).length,
  };
}

export async function browserInvoke<T>(cmd: string, args: Record<string, unknown> | unknown = {}): Promise<T> {
  const a = (args ?? {}) as Record<string, unknown>;
  const docs = read<Record<string, Record<string, unknown>>>("docs", {});
  switch (cmd) {
    case "load_settings":
      return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>("settings", {}), anthropicApiKey: "", openaiApiKey: "" } as T;
    case "save_settings": {
      // Keys stay where ai_set_key put them, as in the app.
      const keys = read<Partial<Settings>>("settings", {});
      write("settings", { ...(a.settings as Settings), anthropicApiKey: keys.anthropicApiKey ?? "", openaiApiKey: keys.openaiApiKey ?? "" });
      return undefined as T;
    }
    case "ai_status": {
      const st = read<Partial<Settings>>("settings", {});
      return { anthropic: Boolean(st.anthropicApiKey), openai: Boolean(st.openaiApiKey) } as T;
    }
    case "ai_set_key":
    case "ai_delete_key": {
      const st = read<Partial<Settings>>("settings", {});
      const field = a.provider === "openai" ? "openaiApiKey" : "anthropicApiKey";
      write("settings", { ...st, [field]: cmd === "ai_set_key" ? String(a.key ?? "").trim() : "" });
      const next = read<Partial<Settings>>("settings", {});
      return { anthropic: Boolean(next.anthropicApiKey), openai: Boolean(next.openaiApiKey) } satisfies KeyStatus as T;
    }
    case "usage_add":
      write("usage", [...read<unknown[]>("usage", []), a.event]);
      return undefined as T;
    case "usage_list":
      return read("usage", []) as T;
    case "usage_reset":
      write("usage", []);
      return undefined as T;
    case "list_documents":
      return Object.values(docs)
        .map(summary)
        .sort((x, y) => y.updatedMs - x.updatedMs) as T;
    case "load_document": {
      const d = docs[String(a.id)];
      if (!d) throw new Error("That document could not be found");
      return d as T;
    }
    case "save_document": {
      const d = a.doc as Record<string, unknown>;
      docs[String(d.id)] = d;
      write("docs", docs);
      return summary(d) as T;
    }
    case "delete_document":
      delete docs[String(a.id)];
      write("docs", docs);
      return undefined as T;
    case "save_source_text":
      write(`text-${a.id}`, a.pages);
      return undefined as T;
    case "load_source_text":
      return read(`text-${a.id}`, null) as T;
    case "read_source_file": {
      const f = files.get(String(a.id));
      if (!f) throw new Error("This source's PDF is not in this browser session");
      return f.slice(0) as T;
    }
    case "delete_source":
      files.delete(String(a.id));
      return undefined as T;
    case "local_status":
      // The catalog can be browsed in the preview; downloading needs the app.
      return { available: true, installed: [], partial: [] } as T;
    case "ai_cancel":
      stopped = true;
      return undefined as T;
    case "ai_list_models":
      throw new Error("Model lists need the app");
    default:
      if (cmd.startsWith("zotero_")) throw new Error("Zotero needs the Nudge app (it isn't reachable from a plain browser)");
      throw new Error(`“${cmd}” is only available in the app`);
  }
}

/** The PDF's bytes for the stand-in (the app sends them to Rust). */
export function browserSaveFile(id: string, bytes: ArrayBuffer): void {
  files.set(id, bytes);
}

let stopped = false;

const SCRIPT = [
  "Thanks — that gives me a clear starting point. Before anything else: **who is this for**, and what do you want them to think or do once they've read it?",
  "That's a useful distinction. Can you give me one concrete example from your own experience that shows it? A specific moment works better than a summary.",
  "Good — that example could open the piece. Try dragging your last answer into the document and we'll build from it. What's the claim you want that example to support?",
];

const REVIEW_SCRIPT = `The draft names its reader clearly, but the claim it wants that reader to accept isn't stated yet, and nothing yet shows peer review at work in a class.

1. **The opening** — “It is for the hiring committee…” says who the piece is for, not what it argues. Consider what you want the committee to believe after reading.
2. **Evidence** — the goal promises a reflection on practice; the draft has no moment from a seminar. A single concrete episode would carry more than a general statement.
3. **What's working** — “read their own drafts as outsiders would” is a clear, memorable idea worth keeping as the spine of the piece.
4. **Length** — at this point the draft is far short of 1,500 words; the sections the goal implies (method, an example, what you've learned) are still to come.`;

export async function browserStream(cmd: string, args: Record<string, unknown>, onEvent: (e: unknown) => void): Promise<void> {
  if (cmd !== "ai_chat") throw new Error(`“${cmd}” is only available in the app`);
  stopped = false;
  const req = args.request as { system: string; messages: { role: string }[] };
  const turn = req.messages.filter((m) => m.role === "assistant").length;
  // With a source attached, point at a real sentence of it, as a model would.
  const m = /\[\[page (\d+)\]\]\n([^\n]{20,})/.exec(req.system);
  const quote = m ? m[2].split(/\s+/).slice(0, 9).join(" ") : "";
  const cite = quote ? ` Your first source puts it this way: [[cite:1:${m![1]}:${quote}]] — does that match your experience?` : "";
  const reviewing = req.system.startsWith("You review");
  const text = reviewing
    ? `${REVIEW_SCRIPT}\n\n_(This is a scripted review: the browser preview has no model.)_`
    : `${SCRIPT[turn % SCRIPT.length]}${turn === 0 ? cite : ""}\n\n_(This is a scripted reply: the browser preview has no model.)_`;
  const send = (e: StreamEvent) => onEvent(e);
  send({ type: "status", message: "Thinking…" });
  await new Promise((r) => setTimeout(r, 300));
  for (const word of text.split(/(?<= )/)) {
    if (stopped) break;
    send({ type: "delta", text: word });
    await new Promise((r) => setTimeout(r, 18));
  }
  send({
    type: "done",
    usage: { inputTokens: 1200, outputTokens: text.length >> 2, cachedInputTokens: 0, cacheWriteTokens: 0 },
    model: "preview",
    stop: stopped ? "stopped" : "end_turn",
  });
}
