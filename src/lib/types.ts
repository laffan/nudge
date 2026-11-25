// The shapes everything shares. A document is the unit of work: its goal,
// the conversation that drew the writing out, the writing itself, and the
// sources attached to it. It is stored whole as JSON by the Rust core
// (src-tauri/src/storage.rs), which reads only id, title, goal, dates and
// content from it.

export type Provider = "local" | "anthropic" | "openai";

export interface Settings {
  zoteroApiKey: string;
  zoteroLibraryId: string;
  zoteroLibraryType: "user" | "group";
  provider: Provider;
  anthropicApiKey: string;
  openaiApiKey: string;
  anthropicModel: string;
  openaiModel: string;
  /** File name of the GGUF in the models folder. */
  localModel: string;
  effort: "low" | "medium" | "high";
  offlineFallback: boolean;
  localContext: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
}

/** A highlight, underline or note the writer made in Zotero's reader. */
export interface ZoteroAnnotation {
  key: string;
  type: string; // highlight | underline | note | image | ink | text
  color: string;
  text: string;
  comment: string;
  pageLabel: string;
  /** 0-based page in the PDF, from the annotation's position. */
  pageIndex: number | null;
  /** Its boxes on that page, in PDF points: [x1, y1, x2, y2] each. */
  rects?: number[][];
  sortIndex: string;
}

export interface Source {
  id: string;
  kind: "pdf" | "zotero";
  title: string;
  authors?: string;
  year?: string;
  /** Whether a PDF of it is stored on this device. */
  hasFile: boolean;
  fileName?: string;
  pageCount?: number;
  /** Characters of text extracted from it. */
  chars?: number;
  abstract?: string;
  zotero?: { itemKey: string; attachmentKey?: string };
  annotations?: ZoteroAnnotation[];
  /** The Zotero item's notes, as plain text. */
  notes?: string[];
  addedMs: number;
  status: "reading" | "ready" | "error";
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  /** The message that opens a conversation (the goal), shown as a card. */
  kind?: "kickoff";
  provider?: Provider;
  model?: string;
  usage?: Usage;
  costUsd?: number;
}

export interface NudgeDoc {
  id: string;
  title: string;
  /** Renamed by hand — so the goal no longer names it. */
  titled: boolean;
  goal: string;
  createdMs: number;
  updatedMs: number;
  /** The writer's document, as Markdown. */
  content: string;
  messages: ChatMessage[];
  sources: Source[];
  costUsd: number;
}

export interface DocSummary {
  id: string;
  title: string;
  goal: string;
  createdMs: number;
  updatedMs: number;
  words: number;
}

/** What the source viewer shows: a source, a page, maybe a passage. */
export interface ViewerTarget {
  sourceId: string;
  page: number;
  quote?: string;
  /** Changes on every request, so asking for the same place again
   *  scrolls back to it. */
  nonce: number;
}

export type StreamEvent =
  | { type: "status"; message: string }
  | { type: "delta"; text: string }
  | { type: "done"; usage: Usage; model: string; stop: string };
