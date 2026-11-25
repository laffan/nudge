// Running the conversation: beginning it from the goal, sending the
// writer's messages, streaming the guide's replies into the store, and
// stopping one midway — and the document's Review, which streams a
// reviewer's assessment into the review bar under the goal the same way. Each takes the
// service and model its use is set to (Settings → AI → Uses). When an
// online service can't be reached and an on-device model is installed, the
// request is answered on the device instead (Settings → AI, "Without a
// network").
import { newId, updateCurrent } from "../documents";
import { modelOf, choiceFor } from "../settings";
import { invoke, invokeStreaming } from "../tauri";
import { toast, useApp, type Streaming } from "../store";
import type { ChatMessage, NudgeDoc, Provider, Review, Settings, StreamEvent, Usage, UseId } from "../types";
import { buildLocal, buildOnline, buildReview, type Built } from "./context";
import { localOptionsFor } from "./localModels";
import { usageCost } from "./models";
import { kickoffMessage } from "./prompts";
import { logUsage } from "./usage";

const LOCAL_REPLY_TOKENS = 700;
const LOCAL_REVIEW_TOKENS = 1100;

export async function beginConversation(goal: string): Promise<void> {
  const g = goal.trim();
  if (!g) return;
  const doc = useApp.getState().current;
  if (!doc) return;
  const kickoff: ChatMessage = {
    id: newId("msg"),
    role: "user",
    kind: "kickoff",
    content: kickoffMessage(g, doc.sources.length),
    ts: Date.now(),
  };
  // The goal is not the document's name: that stays as the writer set it.
  updateCurrent((d) => ({ ...d, goal: g, messages: [kickoff] }));
  await run("chat");
}

export async function sendMessage(text: string): Promise<void> {
  const t = text.trim();
  if (!t || useApp.getState().streaming) return;
  const msg: ChatMessage = { id: newId("msg"), role: "user", content: t, ts: Date.now() };
  updateCurrent((d) => ({ ...d, messages: [...d.messages, msg] }));
  await run("chat");
}

/** Ask again for the last reply (after an error, or to hear it otherwise). */
export async function retryLast(): Promise<void> {
  const doc = useApp.getState().current;
  if (!doc || useApp.getState().streaming) return;
  const last = doc.messages[doc.messages.length - 1];
  if (last?.role === "assistant") updateCurrent((d) => ({ ...d, messages: d.messages.slice(0, -1) }));
  await run("chat");
}

/** Review the document against the goal; the review goes into the bar
 *  under the goal, where the writer decides what to take up. */
export async function reviewDocument(): Promise<void> {
  const doc = useApp.getState().current;
  if (!doc || useApp.getState().streaming) return;
  if (!doc.content.trim()) {
    toast("There's nothing in the document to review yet");
    return;
  }
  await run("review");
}

export function stopReply(): void {
  const s = useApp.getState().streaming;
  if (s) void invoke("ai_cancel", { id: s.requestId });
}

function offline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

async function run(use: UseId): Promise<void> {
  const app = useApp.getState();
  const settings = app.settings;
  const doc = app.current;
  if (!settings || !doc || app.streaming) return;

  const choice = choiceFor(settings, use);
  let provider: Provider = choice.provider;
  let model = modelOf(settings, choice);
  const canFallBack = settings.offlineFallback && Boolean(settings.localModel);
  if (provider !== "local" && offline() && canFallBack) {
    provider = "local";
    model = settings.localModel;
    toast("No network — the on-device model is answering");
  }
  try {
    await stream(doc, settings, use, provider, model);
  } catch (e) {
    const msg = String(e).replace(/^Error:\s*/, "");
    if (provider !== "local" && msg.includes("OFFLINE:") && canFallBack) {
      toast("Couldn't reach the online model — the on-device model is answering");
      try {
        await stream(useApp.getState().current ?? doc, settings, use, "local", settings.localModel);
        return;
      } catch (e2) {
        toast(String(e2).replace(/^Error:\s*/, ""), "error");
        return;
      }
    }
    toast(msg.replace("OFFLINE: ", ""), "error");
  }
}

async function build(doc: NudgeDoc, settings: Settings, use: UseId, provider: Provider): Promise<Built> {
  const local = provider === "local";
  if (use === "review") {
    return buildReview(doc, local ? { nCtx: settings.localContext, replyTokens: LOCAL_REVIEW_TOKENS } : null);
  }
  return local ? buildLocal(doc, settings.localContext, LOCAL_REPLY_TOKENS) : buildOnline(doc);
}

async function stream(doc: NudgeDoc, settings: Settings, use: UseId, provider: Provider, model: string): Promise<void> {
  const built = await build(doc, settings, use, provider);
  const requestId = newId("req");
  const kind: Streaming["kind"] = use === "review" ? "review" : "reply";
  useApp.getState().setStreaming({ docId: doc.id, requestId, text: "", status: use === "review" ? "Reviewing the document…" : "", kind });

  let text = "";
  let usage: Usage | undefined;
  let servedBy = model;
  let stop = "";
  try {
    await invokeStreaming<StreamEvent>(
      "ai_chat",
      {
        request: {
          requestId,
          provider,
          model,
          system: built.system,
          messages: built.messages,
          // Online models think before they answer, inside this budget.
          maxTokens: provider === "local" ? (use === "review" ? LOCAL_REVIEW_TOKENS : LOCAL_REPLY_TOKENS) : 16000,
          local: localOptionsFor(provider === "local" ? model : settings.localModel),
        },
      },
      "onEvent",
      (e) => {
        const s = useApp.getState().streaming;
        if (!s || s.requestId !== requestId) return;
        if (e.type === "status") useApp.getState().setStreaming({ ...s, status: e.message });
        else if (e.type === "delta") {
          text += e.text;
          useApp.getState().setStreaming({ ...s, text, status: "" });
        } else if (e.type === "done") {
          usage = e.usage;
          if (e.model) servedBy = e.model;
          stop = e.stop;
        }
      },
    );
  } finally {
    useApp.getState().setStreaming(null);
  }

  const costUsd = provider === "local" ? 0 : usageCost(servedBy, usage);
  if (usage) logUsage(use, provider, servedBy, usage, costUsd);
  if (!text.trim()) {
    if (stop === "stopped") return;
    throw new Error("The model returned an empty reply");
  }
  const content = stop === "stopped" ? `${text.trim()} …` : text.trim();
  const ts = Date.now();
  // A new review takes over from the last: a point of the old one that was
  // being worked on is put down.
  const add: (d: NudgeDoc) => NudgeDoc =
    use === "review"
      ? (d) => {
          const review: Review = { id: newId("rev"), ts, content, provider, model: servedBy, usage, costUsd, done: [] };
          return { ...d, reviews: [...(d.reviews ?? []), review], working: null, costUsd: d.costUsd + costUsd };
        }
      : (d) => {
          const reply: ChatMessage = { id: newId("msg"), role: "assistant", content, ts, provider, model: servedBy, usage, costUsd };
          return { ...d, messages: [...d.messages, reply], costUsd: d.costUsd + costUsd };
        };
  // The reply belongs to the document it was asked in, even if another
  // is open by the time it arrives.
  if (useApp.getState().current?.id === doc.id) {
    updateCurrent(add);
  } else {
    try {
      const saved = await invoke<NudgeDoc>("load_document", { id: doc.id });
      await invoke("save_document", { doc: { ...add(saved), updatedMs: Date.now() } });
    } catch {
      // the document was deleted meanwhile
    }
  }
}
