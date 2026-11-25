// Running the conversation: beginning it from the goal, sending the
// writer's messages, streaming the guide's replies into the store, and
// stopping one midway. When an online provider can't be reached and an
// on-device model is installed, the turn is answered on the device
// instead (Settings → AI, "When offline…").
import { newId, titleFromGoal, updateCurrent } from "../documents";
import { invoke, invokeStreaming } from "../tauri";
import { toast, useApp } from "../store";
import type { ChatMessage, NudgeDoc, Provider, Settings, StreamEvent, Usage } from "../types";
import { buildLocal, buildOnline } from "./context";
import { localOptionsFor } from "./localModels";
import { usageCost } from "./models";
import { kickoffMessage } from "./prompts";

const LOCAL_REPLY_TOKENS = 700;

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
  updateCurrent((d) => ({
    ...d,
    goal: g,
    title: d.titled ? d.title : titleFromGoal(g),
    messages: [kickoff],
  }));
  await runTurn();
}

export async function sendMessage(text: string): Promise<void> {
  const t = text.trim();
  if (!t || useApp.getState().streaming) return;
  const msg: ChatMessage = { id: newId("msg"), role: "user", content: t, ts: Date.now() };
  updateCurrent((d) => ({ ...d, messages: [...d.messages, msg] }));
  await runTurn();
}

/** Ask again for the last reply (after an error, or to hear it otherwise). */
export async function retryLast(): Promise<void> {
  const doc = useApp.getState().current;
  if (!doc || useApp.getState().streaming) return;
  const last = doc.messages[doc.messages.length - 1];
  if (last?.role === "assistant") updateCurrent((d) => ({ ...d, messages: d.messages.slice(0, -1) }));
  await runTurn();
}

export function stopReply(): void {
  const s = useApp.getState().streaming;
  if (s) void invoke("ai_cancel", { id: s.requestId });
}

function modelOf(s: Settings, p: Provider): string {
  return p === "anthropic" ? s.anthropicModel : p === "openai" ? s.openaiModel : s.localModel;
}

function onlineWithoutNetwork(s: Settings): boolean {
  return s.provider !== "local" && typeof navigator !== "undefined" && navigator.onLine === false;
}

async function runTurn(): Promise<void> {
  const app = useApp.getState();
  const settings = app.settings;
  const doc = app.current;
  if (!settings || !doc || app.streaming) return;

  let provider: Provider = settings.provider;
  const canFallBack = settings.offlineFallback && Boolean(settings.localModel);
  if (onlineWithoutNetwork(settings) && canFallBack) {
    provider = "local";
    toast("No network — the on-device model is answering");
  }
  try {
    await streamReply(doc, settings, provider);
  } catch (e) {
    const msg = String(e).replace(/^Error:\s*/, "");
    if (provider !== "local" && msg.includes("OFFLINE:") && canFallBack) {
      toast("Couldn't reach the online model — the on-device model is answering");
      try {
        await streamReply(useApp.getState().current ?? doc, settings, "local");
        return;
      } catch (e2) {
        toast(String(e2).replace(/^Error:\s*/, ""), "error");
        return;
      }
    }
    toast(msg.replace("OFFLINE: ", ""), "error");
  }
}

async function streamReply(doc: NudgeDoc, settings: Settings, provider: Provider): Promise<void> {
  const app = useApp.getState();
  const model = modelOf(settings, provider);
  const built =
    provider === "local"
      ? await buildLocal(doc, settings.localContext, LOCAL_REPLY_TOKENS)
      : await buildOnline(doc);
  const requestId = newId("req");
  app.setStreaming({ docId: doc.id, requestId, text: "", status: "" });

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
          maxTokens: provider === "local" ? LOCAL_REPLY_TOKENS : 16000,
          local: localOptionsFor(settings.localModel),
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

  if (!text.trim()) {
    if (stop === "stopped") return;
    throw new Error("The model returned an empty reply");
  }
  const costUsd = provider === "local" ? 0 : usageCost(servedBy, usage);
  const reply: ChatMessage = {
    id: newId("msg"),
    role: "assistant",
    content: stop === "stopped" ? `${text.trim()} …` : text.trim(),
    ts: Date.now(),
    provider,
    model: servedBy,
    usage,
    costUsd,
  };
  // The reply belongs to the document it was asked in, even if another
  // is open by the time it arrives.
  if (useApp.getState().current?.id === doc.id) {
    updateCurrent((d) => ({ ...d, messages: [...d.messages, reply], costUsd: d.costUsd + costUsd }));
  } else {
    try {
      const saved = await invoke<NudgeDoc>("load_document", { id: doc.id });
      await invoke("save_document", {
        doc: { ...saved, messages: [...saved.messages, reply], costUsd: saved.costUsd + costUsd, updatedMs: Date.now() },
      });
    } catch {
      // the document was deleted meanwhile
    }
  }
}
