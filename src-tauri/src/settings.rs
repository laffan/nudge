//! Settings the Rust core needs: keys, the Zotero library, and which model
//! answers. Kept as plain JSON in the app's data folder. Device-local UI
//! preferences (column widths, editor font, shortcuts) live in the
//! frontend's localStorage instead — nothing here is about layout.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    // Zotero
    pub zotero_api_key: String,
    /// Numeric user ID, or the group's ID when `zotero_library_type` is "group".
    pub zotero_library_id: String,
    /// "user" or "group".
    pub zotero_library_type: String,

    // AI
    /// Which service and model each use of AI takes ("chat", "review"):
    /// { "chat": { "provider": "anthropic", "model": "claude-opus-5-5" }, … }.
    /// Its shape belongs to the frontend (src/lib/settings.ts); this side
    /// keeps it as given.
    pub uses: serde_json::Value,
    /// Before uses: the one provider every turn went to. Read once by the
    /// frontend to fill `uses` in; kept so older settings still load.
    pub provider: String,
    pub anthropic_api_key: String,
    pub openai_api_key: String,
    pub anthropic_model: String,
    pub openai_model: String,
    /// File name of the GGUF in the models folder.
    pub local_model: String,
    /// "low", "medium" or "high" — Anthropic's effort setting.
    pub effort: String,
    /// When an online provider can't be reached, answer with the
    /// on-device model instead (if one is installed).
    pub offline_fallback: bool,
    /// Context window for the on-device model, in tokens. Memory grows
    /// with it; 8192 suits an 8 GB iPad.
    pub local_context: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            zotero_api_key: String::new(),
            zotero_library_id: String::new(),
            zotero_library_type: "user".into(),
            uses: serde_json::Value::Object(Default::default()),
            provider: "local".into(),
            anthropic_api_key: String::new(),
            openai_api_key: String::new(),
            anthropic_model: "claude-opus-5-5".into(),
            openai_model: "gpt-6.2-sol".into(),
            local_model: String::new(),
            effort: "medium".into(),
            offline_fallback: true,
            local_context: 8192,
        }
    }
}

fn path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("settings.json")
}

pub fn load(data_dir: &Path) -> Settings {
    std::fs::read_to_string(path(data_dir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

impl Settings {
    /// As the frontend sees them: the API keys left out. A saved key is
    /// never shown again (as in Snorkle); `ai_status` says which are saved.
    pub fn without_keys(&self) -> Settings {
        Settings { anthropic_api_key: String::new(), openai_api_key: String::new(), ..self.clone() }
    }
}

pub fn save(data_dir: &Path, s: &Settings) -> crate::Result<()> {
    std::fs::write(path(data_dir), serde_json::to_string_pretty(s)?)?;
    Ok(())
}
