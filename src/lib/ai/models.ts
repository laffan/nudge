// The online models the app knows by name and price. Settings → AI also
// lists whatever each provider offers now (ai_list_models), so a model
// newer than this table can be picked; its cost then shows as unknown.
//
// Prices are USD per million tokens, from Anthropic's and OpenAI's pricing
// (November 2026), as Zotero Helper's catalog has them.
import type { Provider, Usage } from "../types";

export interface OnlineModel {
  id: string;
  label: string;
  provider: Exclude<Provider, "local">;
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  blurb: string;
}

export const ONLINE_MODELS: OnlineModel[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "anthropic", input: 4, cachedInput: 0.2, cacheWrite: 5, output: 20, blurb: "Anthropic's default: careful, attentive reading" },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2", provider: "anthropic", input: 8, cachedInput: 0.2, cacheWrite: 10, output: 40, blurb: "The most capable" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "anthropic", input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10, blurb: "Quicker, and half the price of Opus" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "anthropic", input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5, blurb: "Fastest and cheapest" },
  { id: "gpt-6.2-astra", label: "GPT-6.2 Astra", provider: "openai", input: 8, cachedInput: 0.4, cacheWrite: 10, output: 40, blurb: "OpenAI's most capable" },
  { id: "gpt-6.2-sol", label: "GPT-6.2 Sol", provider: "openai", input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10, blurb: "Speed and judgement balanced" },
  { id: "gpt-6.1-terra", label: "GPT-6.1 Terra", provider: "openai", input: 1, cachedInput: 0.05, cacheWrite: 1.25, output: 5, blurb: "The everyday tier" },
  { id: "gpt-6-luna", label: "GPT-6 Luna", provider: "openai", input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5, blurb: "Cheapest" },
];

export function findOnline(id: string): OnlineModel | undefined {
  return ONLINE_MODELS.find((m) => m.id === id || id.startsWith(`${m.id}-`));
}

export function modelLabel(id: string): string {
  return findOnline(id)?.label ?? id;
}

/** What a turn cost; 0 for the on-device model and for unknown models. */
export function usageCost(model: string, u: Usage | undefined): number {
  const m = findOnline(model);
  if (!m || !u) return 0;
  return (
    (u.inputTokens * m.input +
      u.cachedInputTokens * m.cachedInput +
      u.cacheWriteTokens * m.cacheWrite +
      u.outputTokens * m.output) /
    1_000_000
  );
}

/** Dollars, to the cent; amounts under a cent to four places, since a
 *  turn with a cheap model costs a fraction of one. */
export function formatUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.0001) return "<$0.0001";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
