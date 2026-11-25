// The shapes everything shares. A document is the unit of work: its goal,
// the conversation that drew the writing out, the writing itself, and the
// sources attached to it. It is stored whole as JSON by the Rust core
// (src-tauri/src/storage.rs), which reads only id, title, goal, dates and
// content from it.

export type Provider = "local" | "anthropic" | "openai";

/** The features that use AI, each with a service and model of its own
 *  (Settings → AI → Uses, after Snorkle's). */
export type UseId = "chat" | "review";

export interface UseChoice {
  provider: Provider;
  /** The model's id, or for "local" the GGUF's file name. */
  model: string;
}

export interface Settings {
  zoteroApiKey: string;
  zoteroLibraryId: string;
  zoteroLibraryType: "user" | "group";
  uses: Partial<Record<UseId, UseChoice>>;
  /** Before uses: the one provider and its models. Read to fill `uses` in
   *  for settings saved then (lib/settings.ts `choiceFor`). */
  provider: Provider;
  anthropicModel: string;
  openaiModel: string;
  /** The keys never come back from the Rust core once saved (these stay
   *  empty here); `KeyStatus` says which are. */
  anthropicApiKey: string;
  openaiApiKey: string;
  /** The default on-device model (Settings → Offline model): the file name
   *  of a GGUF in the models folder. Used when the network is gone, and
   *  first for a use set to On-device. */
  localModel: string;
  effort: "low" | "medium" | "high";
  offlineFallback: boolean;
  localContext: number;
}

/** Which API keys are saved in the Rust core. */
export interface KeyStatus {
  anthropic: boolean;
  openai: boolean;
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
  /** "kickoff": the message that opens a conversation (the goal), shown
   *  as the goal card. "review": how reviews were kept before they had a
   *  list of their own (NudgeDoc.reviews); moved there when the document
   *  is opened. */
  kind?: "kickoff" | "review";
  provider?: Provider;
  model?: string;
  usage?: Usage;
  costUsd?: number;
}

/** A review of the document against its goal (the Review button), shown
 *  in the bar under the goal. It is the reviewer's, not the guide's: the
 *  guide reads it as something the writer shared, at the point in the
 *  conversation it was made (lib/ai/context.ts). */
export interface Review {
  id: string;
  ts: number;
  content: string;
  provider?: Provider;
  model?: string;
  usage?: Usage;
  costUsd?: number;
  /** Its points the writer has marked complete, by position in its list
   *  (lib/ai/reviews.ts). */
  done: number[];
  /** Whether the reviewer was given the attached sources (missing on
   *  reviews from before it could be left out: they were). */
  withSources?: boolean;
}

/** The review point the writer is working on (Work on this). */
export interface Working {
  reviewId: string;
  item: number;
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
  reviews: Review[];
  working: Working | null;
  /** Review with the attached sources (the Review button's menu). */
  reviewSources: boolean;
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
