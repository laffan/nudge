// Loading and saving the settings the Rust core keeps (Zotero, the models
// each use takes, the on-device model), the status of the API keys (which
// the core never hands back once saved), and which service and model a use
// of AI will take.
import { invoke } from "./tauri";
import { toast, useApp } from "./store";
import type { KeyStatus, NudgeDoc, Provider, Settings, UseChoice, UseId } from "./types";

export const DEFAULT_MODEL: Record<Exclude<Provider, "local">, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-6.2-sol",
};

export async function loadSettings(): Promise<void> {
  try {
    const [settings, keys] = await Promise.all([invoke<Settings>("load_settings"), invoke<KeyStatus>("ai_status")]);
    useApp.getState().setSettings({ ...settings, uses: settings.uses ?? {} });
    useApp.getState().setKeys(keys);
  } catch (e) {
    toast(`Could not load settings: ${e}`, "error");
  }
}

export async function saveSettings(next: Settings): Promise<void> {
  await invoke("save_settings", { settings: next });
  useApp.getState().setSettings(next);
}

/** Save a change to the settings now (Settings → AI applies as it goes,
 *  as Snorkle's does). */
export async function patchSettings(patch: Partial<Settings>): Promise<void> {
  const cur = useApp.getState().settings;
  if (!cur) return;
  try {
    await saveSettings({ ...cur, ...patch });
  } catch (e) {
    toast(`Could not save settings: ${e}`, "error");
  }
}

/** The service and model `id` takes: its own choice, else (for Review)
 *  Chat's, else the single provider of settings from before uses. */
export function choiceFor(s: Settings, id: UseId): UseChoice {
  const own = s.uses?.[id];
  if (own?.provider) return own;
  if (id !== "chat") return choiceFor(s, "chat");
  const p = s.provider || "local";
  return { provider: p, model: p === "anthropic" ? s.anthropicModel : p === "openai" ? s.openaiModel : s.localModel };
}

/** The model a choice sends: its own, else the service's default (for
 *  On-device, the default on-device model). */
export function modelOf(s: Settings, c: UseChoice): string {
  if (c.model) return c.model;
  return c.provider === "local" ? s.localModel : DEFAULT_MODEL[c.provider];
}

/** An online service and model to move a conversation to: Chat's own if
 *  it's online, else Review's, else the first service with a saved key at
 *  its default model. Null when no key is saved. */
export function onlineChoice(s: Settings, keys: KeyStatus): UseChoice | null {
  for (const id of ["chat", "review"] as const) {
    const c = choiceFor(s, id);
    if (c.provider !== "local" && keys[c.provider]) return c;
  }
  if (keys.anthropic) return { provider: "anthropic", model: "" };
  if (keys.openai) return { provider: "openai", model: "" };
  return null;
}

/** The service and model a document's conversation takes: Settings →
 *  AI → Chat, unless the writer moved this conversation with Use Local or
 *  Use APIs (`NudgeDoc.chatService`). */
export function chatChoice(s: Settings, keys: KeyStatus, doc: Pick<NudgeDoc, "chatService"> | null): UseChoice {
  const base = choiceFor(s, "chat");
  if (doc?.chatService === "local" && base.provider !== "local") return { provider: "local", model: "" };
  if (doc?.chatService === "online" && base.provider === "local") return onlineChoice(s, keys) ?? base;
  return base;
}

export function providerLabel(p: Provider): string {
  return p === "anthropic" ? "Anthropic" : p === "openai" ? "OpenAI" : "On-device";
}

/** Is `id` ready to run — a saved key, or an on-device model? */
export function readyFor(s: Settings | null, keys: KeyStatus, id: UseId): { ok: boolean; why?: string } {
  if (!s) return { ok: false, why: "Settings are loading" };
  const c = choiceFor(s, id);
  if (c.provider === "anthropic" && !keys.anthropic) return { ok: false, why: "Add an Anthropic API key in Settings → AI" };
  if (c.provider === "openai" && !keys.openai) return { ok: false, why: "Add an OpenAI API key in Settings → AI" };
  if (c.provider === "local" && !modelOf(s, c))
    return { ok: false, why: "Download an on-device model in Settings → Offline model, or choose an online service in Settings → AI" };
  return { ok: true };
}
