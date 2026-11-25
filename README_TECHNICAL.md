# Nudge: technical guide

This guide is for contributors and coding agents: how the app is put together, and
the rules for changing it. [README.md](README.md) covers what the app does and how
to build it.

## Rules

These are the same rules as Hush and Zotero Helper:

1. **700 lines at most per code file.** When a file approaches the limit, split it
   along feature lines.
2. **Split by feature, not by size.** Add a new feature as a sibling module rather
   than growing an existing file. No `utils` junk drawer.
3. **Open each module with a comment** that says what it is for and why it works the
   way it does. Comments explain intent; they don't restate the code.
4. **Keep this document current** in the same change as the code.
5. **Colours come from `src/styles/tokens.css`,** so both appearances follow them.

## Stack

- Tauri 2.
- Frontend: React 18, TypeScript, Vite, zustand.
- Document editor: CodeMirror 6.
- PDFs: pdf.js 6.
- Rust core: reqwest (rustls with webpki roots, as Zotero Helper uses, because iOS
  has no enumerable trust store) and llama.cpp through `llama-cpp-2`, with Metal on
  macOS and iOS.

## Source map

```
src/
  App.tsx            the window: list | [viewer] | conversation | document; app shortcuts
  main.tsx
  components/
    Sidebar.tsx      the document list (Hush's files panel)
    chat/ChatPanel   goal screen, goal card, conversation, composer
    chat/MessageBubble
                     a message: yours draggable (grip, or a selection inside it) and
                     "Add to document"; the guide's as Markdown, citations as pills
    chat/Sources     source chips, the attach menu, the goal screen's drop zone
    DocumentPane     the editor's column: title, word count, copy / export
    PdfViewer        the source viewer: lazy pages, text layer, Zotero highlights,
                     a citation's passage found and marked
    ZoteroPicker     collections + search, tick works, attach
    settings/        SettingsDialog (tabs; draft + Save for the Rust-side settings),
                     AiSettings, OfflineSettings, ZoteroSettings, EditorSettings,
                     ShortcutSettings
  editor/
    editor.ts        the CodeMirror setup; snippet drops; word count; export
    shortcuts.ts     every shortcut: id, default binding (Hush's), command
    modes.ts         focus mode and typewriter mode
    *.js             ported unchanged from Hush (same author): sentence-core,
                     sentence-navigator, sentence-delete, sentence-parenthetical,
                     word-shift, formatting, move-line, join-lines,
                     markdown-extensions, wrap-on-selection,
                     select-instance-highlight, shortcuts-core (Hush's
                     shortcuts.js). Hush's cards and Desk Ratchet are stubbed out
                     where those files touched them.
  lib/
    types.ts         shared shapes: a document is goal + messages + content + sources
    store.ts         useApp (what's open and happening), usePrefs (this device, persisted)
    tauri.ts         invoke / invokeStreaming: Tauri inside the app,
                     browserBackend.ts in a plain browser
    documents.ts     create / open / save (coalesced) / delete / rename
    settings.ts      load / save the Rust-side settings; is the provider ready?
    sources.ts       attach PDFs and Zotero works; their text, page by page
    zotero.ts        Zotero items → titles, creators, annotations, notes
    pdf/             pdfjs.ts (loader, assets), text.ts (extraction with page markers),
                     pdfQuote.ts + pdfHighlight.ts (Zotero Helper's quote finder,
                     unchanged)
    ai/              prompts.ts (the guide's instructions), context.ts (building a
                     request), retrieval.ts (BM25 passages for the on-device model),
                     chat.ts (turns, streaming, offline fallback), citations.ts
                     (Zotero Helper's parser), models.ts (online catalog and prices),
                     localModels.ts (the offline catalog and why)
src-tauri/src/
  lib.rs             every command; the opt-in smoke test of the on-device path
  ios.rs             iPad only: the status bar hidden (tao's view controller)
  state.rs           data dir, HTTP client, settings, stop flags, the local engine
  settings.rs        keys, Zotero library, provider and models (settings.json)
  storage.rs         documents/<id>.json + index.json; sources/<id>.pdf + .text.json
  zotero.rs          Web API v3, read-only: verify, collections, search, children,
                     annotations, file
  downloads.rs       GGUF downloads: streamed, resumable (.part + Range), with progress
  ai/mod.rs          ChatRequest → provider → ChatEvent stream (status, delta, done)
  ai/anthropic.rs    Messages API, streamed; cached system block; effort; fallbacks
  ai/openai.rs       Chat Completions, streamed
  ai/sse.rs          Server-Sent Events reader
  ai/models.rs       each provider's list of models (Zotero Helper's)
  ai/local.rs        the llama.cpp worker thread, prompt formats, think-tag filter
```

