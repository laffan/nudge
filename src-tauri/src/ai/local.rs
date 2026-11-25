//! The on-device model: a GGUF file run through llama.cpp (Metal on Apple
//! hardware), for conversations with no network.
//!
//! One worker thread owns the loaded model and its context, and takes chat
//! turns from a queue. Keeping them on one thread is what lets the
//! context outlive a turn: the next turn's prompt mostly repeats the last
//! one (the instructions, the sources, the conversation so far), so only
//! the tokens after the shared prefix are evaluated again. Where the
//! model can't rewind its memory part-way (hybrid models such as Qwen3.5
//! keep a recurrent state beside the KV cache) the whole prompt is read
//! again instead — slower, never wrong.
//!
//! The prompt is assembled here in the model family's own chat format
//! (`format`): writing ChatML and Gemma 4's turns directly is simpler and
//! more predictable than llama.cpp's template detection, which knows
//! neither Gemma 4 nor Qwen3.5's switch for turning thinking off.

use super::{ChatEvent, ChatRequest};
use crate::state::AppState;
use crate::{Error, Result};
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::ipc::Channel;

/// How to talk to a particular model, sent with each turn from the
/// frontend's catalog (src/lib/ai/localModels.ts).
#[derive(Clone, Debug, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LocalOptions {
    /// "chatml", "chatml-nothink" (Qwen3.5 with thinking off) or "gemma4".
    pub format: String,
    pub temperature: f32,
    pub top_p: f32,
    pub top_k: i32,
    pub min_p: f32,
    pub presence_penalty: f32,
}

impl Default for LocalOptions {
    fn default() -> Self {
        LocalOptions {
            format: "chatml".into(),
            temperature: 0.7,
            top_p: 0.8,
            top_k: 20,
            min_p: 0.0,
            presence_penalty: 0.0,
        }
    }
}

/// Is on-device inference part of this build?
pub fn available() -> bool {
    cfg!(feature = "local-llm")
}

/// Write the conversation as the model expects to read it, ending where
/// the model's answer begins.
pub fn build_prompt(format: &str, system: &str, messages: &[super::Turn]) -> String {
    let mut p = String::new();
    match format {
        "gemma4" => {
            // The BOS token is added by the tokenizer, not written here.
            p.push_str("<|turn>system\n");
            p.push_str(system.trim());
            p.push_str("<turn|>\n");
            for m in messages {
                let role = if m.role == "assistant" { "model" } else { "user" };
                p.push_str(&format!("<|turn>{role}\n{}<turn|>\n", m.content.trim()));
            }
            p.push_str("<|turn>model\n");
        }
        _ => {
            p.push_str(&format!("<|im_start|>system\n{}<|im_end|>\n", system.trim()));
            for m in messages {
                let role = if m.role == "assistant" { "assistant" } else { "user" };
                p.push_str(&format!("<|im_start|>{role}\n{}<|im_end|>\n", m.content.trim()));
            }
            p.push_str("<|im_start|>assistant\n");
            if format == "chatml-nothink" {
                // Qwen3.5's own template writes this when thinking is off.
                p.push_str("<think>\n\n</think>\n\n");
            }
        }
    }
    p
}

/// Drops a `<think>…</think>` block from the start of a streamed answer,
/// should a model think anyway. Text is held back only while it could
/// still be the start of the tag.
// Only the engine uses it, so a build without local-llm doesn't.
#[cfg_attr(not(feature = "local-llm"), allow(dead_code))]
#[derive(Default)]
pub struct ThinkFilter {
    buf: String,
    state: u8, // 0 = undecided, 1 = inside thinking, 2 = passing through
}

#[cfg_attr(not(feature = "local-llm"), allow(dead_code))]
impl ThinkFilter {
    pub fn push(&mut self, text: &str) -> String {
        if self.state == 2 {
            return text.to_string();
        }
        self.buf.push_str(text);
        loop {
            match self.state {
                0 => {
                    let t = self.buf.trim_start();
                    if t.starts_with("<think>") {
                        let start = self.buf.find("<think>").unwrap() + "<think>".len();
                        self.buf = self.buf[start..].to_string();
                        self.state = 1;
                    } else if "<think>".starts_with(t) {
                        return String::new();
                    } else {
                        self.state = 2;
                        return std::mem::take(&mut self.buf);
                    }
                }
                1 => {
                    if let Some(end) = self.buf.find("</think>") {
                        let rest = self.buf[end + "</think>".len()..].trim_start().to_string();
                        self.buf.clear();
                        self.state = 2;
                        return rest;
                    }
                    return String::new();
                }
                _ => return std::mem::take(&mut self.buf),
            }
        }
    }
}

