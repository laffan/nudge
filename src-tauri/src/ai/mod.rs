//! Everything that talks to a language model. One request shape
//! (`ChatRequest`) and one stream of events (`ChatEvent`) sit in front of
//! three providers, so the conversation code never branches on which one
//! answers:
//!
//!   anthropic — Anthropic Messages API, streamed
//!   openai    — OpenAI Chat Completions, streamed
//!   local     — a GGUF model on this device, through llama.cpp
//!   sse       — the Server-Sent Events reader both online providers use
//!   models    — each online provider's list of what it offers now
//!
//! The prompt itself (the guide's instructions, the sources, the document
//! so far) is written on the frontend (src/lib/ai/), where it can be read
//! beside the UI it serves; this side only sends it.

pub mod anthropic;
pub mod local;
pub mod models;
pub mod openai;
mod sse;

use crate::state::AppState;
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Turn {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    /// The frontend's id for this request — what `ai_cancel` stops.
    pub request_id: String,
    /// "anthropic", "openai" or "local".
    pub provider: String,
    pub model: String,
    /// The stable part of the prompt: instructions and sources. Marked
    /// cacheable for Anthropic; OpenAI caches a stable prefix by itself.
    pub system: String,
    pub messages: Vec<Turn>,
    pub max_tokens: u32,
    /// How to prompt and sample the on-device model; ignored online.
    #[serde(default)]
    pub local: local::LocalOptions,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cached_input_tokens: u64,
    pub cache_write_tokens: u64,
}

/// What a chat turn sends back while it runs.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatEvent {
    /// Something to show while there is no text yet ("thinking…",
    /// "loading the model…").
    Status { message: String },
    /// More of the answer.
    Delta { text: String },
    /// The answer is complete.
    Done { usage: Usage, model: String, stop: String },
}

pub async fn chat(state: &AppState, req: ChatRequest, events: Channel<ChatEvent>) -> Result<()> {
    let flag = state.cancel_flag(&req.request_id);
    let result = match req.provider.as_str() {
        "anthropic" => anthropic::stream(state, &req, &events, &flag).await,
        "openai" => openai::stream(state, &req, &events, &flag).await,
        "local" => local::stream(state, &req, &events, &flag).await,
        other => Err(Error::msg(format!("Unknown provider “{other}”"))),
    };
    state.finish_cancel(&req.request_id);
    result
}

/// Is this error the network being out of reach (rather than a refusal,
/// a bad key, a bad request)? The frontend falls back to the on-device
/// model on these.
pub fn is_offline_error(e: &reqwest::Error) -> bool {
    e.is_connect() || e.is_timeout() || e.is_request()
}

/// The message the UI shows when an online provider can't be reached.
pub const OFFLINE_PREFIX: &str = "OFFLINE:";
