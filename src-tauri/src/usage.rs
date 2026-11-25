//! The AI usage log behind Settings → AI → Usage (after Snorkle's): one
//! entry per request — when, which service and model, tokens in and out,
//! and the estimated cost the frontend priced it at (src/lib/ai/models.ts
//! holds the prices). Kept in usage.json in the app's data folder, the
//! newest 5,000 entries; nothing about what was asked.

use crate::Result;
use serde_json::Value;
use std::path::{Path, PathBuf};

const KEEP: usize = 5000;

fn path(data: &Path) -> PathBuf {
    data.join("usage.json")
}

pub fn list(data: &Path) -> Vec<Value> {
    std::fs::read_to_string(path(data))
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<Value>>(&t).ok())
        .unwrap_or_default()
}

pub fn add(data: &Path, event: Value) -> Result<()> {
    let mut all = list(data);
    all.push(event);
    if all.len() > KEEP {
        let drop = all.len() - KEEP;
        all.drain(..drop);
    }
    std::fs::write(path(data), serde_json::to_string(&all)?)?;
    Ok(())
}

pub fn reset(data: &Path) -> Result<()> {
    let _ = std::fs::remove_file(path(data));
    Ok(())
}
