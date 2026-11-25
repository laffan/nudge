// Loading and saving the settings the Rust core keeps (keys, Zotero, the
// model), and asking which provider will answer the next turn.
import { invoke } from "./tauri";
import { toast, useApp } from "./store";
import type { Provider, Settings } from "./types";

export async function loadSettings(): Promise<void> {
  try {
    useApp.getState().setSettings(await invoke<Settings>("load_settings"));
  } catch (e) {
    toast(`Could not load settings: ${e}`, "error");
  }
}

export async function saveSettings(next: Settings): Promise<void> {
  await invoke("save_settings", { settings: next });
  useApp.getState().setSettings(next);
}

/** The model a provider answers with, as Settings names it. */
export function modelFor(s: Settings, p: Provider): string {
  if (p === "anthropic") return s.anthropicModel;
  if (p === "openai") return s.openaiModel;
  return s.localModel;
}

export function providerLabel(p: Provider): string {
  return p === "anthropic" ? "Anthropic" : p === "openai" ? "OpenAI" : "On-device";
}

/** Is the chosen provider ready to answer — a key, or a model file? */
export function providerReady(s: Settings | null): { ok: boolean; why?: string } {
  if (!s) return { ok: false, why: "Settings are loading" };
  if (s.provider === "anthropic" && !s.anthropicApiKey.trim())
    return { ok: false, why: "Add an Anthropic API key in Settings → AI" };
  if (s.provider === "openai" && !s.openaiApiKey.trim())
    return { ok: false, why: "Add an OpenAI API key in Settings → AI" };
  if (s.provider === "local" && !s.localModel)
    return { ok: false, why: "Download an on-device model in Settings → Offline model, or choose an online provider" };
  return { ok: true };
}
