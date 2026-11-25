//! OpenAI Chat Completions, streamed. OpenAI caches a stable prompt prefix
//! by itself, so keeping the instructions and sources first and unchanged
//! is all the caching there is to do.

use super::{sse, ChatEvent, ChatRequest, Usage, OFFLINE_PREFIX};
use crate::state::AppState;
use crate::{Error, Result};
use serde_json::{json, Value};
use std::sync::atomic::AtomicBool;
use std::time::Duration;
use tauri::ipc::Channel;

const CHAT_API: &str = "https://api.openai.com/v1/chat/completions";

pub async fn stream(
    state: &AppState,
    req: &ChatRequest,
    events: &Channel<ChatEvent>,
    stop: &AtomicBool,
) -> Result<()> {
    let key = state.settings.read().await.openai_api_key.trim().to_string();
    if key.is_empty() {
        return Err(Error::msg("No OpenAI API key — add one in Settings → AI"));
    }
    let mut messages = vec![json!({ "role": "system", "content": req.system })];
    for t in &req.messages {
        messages.push(json!({ "role": t.role, "content": t.content }));
    }
    let body = json!({
        "model": req.model,
        // Reasoning models take max_completion_tokens, and it has to cover
        // the reasoning they do before answering.
        "max_completion_tokens": req.max_tokens,
        "messages": messages,
        "stream": true,
        "stream_options": { "include_usage": true },
    });
    let resp = match state
        .http
        .post(CHAT_API)
        .header("authorization", format!("Bearer {key}"))
        .header("content-type", "application/json")
        .timeout(Duration::from_secs(600))
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) if super::is_offline_error(&e) => {
            return Err(Error::msg(format!("{OFFLINE_PREFIX} OpenAI could not be reached ({e})")))
        }
        Err(e) => return Err(e.into()),
    };
    let status = resp.status();
    if !status.is_success() {
        let out: Value = resp.json().await.unwrap_or(Value::Null);
        let msg = out["error"]["message"].as_str().unwrap_or("unknown error");
        return Err(Error::msg(format!("OpenAI API error (HTTP {status}): {msg}")));
    }

    let mut usage = Usage::default();
    let mut model = req.model.clone();
    let mut stop_reason = String::from("stop");
    let finished = sse::read(resp, stop, |ev| {
        if ev.data.trim() == "[DONE]" {
            return Ok(());
        }
        let data: Value = match serde_json::from_str(&ev.data) {
            Ok(v) => v,
            Err(_) => return Ok(()),
        };
        if let Some(m) = data["model"].as_str() {
            model = m.to_string();
        }
        if let Some(err) = data["error"]["message"].as_str() {
            return Err(Error::msg(format!("OpenAI: {err}")));
        }
        let choice = &data["choices"][0];
        if let Some(t) = choice["delta"]["content"].as_str() {
            if !t.is_empty() {
                let _ = events.send(ChatEvent::Delta { text: t.to_string() });
            }
        }
        if let Some(r) = choice["finish_reason"].as_str() {
            stop_reason = r.to_string();
        }
        let u = &data["usage"];
        if u.is_object() {
            let cached = u["prompt_tokens_details"]["cached_tokens"].as_u64().unwrap_or(0);
            usage = Usage {
                input_tokens: u["prompt_tokens"].as_u64().unwrap_or(0).saturating_sub(cached),
                output_tokens: u["completion_tokens"].as_u64().unwrap_or(0),
                cached_input_tokens: cached,
                cache_write_tokens: 0,
            };
        }
        Ok(())
    })
    .await?;
    if !finished {
        stop_reason = "stopped".into();
    } else if stop_reason == "content_filter" {
        return Err(Error::msg("The model declined to answer this turn"));
    }
    let _ = events.send(ChatEvent::Done { usage, model, stop: stop_reason });
    Ok(())
}
