//! Documents and their sources on disk.
//!
//!   documents/<id>.json      one document: its goal, the conversation, the
//!                            text the writer has written, its sources' records
//!   documents/index.json     the sidebar's list (id, title, dates), so
//!                            opening the app doesn't parse every conversation
//!   sources/<id>.pdf         an attached PDF, copied in so it reads offline
//!   sources/<id>.text.json   its text, page by page, extracted once
//!
//! The document's shape belongs to the frontend (src/lib/types.ts); this
//! side stores it as given and reads only the fields the index needs.

use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct DocSummary {
    pub id: String,
    pub title: String,
    pub goal: String,
    pub created_ms: u64,
    pub updated_ms: u64,
    pub words: u64,
}

/// Ids come from the frontend and become file names: letters, digits,
/// `-` and `_` only, so nothing can climb out of its folder.
pub fn check_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 80
        || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(Error::msg(format!("Invalid id “{id}”")));
    }
    Ok(())
}

/// A model file name: no folders, and the GGUF extension.
pub fn check_file_name(name: &str) -> Result<()> {
    let ok = !name.is_empty()
        && name.len() < 200
        && name.ends_with(".gguf")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !name.contains("..");
    if !ok {
        return Err(Error::msg(format!("Invalid model file name “{name}”")));
    }
    Ok(())
}

fn docs_dir(data: &Path) -> PathBuf {
    data.join("documents")
}

fn sources_dir(data: &Path) -> PathBuf {
    data.join("sources")
}

fn index_path(data: &Path) -> PathBuf {
    docs_dir(data).join("index.json")
}

fn summary_of(doc: &Value) -> DocSummary {
    let s = |k: &str| doc[k].as_str().unwrap_or("").to_string();
    let n = |k: &str| doc[k].as_u64().unwrap_or(0);
    let text = doc["content"].as_str().unwrap_or("");
    DocSummary {
        id: s("id"),
        title: s("title"),
        goal: s("goal").chars().take(200).collect(),
        created_ms: n("createdMs"),
        updated_ms: n("updatedMs"),
        words: text.split_whitespace().count() as u64,
    }
}

fn write_index(data: &Path, list: &[DocSummary]) -> Result<()> {
    std::fs::write(index_path(data), serde_json::to_string(list)?)?;
    Ok(())
}

/// Rebuild the index from the documents themselves — on first run, or if
/// the index went missing or unreadable.
fn rebuild_index(data: &Path) -> Result<Vec<DocSummary>> {
    let mut list = Vec::new();
    for entry in std::fs::read_dir(docs_dir(data))?.flatten() {
        let p = entry.path();
        if p.file_name().and_then(|n| n.to_str()) == Some("index.json") {
            continue;
        }
        if p.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(&p) {
            if let Ok(doc) = serde_json::from_str::<Value>(&text) {
                list.push(summary_of(&doc));
            }
        }
    }
    write_index(data, &list)?;
    Ok(list)
}

pub fn list_documents(data: &Path) -> Result<Vec<DocSummary>> {
    let mut list = match std::fs::read_to_string(index_path(data)) {
        Ok(t) => match serde_json::from_str::<Vec<DocSummary>>(&t) {
            Ok(l) => l,
            Err(_) => rebuild_index(data)?,
        },
        Err(_) => rebuild_index(data)?,
    };
    list.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms));
    Ok(list)
}

pub fn load_document(data: &Path, id: &str) -> Result<Value> {
    check_id(id)?;
    let text = std::fs::read_to_string(docs_dir(data).join(format!("{id}.json")))
        .map_err(|_| Error::msg("That document could not be found"))?;
    Ok(serde_json::from_str(&text)?)
}

/// Write a document (atomically: a temp file, then a rename, so a crash
/// mid-save never leaves half a conversation) and refresh its index row.
pub fn save_document(data: &Path, doc: &Value) -> Result<DocSummary> {
    let summary = summary_of(doc);
    check_id(&summary.id)?;
    let dir = docs_dir(data);
    let tmp = dir.join(format!("{}.json.tmp", summary.id));
    std::fs::write(&tmp, serde_json::to_string(doc)?)?;
    std::fs::rename(&tmp, dir.join(format!("{}.json", summary.id)))?;
    let mut list = list_documents(data).unwrap_or_default();
    match list.iter_mut().find(|d| d.id == summary.id) {
        Some(row) => *row = summary.clone(),
        None => list.push(summary.clone()),
    }
    write_index(data, &list)?;
    Ok(summary)
}

/// Delete a document and the source files only it used.
pub fn delete_document(data: &Path, id: &str) -> Result<()> {
    check_id(id)?;
    if let Ok(doc) = load_document(data, id) {
        if let Some(sources) = doc["sources"].as_array() {
            for s in sources {
                if let Some(sid) = s["id"].as_str() {
                    let _ = delete_source(data, sid);
                }
            }
        }
    }
    let _ = std::fs::remove_file(docs_dir(data).join(format!("{id}.json")));
    let mut list = list_documents(data).unwrap_or_default();
    list.retain(|d| d.id != id);
    write_index(data, &list)?;
    Ok(())
}

pub fn save_source_file(data: &Path, id: &str, bytes: &[u8]) -> Result<()> {
    check_id(id)?;
    std::fs::write(sources_dir(data).join(format!("{id}.pdf")), bytes)?;
    Ok(())
}

pub fn read_source_file(data: &Path, id: &str) -> Result<Vec<u8>> {
    check_id(id)?;
    std::fs::read(sources_dir(data).join(format!("{id}.pdf")))
        .map_err(|_| Error::msg("This source's PDF is not on this device"))
}

pub fn save_source_text(data: &Path, id: &str, pages: &Value) -> Result<()> {
    check_id(id)?;
    std::fs::write(
        sources_dir(data).join(format!("{id}.text.json")),
        serde_json::to_string(pages)?,
    )?;
    Ok(())
}

pub fn load_source_text(data: &Path, id: &str) -> Result<Option<Value>> {
    check_id(id)?;
    match std::fs::read_to_string(sources_dir(data).join(format!("{id}.text.json"))) {
        Ok(t) => Ok(Some(serde_json::from_str(&t)?)),
        Err(_) => Ok(None),
    }
}

pub fn delete_source(data: &Path, id: &str) -> Result<()> {
    check_id(id)?;
    let dir = sources_dir(data);
    let _ = std::fs::remove_file(dir.join(format!("{id}.pdf")));
    let _ = std::fs::remove_file(dir.join(format!("{id}.text.json")));
    Ok(())
}
