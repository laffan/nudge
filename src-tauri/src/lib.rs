//! Nudge's Rust core: storage, settings, Zotero, and the language models.
//! Every command the frontend calls is declared here; each one is a thin
//! wrapper over the module that does the work.

mod ai;
mod downloads;
mod error;
#[cfg(target_os = "ios")]
mod ios;
mod settings;
mod state;
mod storage;
mod usage;
mod zotero;

pub use error::{Error, Result};

use serde_json::Value;
use state::AppState;
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tauri::{Manager, State};

// ---------------------------------------------------------------- settings

#[tauri::command]
async fn load_settings(state: State<'_, AppState>) -> Result<settings::Settings> {
    Ok(state.settings.read().await.without_keys())
}

/// Everything but the API keys, which only `ai_set_key` and
/// `ai_delete_key` change (the frontend never holds them).
#[tauri::command]
async fn save_settings(state: State<'_, AppState>, settings: settings::Settings) -> Result<()> {
    let mut next = settings;
    let model_changed = {
        let cur = state.settings.read().await;
        next.anthropic_api_key = cur.anthropic_api_key.clone();
        next.openai_api_key = cur.openai_api_key.clone();
        cur.local_model != next.local_model || cur.uses != next.uses
    };
    settings::save(&state.data_dir, &next)?;
    *state.settings.write().await = next;
    if model_changed {
        // Free the old model's memory now rather than at the next turn.
        state.local.unload();
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct KeyStatus {
    anthropic: bool,
    openai: bool,
}

async fn key_status(state: &AppState) -> KeyStatus {
    let s = state.settings.read().await;
    KeyStatus { anthropic: !s.anthropic_api_key.trim().is_empty(), openai: !s.openai_api_key.trim().is_empty() }
}

/// Which API keys are saved (not the keys themselves).
#[tauri::command]
async fn ai_status(state: State<'_, AppState>) -> Result<KeyStatus> {
    Ok(key_status(&state).await)
}

async fn set_key(state: &AppState, provider: &str, key: &str) -> Result<()> {
    let mut s = state.settings.write().await;
    match provider {
        "anthropic" => s.anthropic_api_key = key.trim().to_string(),
        "openai" => s.openai_api_key = key.trim().to_string(),
        other => return Err(Error::msg(format!("Unknown provider “{other}”"))),
    }
    settings::save(&state.data_dir, &s)
}

#[tauri::command]
async fn ai_set_key(state: State<'_, AppState>, provider: String, key: String) -> Result<KeyStatus> {
    if key.trim().is_empty() {
        return Err(Error::msg("Paste a key first"));
    }
    set_key(&state, &provider, &key).await?;
    Ok(key_status(&state).await)
}

#[tauri::command]
async fn ai_delete_key(state: State<'_, AppState>, provider: String) -> Result<KeyStatus> {
    set_key(&state, &provider, "").await?;
    Ok(key_status(&state).await)
}

// ---------------------------------------------------------------- documents

#[tauri::command]
fn list_documents(state: State<'_, AppState>) -> Result<Vec<storage::DocSummary>> {
    storage::list_documents(&state.data_dir)
}

#[tauri::command]
fn load_document(state: State<'_, AppState>, id: String) -> Result<Value> {
    storage::load_document(&state.data_dir, &id)
}

#[tauri::command]
fn save_document(state: State<'_, AppState>, doc: Value) -> Result<storage::DocSummary> {
    storage::save_document(&state.data_dir, &doc)
}

#[tauri::command]
fn delete_document(state: State<'_, AppState>, id: String) -> Result<()> {
    storage::delete_document(&state.data_dir, &id)
}

// ---------------------------------------------------------------- sources

/// The PDF's bytes arrive as the raw request body (no JSON number array),
/// with the source's id in a header.
#[tauri::command]
fn save_source_file(state: State<'_, AppState>, request: Request<'_>) -> Result<()> {
    let id = request
        .headers()
        .get("x-source-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| Error::msg("Missing source id"))?
        .to_string();
    match request.body() {
        InvokeBody::Raw(bytes) => storage::save_source_file(&state.data_dir, &id, bytes),
        InvokeBody::Json(_) => Err(Error::msg("Expected the PDF's bytes")),
    }
}

#[tauri::command]
fn read_source_file(state: State<'_, AppState>, id: String) -> Result<Response> {
    Ok(Response::new(storage::read_source_file(&state.data_dir, &id)?))
}

#[tauri::command]
fn save_source_text(state: State<'_, AppState>, id: String, pages: Value) -> Result<()> {
    storage::save_source_text(&state.data_dir, &id, &pages)
}

#[tauri::command]
fn load_source_text(state: State<'_, AppState>, id: String) -> Result<Option<Value>> {
    storage::load_source_text(&state.data_dir, &id)
}

#[tauri::command]
fn delete_source(state: State<'_, AppState>, id: String) -> Result<()> {
    storage::delete_source(&state.data_dir, &id)
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<()> {
    std::fs::write(path, contents)?;
    Ok(())
}

// ---------------------------------------------------------------- zotero

#[tauri::command]
async fn zotero_verify(state: State<'_, AppState>, key: String) -> Result<Value> {
    zotero::verify_key(&state, &key).await
}

#[tauri::command]
async fn zotero_collections(state: State<'_, AppState>) -> Result<Vec<Value>> {
    zotero::collections(&state).await
}

#[tauri::command]
async fn zotero_search(state: State<'_, AppState>, q: String, collection: Option<String>) -> Result<Vec<Value>> {
    zotero::search(&state, &q, collection.as_deref()).await
}

#[tauri::command]
async fn zotero_children(state: State<'_, AppState>, key: String) -> Result<Vec<Value>> {
    zotero::children(&state, &key).await
}

#[tauri::command]
async fn zotero_annotations(state: State<'_, AppState>, att_key: String) -> Result<Vec<Value>> {
    zotero::annotations(&state, &att_key).await
}

#[tauri::command]
async fn zotero_download(state: State<'_, AppState>, att_key: String) -> Result<Response> {
    Ok(Response::new(zotero::download(&state, &att_key).await?))
}

// ---------------------------------------------------------------- AI

#[tauri::command]
async fn ai_chat(
    state: State<'_, AppState>,
    request: ai::ChatRequest,
    on_event: Channel<ai::ChatEvent>,
) -> Result<()> {
    ai::chat(&state, request, on_event).await
}

#[tauri::command]
fn ai_cancel(state: State<'_, AppState>, id: String) {
    state.cancel(&id);
}

#[tauri::command]
async fn ai_list_models(
    state: State<'_, AppState>,
    service: String,
    key: Option<String>,
) -> Result<Vec<ai::models::ListedModel>> {
    ai::models::list(&state, &service, key).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalStatus {
    available: bool,
    installed: Vec<downloads::InstalledModel>,
    partial: Vec<(String, u64)>,
}

#[tauri::command]
fn local_status(state: State<'_, AppState>, files: Vec<String>) -> LocalStatus {
    LocalStatus {
        available: ai::local::available(),
        installed: downloads::installed(&state),
        partial: files
            .into_iter()
            .map(|f| {
                let n = downloads::partial(&state, &f);
                (f, n)
            })
            .filter(|(_, n)| *n > 0)
            .collect(),
    }
}

#[tauri::command]
async fn local_download(
    state: State<'_, AppState>,
    id: String,
    url: String,
    file: String,
    on_progress: Channel<downloads::Progress>,
) -> Result<()> {
    downloads::download(&state, &id, &url, &file, on_progress).await
}

#[tauri::command]
fn local_delete(state: State<'_, AppState>, file: String) -> Result<()> {
    state.local.unload();
    downloads::delete(&state, &file)
}

#[tauri::command]
fn usage_add(state: State<'_, AppState>, event: Value) -> Result<()> {
    usage::add(&state.data_dir, event)
}

#[tauri::command]
fn usage_list(state: State<'_, AppState>) -> Vec<Value> {
    usage::list(&state.data_dir)
}

#[tauri::command]
fn usage_reset(state: State<'_, AppState>) -> Result<()> {
    usage::reset(&state.data_dir)
}

#[tauri::command]
fn local_unload(state: State<'_, AppState>) {
    state.local.unload();
}

/// iPad: hand the hardware keyboard to the page after a trackpad click that
/// WebKit doesn't treat as focusing it (src/ios.rs). Elsewhere, nothing.
#[tauri::command]
fn claim_keyboard(app: tauri::AppHandle) {
    #[cfg(target_os = "ios")]
    ios::claim_keyboard(&app);
    #[cfg(not(target_os = "ios"))]
    let _ = app;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(AppState::new(dir));
            #[cfg(target_os = "ios")]
            ios::hide_status_bar(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            list_documents,
            load_document,
            save_document,
            delete_document,
            save_source_file,
            read_source_file,
            save_source_text,
            load_source_text,
            delete_source,
            write_text_file,
            zotero_verify,
            zotero_collections,
            zotero_search,
            zotero_children,
            zotero_annotations,
            zotero_download,
            ai_chat,
            ai_cancel,
            ai_list_models,
            ai_status,
            ai_set_key,
            ai_delete_key,
            usage_add,
            usage_list,
            usage_reset,
            local_status,
            local_download,
            local_delete,
            local_unload,
            claim_keyboard,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Nudge")
        .run(|_app, _event| {
            #[cfg(target_os = "ios")]
            ios::on_run_event(_app, &_event);
        });
}

/// End-to-end check of the on-device path: the app's own downloader fetches
/// a GGUF, then two conversation turns run through the llama.cpp worker.
/// Opt-in (it downloads half a gigabyte):
///   NUDGE_SMOKE_URL=https://…/model.gguf cargo test --release --lib smoke -- --ignored --nocapture
#[cfg(all(test, feature = "local-llm"))]
mod smoke {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tauri::ipc::InvokeResponseBody;

    /// A channel whose events are collected, as JSON, into `sink`.
    fn channel<T: serde::Serialize>(sink: Arc<Mutex<Vec<serde_json::Value>>>) -> Channel<T> {
        Channel::new(move |body| {
            if let InvokeResponseBody::Json(s) = body {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                    sink.lock().unwrap().push(v);
                }
            }
            Ok(())
        })
    }

    #[test]
    #[ignore]
    fn smoke() {
        let url = std::env::var("NUDGE_SMOKE_URL").expect("set NUDGE_SMOKE_URL to a .gguf URL");
        let file = url.rsplit('/').next().unwrap().split('?').next().unwrap().to_string();
        let dir = std::env::var("NUDGE_SMOKE_DIR").map(std::path::PathBuf::from).unwrap_or_else(|_| std::env::temp_dir().join("nudge-smoke"));
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let state = AppState::new(dir);
            if !state.models_dir().join(&file).exists() {
                let progress = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
                downloads::download(&state, "dl", &url, &file, channel(progress.clone())).await.expect("download");
                println!("downloaded; {} progress events", progress.lock().unwrap().len());
            }
            {
                let mut s = state.settings.write().await;
                s.local_model = file.clone();
                s.local_context = 4096;
            }
            let mut messages = vec![ai::Turn {
                role: "user".into(),
                content: "<document>\n(Nothing written yet.)\n</document>\n\nHere is what I want this document to do: a short reflection on why I keep a reading journal. Help me get started.".into(),
            }];
            for turn in 0..2 {
                let events = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
                let started = std::time::Instant::now();
                let req = ai::ChatRequest {
                    request_id: format!("t{turn}"),
                    provider: "local".into(),
                    model: file.clone(),
                    system: format!("{}\n\n# The writer's goal\n\nA short reflection on why I keep a reading journal.", "You are Nudge, a writing guide. Ask one short question at a time. Never write the document for the writer."),
                    messages: messages.clone(),
                    max_tokens: 120,
                    local: ai::local::LocalOptions { format: "chatml-nothink".into(), temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0.0, presence_penalty: 1.5 },
                };
                ai::chat(&state, req, channel(events.clone())).await.expect("chat turn");
                let ev = events.lock().unwrap();
                let text: String = ev.iter().filter(|e| e["type"] == "delta").map(|e| e["text"].as_str().unwrap_or("").to_string()).collect();
                let done = ev.iter().find(|e| e["type"] == "done").cloned();
                println!("--- turn {turn} ({:.1}s) ---\n{text}\n--- done: {done:?}", started.elapsed().as_secs_f32());
                assert!(!text.trim().is_empty(), "the model said nothing");
                assert!(!text.contains("<think>"), "thinking leaked into the reply");
                messages.push(ai::Turn { role: "assistant".into(), content: text });
                messages.push(ai::Turn { role: "user".into(), content: "<document>\n(Nothing written yet.)\n</document>\n\nMostly to remember what I read, and to argue with authors.".into() });
            }
        });
    }
}
