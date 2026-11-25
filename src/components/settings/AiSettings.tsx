// Settings → AI, after Snorkle's (ui/chrome/settings.js there): connect each
// service with its own key (Authentication: Save, Test, Remove — a saved
// key is never shown again), then choose a service and model for each use
// of AI (Uses: Chat, Review), and see what it has cost (Usage). Unlike
// Snorkle's, the uses can also be On-device, as Nudge works offline. Every
// change here applies as it's made.
import { useEffect, useState } from "react";
import { localLabel } from "../../lib/ai/localModels";
import { ONLINE_MODELS, formatUsd, modelLabel } from "../../lib/ai/models";
import { loadUsage, resetUsage, usageByDay, usageByModel, type UsageEvent } from "../../lib/ai/usage";
import { choiceFor, patchSettings, providerLabel } from "../../lib/settings";
import { useApp } from "../../lib/store";
import { invoke } from "../../lib/tauri";
import type { KeyStatus, Provider, UseId } from "../../lib/types";

type Online = Exclude<Provider, "local">;
interface Listed {
  id: string;
  label: string;
}

const LIST_KEY = (p: Online) => `nudge-ai-models.${p}`;

function listedModels(p: Online): Listed[] {
  try {
    return JSON.parse(localStorage.getItem(LIST_KEY(p)) ?? "[]") as Listed[];
  } catch {
    return [];
  }
}

const USES: { id: UseId; label: string; note: string }[] = [
  { id: "chat", label: "Chat", note: "The guide's side of the conversation." },
  { id: "review", label: "Review", note: "Assesses the document against its goal (the document's Review button)." },
];
const USE_NAMES = Object.fromEntries(USES.map((u) => [u.id, u.label])) as Record<UseId, string>;

function ProviderBox({ p, onListed }: { p: Online; onListed: () => void }) {
  const keys = useApp((s) => s.keys);
  const setKeys = useApp((s) => s.setKeys);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const on = keys[p];
  const n = listedModels(p).length;

  const test = async () => {
    setMsg("Testing…");
    try {
      const models = await invoke<Listed[]>("ai_list_models", { service: p, key: null });
      localStorage.setItem(LIST_KEY(p), JSON.stringify(models));
      onListed();
      setMsg(`Connected. ${models.length} model${models.length === 1 ? "" : "s"} available; choose them under Uses.`);
    } catch (e) {
      setMsg(String(e).replace(/^Error:\s*/, ""));
    }
  };
  const save = async () => {
    try {
      setKeys(await invoke<KeyStatus>("ai_set_key", { provider: p, key }));
      setKey("");
      setMsg("Saved. Testing…");
      await test();
    } catch (e) {
      setMsg(String(e).replace(/^Error:\s*/, ""));
    }
  };
  const remove = async () => {
    try {
      setKeys(await invoke<KeyStatus>("ai_delete_key", { provider: p }));
      setMsg("Key removed from this device.");
    } catch (e) {
      setMsg(String(e).replace(/^Error:\s*/, ""));
    }
  };

  return (
    <div className="ai-provider">
      <div className="ai-head">
        <span className="ai-title">{providerLabel(p)}</span>
        <span className="ai-state">{on ? (n ? `Key saved · ${n} models` : "Key saved") : "Not connected"}</span>
      </div>
      <div className="ai-row">
        <input
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={on ? "Replace the saved key" : p === "anthropic" ? "Anthropic API key (sk-ant-…)" : "OpenAI API key (sk-…)"}
          aria-label={`${providerLabel(p)} API key`}
          onKeyDown={(e) => e.key === "Enter" && key.trim() && void save()}
        />
        <button className="btn small" disabled={!key.trim()} onClick={() => void save()}>
          Save
        </button>
      </div>
      <div className="ai-row">
        <button className="btn small" disabled={!on} onClick={() => void test()}>
          Test
        </button>
        <button className="btn small" disabled={!on} onClick={() => void remove()}>
          Remove
        </button>
      </div>
      {msg && (
        <div className="ai-msg" role="status">
          {msg}
        </div>
      )}
    </div>
  );
}

