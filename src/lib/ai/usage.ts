// The AI usage log (Settings → AI → Usage, after Snorkle's): one entry per
// request, kept by the Rust core (src-tauri/src/usage.rs), totalled here
// by local day. Costs are estimates from the price table in models.ts.
import { invoke } from "../tauri";
import type { Provider, Usage, UseId } from "../types";

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

export async function usageByDay(): Promise<UsageDay[]> {
  const events = await invoke<UsageEvent[]>("usage_list");
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