## A turn, end to end

1. `lib/ai/chat.ts` decides who answers. It uses the provider from settings, or the
   on-device model when the browser reports no network and fallback is on. It also
   falls back to the on-device model when an online request fails with the `OFFLINE:`
   marker that `src-tauri/src/ai/` puts on connection errors.
2. `lib/ai/context.ts` builds the request:
   - **The system prompt is stable.** It holds the guide's instructions
     (`prompts.ts`), the citation rules (when there is source text), the goal, and
     the sources. Online, each source goes in whole (up to 150K characters, 400K in
     all), after its Zotero annotations and notes, with `[[page N]]` markers.
     Anthropic caches this block, and OpenAI caches a stable prefix on its own.
   - **The volatile part rides on the writer's latest message.** It is the document
     as it stands (`<document>…</document>`) and, on the device, the passages
     retrieved for this turn. Keeping it out of the system prompt keeps the cached
     prefix intact.
   - **On the device, the whole request is fitted to the context window** at about
     3.6 characters per token, leaving room for the reply. The budget goes to the
     instructions and goal, then annotations (15%), the document (22%), passages
     (up to 30%), and then as much of the conversation as fits, newest first.
3. `invokeStreaming("ai_chat")` passes a Tauri `Channel`. Rust streams `status`
   ("Thinking…", "Loading the on-device model…"), `delta` and `done` (usage, model,
   stop reason) events, and the reply grows in `useApp.streaming`.
4. On `done`, the reply is appended to the document it was asked in, even if
   another document is open by then, and its cost is added to the document's total.

## The guide's instructions

`lib/ai/prompts.ts` is the product's core. It tells the model to:

- ask one question at a time;
- build on what the writer said;
- keep the whole document in view;
- never draft or rewrite the document's prose;
- say when an answer is ready to go into the draft;
- bring the sources in, the writer's own annotations first;
- keep its turns short.

The first message of a conversation (`kickoffMessage`) states the goal on the
writer's behalf. It is shown as the goal card, not as a message of theirs.

## Citations

The format and parser come from Zotero Helper. The model writes
`[[cite:S:P:exact words]]`. `citations.ts` turns each citation into a `nudge-cite:`
link, which `MessageBubble` renders as a pill. Pressing the pill opens the viewer at
page P. `pdfQuote.findQuote` then searches outward from that page for the quoted
words, matching words rather than characters, and the viewer marks what it finds.
The page number is only where the search starts, because it is the part of a
citation a model most often gets wrong.

## The on-device engine

`src-tauri/src/ai/local.rs`.

**One worker thread owns the model and its context**, so the KV cache outlives a
turn. Each new turn evaluates only the tokens after the prefix it shares with the
previous one. Hybrid models such as Qwen3.5 can't rewind their recurrent state part
way. When `llama_memory_seq_rm` refuses, the context is cleared and the whole prompt
is read again. That is slower, but the answer is the same.

**Prompts are written in each family's own format** rather than through llama.cpp's
template detection, which knows neither Gemma 4's turns nor Qwen3.5's switch for
turning thinking off:

- `chatml-nothink` writes Qwen3.5's empty `<think></think>`.
- `gemma4` writes `<|turn>…<turn|>`.
- `ThinkFilter` strips a `<think>` block if a model thinks anyway.

**Model and context changes are handled in the worker.** Changing the model in
Settings unloads the old one. Changing the context size rebuilds the context. The
first thread starts on the first local turn.

**To test the path for real** (download, load, two turns):

```sh
cd src-tauri
NUDGE_SMOKE_URL=https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf \
  cargo test --release --lib smoke -- --ignored --nocapture
```

## Storage

The app's data folder holds:

- `settings.json`
- `documents/<id>.json` (one document, whole)
- `documents/index.json` (the list; rebuilt if missing)
- `sources/<id>.pdf` and `sources/<id>.text.json` (pages of text)
- `models/*.gguf`

Ids and model file names are checked before they become paths. Writes of a document
go through a temp file and a rename. Saves are coalesced, about 0.7 seconds after the
last change, and flushed when another document opens or the app is put away.

Device preferences (column widths, editor look, modes, rebound shortcuts, custom
model URLs) live in localStorage (`nudge-prefs`, `nudge-custom-models`).

## Browser preview

`npm run dev` without Tauri runs the interface against `lib/browserBackend.ts`. It
keeps documents and settings in localStorage and PDFs in memory, and its guide is
scripted. With a source attached, the scripted guide cites a real sentence of it, so
citations and the viewer can be exercised. Zotero, model lists and downloads say they
need the app.

## iOS linking

On iOS, Rust is built as a static library (`libapp.a`) that Xcode links into the
app. Link requests that build scripts make with `cargo:rustc-link-lib=framework=…`
don't travel inside a static library. `llama-cpp-sys-2` asks for Foundation, Metal,
MetalKit and Accelerate in that way, so the Xcode project has to link them itself:

- Tauri's project template already links Metal and MetalKit.
- `bundle.iOS.frameworks` in `tauri.conf.json` adds Accelerate (ggml's `vDSP_*`
  calls) and Foundation.
- `scripts/ios-entitlements.mjs` brings the generated project's memory
  entitlements in line with `src-tauri/ios/Nudge.entitlements`. Tauri's config has
  no entitlements option. Only Increased Memory Limit is requested: Personal teams
  can't sign Extended Virtual Addressing, and the script removes it if an earlier
  run added it. `--no-memory-limit` removes Increased Memory Limit too.

Both take effect when the project is generated (`npm run ios:init`), not on later
builds.

## The iPad window

- **No status bar.** `src/ios.rs` calls `setPrefersStatusBarHidden:` on tao's
  `TaoUIViewController`, which Tauri hands out as the webview's
  `view_controller()`. It does this at setup, on `RunEvent::Ready` and on
  `RunEvent::Resumed`, as Snorkle does. `UIViewControllerBasedStatusBarAppearance`
  stays YES in `Info.ios.plist`: with NO, UIKit ignores the view controller, and
  apps built with the current SDK get no effect from
  `UIApplication.statusBarHidden`.
- **Nothing of the app's own starts in the top strip.** iPadOS 26 uses the window's
  top ~30 pt to drag, shrink or un-fullscreen the window, and to show the window
  controls. On iPad (`html.ipados`) each column's head starts below
  `--ipad-top` (36 px, or the safe area if a status bar shows anyway).
- **Trackpad scrolling.** In landscape with a Magic Keyboard, two-finger scrolls
  arrived turned a quarter round. `Info.ios.plist` sets two keys, both needed, as
  in Snorkle and Zotero Helper:
  - `UIApplicationSupportsIndirectInputEvents`;
  - a single-window `UIApplicationSceneManifest` naming tao's `TaoSceneDelegate`
    (tao 0.37 and later). Without it, tao starts on the legacy
    application-delegate path and the window isn't created in its scene's
    orientation.

  Plist keys are read from the built app, so a change needs a rebuild and
  reinstall, not a hot reload.
- **Type-checking the iPad target on Linux.** Run from `src-tauri`:

  ```sh
  DOCS_RS=1 SDKROOT=<dir> CC_aarch64_apple_ios=clang cargo check --target aarch64-apple-ios --no-default-features
  ```

  `<dir>/usr/include` holds stub `TargetConditionals.h`, `assert.h` and
  `string.h`, so `ring`'s C compiles without Apple's SDK. `DOCS_RS` skips objc2's
  C helper. This checks the Rust, not the link.

## Not yet done / known limits

- The iOS build of llama.cpp (Metal) has not yet run on a device. If it can't be
  made to link, `--no-default-features` builds without the on-device engine.
- Exporting to a file uses the save dialog on macOS. On iPad the document is copied
  to the clipboard as Markdown instead.
- Downloaded models live in the app's data folder, which iOS includes in device
  backups. Excluding them (`NSURLIsExcludedFromBackupKey`) needs a small native call.
- Zotero is read-only here: nothing is written back.
