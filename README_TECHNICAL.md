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
    Sidebar.tsx      the document list (Hush's files panel): each row the
                     document's name, its goal beneath, then its date. With the
                     list closed, App.tsx shows a narrow rail (toggle, New,
                     Settings) in its place
    chat/ChatPanel   goal screen (name, goal, sources), goal card, review bar,
                     conversation, composer, and under it what the document has
                     cost by service, with Use Local / Use APIs. The name and the goal are separate;
                     documents that earlier versions named after their goal show
                     as Untitled (`shownTitle` in lib/documents.ts)
    chat/ReviewBar   the review bar under the goal: the latest review, its
                     points (Work on this, Ignore / Revisit, Item complete,
                     Stop working), the earlier reviews with their times
    chat/MessageBubble
                     a message: yours draggable (grip, or a selection inside it) and
                     "Add to document" ("Add selection to document" while words
                     in it are selected: ChatPanel's `useMessageSelection` watches
                     `selectionchange`, and the button takes the selection on
                     pointerdown, before the press can clear it); the guide's as
                     Markdown (`ReplyMarkdown`, also used by the review bar),
                     citations as pills, references to the document as links
                     into it, its questions underlined (lib/ai/questions.ts).
                     The guide's and the reviewer's text can't be selected or
                     dragged (`user-select: none` in chat.css)
    chat/Sources     source chips, the attach menu, the goal screen's drop zone
    ReviewButton     Review, with its menu (include the attached PDFs or not)
    CopyButton       the document's copy menu: Markdown, or as a Google Doc
    DocumentPane     the editor's column: title, word count, copy / export, and
                     Review last; Suggest placement's requests and document
                     references carried out
    PdfViewer        the source viewer: lazy pages, text layer, Zotero highlights,
                     a citation's passage found and marked
    ZoteroPicker     collections + search, tick works, attach
    settings/        SettingsDialog (tabs: Offline model and Zotero edit a draft
                     saved with Save; the rest apply as they change), AiSettings
                     (after Snorkle's: Authentication, Uses, Usage),
                     OfflineSettings, ZoteroSettings, AppearanceSettings (with
                     CaretSettings), EditorSettings, ChatSettings,
                     ShortcutSettings
  editor/
    editor.ts        the CodeMirror setup; snippet drops; word count; export
    shortcuts.ts     every shortcut: id, default binding (Hush's), command
    modes.ts         focus mode and typewriter mode
    quick-find.ts    ⌘F: Hush's quick find, with the replace row; its marks
                     in find-highlight.ts
    caret.ts         the caret's shape, colour and animation; the caret at rest
    click-focus.ts   a click back into the editor places the caret and selects
                     nothing (WebKit's scroll on focus)
    google-doc-paste.ts
                     a paste from Google Docs as Markdown (Hush's converter)
    placement.ts     Suggest placement: the sentence a message would follow, and
                     its brief light; where quoted words are (`findInDocument`)
    *.js             ported unchanged from Hush (same author): sentence-core,
                     sentence-navigator, sentence-delete, sentence-parenthetical,
                     word-shift, formatting, move-line, join-lines,
                     markdown-extensions, wrap-on-selection,
                     select-instance-highlight, shortcuts-core (Hush's
                     shortcuts.js). Hush's cards and Desk Ratchet are stubbed out
                     where those files touched them.
  lib/
    types.ts         shared shapes: a document is goal + messages + reviews +
                     content + sources, and the review point being worked on
    store.ts         useApp (what's open and happening), usePrefs (this device, persisted)
    googleDoc.ts     Copy as Google Doc (Hush's): Markdown → the HTML Google Docs
                     reads, put on the clipboard as text/html beside the Markdown
    tauri.ts         invoke / invokeStreaming: Tauri inside the app,
                     browserBackend.ts in a plain browser
    documents.ts     create / open / save (coalesced) / delete / rename
    settings.ts      load / save the Rust-side settings; each use's service and
                     model (`choiceFor`, with settings from before uses read in;
                     `chatChoice`, with the document's Use Local / Use APIs);
                     is a use ready (`readyFor`)?
    sources.ts       attach PDFs and Zotero works; their text, page by page
    zotero.ts        Zotero items → titles, creators, annotations, notes
    pdf/             pdfjs.ts (loader, assets), text.ts (extraction with page markers),
                     pdfQuote.ts + pdfHighlight.ts (Zotero Helper's quote finder,
                     unchanged)
    ai/              prompts.ts (the guide's instructions), context.ts (building a
                     request), retrieval.ts (BM25 passages for the on-device model),
                     chat.ts (turns and reviews, streaming, offline fallback),
                     reviews.ts (a review's points and titles, its time, the
                     earlier reviews as the reviewer reads them back),
                     usage.ts (the usage log, by model and by day; a document's
                     cost by service), citations.ts (Zotero Helper's parser,
                     and references to the document), models.ts (online
                     catalog and prices),
                     localModels.ts (the offline catalog and why), questions.ts
                     (the sentences of a reply that ask something, underlined)
src-tauri/src/
  lib.rs             every command; the opt-in smoke test of the on-device path
  ios.rs             iPad only: the status bar hidden (tao's view controller); the
                     hardware keyboard handed to the page (after Hush)
  state.rs           data dir, HTTP client, settings, stop flags, the local engine
  settings.rs        keys, Zotero library, uses, the on-device model (settings.json);
                     the keys never go back to the frontend (`without_keys`)
  usage.rs           the AI usage log (usage.json)
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

1. `lib/ai/chat.ts` decides who answers. It uses the service and model of the use
   (Chat for a turn, Review for a review; Settings → AI → Uses). A document's
   conversation can be moved off its Chat setting with Use Local / Use APIs under
   the composer (`NudgeDoc.chatService`, read by `chatChoice` in lib/settings.ts):
   Use Local takes the default on-device model; Use APIs takes Chat's online
   choice, else Review's, else the first service with a key at its default model.
   Review keeps its own setting. It switches to the
   default on-device model when the browser reports no network and fallback is on. It also
   falls back to the on-device model when an online request fails with the `OFFLINE:`
   marker that `src-tauri/src/ai/` puts on connection errors.
2. `lib/ai/context.ts` builds the request:
   - **The system prompt is stable.** It holds the guide's instructions
     (`prompts.ts`), the citation rules (when there is source text), the goal, and
     the sources. Online, each source goes in whole (up to 150K characters, 400K in
     all), after its Zotero annotations and notes, with `[[page N]]` markers.
     Anthropic caches this block, and OpenAI caches a stable prefix on its own.
   - **The volatile part rides on the writer's latest message.** It is the document
     as it stands (`<document>…</document>`), the review point being worked on
     (`<working_on>…</working_on>`, when there is one) and, on the device, the
     passages retrieved for this turn. Keeping it out of the system prompt keeps
     the cached prefix intact.
   - **On the device, the whole request is fitted to the context window** at about
     3.6 characters per token, leaving room for the reply. The budget goes to the
     instructions and goal, then annotations (15%), the document (22%), passages
     (up to 30%), and then as much of the conversation as fits, newest first.
3. `invokeStreaming("ai_chat")` passes a Tauri `Channel`. Rust streams `status`
   ("Thinking…", "Loading the on-device model…"), `delta` and `done` (usage, model,
   stop reason) events, and the reply grows in `useApp.streaming`.
4. On `done`, the reply is appended to the document it was asked in, even if
   another document is open by then. Its cost is added to the document's total and
   the request to the usage log.

A **review** is the same path with the Review use. `buildReview` gives the reviewer
(`REVIEWER` in prompts.ts) the goal, the sources and the document, not the
conversation. With **Include attached PDFs** off in the Review button's menu
(`NudgeDoc.reviewSources`), the sources, their citation rules and the on-device
passages are left out, and the reviewer is told why (`SOURCES_LEFT_OUT`); the review
records it (`Review.withSources`, set only when there were sources to leave out).
The reviewer is also given its earlier reviews of the document
(`earlierReviewsBlock` in lib/ai/reviews.ts, `<earlier_reviews>…</earlier_reviews>`),
each point followed by what the writer did with it: marked complete, ignored, being
worked on, or not marked. Its instructions (`REVIEWER`, "EARLIER REVIEWS") have it
say what has been addressed since, check points marked complete against the draft,
and leave ignored points alone unless the draft has made them matter more. They go
in the message with the draft, not the system prompt, so the cached head of the
request stays the same from one review to the next. Online, the newest that fit in
30,000 characters go; on the device, 12% of the budget. It streams into the review bar and is kept in `NudgeDoc.reviews`, not
among the messages. In the guide's history each review is placed by its time among
the messages and passed on as something the writer shared (`REVIEW_SHARED`, role
user), so the guide doesn't take the advice as its own. Its instructions tell it to
leave the choosing of points to the writer. Documents from before reviews had a list
of their own have their review messages moved there when opened (`migrate` in
lib/documents.ts).

## The review bar

`components/chat/ReviewBar.tsx`, attached under the goal.

- **The points.** The reviewer is asked for a numbered list, each point opening
  with a bold title. `lib/ai/reviews.ts` splits a review into its opening
  sentences, its points and anything after them, and takes each point's title from
  its bold opening (or its first eight words). A bulleted list is accepted when there
  is no numbered one; a review with neither shows as plain Markdown.
- **Positions.** A point is known by its position in the list: `Review.done` lists
  the completed ones, `Review.ignored` the ignored ones, and `NudgeDoc.working`
  (`{ reviewId, item }`) is the one being worked on. All are saved with the
  document.
- **Work on this and Ignore.** Each open point of the latest review has both, shown
  on hover (always, on touch): Work on this in the accent, Ignore in grey. Ignore
  folds the point to its number and title, marked Ignored, with a Revisit link that
  takes the mark off. The bar's head counts them ("2 of 6 complete · 1 ignored").
- **Two tiers of folding.** The review opens and closes as a whole. Work on this
  narrows the bar to that one point, with Item complete and Stop working, and the
  point folds on its own to a line ("Working on: Evidence"). Item complete adds the
  point to `done` (greyed, with Reopen); Stop working leaves it as it was. Both clear
  `working` and return the bar to the whole review. The fold states are the
  component's own; a document opens with the review folded, and a new review opens
  it.
- **Earlier reviews.** Only the latest is worked from. A new review clears `working`.
  The earlier ones are listed with their times (`reviewWhen`: "Today, 2:14 pm") and
  open to be read, with their completed points marked.

## References to the document

The guide and the reviewer can point into the writer's document as they point into
a source: `[[doc:exact words]]` (`DOC_REFS` in prompts.ts, three to twelve words
copied from the `<document>` block). `citations.ts` turns each into a `nudge-doc:`
link (quotation marks the model put around it are taken in), which `ReplyMarkdown`
renders as the quoted words with an arrow. Pressing one sets `docFocusRequest`;
`DocumentPane` finds the words with `findInDocument` and scrolls to them and lights
them as Suggest placement does. The search ignores case, kinds of quote and dash,
Markdown emphasis, spacing and a trailing ellipsis. When the whole quote isn't
there, the first five words and then the last five will do. If nothing is found,
a toast says the words aren't in the document any more. In questions.ts a
reference counts as one piece, like a citation pill, so punctuation inside the
quote doesn't end the sentence around it.

## Settings → AI

The layout is lifted from Snorkle's `ui/chrome/settings.js`:

- **Authentication.** A box per service: Save (`ai_set_key`), Test (lists the
  account's models into localStorage, `nudge-ai-models.<service>`), Remove
  (`ai_delete_key`). The keys live in `settings.json`, where Snorkle uses the
  Keychain. `load_settings` never returns them and `save_settings` never overwrites
  them; `ai_status` says which are saved.
- **Uses.** Chat and Review, each a service and a model (`Settings.uses`). The
  services are On-device (when a model is downloaded), Anthropic and OpenAI (when
  keyed). The models come from Test, or the price table before Test; for On-device,
  the downloaded GGUFs. The Rust core runs the on-device model the request names, or
  else the default (`local_model`).
- **Usage.** `usage_add` / `usage_list` / `usage_reset`, totalled by model (with its
  service and the uses it served) and by local day, a row per service, in
  `lib/ai/usage.ts`. A model the
  price table doesn't know makes its total "≥". Amounts under a cent show to four
  places (`formatUsd`).

Under the composer, `documentCosts` totals what the open document has cost by
service, from the cost kept on each of its replies and reviews, with the detail by
model and use on hover. To its right is Use Local; while the conversation is on the
device, the costs give way to the on-device model's name ("On-device: Qwen3.5 4B")
and Use APIs (see "A turn, end to end"). Both are links in
the footer's own colour, told apart by their underline. Without a downloaded model,
Use Local opens Settings → Offline model; without a key, Use APIs opens Settings →
AI.

## Quick find

`editor/quick-find.ts`, Hush's `quick-find.js` in TypeScript, in place of
CodeMirror's search panel (`@codemirror/search` is no longer a dependency).

- **One bar per editor.** It's a view plugin, so it goes with the document. The bar
  is placed in the editor's column (`.doc-editor`, find.css), centred at its top.
  While it's open the column carries `data-finding`, which puts 52 px above the
  first line so the bar doesn't hide it; further down the scroll moves by the same
  amount, so nothing on screen shifts.
- **Searching.** Case is ignored; there is no regular-expression, case or
  whole-word option. Typing selects the first match at or after the selection and
  centres it; the marks (`find-highlight.ts`, `--find-match` and `--find-current`)
  are a StateField that maps through edits. Edits made while the bar is up search
  again on the next frame without moving the caret.
- **Keys.** In the field: Enter, or → with the caret at the end of the field, closes
  the bar and leaves the match selected (Hush's way out); ⇧↩ goes back; Esc closes;
  the Find, Find next and Find previous shortcuts work there too, as rebound. Esc in
  the document also closes it (a high-precedence keymap). With the bar closed,
  Find next / previous step through the last search.
- **Replace.** The chevron opens the replace row; whether it's open outlives the bar.
  Replace all is one transaction (`input.replace.all`), so one undo, and then
  searches again, briefly showing "4 replaced" in the count's place.

## The caret

`editor/caret.ts` and `styles/caret.css`, after Hush's cursor modes
(`block-cursor.js`, `cursor-options.js`, `caret-rest.js`).

- **Shape, colour, animation.** Prefs `caretShape` (line, thick, block,
  underline), `caretColor` (a preset's name, each a `--caret-*` token with light and
  dark values, or a #hex of the writer's own) and `caretAnimation` (blink, pulse,
  none). DocumentPane puts them on the column as `caret-<shape>
  caret-anim-<animation>` and `--caret`. Pulse follows CodeMirror's switch between
  `cm-blink` and `cm-blink2` on each move onto twin keyframes, so it restarts at full
  strength, as Hush's does. Settings → Appearance draws a sample with the same rules.
- **At rest.** `caretRest` marks the editor `data-caret="rest"` when the keyboard is
  elsewhere (listening to the window's focus too, since CodeMirror's `cm-focused`
  can outlive the app being put away). The caret then stays drawn, faded, grey and
  still, but only once the column has `data-placed`: until the writer has placed the
  caret, Add to document goes to the end, and a caret at the start would mislead.

## Clicking back into the document

With the focus elsewhere, scrolling the document and clicking into it used to select
everything from the old caret to the click. CodeMirror's mousedown handler reads the
click's position in the document, focuses the editor, and reads the position under
the pointer again; when they differ it selects between them, as for a drag. Safari
26's WebKit scrolls an editable element on focus even with `preventScroll`, towards
the selection it restores, so the second reading lands elsewhere. CodeMirror turns
`preventScroll` off for Safari 26, but it recognises Safari 26 by `Version/26` in
the user agent, which WKWebView's doesn't have.

`editor/click-focus.ts` focuses the editor itself before CodeMirror handles the
press and puts the scroll back, so CodeMirror finds it focused and reads both
positions from the same layout. For the rest of the press (at most 250 ms) any
scroll of the editor is undone, for a WebKit that scrolls a frame later. Typewriter
mode likewise centres a clicked line only once the button is up (`modes.ts`).

## Copy as Google Doc

`lib/googleDoc.ts`, Hush's `markdown-to-html.js` and `copy-command.js` in
TypeScript, less Hush's tab markers and Google-comment syntax. The whole document,
%%comments%% left out, becomes a small HTML subset Google Docs keeps on paste:
headings, paragraphs with a 10 pt space after (the blank line between them), nested
lists, block quotes as paragraphs indented 36 pt (Google Docs has no quote style),
code, rules, and inline bold, italics, strikethrough, code, links and
==highlights== (in Google Docs' own yellow). A bulleted and a numbered list next to
each other stay two lists. It goes on the clipboard through `ClipboardItem`, as
text/html with the Markdown as text/plain for places that take only text; where
there is no ClipboardItem, a hidden editable element holding the HTML is selected
and copied.

Pasting goes the other way (`editor/google-doc-paste.ts`, Hush's
`html-to-markdown.js` and `paste-extension.js`, less its comment and tab markers
for sync). Only HTML Google Docs made is converted, known by the
`docs-internal-guid-…` id it puts on every copy; anything else (the conversation,
web pages, Word) pastes as plain text, as CodeMirror does by default. Hush converts
every rich paste. The converter unwraps Google's `<b id="docs-internal-guid-…">`
envelope (which would make everything bold), reads bold, italics, strikethrough and
highlights from the spans' inline styles (the last `background-color` declared, a
plain one ignored), takes paragraphs indented half a level or more as block quotes
(dropping emphasis that covers the whole quoted line, which is the quote style's),
joins Google's one-list-per-item lists by `aria-level`, drops comment markers, and
takes links out of Google's `google.com/url?q=` redirect. The result replaces the
selection as one undo step (`input.paste`).

## Suggest placement

`editor/placement.ts` works without a model, at once and offline. Each sentence of the
document is scored by the words it shares with the message (TF-IDF over the
document's sentences, stop words left out, light stemming). Its neighbours in the
same paragraph add to its score, so the paragraph about the same thing wins over a
stray match. With nothing in common, the end of the document is suggested.

- **Hovering** "Suggest placement" (`mode: "preview"`) scrolls there and lights the
  sentence for 1.8 s.
- **Pressing** it (`mode: "place"`) also puts the caret after the sentence, so Add to
  document inserts there.

A message that's already in the document gets no placement: the button shows a tip
("This is already in your document.") instead (`isInDocument`, checked as it's
used). The check ignores case, spacing, curly vs straight quotes, dashes and
Markdown emphasis. It counts a message as there when the whole text is found, or
every sentence of it is, so a message split up or moved apart since still counts.

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

What the guide asks is underlined in its replies (`lib/ai/questions.ts`, a rehype
plugin on the Markdown). A question is a sentence ending in "?". The plugin works
per paragraph, list item and table cell, across the bold, italics and links inside
the sentence. It leaves out a lead-in ("Before anything else: who…?" underlines
from "who") and citation pills. A full stop after an abbreviation ("e.g.", "p. 4")
doesn't end a sentence, and neither does punctuation followed by lower case
('You said "why bother?" earlier.').

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
- `usage.json` (the newest 5,000 AI requests: when, service, model, tokens, cost)
- `documents/<id>.json` (one document, whole)
- `documents/index.json` (the list; rebuilt if missing)
- `sources/<id>.pdf` and `sources/<id>.text.json` (pages of text)
- `models/*.gguf`

Ids and model file names are checked before they become paths. Writes of a document
go through a temp file and a rename. Saves are coalesced, about 0.7 seconds after the
last change, and flushed when another document opens or the app is put away.

Device preferences (column widths, the look, the caret, the modes, spelling, the
chat's text size, rebound shortcuts, custom model URLs, Test's model lists) live in localStorage
(`nudge-prefs`, `nudge-custom-models`, `nudge-ai-models.<service>`).

## Browser preview

`npm run dev` without Tauri runs the interface against `lib/browserBackend.ts`. It
keeps documents and settings in localStorage and PDFs in memory, and its guide is
scripted. With a source attached, the scripted guide cites a real sentence of it, so
citations and the viewer can be exercised. The scripted review quotes the draft's
own words as document references. Replies report the model asked for, so the cost
estimates show. Zotero, model lists and downloads say they need the app.

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
- **The hardware keyboard reaches the page.** On iPad a key goes only to the first
  responder: for the page, WebKit's content view. wry gives it that role on macOS
  but not on iOS. WebKit takes it for a finger tap or a tap into text, never for a
  trackpad click. So with a Magic Keyboard, ⌘\ and the other shortcuts did nothing
  until text was tapped (Hush's README-TECHNICAL describes the same). `ios.rs`
  ports Hush's `KeyboardFocus.swift`. It calls `becomeFirstResponder` on the
  WKWebView at launch (retried for five seconds while the window appears), on
  resume, and when `main.tsx` reports a trackpad click outside editable text
  (`claim_keyboard`). It does so only while a hardware keyboard is attached
  (`GCKeyboard.coalescedKeyboard`; GameController is loaded with `dlopen`, as the
  generated project doesn't link it), never over a presented view controller, and
  never when a view inside the web view already holds the role.
- **Panel toggles fire once per press.** ⌘\ and ⌘⇧\ are the shortcuts whose second
  firing undoes the first. A repeat, or the same toggle again within 90 ms, is let
  go of (`App.tsx`, after Hush's `installPanelToggleGuard`).
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
