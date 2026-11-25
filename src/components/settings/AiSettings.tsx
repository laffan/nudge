// Settings → AI: which model answers — the on-device one, or Anthropic's
// or OpenAI's with a key — and what happens when the network is gone.
import { useState } from "react";
import { localLabel } from "../../lib/ai/localModels";
import { ONLINE_MODELS } from "../../lib/ai/models";
import { useApp } from "../../lib/store";
import { invoke } from "../../lib/tauri";
import type { Provider } from "../../lib/types";
import { Spinner } from "../Icons";
import type { DraftProps } from "./SettingsDialog";

interface Listed {
  id: string;
  label: string;
}

function ModelPicker({
  service,
  value,
  apiKey,
  onPick,
}: {
  service: "anthropic" | "openai";
  value: string;
  apiKey: string;
  onPick: (id: string) => void;
}) {
  const [listed, setListed] = useState<Listed[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const known = ONLINE_MODELS.filter((m) => m.provider === service);
  const extra = (listed ?? []).filter((l) => !known.some((k) => k.id === l.id));
  const refresh = async () => {
    setBusy(true);
    setErr(null);
    try {
      setListed(await invoke<Listed[]>("ai_list_models", { service, key: apiKey }));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="field-with-btn">
      <select value={value} onChange={(e) => onPick(e.target.value)}>
        {!known.some((k) => k.id === value) && !extra.some((x) => x.id === value) && <option value={value}>{value}</option>}
        <optgroup label="Known models">
          {known.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — ${m.input} / ${m.output} per M tokens · {m.blurb}
            </option>
          ))}
        </optgroup>
        {extra.length > 0 && (
          <optgroup label="Also offered by the provider">
            {extra.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <button className="btn small" disabled={!apiKey.trim() || busy} onClick={() => void refresh()} title="Ask the provider which models it offers now">
        {busy ? <Spinner size={12} /> : "List models"}
      </button>
      {err && <div className="field-error">{err}</div>}
    </div>
  );
}

export function AiSettings({ draft, set }: DraftProps) {
  const openSettings = useApp((s) => s.openSettings);
  const choice = (p: Provider, title: string, body: string) => (
    <label className={`provider-choice${draft.provider === p ? " chosen" : ""}`}>
      <input type="radio" name="provider" checked={draft.provider === p} onChange={() => set("provider", p)} />
      <div>
        <div className="provider-title">{title}</div>
        <div className="provider-body">{body}</div>
      </div>
    </label>
  );
  return (
    <>
      <p className="hint">
        The guide can run on this device with no network, or online with your own Anthropic or OpenAI key. Online models
        read your sources whole; the on-device model reads the passages that bear on each turn.
      </p>
      <h3>Who answers</h3>
      <div className="provider-choices">
        {choice(
          "local",
          "On-device (offline)",
          draft.localModel ? `${localLabel(draft.localModel)} — nothing leaves this device.` : "No model downloaded yet — see Offline model.",
        )}
        {choice("anthropic", "Anthropic", "Claude models, with your API key. Sources are cached between turns.")}
        {choice("openai", "OpenAI", "GPT models, with your API key.")}
      </div>
      {draft.provider === "local" && !draft.localModel && (
        <p className="warn">
          <button className="link" onClick={() => openSettings("offline")}>
            Download an on-device model
          </button>{" "}
          to use this.
        </p>
      )}

      <h3>Anthropic</h3>
      <label className="field">
        <span>API key</span>
        <input type="password" autoComplete="off" value={draft.anthropicApiKey} onChange={(e) => set("anthropicApiKey", e.target.value)} placeholder="sk-ant-…" />
      </label>
      <label className="field">
        <span>Model</span>
        <ModelPicker service="anthropic" value={draft.anthropicModel} apiKey={draft.anthropicApiKey} onPick={(id) => set("anthropicModel", id)} />
      </label>
      <label className="field">
        <span>Effort</span>
        <select value={draft.effort} onChange={(e) => set("effort", e.target.value as typeof draft.effort)}>
          <option value="low">Low — quickest replies</option>
          <option value="medium">Medium — the model's default</option>
          <option value="high">High — more thought per turn</option>
        </select>
      </label>

      <h3>OpenAI</h3>
      <label className="field">
        <span>API key</span>
        <input type="password" autoComplete="off" value={draft.openaiApiKey} onChange={(e) => set("openaiApiKey", e.target.value)} placeholder="sk-…" />
      </label>
      <label className="field">
        <span>Model</span>
        <ModelPicker service="openai" value={draft.openaiModel} apiKey={draft.openaiApiKey} onPick={(id) => set("openaiModel", id)} />
      </label>

      <h3>Without a network</h3>
      <label className="check">
        <input type="checkbox" checked={draft.offlineFallback} onChange={(e) => set("offlineFallback", e.target.checked)} />
        When the online model can't be reached, answer with the on-device model (if one is downloaded).
      </label>
    </>
  );
}