#[cfg(feature = "local-llm")]
mod engine {
    use super::*;
    use crate::ai::Usage;
    use llama_cpp_2::context::params::LlamaContextParams;
    use llama_cpp_2::context::LlamaContext;
    use llama_cpp_2::llama_backend::LlamaBackend;
    use llama_cpp_2::llama_batch::LlamaBatch;
    use llama_cpp_2::model::params::LlamaModelParams;
    use llama_cpp_2::model::LlamaModel;
    use llama_cpp_2::sampling::LlamaSampler;
    use llama_cpp_2::token::LlamaToken;
    use std::num::NonZeroU32;
    use std::sync::atomic::Ordering;
    use std::sync::mpsc;
    use std::sync::Mutex;

    pub struct Job {
        pub model_path: PathBuf,
        pub n_ctx: u32,
        pub prompt: String,
        pub max_tokens: u32,
        pub options: LocalOptions,
        pub events: Channel<ChatEvent>,
        pub stop: Arc<AtomicBool>,
        pub done: tokio::sync::oneshot::Sender<Result<()>>,
    }

    pub enum Msg {
        Chat(Job),
        Unload,
    }

    pub struct LocalEngine {
        tx: Mutex<Option<mpsc::Sender<Msg>>>,
    }

    impl LocalEngine {
        pub fn new() -> Self {
            LocalEngine { tx: Mutex::new(None) }
        }

        /// The worker's queue, starting the worker on first use.
        fn sender(&self) -> mpsc::Sender<Msg> {
            let mut guard = self.tx.lock().unwrap();
            if let Some(tx) = guard.as_ref() {
                return tx.clone();
            }
            let (tx, rx) = mpsc::channel::<Msg>();
            std::thread::Builder::new()
                .name("nudge-local-llm".into())
                // llama.cpp's loader and graph building use deep stacks.
                .stack_size(16 * 1024 * 1024)
                .spawn(move || worker(rx))
                .expect("local model thread");
            *guard = Some(tx.clone());
            tx
        }

        pub fn submit(&self, job: Job) {
            if let Err(mpsc::SendError(Msg::Chat(job))) = self.sender().send(Msg::Chat(job)) {
                let _ = job.done.send(Err(Error::msg("The on-device model stopped unexpectedly")));
                *self.tx.lock().unwrap() = None;
            }
        }

        /// Free the model's memory (it loads again on the next turn).
        pub fn unload(&self) {
            if let Some(tx) = self.tx.lock().unwrap().as_ref() {
                let _ = tx.send(Msg::Unload);
            }
        }
    }

