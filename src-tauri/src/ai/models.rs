//! Each online provider's own list of the models it offers now, for the
//! model pickers in Settings → AI (beside the app's built-in list, so a
//! model released after this build can still be chosen). Ported from
//! Zotero Helper's `ai/models.rs`.

use crate::state::AppState;
use crate::{Error, Result};
use serde_json::Value;
use std::time::Duration;

const ANTHROPIC_MODELS: &str = "https://api.anthropic.com/v1/models?limit=1000";
const OPENAI_MODELS: &str = "https://api.openai.com/v1/models";

/// OpenAI ids with any of these in them aren't text chat models.
const OPENAI_LEFT_OUT: &[&str] = &[
    "audio", "realtime", "transcribe", "tts", "image", "search", "embedding", "instruct",
    "moderation", "codex", "computer-use", "deep-research", "-pro", "whisper", "dall-e",
];

#[derive(Clone, Debug, serde::Serialize)]
pub struct ListedModel {
    pub id: String,
    pub label: String,
}

pub async fn list(state: &AppState, service: &str, key: Option<String>) -> Result<Vec<ListedModel>> {
    let key = match key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        Some(k) => k,
        None => {
            let s = state.settings.read().await;
            if service == "openai" { s.openai_api_key.clone() } else { s.anthropic_api_key.clone() }
        }
    };
    if key.trim().is_empty() {
        return Err(Error::msg("Add a key first"));
    }
    let req = if service == "openai" {
        state.http.get(OPENAI_MODELS).header("authorization", format!("Bearer {key}"))
    } else {
        state
            .http
            .get(ANTHROPIC_MODELS)
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01")
    };
    let resp = req.timeout(Duration::from_secs(30)).send().await?;
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let why = body["error"]["message"].as_str().unwrap_or("no reason given");
        return Err(Error::msg(format!("The model list was refused ({status}): {why}")));
    }
    let data = body["data"].as_array().cloned().unwrap_or_default();
    let mut out: Vec<ListedModel> = data
        .iter()
        .filter_map(|m| {
            let id = m["id"].as_str()?.to_string();
            if service == "openai" {
                let lower = id.to_ascii_lowercase();
                if !(lower.starts_with("gpt") || lower.starts_with('o')) {
                    return None;
                }
                if OPENAI_LEFT_OUT.iter().any(|x| lower.contains(x)) {
                    return None;
                }
            }
            let label = m["display_name"].as_str().unwrap_or(&id).to_string();
            Some(ListedModel { id, label })
        })
        .collect();
    if service == "openai" {
        out.sort_by(|a, b| b.id.cmp(&a.id));
    }
    Ok(out)
}
