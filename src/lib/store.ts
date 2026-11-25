// App state in two stores. `useApp` is what's open and happening: the
// document list, the open document, the reply being streamed, which
// panels and dialogs are up. `usePrefs` is this device's preferences —
// column widths, the editor's look and modes, rebound shortcuts —
// persisted in localStorage and never written to a document.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DocSummary, KeyStatus, NudgeDoc, Settings, ViewerTarget } from "./types";
import type { CaretAnimation, CaretShape } from "../editor/caret";

export interface Streaming {
  docId: string;
  requestId: string;
  text: string;
  status: string;
  /** A guide's reply, or a review of the document (Review button). */
  kind: "reply" | "review";
}

/** A message of the writer's, to show where in the document it fits
 *  (Suggest placement): "preview" scrolls there and flashes the sentence;
 *  "place" also puts the caret after it. */
export interface PlacementRequest {
  text: string;
  mode: "preview" | "place";
  nonce: number;
}

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

export type SettingsTab = "ai" | "offline" | "zotero" | "appearance" | "editor" | "chat" | "shortcuts";

interface AppState {
  settings: Settings | null;
  keys: KeyStatus;
  docs: DocSummary[];
  current: NudgeDoc | null;
  loadingDoc: boolean;
  streaming: Streaming | null;
  /** The source viewer column: closed when null. */
  viewer: ViewerTarget | null;
  settingsTab: SettingsTab | null;
  zoteroPicker: boolean;
  toasts: Toast[];
  /** Characters to put into the document at its caret (bumped to repeat). */
  insertRequest: { text: string; nonce: number } | null;
  placementRequest: PlacementRequest | null;
  /** Words of the document to scroll to and light up (a [[doc:…]]
   *  reference in a reply or review). */
  docFocusRequest: { text: string; nonce: number } | null;

  setSettings: (s: Settings) => void;
  setKeys: (k: KeyStatus) => void;
  setDocs: (d: DocSummary[]) => void;
  setCurrent: (d: NudgeDoc | null) => void;
  patchCurrent: (fn: (d: NudgeDoc) => NudgeDoc) => void;
  setLoadingDoc: (b: boolean) => void;
  setStreaming: (s: Streaming | null) => void;
  openViewer: (sourceId: string, page?: number, quote?: string) => void;
  closeViewer: () => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setZoteroPicker: (b: boolean) => void;
  toast: (text: string, kind?: "info" | "error") => void;
  dismissToast: (id: number) => void;
  insertIntoDocument: (text: string) => void;
  suggestPlacement: (text: string, mode: PlacementRequest["mode"]) => void;
  showInDocument: (text: string) => void;
}

let toastId = 0;

export const useApp = create<AppState>((set, get) => ({
  settings: null,
  keys: { anthropic: false, openai: false },
  docs: [],
  current: null,
  loadingDoc: false,
  streaming: null,
  viewer: null,
  settingsTab: null,
  zoteroPicker: false,
  toasts: [],
  insertRequest: null,
  placementRequest: null,
  docFocusRequest: null,

  setSettings: (settings) => set({ settings }),
  setKeys: (keys) => set({ keys }),
  setDocs: (docs) => set({ docs }),
  setCurrent: (current) => set({ current }),
  patchCurrent: (fn) => {
    const cur = get().current;
    if (cur) set({ current: fn(cur) });
  },
  setLoadingDoc: (loadingDoc) => set({ loadingDoc }),
  setStreaming: (streaming) => set({ streaming }),
  openViewer: (sourceId, page = 1, quote) =>
    set({ viewer: { sourceId, page, quote, nonce: Date.now() + Math.random() } }),
  closeViewer: () => set({ viewer: null }),
  openSettings: (tab = "ai") => set({ settingsTab: tab }),
  closeSettings: () => set({ settingsTab: null }),
  setZoteroPicker: (zoteroPicker) => set({ zoteroPicker }),
  toast: (text, kind = "info") => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => get().dismissToast(id), kind === "error" ? 8000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  insertIntoDocument: (text) => set({ insertRequest: { text, nonce: Date.now() + Math.random() } }),
  suggestPlacement: (text, mode) => set({ placementRequest: { text, mode, nonce: Date.now() + Math.random() } }),
  showInDocument: (text) => set({ docFocusRequest: { text, nonce: Date.now() + Math.random() } }),
}));

export type Theme = "system" | "light" | "dark";

export interface Prefs {
  sidebarOpen: boolean;
  sidebarWidth: number;
  viewerWidth: number;
  /** The chat column's share of the space it and the document split. */
  chatShare: number;
  theme: Theme;
  fontSize: number;
  lineHeight: number;
  editorFont: string;
  /** Widest the document's text column grows, in px. */
  columnWidth: number;
  /** The caret (Settings → Appearance; editor/caret.ts). The colour is a
   *  preset's name or a #hex. */
  caretShape: CaretShape;
  caretColor: string;
  caretAnimation: CaretAnimation;
  focusMode: boolean;
  typewriter: boolean;
  showWordCount: boolean;
  spellcheck: boolean;
  /** Text size of the conversation, in px. */
  chatFontSize: number;
  /** Underline what the guide asks (lib/ai/questions.ts). */
  underlineQuestions: boolean;
  /** Shortcut id → binding, for the ones rebound in Settings. */
  shortcuts: Record<string, string>;
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      sidebarWidth: 250,
      viewerWidth: 520,
      chatShare: 0.46,
      theme: "system",
      fontSize: 18,
      lineHeight: 1.6,
      editorFont: "iA Writer Quattro",
      columnWidth: 720,
      caretShape: "line",
      caretColor: "accent",
      caretAnimation: "blink",
      focusMode: false,
      typewriter: false,
      showWordCount: true,
      spellcheck: true,
      chatFontSize: 15,
      underlineQuestions: true,
      shortcuts: {},
      set: (key, value) => set({ [key]: value } as Partial<Prefs>),
    }),
    { name: "nudge-prefs" },
  ),
);

export function toast(text: string, kind: "info" | "error" = "info"): void {
  useApp.getState().toast(text, kind);
}
