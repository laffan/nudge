//! Anthropic Messages API, streamed.
//!
//! The instructions and sources travel as one system block marked
//! cacheable (5-minute TTL), so a conversation re-reads its PDFs at the
//! cached rate on every turn after the first; the parts that change each
//! turn (the document so far, the question) ride in the messages after it.
//!
//! On the models that take it, the request opts into server-side refusal
//! fallbacks (`fallbacks: "default"`): when a safety classifier declines,
//! the API re-runs the turn on a fallback model within the same stream,
//! which arrives as more text_delta events — nothing to handle here
//! beyond ignoring the `fallback` content block that marks the switch.

use super::{sse, ChatEvent, ChatRequest, Usage, OFFLINE_PREFIX};
use crate::state::AppState;
use crate::{Error, Result};
use serde_json::{json, Value};
use std::sync::atomic::AtomicBool;
use std::time::Duration;
use tauri::ipc::Channel;

const MESSAGES_API: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

/// Models that accept `output_config.effort`.
fn takes_effort(model: &str) -> bool {
    ["claude-fable-5", "claude-mythos-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-5", "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-sonnet-4-6"]
        .iter()
        .any(|p| model.starts_with(p))
}

/// Models that accept server-side refusal fallbacks in the "default" form.
fn takes_fallbacks(model: &str) -> bool {
    ["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]
        .iter()
        .any(|p| model == *p || model.starts_with(&format!("{p}-")))
}

pub async fn stream(
    state: &AppState,
    req: &ChatRequest,
    events: &Channel<ChatEvent>,
    stop: &AtomicBool,
) -> Result<()> {
    let (key, effort) = {
        let s = state.settings.read().await;
        (s.anthropic_api_key.trim().to_string(), s.effort.clone())
    };
    if key.is_empty() {
        return Err(Error::msg("No Anthropic API key — add one in Settings → AI"));
    }
    let messages: Vec<Value> = req
        .messages
        .iter()
        .map(|t| json!({ "role": t.role, "content": t.content }))
        .collect();
    let mut body = json!({
        "model": req.model,
        "max_tokens": req.max_tokens,
        "stream": true,
        "system": [{ "type": "text", "text": req.system, "cache_control": { "type": "ephemeral" } }],
        "messages": messages,
    });
    if takes_effort(&req.model) && !effort.is_empty() {
        body["output_config"] = json!({ "effort": effort });
    }
    let fallbacks = takes_fallbacks(&req.model);
    if fallbacks {
        body["fallbacks"] = json!("default");
    }

    let mut call = state
        .http
        .post(MESSAGES_API)
        .header("x-api-key", &key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .timeout(Duration::from_secs(600))
        .json(&body);
    if fallbacks {
        call = call.header("anthropic-beta", FALLBACK_BETA);
    }
    let resp = match call.send().await {
        Ok(r) => r,
        Err(e) if super::is_offline_error(&e) => {
            return Err(Error::msg(format!("{OFFLINE_PREFIX} Anthropic could not be reached ({e})")))
        }
        Err(e) => return Err(e.into()),
    };
    let status = resp.status();
    if !status.is_success() {
        let out: Value = resp.json().await.unwrap_or(Value::Null);
        let msg = out["error"]["message"].as_str().unwrap_or("unknown error");
        return Err(Error::msg(format!("Anthropic API error (HTTP {status}): {msg}")));
    }

    let mut usage = Usage::default();
    let mut model = req.model.clone();
    let mut stop_reason = String::from("end_turn");
    let mut said_thinking = false;
    let finished = sse::read(resp, stop, |ev| {
        let data: Value = match serde_json::from_str(&ev.data) {
            Ok(v) => v,
            Err(_) => return Ok(()),
        };
        match data["type"].as_str().unwrap_or(&ev.event) {
            "message_start" => {
                let m = &data["message"];
                if let Some(id) = m["model"].as_str() {
                    model = id.to_string();
                }
                let u = &m["usage"];
                usage.input_tokens = u["input_tokens"].as_u64().unwrap_or(0);
                usage.cached_input_tokens = u["cache_read_input_tokens"].as_u64().unwrap_or(0);
                usage.cache_write_tokens = u["cache_creation_input_tokens"].as_u64().unwrap_or(0);
            }
            "content_block_start" => {
                if data["content_block"]["type"].as_str() == Some("thinking") && !said_thinking {
                    said_thinking = true;
                    let _ = events.send(ChatEvent::Status { message: "Thinking…".into() });
                }
            }
            "content_block_delta" => {
                if data["delta"]["type"].as_str() == Some("text_delta") {
                    if let Some(t) = data["delta"]["text"].as_str() {
                        let _ = events.send(ChatEvent::Delta { text: t.to_string() });
                    }
                }
            }
            "message_delta" => {
                if let Some(r) = data["delta"]["stop_reason"].as_str() {
                    stop_reason = r.to_string();
                }
                if let Some(n) = data["usage"]["output_tokens"].as_u64() {
                    usage.output_tokens = n;
                }
            }
            "error" => {
                let msg = data["error"]["message"].as_str().unwrap_or("stream error");
                return Err(Error::msg(format!("Anthropic: {msg}")));
            }
            _ => {}
        }
        Ok(())
    })
    .await?;

    if !finished {
        stop_reason = "stopped".into();
    } else if stop_reason == "refusal" {
        return Err(Error::msg("The model declined to answer this turn"));
    }
    let _ = events.send(ChatEvent::Done { usage, model, stop: stop_reason });
    Ok(())
}
