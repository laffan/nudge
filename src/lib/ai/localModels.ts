// The on-device models Settings → Offline model offers to download.
//
// The default, Qwen3.5 4B, is chosen for an 8 GB M1 iPad:
// - At 4-bit (Q4_K_M) the file is 2.74 GB, which leaves room for the
//   context, the app and iPadOS within the M1 iPad's memory (with the
//   increased-memory-limit entitlement — see README). Gemma 4 E4B, the
//   other strong 4B-class model of 2026, is 4.98 GB at the same
//   quantization: too much for 8 GB.
// - Its hybrid attention (three Gated DeltaNet layers to every full
//   attention layer) keeps the memory a long prompt needs small, and the
//   prompts here are long: instructions, source passages, the draft.
// - Apache 2.0, 262K-token native context, and strong instruction
//   following for its size — what a guide that must *not* write the
//   document for you needs most.
// It thinks before answering by default; the prompt turns that off
// (src-tauri/src/ai/local.rs, "chatml-nothink"), as a conversation wants
// quick, short turns.
//
// The others are there for a reason each: Qwen3 4B Instruct 2507 is
// plain attention, so the engine can reuse the previous turn's context
// and later turns start faster; Gemma 4 E2B is the smallest; Gemma 4 E4B
// is the strongest, for Macs with memory to spare.
import { usePrefs } from "../store";

export interface Sampling {
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  presencePenalty: number;
}

export interface LocalModel {
  id: string;
  label: string;
  file: string;
  url: string;
  sizeGB: number;
  /** Prompt format the Rust engine writes: see local.rs `build_prompt`. */
  format: "chatml" | "chatml-nothink" | "gemma4";
  sampling: Sampling;
  blurb: string;
  recommended?: boolean;
}

const HF = "https://huggingface.co";

export const LOCAL_MODELS: LocalModel[] = [
  {
    id: "qwen3.5-4b",
    label: "Qwen3.5 4B",
    file: "Qwen3.5-4B-Q4_K_M.gguf",
    url: `${HF}/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf`,
    sizeGB: 2.74,
    format: "chatml-nothink",
    sampling: { temperature: 0.7, topP: 0.8, topK: 20, minP: 0, presencePenalty: 1.5 },
    blurb: "Fits an 8 GB M1 iPad; long context at low memory; Apache 2.0.",
    recommended: true,
  },
  {
    id: "qwen3-4b-2507",
    label: "Qwen3 4B Instruct 2507",
    file: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
    url: `${HF}/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf`,
    sizeGB: 2.5,
    format: "chatml",
    sampling: { temperature: 0.7, topP: 0.8, topK: 20, minP: 0, presencePenalty: 0.5 },
    blurb: "Text only, never thinks; later turns start fastest. Apache 2.0.",
  },
  {
    id: "gemma-4-e2b",
    label: "Gemma 4 E2B",
    file: "gemma-4-E2B-it-Q4_K_M.gguf",
    url: `${HF}/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf`,
    sizeGB: 3.11,
    format: "gemma4",
    sampling: { temperature: 1.0, topP: 0.95, topK: 64, minP: 0, presencePenalty: 0 },
    blurb: "Google's smallest Gemma 4; 128K context; Apache 2.0.",
  },
  {
    id: "gemma-4-e4b",
    label: "Gemma 4 E4B",
    file: "gemma-4-E4B-it-Q4_K_M.gguf",
    url: `${HF}/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf`,
    sizeGB: 4.98,
    format: "gemma4",
    sampling: { temperature: 1.0, topP: 0.95, topK: 64, minP: 0, presencePenalty: 0 },
    blurb: "Stronger, but too large for an 8 GB iPad — for Macs with 16 GB or more.",
  },
];

/** A model the writer added by URL, kept on this device. */
export interface CustomModel {
  file: string;
  url: string;
  format: LocalModel["format"];
}

const CUSTOM_KEY = "nudge-custom-models";

export function customModels(): CustomModel[] {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]") as CustomModel[];
  } catch {
    return [];
  }
}

export function saveCustomModels(list: CustomModel[]): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch {
    // not kept
  }
  // Nudge anything that renders from the list.
  usePrefs.setState({});
}

/** What the engine needs for the model in file `file`. */
export function localOptionsFor(file: string) {
  const known = LOCAL_MODELS.find((m) => m.file === file);
  if (known) return { format: known.format, ...known.sampling };
  const custom = customModels().find((m) => m.file === file);
  const format = custom?.format ?? (/gemma-?4/i.test(file) ? "gemma4" : /qwen3\.5/i.test(file) ? "chatml-nothink" : "chatml");
  return { format, temperature: 0.7, topP: 0.9, topK: 40, minP: 0.05, presencePenalty: 0 };
}

export function localLabel(file: string): string {
  return LOCAL_MODELS.find((m) => m.file === file)?.label ?? file.replace(/\.gguf$/i, "");
}
