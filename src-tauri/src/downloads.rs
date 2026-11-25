//! Fetching an on-device model: a multi-gigabyte GGUF from Hugging Face,
//! streamed to `models/<file>.part` with progress, then renamed into place
//! so a half-finished download is never mistaken for a model. A `.part`
//! left by an interrupted download is resumed with a Range request.

use crate::state::AppState;
use crate::{Error, Result};
use futures_util::StreamExt;
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::ipc::Channel;
use tokio::io::AsyncWriteExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub received: u64,
    pub total: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModel {
    pub file: String,
    pub bytes: u64,
}

pub fn installed(state: &AppState) -> Vec<InstalledModel> {
    let mut out = Vec::new();
    if let Ok(dir) = std::fs::read_dir(state.models_dir()) {
        for e in dir.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".gguf") {
                let bytes = e.metadata().map(|m| m.len()).unwrap_or(0);
                out.push(InstalledModel { file: name, bytes });
            }
        }
    }
    out.sort_by(|a, b| a.file.cmp(&b.file));
    out
}

pub async fn download(
    state: &AppState,
    id: &str,
    url: &str,
    file: &str,
    progress: Channel<Progress>,
) -> Result<()> {
    crate::storage::check_file_name(file)?;
    if !url.starts_with("https://") {
        return Err(Error::msg("Model downloads must use https"));
    }
    let dir = state.models_dir();
    let part = dir.join(format!("{file}.part"));
    let done = dir.join(file);
    let have = tokio::fs::metadata(&part).await.map(|m| m.len()).unwrap_or(0);

    let stop = state.cancel_flag(id);
    let result = async {
        let mut req = state.http.get(url);
        if have > 0 {
            req = req.header("Range", format!("bytes={have}-"));
        }
        let resp = req.send().await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(Error::msg(format!("The download was refused (HTTP {status})")));
        }
        // 206 means the server is resuming; anything else starts over.
        let resuming = status.as_u16() == 206;
        let start = if resuming { have } else { 0 };
        let total = start + resp.content_length().unwrap_or(0);
        let mut out = if resuming {
            tokio::fs::OpenOptions::new().append(true).open(&part).await?
        } else {
            tokio::fs::File::create(&part).await?
        };
        let mut received = start;
        let mut last_sent = 0u64;
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            if stop.load(Ordering::SeqCst) {
                out.flush().await?;
                return Err(Error::msg("Download paused"));
            }
            let chunk = chunk?;
            out.write_all(&chunk).await?;
            received += chunk.len() as u64;
            if received - last_sent > 4 * 1024 * 1024 || received == total {
                last_sent = received;
                let _ = progress.send(Progress { received, total });
            }
        }
        out.flush().await?;
        drop(out);
        if total > 0 && received < total {
            return Err(Error::msg("The download ended early — try again to resume it"));
        }
        tokio::fs::rename(&part, &done).await?;
        let _ = progress.send(Progress { received, total: received });
        Ok(())
    }
    .await;
    state.finish_cancel(id);
    result
}

pub fn delete(state: &AppState, file: &str) -> Result<()> {
    crate::storage::check_file_name(file)?;
    let dir = state.models_dir();
    let _ = std::fs::remove_file(dir.join(file));
    let _ = std::fs::remove_file(dir.join(format!("{file}.part")));
    Ok(())
}

/// Bytes already fetched of an interrupted download, if any.
pub fn partial(state: &AppState, file: &str) -> u64 {
    std::fs::metadata(state.models_dir().join(format!("{file}.part")))
        .map(|m| m.len())
        .unwrap_or(0)
}
