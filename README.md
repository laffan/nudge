# Nudge

A writing app for macOS and iPad in which an AI guides a conversation and you
write the document. Every sentence in the finished document is yours: the AI asks
the questions, points you to your sources, and tells you when one of your answers
is ready to go into the draft. You drag that answer across, or copy and paste it.

Nudge combines two earlier apps. From [Hush](https://github.com/laffan/hush) it takes
the document list and the editor, including Hush's Markdown flavour and keyboard
shortcuts. From [Zotero Helper](https://github.com/laffan/zotero-helper) it takes the
Zotero integration (the Web API, and reading your annotations) and the AI
conversation, including page citations that open the PDF at the cited passage.

## The window

- **Document list** (left). Hush's files panel: newest first, with a filter, rename,
  and delete. Settings is the gear at the bottom.
- **Conversation** (middle). A new document opens on its goal screen. You say what
  the document is for and attach supporting PDFs, then press **Begin**. After that the
  goal stays at the top (click it to edit), the review bar is attached under it once
  the document has been reviewed, your sources appear as chips, and the conversation
  runs below. Under the composer is what the document has cost with each service
  (for example "OpenAI $0.0042 · Anthropic $0.0310"); hovering a service shows the
  cost by model. To its right, **Use Local** moves this document's conversation to
  the on-device model, with its attached sources; the costs then give way to
  the on-device model's name and **Use APIs**, which moves it back. The choice is kept with the document, and
  Review keeps its own service.
- **Document** (right). Hush's editor, with Hush's quick find: **⌘F** opens a small
  bar at the top of the document that marks the matches as you type (ignoring case)
  and selects the first after the caret. ⌘G and ⌘⇧G step through them. **→** at the
  end of the field, or Enter, closes the bar and leaves the match selected; Esc or
  ⌘F again also closes it. The chevron at its head opens **Replace**: Replace all
  changes every match at once, and a single undo takes it back.

  Your own messages in the conversation can be dragged into the document by their
  grip (⠿). A text selection inside one of your messages can be dragged on its own.
  **Add to document** puts a message at the caret; while part of the message is
  selected, it reads **Add selection to document** and adds just that part. Copy
  and paste also work. The AI's replies and reviews can't be selected or dragged,
  because the document is meant to be yours: their links and citations can be
  pressed, and their copy buttons copy them whole.
  - **Suggest placement**, on each of your messages, shows where the message would
    fit. Hovering it scrolls the document to the sentence the message would follow
    and lights that sentence briefly. Pressing it also puts the caret there, ready
    for Add to document. For a message that's already in the document, it does
    nothing but say so in a small tip.
  - **Review**, the last button at the top of the document, has a separate reviewer
    assess the document against its goal. The advice appears in the review bar under
    the goal; the guide sees it too. Which points to take up is yours to decide, and
    the guide is told not to work through them unasked.
    - The menu beside Review (▾) has **Include attached PDFs**. Turned off, the
      reviewer sees only the goal and the draft, which costs less with large
      sources. The choice is kept per document, and a review made without the PDFs
      says so.
    - The bar shows the latest review and folds to a single line. **Earlier** lists
      the previous reviews with their times, to read again.
    - **Work on this** on a point narrows the bar to that point alone, and the guide
      is told you're working on it. **Ignore** folds the point to its title, with
      **Revisit** to open it again. The point folds to a single line of its own
      ("Working on: Evidence"). **Item complete** greys the point out in the review;
      **Stop working** leaves it as it was. Either way the bar goes back to the
      whole review.
    - A new review takes over from the last, and a point you were working on is put
      down. The reviewer is given its earlier reviews, with what you did with each
      point (completed, ignored, being worked on), so it says what has been
      addressed since and doesn't press points you ignored.
  - **Quoted words of your document**, in a review or a reply, are links: pressing
    one scrolls the document to those words and lights them. If you've changed the
    words since, it says so.
- **Source viewer** (optional, left of the conversation). Opens when you press a
  source chip or a citation such as **p. 4**. It goes to the cited page and marks the
  quoted passage. Your Zotero highlights are drawn on the pages.

You can attach sources at any time from the paperclip in the composer: a **PDF from
Files**, or works **from Zotero**. A work from Zotero brings its PDF (copied in, so it
can be read offline), your highlights and comments on it, and your notes. The AI
reads your annotations before the full text.

## Online and offline

Settings → AI follows Snorkle's layout:

- **Authentication.** Anthropic and OpenAI each have a key box with Save, Test and
  Remove. A saved key is never shown again, and Test lists the models that account
  can use.
- **Uses.** Each use of AI has its own service and model:
  - **Chat**, the guide's side of the conversation;
  - **Review**, the document's Review button.
- **Usage.** Tokens and estimated cost by model (with its service, and whether it
  served Chat or Review), and by day, with a row for each service (and so each key)
  used that day. Amounts under a cent show to four places.

The services are:

- **On-device (offline)**. A GGUF model run by llama.cpp on the Mac's or iPad's GPU.
  Settings → Offline model downloads one. The recommended model is **Qwen3.5 4B**
  (Q4_K_M, 2.74 GB), chosen for an 8 GB M1 iPad:
  - It fits the iPad's memory with room left for the context, the app and iPadOS.
    Gemma 4 E4B, the other strong 4B-class model of 2026, is 4.98 GB at the same
    quantization, which is too much for 8 GB.
  - Its hybrid attention keeps the memory cost of long prompts low.
  - It follows instructions well for its size, and it is licensed under Apache 2.0.

  Three alternatives are offered:
  - Qwen3 4B Instruct 2507. It uses plain attention, so later turns start faster.
  - Gemma 4 E2B. The smallest option.
  - Gemma 4 E4B. For Macs with 16 GB or more.

  You can also add any GGUF by URL.
- **Anthropic** or **OpenAI**, each with your own API key. Online models read your
  sources whole, and the sources are cached between turns. The default Anthropic
  model is Claude Opus 5.5. Requests to Opus 5.5, Sonnet 5.5 and Fable 5.x opt into
  Anthropic's server-side refusal fallback.

With **When an online model can't be reached…** switched on (the default), a request
that can't reach the network is answered by the default on-device model, if one is
installed.

The rest of Settings:

- **Appearance:** theme, the document's look, and its caret, after Hush's: a line,
  a thick line, a block or an underline; a colour (six that suit both appearances,
  or your own); and whether it blinks, pulses or holds still while you pause. While
  you're in the conversation the caret stays where you left it, grey and faded, so
  you can see where Add to document will put a message.
- **Editor:** writing modes, word count, spelling.
- **Chat:** the conversation's text size, and whether the guide's questions are
  underlined.

## Build

Requires [Node.js](https://nodejs.org/) 20+, [Rust](https://rustup.rs/), CMake (for
llama.cpp), and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev      # run the desktop app in development
npm run tauri build    # macOS: .app / .dmg under src-tauri/target/release/bundle/
npm run dev            # the interface alone in a browser, with a scripted guide (no Rust, no model)
```

The on-device engine is the Cargo feature `local-llm`, which is on by default. To
build without it:

```sh
npm run tauri build -- -- --no-default-features
```

### iPad

One-time setup (macOS and Xcode):

```sh
npm run ios:init           # tauri ios init (generates src-tauri/gen/apple), then adds the entitlements
```

Then open the generated Xcode project and set your signing team, or set the
`APPLE_DEVELOPMENT_TEAM` environment variable.

`npm run ios:init` does two things beyond `tauri ios init`:

- **Links Apple's Accelerate and Foundation frameworks.** llama.cpp needs them on
  iOS, and they are listed in `bundle.iOS.frameworks` in `tauri.conf.json`. Rust is
  built as a static library that Xcode links, so the framework requests from
  llama.cpp's own build script don't reach Xcode. Without Accelerate the link fails
  with `"_vDSP_…", referenced from: ggml_compute_forward_…`. Tauri applies this
  setting only when it creates the project. If `src-tauri/gen/apple` predates it,
  delete that folder and run `npm run ios:init` again.
- **Adds the Increased Memory Limit entitlement** from
  `src-tauri/ios/Nudge.entitlements` to the generated project. It gives the app
  more room for an on-device model of about 2.7 GB on an 8 GB iPad. Extended
  Virtual Addressing is left out on purpose: a model this size doesn't need it, and
  a Personal (free) team can't sign an app that asks for it. If your team can't
  have Increased Memory Limit either, run
  `npm run ios:entitlements -- --no-memory-limit`. The app still runs, within
  iPadOS's default per-app limit; there, Qwen3.5 4B at an 8,192-token context may
  not fit.

On the iPad the status bar is hidden, so the columns reach the top of the window;
each column's controls start below the strip iPadOS 26 uses to move the window.
Trackpad scrolling relies on two `Info.ios.plist` keys, taken from Snorkle. Plist
changes take effect only after a rebuild and reinstall; a hot reload doesn't pick
them up.

Day-to-day:

```sh
npm run tauri ios dev      # device or simulator (Metal, and so the on-device model, needs a real device)
npm run tauri ios build
```

## More

[README_TECHNICAL.md](README_TECHNICAL.md) covers how the app is put together: the
source map, how a request is assembled, citations, storage, and the rules for
changing it.
