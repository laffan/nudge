// The AI usage log (Settings → AI → Usage, after Snorkle's): one entry per
// request, kept by the Rust core (src-tauri/src/usage.rs), totalled here
// by model and by local day. Costs are estimates from the price table in
// models.ts. Also what one document has cost, by service, for the foot of
// its conversation.
import { invoke } from "../tauri";
import type { NudgeDoc, Provider, Usage, UseId } from "../types";

export interface UsageEvent {
  atMs: number;
  use: UseId;
  provider: Provider;
  model: string;
  input: number;
  output: number;
  cached: number;
  costUsd: number;
  /** False when the model isn't in the price table: its cost shows as "≥". */
  priced: boolean;
}

export interface UsageDay {
  key: string;
  label: string;
  requests: number;
  input: number;
  output: number;
  costUsd: number;
  unpriced: boolean;
}

export function logUsage(use: UseId, provider: Provider, model: string, u: Usage, costUsd: number): void {
  const event: UsageEvent = {
    atMs: Date.now(),
    use,
    provider,
    model,
    input: u.inputTokens + u.cachedInputTokens + u.cacheWriteTokens,
    output: u.outputTokens,
    cached: u.cachedInputTokens,
    costUsd,
    priced: provider === "local" || costUsd > 0 || u.inputTokens + u.outputTokens === 0,
  };
  void invoke("usage_add", { event }).catch(() => {});
}

export interface UsageModel {
  key: string;
  provider: Provider;
  model: string;
  /** The uses (Chat, Review) it served. */
  uses: UseId[];
  requests: number;
  input: number;
  output: number;
  costUsd: number;
  unpriced: boolean;
}

export async function loadUsage(): Promise<UsageEvent[]> {
  return invoke<UsageEvent[]>("usage_list");
}

export function usageByModel(events: UsageEvent[]): UsageModel[] {
  const rows = new Map<string, UsageModel>();
  for (const e of events) {
    const key = `${e.provider}:${e.model}`;
    const row = rows.get(key) ?? { key, provider: e.provider, model: e.model, uses: [], requests: 0, input: 0, output: 0, costUsd: 0, unpriced: false };
    if (!row.uses.includes(e.use)) row.uses.push(e.use);
    row.requests += 1;
    row.input += e.input;
    row.output += e.output;
    row.costUsd += e.costUsd;
    row.unpriced ||= !e.priced;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests);
}

export interface ServiceCost {
  provider: Exclude<Provider, "local">;
  costUsd: number;
  /** By model and use, for the detail on hover. */
  parts: { model: string; use: UseId; costUsd: number }[];
}

/** What a document's conversation and reviews have cost, by service. */
export function documentCosts(doc: NudgeDoc): ServiceCost[] {
  const out = new Map<string, ServiceCost>();
  const add = (provider: Provider | undefined, model: string | undefined, use: UseId, cost: number | undefined) => {
    if (!provider || provider === "local" || !cost) return;
    const line = out.get(provider) ?? { provider, costUsd: 0, parts: [] };
    line.costUsd += cost;
    const m = model ?? "";
    const part = line.parts.find((p) => p.model === m && p.use === use);
    if (part) part.costUsd += cost;
    else line.parts.push({ model: m, use, costUsd: cost });
    out.set(provider, line);
  };
  for (const m of doc.messages) if (m.role === "assistant") add(m.provider, m.model, "chat", m.costUsd);
  for (const r of doc.reviews) add(r.provider, r.model, "review", r.costUsd);
  return [...out.values()];
}

export function usageByDay(events: UsageEvent[]): UsageDay[] {
  const days = new Map<string, UsageDay>();
  for (const e of events) {
    const d = new Date(e.atMs);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const day = days.get(key) ?? {
      key,
      label: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
      requests: 0,
      input: 0,
      output: 0,
      costUsd: 0,
      unpriced: false,
    };
    day.requests += 1;
    day.input += e.input;
    day.output += e.output;
    day.costUsd += e.costUsd;
    day.unpriced ||= !e.priced;
    days.set(key, day);
  }
  return [...days.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

export async function resetUsage(): Promise<void> {
  await invoke("usage_reset");
}