    fn new_context<'m>(model: &'m LlamaModel, backend: &LlamaBackend, n_ctx: u32) -> Result<LlamaContext<'m>> {
        let threads = std::thread::available_parallelism().map(|n| n.get() as i32).unwrap_or(4).clamp(1, 8);
        let params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(n_ctx))
            .with_n_batch(512)
            .with_n_ubatch(512)
            .with_n_threads(threads)
            .with_n_threads_batch(threads);
        model
            .new_context(backend, params)
            .map_err(|e| Error::msg(format!("The on-device model could not start ({e}) — try a smaller context in Settings → AI")))
    }

    fn worker(rx: mpsc::Receiver<Msg>) {
        let backend = match LlamaBackend::init() {
            Ok(mut b) => {
                b.void_logs();
                b
            }
            Err(e) => {
                // Answer every job with the failure rather than hanging.
                for msg in rx {
                    if let Msg::Chat(job) = msg {
                        let _ = job.done.send(Err(Error::msg(format!("llama.cpp could not start: {e}"))));
                    }
                }
                return;
            }
        };
        let mut pending: Option<Job> = None;
        loop {
            // Wait for a turn; Unload with nothing loaded is a no-op.
            let job = match pending.take() {
                Some(j) => j,
                None => match rx.recv() {
                    Ok(Msg::Chat(j)) => j,
                    Ok(Msg::Unload) => continue,
                    Err(_) => return,
                },
            };
            let _ = job.events.send(ChatEvent::Status { message: "Loading the on-device model…".into() });
            let params = LlamaModelParams::default().with_n_gpu_layers(999);
            let model = match LlamaModel::load_from_file(&backend, &job.model_path, &params) {
                Ok(m) => m,
                Err(e) => {
                    let _ = job.done.send(Err(Error::msg(format!("The model file could not be loaded ({e})"))));
                    continue;
                }
            };
            let model_path = job.model_path.clone();
            let mut n_ctx = job.n_ctx;
            let mut ctx = match new_context(&model, &backend, n_ctx) {
                Ok(c) => c,
                Err(e) => {
                    let _ = job.done.send(Err(e));
                    continue;
                }
            };
            let mut cached: Vec<LlamaToken> = Vec::new();
            let mut next = Some(job);
            loop {
                let job = match next.take() {
                    Some(j) => j,
                    None => match rx.recv() {
                        Ok(Msg::Chat(j)) => j,
                        Ok(Msg::Unload) => break,
                        Err(_) => return,
                    },
                };
                if job.model_path != model_path {
                    pending = Some(job);
                    break; // drops the context, then the model
                }
                if job.n_ctx != n_ctx {
                    // Drop the old context before making the new one, so
                    // both are never in memory together.
                    drop(ctx);
                    n_ctx = job.n_ctx;
                    cached.clear();
                    ctx = match new_context(&model, &backend, n_ctx) {
                        Ok(c) => c,
                        Err(e) => {
                            let _ = job.done.send(Err(e));
                            break;
                        }
                    };
                }
                let result = run(&model, &mut ctx, &mut cached, &job);
                if result.is_err() {
                    ctx.clear_kv_cache();
                    cached.clear();
                }
                let _ = job.done.send(result);
            }
        }
    }

    fn run(model: &LlamaModel, ctx: &mut LlamaContext, cached: &mut Vec<LlamaToken>, job: &Job) -> Result<()> {
        let vocab = model.vocab();
        let tokens = vocab.tokenize(job.prompt.as_bytes(), true, true);
        let n_ctx = ctx.n_ctx() as usize;
        if tokens.is_empty() {
            return Err(Error::msg("Nothing to send"));
        }
        if tokens.len() + 64 >= n_ctx {
            return Err(Error::msg(format!(
                "This turn is {} tokens, more than the on-device model's {n_ctx}-token context — raise it in Settings → AI, or detach a source",
                tokens.len()
            )));
        }
        let max_new = (job.max_tokens as usize).min(n_ctx - tokens.len() - 1);

        // Keep what the context already holds of this prompt.
        let mut common = cached.iter().zip(tokens.iter()).take_while(|(a, b)| a == b).count();
        if common >= tokens.len() {
            common = tokens.len() - 1; // the last token must be read again for its logits
        }
        if common < cached.len() {
            let ok = ctx.clear_kv_cache_seq(Some(0), Some(common as u32), None).unwrap_or(false);
            if !ok {
                ctx.clear_kv_cache();
                common = 0;
            }
        }
        cached.truncate(common);

        let rest = &tokens[common..];
        if rest.len() > 200 {
            let _ = job.events.send(ChatEvent::Status { message: "Reading…".into() });
        }
        let n_batch = ctx.n_batch().max(1) as usize;
        let mut batch = LlamaBatch::new(n_batch, 1);
        for (ci, chunk) in rest.chunks(n_batch).enumerate() {
            if job.stop.load(Ordering::SeqCst) {
                let _ = job.events.send(ChatEvent::Done { usage: Usage::default(), model: String::new(), stop: "stopped".into() });
                return Ok(());
            }
            batch.clear();
            for (j, t) in chunk.iter().enumerate() {
                let pos = common + ci * n_batch + j;
                batch
                    .add(*t, pos as i32, &[0], pos == tokens.len() - 1)
                    .map_err(|e| Error::msg(format!("Batch error: {e}")))?;
            }
            ctx.decode(&mut batch).map_err(|e| Error::msg(format!("The model could not read the prompt ({e})")))?;
            cached.extend_from_slice(chunk);
        }

        let o = &job.options;
        let mut chain = Vec::new();
        if o.presence_penalty > 0.0 {
            chain.push(LlamaSampler::penalties(model.n_vocab(), 256, 1.0, 0.0, o.presence_penalty));
        }
        if o.top_k > 0 {
            chain.push(LlamaSampler::top_k(o.top_k));
        }
        chain.push(LlamaSampler::top_p(o.top_p.clamp(0.05, 1.0), 1));
        if o.min_p > 0.0 {
            chain.push(LlamaSampler::min_p(o.min_p, 1));
        }
        chain.push(LlamaSampler::temp(o.temperature.max(0.0)));
        chain.push(LlamaSampler::dist(rand::random::<u32>()));
        let mut sampler = LlamaSampler::chain_simple(chain);

        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let mut filter = ThinkFilter::default();
        let mut piece: Vec<u8> = Vec::new();
        let mut n_cur = tokens.len();
        let mut produced = 0usize;
        let mut idx = batch.n_tokens() - 1;
        let mut stop_reason = "end_turn";
        loop {
            if job.stop.load(Ordering::SeqCst) {
                stop_reason = "stopped";
                break;
            }
            if produced >= max_new {
                stop_reason = "max_tokens";
                break;
            }
            // sample() also accepts the token into the chain's state.
            let token = sampler.sample(ctx, idx);
            if vocab.is_eog(token) {
                break;
            }
            piece.clear();
            vocab.token_to_piece_into(token, &mut piece, false, None);
            let mut text = String::with_capacity(decoder.max_utf8_buffer_length(piece.len()).unwrap_or(16));
            let _ = decoder.decode_to_string(&piece, &mut text, false);
            let shown = filter.push(&text);
            if !shown.is_empty() {
                let _ = job.events.send(ChatEvent::Delta { text: shown });
            }
            batch.clear();
            batch
                .add(token, n_cur as i32, &[0], true)
                .map_err(|e| Error::msg(format!("Batch error: {e}")))?;
            ctx.decode(&mut batch).map_err(|e| Error::msg(format!("The model stopped mid-answer ({e})")))?;
            cached.push(token);
            n_cur += 1;
            produced += 1;
            idx = 0;
        }
        let model_name = job
            .model_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("local")
            .to_string();
        let _ = job.events.send(ChatEvent::Done {
            usage: Usage { input_tokens: tokens.len() as u64, output_tokens: produced as u64, ..Default::default() },
            model: model_name,
            stop: stop_reason.into(),
        });
        Ok(())
    }
}

