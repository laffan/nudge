//! Zotero Web API v3, read-only: what Nudge needs to attach works from the
//! writer's library to a conversation — checking a key, browsing
//! collections, searching, an item's children (its PDF, its notes), the
//! PDF itself, and the annotations made on it.
//!
//! Annotations need no special endpoint: in Zotero an annotation is an
//! ordinary item (itemType "annotation") whose parent is the PDF
//! attachment, so they are the attachment's children. They are returned
//! raw here and read on the frontend (src/lib/zotero.ts), as Zotero
//! Helper does.

use crate::state::AppState;
use crate::{Error, Result};
use serde_json::Value;

const API: &str = "https://api.zotero.org";
const PAGE: usize = 100;

async fn base(state: &AppState) -> Result<(String, String)> {
    let s = state.settings.read().await;
    let key = s.zotero_api_key.trim().to_string();
    let id = s.zotero_library_id.trim().to_string();
    if key.is_empty() || id.is_empty() {
        return Err(Error::msg(
            "Zotero isn't set up yet — add your API key in Settings → Zotero",
        ));
    }
    let kind = if s.zotero_library_type == "group" { "groups" } else { "users" };
    Ok((format!("{API}/{kind}/{id}"), key))
}

fn status_error(what: &str, status: reqwest::StatusCode) -> Error {
    let hint = match status.as_u16() {
        403 => " — the key may lack access to this library",
        404 => " — not found in this library",
        429 => " — Zotero asks us to slow down; try again in a moment",
        _ => "",
    };
    Error::msg(format!("Zotero {what} failed (HTTP {status}){hint}"))
}

async fn get_json(state: &AppState, url: &str, query: &[(&str, String)]) -> Result<(Value, usize)> {
    let (_, key) = base(state).await?;
    let resp = state
        .http
        .get(url)
        .header("Zotero-API-Key", key)
        .header("Zotero-API-Version", "3")
        .query(query)
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(status_error("request", resp.status()));
    }
    let total = resp
        .headers()
        .get("total-results")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    Ok((resp.json().await?, total))
}

/// Every page of a listing, up to `cap` objects.
async fn get_all(state: &AppState, url: &str, query: Vec<(&str, String)>, cap: usize) -> Result<Vec<Value>> {
    let mut out = Vec::new();
    let mut start = 0usize;
    loop {
        let mut q = query.clone();
        q.push(("limit", PAGE.to_string()));
        q.push(("start", start.to_string()));
        let (page, total) = get_json(state, url, &q).await?;
        let items = page.as_array().cloned().unwrap_or_default();
        let n = items.len();
        out.extend(items);
        start += n;
        if n < PAGE || start >= total || out.len() >= cap {
            break;
        }
    }
    Ok(out)
}

/// Check a key: Zotero answers with the user it belongs to.
pub async fn verify_key(state: &AppState, key: &str) -> Result<Value> {
    let resp = state
        .http
        .get(format!("{API}/keys/current"))
        .header("Zotero-API-Key", key.trim())
        .header("Zotero-API-Version", "3")
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(Error::msg(format!(
            "Zotero rejected the API key (HTTP {})",
            resp.status()
        )));
    }
    Ok(resp.json().await?)
}

pub async fn collections(state: &AppState) -> Result<Vec<Value>> {
    let (b, _) = base(state).await?;
    get_all(state, &format!("{b}/collections"), vec![("format", "json".into())], 5000).await
}

/// Top-level items matching `q` (title, creator, year), optionally within
/// a collection. An empty `q` lists the collection (or the library's most
/// recently modified items).
pub async fn search(state: &AppState, q: &str, collection: Option<&str>) -> Result<Vec<Value>> {
    let (b, _) = base(state).await?;
    let url = match collection {
        Some(c) if !c.is_empty() => format!("{b}/collections/{c}/items/top"),
        _ => format!("{b}/items/top"),
    };
    let mut query = vec![
        ("format", "json".to_string()),
        ("include", "data".to_string()),
        // Repeated parameters are ANDed: neither standalone files nor notes.
        ("itemType", "-attachment".to_string()),
        ("itemType", "-note".to_string()),
        ("limit", "50".to_string()),
        ("sort", "dateModified".to_string()),
        ("direction", "desc".to_string()),
    ];
    if !q.trim().is_empty() {
        query.push(("q", q.trim().to_string()));
        query.push(("qmode", "titleCreatorYear".to_string()));
    }
    let (v, _) = get_json(state, &url, &query).await?;
    Ok(v.as_array().cloned().unwrap_or_default())
}

/// An item's children: its attachments and notes.
pub async fn children(state: &AppState, key: &str) -> Result<Vec<Value>> {
    let (b, _) = base(state).await?;
    get_all(
        state,
        &format!("{b}/items/{key}/children"),
        vec![("format", "json".into()), ("include", "data".into())],
        500,
    )
    .await
}

/// The annotations on a PDF attachment, in Zotero's reading order.
pub async fn annotations(state: &AppState, att_key: &str) -> Result<Vec<Value>> {
    let (b, _) = base(state).await?;
    get_all(
        state,
        &format!("{b}/items/{att_key}/children"),
        vec![
            ("format", "json".into()),
            ("include", "data".into()),
            ("itemType", "annotation".into()),
        ],
        5000,
    )
    .await
}

/// An attachment's file. Zotero redirects to its storage; reqwest follows.
pub async fn download(state: &AppState, att_key: &str) -> Result<Vec<u8>> {
    let (b, key) = base(state).await?;
    let resp = state
        .http
        .get(format!("{b}/items/{att_key}/file"))
        .header("Zotero-API-Key", key)
        .header("Zotero-API-Version", "3")
        .timeout(std::time::Duration::from_secs(300))
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(status_error("file download", resp.status()));
    }
    Ok(resp.bytes().await?.to_vec())
}