function UseRow({ id, label, note, installed }: { id: UseId; label: string; note: string; installed: string[] }) {
  const settings = useApp((s) => s.settings);
  const keys = useApp((s) => s.keys);
  if (!settings) return null;
  const choice = choiceFor(settings, id);
  const services: Provider[] = [
    ...(installed.length ? (["local"] as Provider[]) : []),
    ...(keys.anthropic ? (["anthropic"] as Provider[]) : []),
    ...(keys.openai ? (["openai"] as Provider[]) : []),
  ];
  const modelsFor = (p: Provider): Listed[] => {
    if (p === "local") return installed.map((f) => ({ id: f, label: localLabel(f) }));
    const listed = listedModels(p);
    return listed.length ? listed : ONLINE_MODELS.filter((m) => m.provider === p).map((m) => ({ id: m.id, label: m.label }));
  };
  const set = (provider: Provider, model: string) =>
    void patchSettings({ uses: { ...settings.uses, [id]: { provider, model } } });
  const current = services.includes(choice.provider) ? choice.provider : null;
  const models = current ? modelsFor(current) : [];
  const model = choice.model || (current === "local" ? settings.localModel : "");

  return (
    <div className="ai-use">
      <div className="ai-use-label">
        <div className="ai-title">{label}</div>
        <div className="hint">{note}</div>
      </div>
      <div className="ai-use-pickers">
        <select
          aria-label={`${label}: service`}
          disabled={!services.length}
          value={current ?? ""}
          onChange={(e) => {
            const p = e.target.value as Provider;
            set(p, modelsFor(p)[0]?.id ?? "");
          }}
        >
          {!services.length && <option value="">Connect a service above</option>}
          {services.length > 0 && !current && <option value="">{providerLabel(choice.provider)} (not connected)</option>}
          {services.map((p) => (
            <option key={p} value={p}>
              {providerLabel(p)}
            </option>
          ))}
        </select>
        <select aria-label={`${label}: model`} disabled={!current} value={model} onChange={(e) => current && set(current, e.target.value)}>
          {current && model && !models.some((m) => m.id === model) && <option value={model}>{current === "local" ? localLabel(model) : model}</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label === m.id ? m.id : `${m.label} (${m.id})`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function UsageTable() {
  const [events, setEvents] = useState<UsageEvent[] | null>(null);
  const [armed, setArmed] = useState(false);
  const load = () => void loadUsage().then(setEvents).catch(() => setEvents([]));
  useEffect(load, []);
  const days = events ? usageByDay(events) : null;
  const models = events ? usageByModel(events) : null;
  const total = (days ?? []).reduce(
    (t, d) => ({ requests: t.requests + d.requests, input: t.input + d.input, output: t.output + d.output, costUsd: t.costUsd + d.costUsd, unpriced: t.unpriced || d.unpriced }),
    { requests: 0, input: 0, output: 0, costUsd: 0, unpriced: false },
  );
  const fmt = (n: number) => n.toLocaleString();
  const cost = (n: number, unpriced: boolean) => `${unpriced ? "≥ " : ""}${formatUsd(n)}`;
  const head = (first: string) => (
    <thead>
      <tr>
        <th scope="col">{first}</th>
        <th scope="col">Requests</th>
        <th scope="col">Input</th>
        <th scope="col">Output</th>
        <th scope="col">Est. cost</th>
      </tr>
    </thead>
  );
  const none = events?.length === 0 && (
    <tr>
      <td colSpan={5}>No AI requests yet.</td>
    </tr>
  );
  return (
    <div className="ai-usage">
      <div className="ai-head">
        <span className="ai-title">Usage</span>
        <button
          className={`btn small${armed ? " armed" : ""}`}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              setTimeout(() => setArmed(false), 4000);
              return;
            }
            setArmed(false);
            void resetUsage().then(load);
          }}
        >
          {armed ? "Press again to reset" : "Reset"}
        </button>
      </div>
      <p className="hint">
        Tokens used by Nudge's AI requests, by model and by day, with an estimated cost from published prices. Your
        provider's billing page is authoritative. On-device requests cost nothing.
      </p>
      <h4 className="usage-caption">By model</h4>
      <table className="usage-table">
        {head("Model")}
        <tbody>
          {none}
          {models?.map((m) => (
            <tr key={m.key}>
              <td>
                {m.provider === "local" ? localLabel(m.model) : modelLabel(m.model)}
                <span className="usage-sub">
                  {providerLabel(m.provider)} · {m.uses.map((u) => USE_NAMES[u]).join(", ")}
                </span>
              </td>
              <td>{fmt(m.requests)}</td>
              <td>{fmt(m.input)}</td>
              <td>{fmt(m.output)}</td>
              <td>{cost(m.costUsd, m.unpriced)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4 className="usage-caption">By day</h4>
      <table className="usage-table">
        {head("Date")}
        <tbody>
          {none}
          {days?.map((d) => (
            <tr key={d.key}>
              <td>{d.label}</td>
              <td>{fmt(d.requests)}</td>
              <td>{fmt(d.input)}</td>
              <td>{fmt(d.output)}</td>
              <td>{cost(d.costUsd, d.unpriced)}</td>
            </tr>
          ))}
        </tbody>
        {Boolean(days?.length) && (
          <tfoot>
            <tr>
              <td>Total</td>
              <td>{fmt(total.requests)}</td>
              <td>{fmt(total.input)}</td>
              <td>{fmt(total.output)}</td>
              <td>{cost(total.costUsd, total.unpriced)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export function AiSettings() {
  const settings = useApp((s) => s.settings);
  const [, rerender] = useState(0);
  const [installed, setInstalled] = useState<string[]>([]);
  useEffect(() => {
    invoke<{ installed: { file: string }[] }>("local_status", { files: [] })
      .then((st) => setInstalled(st.installed.map((m) => m.file)))
      .catch(() => setInstalled([]));
  }, []);
  if (!settings) return null;
  return (
    <>
      <p className="hint">
        Use the on-device model, or connect your own Anthropic or OpenAI account. Keys are kept in Nudge's settings on this
        device and are never shown again. Requests go directly to the provider: a chat turn sends your goal, your sources,
        the conversation and your document; a review sends your goal, your sources and your document.
      </p>
      <h3>Authentication</h3>
      <p className="hint">Test lists the models your account can use, for the menus under Uses.</p>
      <ProviderBox p="anthropic" onListed={() => rerender((n) => n + 1)} />
      <ProviderBox p="openai" onListed={() => rerender((n) => n + 1)} />

      <h3>Uses</h3>
      <p className="hint">Each use has its own service and model. On-device lists the models downloaded under Offline model.</p>
      <div className="ai-uses">
        {USES.map((u) => (
          <UseRow key={u.id} {...u} installed={installed} />
        ))}
        <div className="ai-use">
          <div className="ai-use-label">
            <div className="ai-title">Anthropic effort</div>
            <div className="hint">How much Claude thinks before each answer.</div>
          </div>
          <div className="ai-use-pickers">
            <select value={settings.effort} onChange={(e) => void patchSettings({ effort: e.target.value as typeof settings.effort })}>
              <option value="low">Low — quickest replies</option>
              <option value="medium">Medium — the model's default</option>
              <option value="high">High — more thought per turn</option>
            </select>
          </div>
        </div>
      </div>

      <h3>Without a network</h3>
      <label className="check">
        <input type="checkbox" checked={settings.offlineFallback} onChange={(e) => void patchSettings({ offlineFallback: e.target.checked })} />
        When an online model can't be reached, answer with the default on-device model (if one is downloaded).
      </label>

      <UsageTable />
    </>
  );
}