#[cfg(feature = "local-llm")]
pub use engine::LocalEngine;

/// Without the `local-llm` feature: the same surface, saying so.
#[cfg(not(feature = "local-llm"))]
pub struct LocalEngine;

#[cfg(not(feature = "local-llm"))]
impl LocalEngine {
    pub fn new() -> Self {
        LocalEngine
    }
    pub fn unload(&self) {}
}

pub async fn stream(
    state: &AppState,
    req: &ChatRequest,
    events: &Channel<ChatEvent>,
    stop: &Arc<AtomicBool>,
) -> Result<()> {
    let (file, n_ctx) = {
        let s = state.settings.read().await;
        (s.local_model.clone(), s.local_context.clamp(2048, 131072))
    };
    if file.trim().is_empty() {
        return Err(Error::msg("No on-device model is installed — download one in Settings → AI"));
    }
    crate::storage::check_file_name(&file)?;
    let path = state.models_dir().join(&file);
    if !path.exists() {
        return Err(Error::msg("The chosen on-device model is not on this device — download it in Settings → AI"));
    }
    let options = req.local.clone();
    let prompt = build_prompt(&options.format, &req.system, &req.messages);
    run_job(state, path, n_ctx, prompt, req.max_tokens, options, events, stop).await
}

#[cfg(feature = "local-llm")]
#[allow(clippy::too_many_arguments)]
async fn run_job(
    state: &AppState,
    model_path: PathBuf,
    n_ctx: u32,
    prompt: String,
    max_tokens: u32,
    options: LocalOptions,
    events: &Channel<ChatEvent>,
    stop: &Arc<AtomicBool>,
) -> Result<()> {
    let (done, wait) = tokio::sync::oneshot::channel();
    state.local.submit(engine::Job {
        model_path,
        n_ctx,
        prompt,
        max_tokens,
        options,
        events: events.clone(),
        stop: stop.clone(),
        done,
    });
    wait.await.map_err(|_| Error::msg("The on-device model stopped unexpectedly"))?
}

#[cfg(not(feature = "local-llm"))]
#[allow(clippy::too_many_arguments)]
async fn run_job(
    _: &AppState,
    _: PathBuf,
    _: u32,
    _: String,
    _: u32,
    _: LocalOptions,
    _: &Channel<ChatEvent>,
    _: &Arc<AtomicBool>,
) -> Result<()> {
    Err(Error::msg("This build of Nudge was made without the on-device model (the local-llm feature)"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn think_filter_drops_leading_block() {
        let mut f = ThinkFilter::default();
        let mut out = String::new();
        for part in ["<thi", "nk>\nhmm", " let me", "</think>\n\nHello", " there"] {
            out.push_str(&f.push(part));
        }
        assert_eq!(out, "Hello there");
    }

    #[test]
    fn think_filter_passes_plain_text() {
        let mut f = ThinkFilter::default();
        let mut out = String::new();
        for part in ["Hel", "lo <think> is text here"] {
            out.push_str(&f.push(part));
        }
        assert_eq!(out, "Hello <think> is text here");
    }

    #[test]
    fn chatml_nothink_prompt() {
        let p = build_prompt(
            "chatml-nothink",
            "sys",
            &[super::super::Turn { role: "user".into(), content: "hi".into() }],
        );
        assert_eq!(p, "<|im_start|>system\nsys<|im_end|>\n<|im_start|>user\nhi<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n");
    }

    #[test]
    fn gemma4_prompt() {
        let p = build_prompt("gemma4", "sys", &[super::super::Turn { role: "user".into(), content: "hi".into() }]);
        assert_eq!(p, "<|turn>system\nsys<turn|>\n<|turn>user\nhi<turn|>\n<|turn>model\n");
    }
}
